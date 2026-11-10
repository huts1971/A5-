from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.api.deps import require_visitor
from app.core.errors import ApiError
from app.schemas import (
    PhotoWorkshopGenerateResponse,
    PhotoWorkshopPolishRequest,
    PhotoWorkshopPolishResponse,
)
from app.services.auth import AuthUser
from app.services.photo_workshop import (
    MAX_REFERENCE_IMAGE_BYTES,
    PromptPolishError,
    SeedreamClient,
    SeedreamProviderError,
    image_response_payload,
    polish_photo_prompt,
    seedream_size,
    validate_reference_image,
)


router = APIRouter(prefix="/api/photo-workshop", tags=["photo-workshop"])


@router.post("/polish", response_model=PhotoWorkshopPolishResponse)
def polish_prompt(
    payload: PhotoWorkshopPolishRequest,
    request: Request,
    _visitor: AuthUser = Depends(require_visitor),
) -> PhotoWorkshopPolishResponse:
    try:
        prompt = polish_photo_prompt(request.app.state.settings, payload.prompt)
    except PromptPolishError as exc:
        if exc.kind == "too_long":
            raise ApiError(
                "AI 润色结果过长，请精简原文后重试",
                "PHOTO_WORKSHOP_POLISH_TOO_LONG",
                502,
            ) from exc
        raise ApiError(
            "AI 润色暂时不可用，请稍后重试",
            "PHOTO_WORKSHOP_POLISH_UNAVAILABLE",
            502,
        ) from exc
    return PhotoWorkshopPolishResponse(prompt=prompt)


@router.post("/generate", response_model=PhotoWorkshopGenerateResponse)
async def generate_image(
    request: Request,
    images: list[UploadFile] | None = File(default=None, alias="image"),
    prompt: str = Form(...),
    aspect_ratio: str = Form("smart"),
    resolution: str = Form("1K"),
    _visitor: AuthUser = Depends(require_visitor),
) -> PhotoWorkshopGenerateResponse:
    if not images:
        raise ApiError(
            "请先上传一张参考图片",
            "PHOTO_WORKSHOP_IMAGE_REQUIRED",
            400,
        )
    if len(images) != 1:
        raise ApiError(
            "每次只能上传一张参考图片",
            "PHOTO_WORKSHOP_IMAGE_COUNT_INVALID",
            400,
        )
    image = images[0]
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise ApiError(
            "请先输入创意想法",
            "PHOTO_WORKSHOP_PROMPT_REQUIRED",
            400,
        )
    if len(clean_prompt) > 2000:
        raise ApiError(
            "创意想法不能超过 2000 个字符",
            "PHOTO_WORKSHOP_PROMPT_TOO_LONG",
            400,
        )
    seedream_size(aspect_ratio, resolution)
    raw = await image.read(MAX_REFERENCE_IMAGE_BYTES + 1)
    reference = validate_reference_image(
        raw,
        filename=image.filename or "",
        content_type=image.content_type or "",
    )
    settings = request.app.state.settings
    if not settings.photo_workshop_seedream_api_key:
        raise ApiError(
            "图片创作服务暂未配置",
            "PHOTO_WORKSHOP_NOT_CONFIGURED",
            503,
        )
    client = SeedreamClient(
        settings.photo_workshop_seedream_base_url,
        settings.photo_workshop_seedream_api_key,
        settings.photo_workshop_seedream_timeout_seconds,
    )
    try:
        result = client.generate(
            model=settings.photo_workshop_seedream_model,
            prompt=clean_prompt,
            image=reference,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
        )
    except SeedreamProviderError as exc:
        raise _seedream_api_error(exc) from exc
    return PhotoWorkshopGenerateResponse(**image_response_payload(result))


def _seedream_api_error(exc: SeedreamProviderError) -> ApiError:
    if exc.kind == "content_rejected":
        return ApiError(
            "图片或创意内容未通过服务审核，请调整后重试",
            "PHOTO_WORKSHOP_CONTENT_REJECTED",
            400,
        )
    if exc.kind == "not_configured":
        return ApiError(
            "图片创作服务配置无效",
            "PHOTO_WORKSHOP_NOT_CONFIGURED",
            503,
        )
    if exc.kind == "rate_limited":
        return ApiError(
            "图片创作请求较多，请稍后重试",
            "PHOTO_WORKSHOP_RATE_LIMITED",
            429,
        )
    if exc.kind == "timeout":
        return ApiError(
            "图片生成等待超时，请主动重试",
            "PHOTO_WORKSHOP_TIMEOUT",
            504,
        )
    if exc.kind == "invalid_response":
        return ApiError(
            "图片服务未返回有效结果，请稍后重试",
            "PHOTO_WORKSHOP_INVALID_RESPONSE",
            502,
        )
    return ApiError(
        "图片创作服务暂时不可用，请稍后重试",
        "PHOTO_WORKSHOP_UNAVAILABLE",
        502,
    )
