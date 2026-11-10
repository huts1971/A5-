from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from pathlib import Path

import httpx
from PIL import Image, UnidentifiedImageError

from app.core.config import Settings
from app.core.errors import ApiError
from app.services.mimo import MimoClient


MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
MAX_RESULT_IMAGE_BYTES = 30 * 1024 * 1024
ALLOWED_ASPECT_RATIOS = {
    "smart",
    "1:1",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "2:3",
    "3:2",
    "21:9",
}
ALLOWED_RESOLUTIONS = {"1K", "2K"}

_EXTENSION_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
_PIL_MIME_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
_FIXED_SIZES = {
    "1K": {
        "1:1": "1024x1024",
        "3:4": "864x1152",
        "4:3": "1152x864",
        "16:9": "1344x768",
        "9:16": "768x1344",
        "2:3": "832x1248",
        "3:2": "1248x832",
        "21:9": "1536x640",
    },
    "2K": {
        "1:1": "2048x2048",
        "3:4": "1728x2304",
        "4:3": "2304x1728",
        "16:9": "2560x1440",
        "9:16": "1440x2560",
        "2:3": "1664x2496",
        "3:2": "2496x1664",
        "21:9": "3024x1296",
    },
}

PHOTO_PROMPT_POLISH_SYSTEM = """你是“灵诗音相册创意工坊”的图片编辑提示词专家。
请在不改变游客核心意图的前提下，把原文润色并适度扩写为一段可直接用于图生图编辑的中文提示词。

规则：
1. 使用自然、清晰、具体的语言，优先写明主体、动作和环境。
2. 按游客意图补充必要的风格、色彩、光影、构图和应用场景，不添加无关主体。
3. 有明确风格时使用精准风格词；参考图是编辑对象，必须说明参考图的作用。
4. 需要在画面中生成的文字必须放在中文双引号中。
5. 明确需要修改的对象和具体操作，并写明必须保持不变的主体、构图或细节。
6. 不要解释规则，不要添加标题、列表、前后缀或 Markdown，只输出润色后的最终提示词。
7. 最终内容不得超过 2000 个字符。"""


@dataclass(frozen=True)
class ValidatedReferenceImage:
    data: bytes
    mime_type: str
    width: int
    height: int


@dataclass(frozen=True)
class GeneratedImage:
    data: bytes
    mime_type: str
    width: int
    height: int


class SeedreamProviderError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class PromptPolishError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class SeedreamClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_seconds: float,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    def generate(
        self,
        *,
        model: str,
        prompt: str,
        image: ValidatedReferenceImage,
        aspect_ratio: str,
        resolution: str,
    ) -> GeneratedImage:
        payload = {
            "model": model,
            "prompt": prompt,
            "image": _image_data_url(image),
            "size": seedream_size(
                aspect_ratio,
                resolution,
                reference_width=image.width,
                reference_height=image.height,
            ),
            "response_format": "b64_json",
            "output_format": "png",
            "watermark": False,
        }
        try:
            with httpx.Client(
                timeout=self.timeout_seconds,
                transport=self.transport,
            ) as client:
                response = client.post(
                    f"{self.base_url}/images/generations",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                if response.status_code >= 400:
                    raise SeedreamProviderError(_provider_error_kind(response.status_code))
                try:
                    body = response.json()
                except ValueError as exc:
                    raise SeedreamProviderError("invalid_response") from exc
                image_bytes = _response_image_bytes(body, client)
        except httpx.TimeoutException as exc:
            raise SeedreamProviderError("timeout") from exc
        except httpx.RequestError as exc:
            raise SeedreamProviderError("unavailable") from exc
        return inspect_generated_image(image_bytes)


def validate_reference_image(
    raw: bytes,
    *,
    filename: str,
    content_type: str,
) -> ValidatedReferenceImage:
    if not raw:
        raise ApiError("请选择一张图片", "PHOTO_WORKSHOP_IMAGE_REQUIRED", 400)
    if len(raw) > MAX_REFERENCE_IMAGE_BYTES:
        raise ApiError(
            "图片不能超过 10 MB",
            "PHOTO_WORKSHOP_IMAGE_TOO_LARGE",
            400,
        )
    suffix = Path(filename).suffix.lower()
    expected_mime = _EXTENSION_MIME_TYPES.get(suffix)
    normalized_content_type = content_type.split(";", 1)[0].strip().lower()
    if not expected_mime or normalized_content_type != expected_mime:
        raise ApiError(
            "仅支持 JPEG、PNG 或 WebP 图片",
            "PHOTO_WORKSHOP_IMAGE_TYPE_INVALID",
            400,
        )
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            actual_mime = _PIL_MIME_TYPES.get((image.format or "").upper())
            width, height = image.size
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ApiError(
            "图片文件无法读取，请重新选择",
            "PHOTO_WORKSHOP_IMAGE_INVALID",
            400,
        ) from exc
    if actual_mime != expected_mime or width < 1 or height < 1:
        raise ApiError(
            "图片格式与文件内容不一致",
            "PHOTO_WORKSHOP_IMAGE_TYPE_MISMATCH",
            400,
        )
    return ValidatedReferenceImage(
        data=raw,
        mime_type=actual_mime,
        width=width,
        height=height,
    )


def seedream_size(
    aspect_ratio: str,
    resolution: str,
    *,
    reference_width: int | None = None,
    reference_height: int | None = None,
) -> str:
    if aspect_ratio not in ALLOWED_ASPECT_RATIOS:
        raise ApiError(
            "请选择有效的图片比例",
            "PHOTO_WORKSHOP_ASPECT_RATIO_INVALID",
            400,
        )
    if resolution not in ALLOWED_RESOLUTIONS:
        raise ApiError(
            "请选择 1K 或 2K 清晰度",
            "PHOTO_WORKSHOP_RESOLUTION_INVALID",
            400,
        )
    if aspect_ratio == "smart":
        if reference_width and reference_height:
            source_ratio = reference_width / reference_height
            aspect_ratio = min(
                _FIXED_SIZES[resolution],
                key=lambda value: abs(
                    source_ratio
                    - (int(value.split(":")[0]) / int(value.split(":")[1]))
                ),
            )
            return _FIXED_SIZES[resolution][aspect_ratio]
        return resolution
    return _FIXED_SIZES[resolution][aspect_ratio]


def inspect_generated_image(raw: bytes) -> GeneratedImage:
    if not raw or len(raw) > MAX_RESULT_IMAGE_BYTES:
        raise SeedreamProviderError("invalid_response")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            mime_type = _PIL_MIME_TYPES.get((image.format or "").upper())
            width, height = image.size
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise SeedreamProviderError("invalid_response") from exc
    if not mime_type or width < 1 or height < 1:
        raise SeedreamProviderError("invalid_response")
    return GeneratedImage(raw, mime_type, width, height)


def polish_photo_prompt(
    settings: Settings,
    prompt: str,
    *,
    client: MimoClient | None = None,
) -> str:
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise ApiError(
            "请先输入创意想法",
            "PHOTO_WORKSHOP_PROMPT_REQUIRED",
            400,
        )
    if not settings.llm_api_key:
        raise ApiError(
            "AI 提示词润色暂未配置",
            "PHOTO_WORKSHOP_POLISH_NOT_CONFIGURED",
            503,
        )
    active_client = client or MimoClient(
        settings.llm_base_url,
        settings.llm_api_key,
    )
    try:
        result = active_client.chat_completion(
            model=settings.photo_workshop_polish_model,
            system_prompt=PHOTO_PROMPT_POLISH_SYSTEM,
            user_prompt=clean_prompt,
            temperature=0.55,
            max_completion_tokens=1400,
            timeout_seconds=settings.photo_workshop_polish_timeout_seconds,
        ).strip()
    except Exception as exc:
        raise PromptPolishError("unavailable") from exc
    if not result:
        raise PromptPolishError("empty")
    if len(result) > 2000:
        raise PromptPolishError("too_long")
    return result


def image_response_payload(image: GeneratedImage) -> dict:
    return {
        "image_base64": base64.b64encode(image.data).decode("ascii"),
        "mime_type": image.mime_type,
        "width": image.width,
        "height": image.height,
    }


def _image_data_url(image: ValidatedReferenceImage) -> str:
    encoded = base64.b64encode(image.data).decode("ascii")
    return f"data:{image.mime_type};base64,{encoded}"


def _provider_error_kind(status_code: int) -> str:
    if status_code in {400, 422}:
        return "content_rejected"
    if status_code in {401, 403}:
        return "not_configured"
    if status_code == 429:
        return "rate_limited"
    return "unavailable"


def _response_image_bytes(body: object, client: httpx.Client) -> bytes:
    if not isinstance(body, dict):
        raise SeedreamProviderError("invalid_response")
    data = body.get("data")
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise SeedreamProviderError("invalid_response")
    item = data[0]
    encoded = item.get("b64_json")
    if isinstance(encoded, str) and encoded:
        try:
            return base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise SeedreamProviderError("invalid_response") from exc
    url = item.get("url")
    if not isinstance(url, str) or not url.startswith(("https://", "http://")):
        raise SeedreamProviderError("invalid_response")
    try:
        response = client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SeedreamProviderError("unavailable") from exc
    return response.content
