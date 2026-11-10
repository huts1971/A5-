import base64
import io
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.core.errors import ApiError
from app.main import create_app
from app.services.mimo import MimoClient
from app.services.photo_workshop import (
    GeneratedImage,
    MAX_REFERENCE_IMAGE_BYTES,
    SeedreamClient,
    SeedreamProviderError,
    seedream_size,
    validate_reference_image,
)


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path, **overrides):
    settings_data = {
        "database_url": f"sqlite:///{tmp_path / 'app.db'}",
        "source_package_path": str(SOURCE_PACKAGE_PATH),
        "tts_mode": "disabled",
        "guide_warmup_on_startup": "false",
        "llm_api_key": "test-mimo-key",
        "photo_workshop_seedream_api_key": "test-seedream-key",
        **overrides,
    }
    return TestClient(create_app(Settings(**settings_data)))


def visitor_headers(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "photo_user", "password": "secret123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def image_bytes(image_format="PNG", size=(80, 60)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "#d8c7aa").save(buffer, format=image_format)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("resolution", "aspect_ratio", "expected"),
    [
        ("1K", "smart", "1K"),
        ("2K", "smart", "2K"),
        ("1K", "1:1", "1024x1024"),
        ("1K", "3:4", "864x1152"),
        ("1K", "4:3", "1152x864"),
        ("1K", "16:9", "1344x768"),
        ("1K", "9:16", "768x1344"),
        ("1K", "2:3", "832x1248"),
        ("1K", "3:2", "1248x832"),
        ("1K", "21:9", "1536x640"),
        ("2K", "3:4", "1728x2304"),
        ("2K", "4:3", "2304x1728"),
        ("2K", "16:9", "2560x1440"),
        ("2K", "9:16", "1440x2560"),
        ("2K", "2:3", "1664x2496"),
        ("2K", "3:2", "2496x1664"),
        ("2K", "21:9", "3024x1296"),
    ],
)
def test_seedream_size_mapping(resolution, aspect_ratio, expected):
    assert seedream_size(aspect_ratio, resolution) == expected


def test_seedream_size_rejects_unknown_values():
    with pytest.raises(ApiError):
        seedream_size("5:7", "1K")
    with pytest.raises(ApiError):
        seedream_size("smart", "4K")


def test_seedream_size_smart_matches_reference_orientation():
    assert seedream_size(
        "smart",
        "1K",
        reference_width=1039,
        reference_height=1559,
    ) == "832x1248"
    assert seedream_size(
        "smart",
        "1K",
        reference_width=1559,
        reference_height=1039,
    ) == "1248x832"


def test_seedream_client_sends_single_reference_contract():
    source = validate_reference_image(
        image_bytes(),
        filename="source.png",
        content_type="image/png",
    )
    result_bytes = image_bytes(size=(96, 96))
    captured = {}

    def handler(request):
        captured["authorization"] = request.headers.get("Authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "data": [
                    {"b64_json": base64.b64encode(result_bytes).decode("ascii")}
                ]
            },
        )

    client = SeedreamClient(
        "https://ark.example/api/v3",
        "secret-test-key",
        30,
        transport=httpx.MockTransport(handler),
    )
    result = client.generate(
        model="doubao-seedream-5-0-pro-260628",
        prompt="把照片变成冬日动漫场景，保持构图不变。",
        image=source,
        aspect_ratio="16:9",
        resolution="2K",
    )

    assert captured["authorization"] == "Bearer secret-test-key"
    assert captured["body"]["model"] == "doubao-seedream-5-0-pro-260628"
    assert captured["body"]["size"] == "2560x1440"
    assert "sequential_image_generation" not in captured["body"]
    assert captured["body"]["watermark"] is False
    assert captured["body"]["image"].startswith("data:image/png;base64,")
    assert result.mime_type == "image/png"
    assert (result.width, result.height) == (96, 96)


def test_validate_reference_image_checks_extension_mime_and_content():
    raw = image_bytes()
    valid = validate_reference_image(
        raw,
        filename="photo.png",
        content_type="image/png",
    )
    assert valid.mime_type == "image/png"
    assert (valid.width, valid.height) == (80, 60)

    with pytest.raises(ApiError) as mismatch:
        validate_reference_image(
            raw,
            filename="photo.jpg",
            content_type="image/jpeg",
        )
    assert mismatch.value.code == "PHOTO_WORKSHOP_IMAGE_TYPE_MISMATCH"

    with pytest.raises(ApiError) as unsupported:
        validate_reference_image(
            raw,
            filename="photo.gif",
            content_type="image/gif",
        )
    assert unsupported.value.code == "PHOTO_WORKSHOP_IMAGE_TYPE_INVALID"


def test_validate_reference_image_rejects_empty_oversized_and_corrupt_files():
    with pytest.raises(ApiError) as empty:
        validate_reference_image(
            b"",
            filename="photo.png",
            content_type="image/png",
        )
    assert empty.value.code == "PHOTO_WORKSHOP_IMAGE_REQUIRED"

    with pytest.raises(ApiError) as oversized:
        validate_reference_image(
            b"x" * (MAX_REFERENCE_IMAGE_BYTES + 1),
            filename="photo.png",
            content_type="image/png",
        )
    assert oversized.value.code == "PHOTO_WORKSHOP_IMAGE_TOO_LARGE"

    with pytest.raises(ApiError) as corrupt:
        validate_reference_image(
            b"not-a-real-png",
            filename="photo.png",
            content_type="image/png",
        )
    assert corrupt.value.code == "PHOTO_WORKSHOP_IMAGE_INVALID"


@pytest.mark.parametrize(
    ("image_format", "filename", "content_type", "expected_mime"),
    [
        ("JPEG", "photo.jpg", "image/jpeg", "image/jpeg"),
        ("PNG", "photo.png", "image/png", "image/png"),
        ("WEBP", "photo.webp", "image/webp", "image/webp"),
    ],
)
def test_validate_reference_image_accepts_supported_formats(
    image_format,
    filename,
    content_type,
    expected_mime,
):
    validated = validate_reference_image(
        image_bytes(image_format),
        filename=filename,
        content_type=content_type,
    )
    assert validated.mime_type == expected_mime


def test_generate_endpoint_returns_image_and_never_exposes_provider_key(
    tmp_path,
    monkeypatch,
):
    expected = image_bytes(size=(120, 90))
    captured = {}

    def fake_generate(self, **kwargs):
        captured.update(kwargs)
        return GeneratedImage(expected, "image/png", 120, 90)

    monkeypatch.setattr(SeedreamClient, "generate", fake_generate)
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client)
        response = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={
                "prompt": "改成漫画风，保持主体和构图不变。",
                "aspect_ratio": "smart",
                "resolution": "1K",
            },
        )

    assert response.status_code == 200
    assert response.json()["mime_type"] == "image/png"
    assert response.json()["width"] == 120
    assert response.json()["height"] == 90
    assert base64.b64decode(response.json()["image_base64"]) == expected
    assert captured["model"] == "doubao-seedream-5-0-pro-260628"
    assert captured["aspect_ratio"] == "smart"
    assert "test-seedream-key" not in response.text


def test_generate_endpoint_rejects_missing_config_and_bad_image(tmp_path):
    with create_test_client(
        tmp_path,
        photo_workshop_seedream_api_key="",
    ) as client:
        headers = visitor_headers(client)
        response = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={"prompt": "改成冬季风格。"},
        )
        invalid = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", b"not-an-image", "image/png")},
            data={"prompt": "改成冬季风格。"},
        )

    assert response.status_code == 503
    assert response.json()["code"] == "PHOTO_WORKSHOP_NOT_CONFIGURED"
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "PHOTO_WORKSHOP_IMAGE_INVALID"


def test_generate_endpoint_rejects_missing_or_multiple_images_and_bad_prompt(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client)
        missing_image = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            data={"prompt": "改成冬季风格。"},
        )
        multiple_images = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files=[
                ("image", ("first.png", image_bytes(), "image/png")),
                ("image", ("second.png", image_bytes(), "image/png")),
            ],
            data={"prompt": "改成冬季风格。"},
        )
        empty_prompt = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={"prompt": "   "},
        )
        long_prompt = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={"prompt": "字" * 2001},
        )

    assert missing_image.status_code == 400
    assert missing_image.json()["code"] == "PHOTO_WORKSHOP_IMAGE_REQUIRED"
    assert multiple_images.status_code == 400
    assert multiple_images.json()["code"] == "PHOTO_WORKSHOP_IMAGE_COUNT_INVALID"
    assert empty_prompt.status_code == 400
    assert empty_prompt.json()["code"] == "PHOTO_WORKSHOP_PROMPT_REQUIRED"
    assert long_prompt.status_code == 400
    assert long_prompt.json()["code"] == "PHOTO_WORKSHOP_PROMPT_TOO_LONG"


def test_generate_endpoint_maps_provider_failure_without_secret(tmp_path, monkeypatch):
    def fail_generate(self, **_kwargs):
        raise SeedreamProviderError("unavailable")

    monkeypatch.setattr(SeedreamClient, "generate", fail_generate)
    with create_test_client(
        tmp_path,
        photo_workshop_seedream_api_key="super-private-key",
    ) as client:
        headers = visitor_headers(client)
        response = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={"prompt": "改成冬季风格。"},
        )

    assert response.status_code == 502
    assert response.json()["code"] == "PHOTO_WORKSHOP_UNAVAILABLE"
    assert "super-private-key" not in response.text


@pytest.mark.parametrize(
    ("kind", "expected_status", "expected_code"),
    [
        ("content_rejected", 400, "PHOTO_WORKSHOP_CONTENT_REJECTED"),
        ("not_configured", 503, "PHOTO_WORKSHOP_NOT_CONFIGURED"),
        ("rate_limited", 429, "PHOTO_WORKSHOP_RATE_LIMITED"),
        ("timeout", 504, "PHOTO_WORKSHOP_TIMEOUT"),
        ("invalid_response", 502, "PHOTO_WORKSHOP_INVALID_RESPONSE"),
        ("unavailable", 502, "PHOTO_WORKSHOP_UNAVAILABLE"),
    ],
)
def test_generate_endpoint_maps_all_provider_errors_without_details(
    tmp_path,
    monkeypatch,
    kind,
    expected_status,
    expected_code,
):
    def fail_generate(self, **_kwargs):
        raise SeedreamProviderError(kind)

    monkeypatch.setattr(SeedreamClient, "generate", fail_generate)
    with create_test_client(
        tmp_path,
        photo_workshop_seedream_api_key="never-return-this-key",
    ) as client:
        headers = visitor_headers(client)
        response = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={"prompt": "改成冬季风格。"},
        )

    assert response.status_code == expected_status
    assert response.json()["code"] == expected_code
    assert kind not in response.text
    assert "never-return-this-key" not in response.text


@pytest.mark.parametrize(
    ("aspect_ratio", "resolution", "expected_code"),
    [
        ("5:7", "1K", "PHOTO_WORKSHOP_ASPECT_RATIO_INVALID"),
        ("smart", "4K", "PHOTO_WORKSHOP_RESOLUTION_INVALID"),
    ],
)
def test_generate_endpoint_rejects_invalid_product_parameters(
    tmp_path,
    aspect_ratio,
    resolution,
    expected_code,
):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client)
        response = client.post(
            "/api/photo-workshop/generate",
            headers=headers,
            files={"image": ("source.png", image_bytes(), "image/png")},
            data={
                "prompt": "改成冬季风格。",
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == expected_code


def test_seedream_client_accepts_temporary_url_response():
    source = validate_reference_image(
        image_bytes(),
        filename="source.png",
        content_type="image/png",
    )
    result_bytes = image_bytes(size=(140, 100))

    def handler(request):
        if request.url.path.endswith("/images/generations"):
            return httpx.Response(
                200,
                json={"data": [{"url": "https://assets.example/result.png"}]},
            )
        if str(request.url) == "https://assets.example/result.png":
            return httpx.Response(200, content=result_bytes)
        return httpx.Response(404)

    client = SeedreamClient(
        "https://ark.example/api/v3",
        "test-key",
        30,
        transport=httpx.MockTransport(handler),
    )
    result = client.generate(
        model="doubao-seedream-5-0-pro-260628",
        prompt="转换为冬日风格，保持构图不变。",
        image=source,
        aspect_ratio="smart",
        resolution="1K",
    )

    assert result.mime_type == "image/png"
    assert (result.width, result.height) == (140, 100)


def test_seedream_client_maps_transport_timeout():
    source = validate_reference_image(
        image_bytes(),
        filename="source.png",
        content_type="image/png",
    )

    def handler(request):
        raise httpx.ReadTimeout("private upstream timeout", request=request)

    client = SeedreamClient(
        "https://ark.example/api/v3",
        "test-key",
        30,
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(SeedreamProviderError) as failure:
        client.generate(
            model="doubao-seedream-5-0-pro-260628",
            prompt="转换为冬日风格，保持构图不变。",
            image=source,
            aspect_ratio="smart",
            resolution="1K",
        )

    assert failure.value.kind == "timeout"


def test_polish_endpoint_uses_dedicated_model_and_returns_editable_text(
    tmp_path,
    monkeypatch,
):
    captured = {}

    def fake_completion(self, **kwargs):
        captured.update(kwargs)
        return "将参考照片转换为冬季动漫风，保持主体位置与原有构图不变。"

    monkeypatch.setattr(MimoClient, "chat_completion", fake_completion)
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client)
        response = client.post(
            "/api/photo-workshop/polish",
            headers=headers,
            json={"prompt": "改成冬天动漫风"},
        )

    assert response.status_code == 200
    assert response.json()["prompt"].startswith("将参考照片转换为")
    assert captured["model"] == "mimo-v2.5-pro"
    assert "主体、动作和环境" in captured["system_prompt"]
    assert "双引号" in captured["system_prompt"]


def test_polish_endpoint_preserves_source_on_provider_or_length_failure(
    tmp_path,
    monkeypatch,
):
    responses = iter([RuntimeError("secret upstream detail"), "字" * 2001])

    def fake_completion(self, **_kwargs):
        result = next(responses)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(MimoClient, "chat_completion", fake_completion)
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client)
        unavailable = client.post(
            "/api/photo-workshop/polish",
            headers=headers,
            json={"prompt": "原始创意"},
        )
        too_long = client.post(
            "/api/photo-workshop/polish",
            headers=headers,
            json={"prompt": "原始创意"},
        )

    assert unavailable.status_code == 502
    assert unavailable.json()["code"] == "PHOTO_WORKSHOP_POLISH_UNAVAILABLE"
    assert "secret upstream detail" not in unavailable.text
    assert too_long.status_code == 502
    assert too_long.json()["code"] == "PHOTO_WORKSHOP_POLISH_TOO_LONG"


def test_polish_endpoint_handles_empty_provider_result_and_missing_config(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(MimoClient, "chat_completion", lambda self, **kwargs: "   ")
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client)
        empty_result = client.post(
            "/api/photo-workshop/polish",
            headers=headers,
            json={"prompt": "原始创意"},
        )

    assert empty_result.status_code == 502
    assert empty_result.json()["code"] == "PHOTO_WORKSHOP_POLISH_UNAVAILABLE"

    missing_config_path = tmp_path / "missing-config"
    missing_config_path.mkdir()
    with create_test_client(missing_config_path, llm_api_key="") as client:
        headers = visitor_headers(client)
        missing_config = client.post(
            "/api/photo-workshop/polish",
            headers=headers,
            json={"prompt": "原始创意"},
        )

    assert missing_config.status_code == 503
    assert missing_config.json()["code"] == "PHOTO_WORKSHOP_POLISH_NOT_CONFIGURED"
