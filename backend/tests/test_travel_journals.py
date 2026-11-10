import io
import json
from pathlib import Path
import re

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app
from app.services.travel_journals import KimiJournalClient, validate_generated_result


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path, **overrides):
    settings_data = {
        "database_url": f"sqlite:///{tmp_path / 'app.db'}",
        "source_package_path": str(SOURCE_PACKAGE_PATH),
        "travel_journal_asset_dir": str(tmp_path / "journal-assets"),
        "tts_mode": "disabled",
        "kimi_api_key": "",
        "guide_warmup_on_startup": "false",
        **overrides,
    }
    return TestClient(create_app(Settings(**settings_data)))


def visitor_headers(client, username):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "secret123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def admin_headers(client):
    response = client.post(
        "/api/auth/admin/login",
        json={"username": "admin", "password": "test-admin-password-123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def create_journal(client, headers, **payload):
    response = client.post(
        "/api/travel-journals",
        headers=headers,
        json={"description": "", "target_words": 600, **payload},
    )
    assert response.status_code == 200
    return response.json()


def generated_result(image_ids=()):
    if image_ids:
        body_length = max(1, 180 // len(image_ids))
        image_sections = [
            {
                "image_id": image_id,
                "title": f"旅途一景 {index + 1}",
                "body": "景" * body_length,
            }
            for index, image_id in enumerate(image_ids)
        ]
        current = 20 + sum(len(item["body"]) for item in image_sections)
        image_sections[-1]["body"] += "光" * (200 - current)
        text_sections = []
    else:
        image_sections = []
        text_sections = [
            {"id": f"text-{index}", "title": f"第{index}段", "body": "春" * 60}
            for index in range(1, 4)
        ]
    return {
        "title": "一日灵山行",
        "opening": "风" * 10,
        "text_sections": text_sections,
        "image_sections": image_sections,
        "conclusion": "心" * 10,
    }


def image_bytes(*, image_format="JPEG", with_exif=False):
    buffer = io.BytesIO()
    image = Image.new("RGB", (40, 24), (191, 153, 101))
    kwargs = {}
    if with_exif:
        exif = Image.Exif()
        exif[0x010E] = "private travel note"
        kwargs["exif"] = exif
    image.save(buffer, image_format, **kwargs)
    return buffer.getvalue()


def upload_image(client, headers, journal_id, filename="trip.jpg", content_type="image/jpeg"):
    return client.post(
        f"/api/travel-journals/{journal_id}/images",
        headers=headers,
        files=[
            (
                "files",
                (filename, image_bytes(with_exif=True), content_type),
            )
        ],
    )


def test_text_generation_saves_editable_draft_and_keeps_visitors_isolated(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(
        KimiJournalClient,
        "generate",
        lambda self, **kwargs: generated_result(),
    )
    with create_test_client(tmp_path, kimi_api_key="test-only") as client:
        owner = visitor_headers(client, "journal_owner")
        other = visitor_headers(client, "journal_other")
        journal = create_journal(client, owner)
        generated = client.post(
            f"/api/travel-journals/{journal['id']}/generate",
            headers=owner,
            json={"description": "今天在灵山慢慢走了一圈。", "target_words": 200},
        )
        forbidden = client.get(
            f"/api/travel-journals/{journal['id']}",
            headers=other,
        )
        forbidden_update = client.patch(
            f"/api/travel-journals/{journal['id']}",
            headers=other,
            json={"title": "不应写入"},
        )
        forbidden_copy = client.post(
            f"/api/travel-journals/{journal['id']}/copy",
            headers={**other, "Idempotency-Key": "foreign-copy"},
        )
        forbidden_export = client.get(
            f"/api/travel-journals/{journal['id']}/export.pdf",
            headers=other,
        )
        forbidden_delete = client.delete(
            f"/api/travel-journals/{journal['id']}",
            headers=other,
        )
        listed = client.get("/api/travel-journals", headers=owner)

    assert generated.status_code == 200
    body = generated.json()
    assert body["status"] == "draft"
    assert body["title"] == "一日灵山行"
    assert len(body["text_sections"]) == 3
    assert body["description"] == "今天在灵山慢慢走了一圈。"
    assert forbidden.status_code == 404
    assert forbidden_update.status_code == 404
    assert forbidden_copy.status_code == 404
    assert forbidden_export.status_code == 404
    assert forbidden_delete.status_code == 404
    assert listed.json()["items"][0]["id"] == journal["id"]


def test_generation_requires_material_and_preserves_input_when_kimi_is_missing(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client, "journal_failure")
        journal = create_journal(client, headers)
        empty = client.post(
            f"/api/travel-journals/{journal['id']}/generate",
            headers=headers,
            json={"description": "", "target_words": 600},
        )
        missing_kimi = client.post(
            f"/api/travel-journals/{journal['id']}/generate",
            headers=headers,
            json={"description": "请保留这段旅途感受", "target_words": 300},
        )
        reloaded = client.get(
            f"/api/travel-journals/{journal['id']}",
            headers=headers,
        )

    assert empty.status_code == 400
    assert empty.json()["code"] == "TRAVEL_JOURNAL_MATERIAL_REQUIRED"
    assert missing_kimi.status_code == 503
    assert missing_kimi.json()["code"] == "KIMI_NOT_CONFIGURED"
    assert reloaded.json()["description"] == "请保留这段旅途感受"
    assert reloaded.json()["target_words"] == 300


def test_text_and_word_validation_is_enforced(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client, "journal_validation")
        too_long = client.post(
            "/api/travel-journals",
            headers=headers,
            json={"description": "旅" * 2001, "target_words": 600},
        )
        too_short = client.post(
            "/api/travel-journals",
            headers=headers,
            json={"description": "一段感受", "target_words": 199},
        )
        too_large = client.post(
            "/api/travel-journals",
            headers=headers,
            json={"description": "一段感受", "target_words": 3001},
        )

    assert too_long.status_code == 422
    assert too_short.status_code == 422
    assert too_large.status_code == 422


def test_image_upload_removes_exif_and_supports_partial_failure(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client, "journal_images")
        journal = create_journal(client, headers)
        response = client.post(
            f"/api/travel-journals/{journal['id']}/images",
            headers=headers,
            files=[
                ("files", ("good.jpg", image_bytes(with_exif=True), "image/jpeg")),
                ("files", ("bad.txt", b"not an image", "text/plain")),
            ],
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["journal"]["images"]) == 1
    assert body["errors"][0]["code"] == "TRAVEL_JOURNAL_IMAGE_FORMAT_INVALID" or body[
        "errors"
    ][0]["code"] == "TRAVEL_JOURNAL_IMAGE_DECODE_FAILED"
    display_files = list((tmp_path / "journal-assets" / journal["id"] / "display").glob("*.jpg"))
    model_files = list((tmp_path / "journal-assets" / journal["id"] / "model").glob("*.jpg"))
    assert len(display_files) == 1
    assert len(model_files) == 1
    with Image.open(display_files[0]) as saved:
        assert saved.width <= 2560
        assert not saved.getexif()


def test_image_type_mismatch_and_nine_image_limit(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client, "journal_limits")
        journal = create_journal(client, headers)
        mismatch = client.post(
            f"/api/travel-journals/{journal['id']}/images",
            headers=headers,
            files=[("files", ("wrong.png", image_bytes(), "image/png"))],
        )
        files = [
            ("files", (f"trip-{index}.jpg", image_bytes(), "image/jpeg"))
            for index in range(10)
        ]
        limited = client.post(
            f"/api/travel-journals/{journal['id']}/images",
            headers=headers,
            files=files,
        )

    assert mismatch.json()["errors"][0]["code"] == "TRAVEL_JOURNAL_IMAGE_TYPE_MISMATCH"
    assert len(limited.json()["journal"]["images"]) == 9
    assert limited.json()["errors"][-1]["code"] == "TRAVEL_JOURNAL_IMAGE_LIMIT"


def test_multimodal_generation_maps_each_image_once_and_rejects_missing_mapping(
    tmp_path,
    monkeypatch,
):
    with create_test_client(tmp_path, kimi_api_key="test-only") as client:
        headers = visitor_headers(client, "journal_multimodal")
        journal = create_journal(client, headers)
        first = upload_image(client, headers, journal["id"], "one.jpg").json()
        second = upload_image(client, headers, journal["id"], "two.jpg").json()
        image_ids = [item["id"] for item in second["journal"]["images"]]

        monkeypatch.setattr(
            KimiJournalClient,
            "generate",
            lambda self, **kwargs: generated_result(image_ids),
        )
        generated = client.post(
            f"/api/travel-journals/{journal['id']}/generate",
            headers=headers,
            json={"description": "", "target_words": 200},
        )

        invalid = generated_result(image_ids)
        invalid["image_sections"] = invalid["image_sections"][:-1]
        monkeypatch.setattr(
            KimiJournalClient,
            "generate",
            lambda self, **kwargs: invalid,
        )
        rejected = client.post(
            f"/api/travel-journals/{journal['id']}/generate",
            headers=headers,
            json={"description": "重新生成", "target_words": 200},
        )

    assert first["errors"] == []
    assert generated.status_code == 200
    assert [item["id"] for item in generated.json()["images"]] == image_ids
    assert all(item["title"].startswith("旅途一景") for item in generated.json()["images"])
    assert rejected.status_code == 502
    assert rejected.json()["code"] == "TRAVEL_JOURNAL_IMAGE_MAPPING_INVALID"


def test_kimi_payload_uses_k3_low_reasoning_all_images_and_strict_schema(tmp_path):
    model_path = tmp_path / "model.jpg"
    model_path.write_bytes(image_bytes())
    from app.models import TravelJournalImage

    images = [
        TravelJournalImage(
            id="image-one",
            journal_id="journal",
            display_path=str(model_path),
            model_path=str(model_path),
            sort_order=0,
        ),
        TravelJournalImage(
            id="image-two",
            journal_id="journal",
            display_path=str(model_path),
            model_path=str(model_path),
            sort_order=1,
        ),
    ]
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(generated_result(["image-one", "image-two"]))
                        }
                    }
                ]
            },
        )

    client = KimiJournalClient(
        base_url="https://api.moonshot.cn/v1",
        api_key="test-only",
        model="kimi-k3",
        timeout_seconds=10,
        transport=httpx.MockTransport(handler),
    )
    client.generate(description="旅行描述", target_words=200, images=images)

    assert captured["model"] == "kimi-k3"
    assert captured["reasoning_effort"] == "low"
    assert captured["response_format"]["json_schema"]["strict"] is True
    assert captured["response_format"]["json_schema"]["schema"]["properties"][
        "text_sections"
    ]["maxItems"] == 0
    schema = captured["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["opening"] == {"type": "string"}
    assert schema["properties"]["image_sections"]["items"]["properties"]["body"] == {
        "type": "string"
    }
    prompt = captured["messages"][1]["content"][0]["text"]
    assert "正文目标约 200 字" in prompt
    assert "每张图片讲述约 80 字" in prompt
    image_parts = [
        part
        for part in captured["messages"][1]["content"]
        if part["type"] == "image_url"
    ]
    assert len(image_parts) == 2
    assert all(part["image_url"]["url"].startswith("data:image/jpeg;base64,") for part in image_parts)


@pytest.mark.parametrize("image_count", [1, 9])
def test_kimi_payload_supports_pure_image_single_and_nine_image_requests(
    tmp_path,
    image_count,
):
    model_path = tmp_path / "model.jpg"
    model_path.write_bytes(image_bytes())
    from app.models import TravelJournalImage

    image_ids = [f"image-{index}" for index in range(image_count)]
    images = [
        TravelJournalImage(
            id=image_id,
            journal_id="journal",
            display_path=str(model_path),
            model_path=str(model_path),
            sort_order=index,
        )
        for index, image_id in enumerate(image_ids)
    ]

    def handler(request):
        payload = json.loads(request.content)
        image_parts = [
            part
            for part in payload["messages"][1]["content"]
            if part["type"] == "image_url"
        ]
        assert len(image_parts) == image_count
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(generated_result(image_ids))
                        }
                    }
                ]
            },
        )

    client = KimiJournalClient(
        base_url="https://api.moonshot.cn/v1",
        api_key="test-only",
        model="kimi-k3",
        timeout_seconds=10,
        transport=httpx.MockTransport(handler),
    )
    result = client.generate(
        description="",
        target_words=200,
        images=images,
    )

    assert [item["image_id"] for item in result["image_sections"]] == image_ids


def test_lifecycle_copy_delete_publish_and_community_delete_restore(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = visitor_headers(client, "journal_lifecycle")
        journal = create_journal(client, headers)
        updated = client.patch(
            f"/api/travel-journals/{journal['id']}",
            headers=headers,
            json={
                "title": "可发布的旅行手账",
                "opening": "这是开场。",
                "text_sections": [
                    {"id": "one", "title": "第一段", "body": "完整的旅行内容。"}
                ],
                "conclusion": "这是结尾。",
            },
        )
        copy_headers = {**headers, "Idempotency-Key": "same-copy-request"}
        copied = client.post(
            f"/api/travel-journals/{journal['id']}/copy",
            headers=copy_headers,
        )
        copied_again = client.post(
            f"/api/travel-journals/{journal['id']}/copy",
            headers=copy_headers,
        )
        published = client.post(
            f"/api/travel-journals/{journal['id']}/publish",
            headers=headers,
        )
        published_again = client.post(
            f"/api/travel-journals/{journal['id']}/publish",
            headers=headers,
        )
        readonly = client.patch(
            f"/api/travel-journals/{journal['id']}",
            headers=headers,
            json={"title": "不允许覆盖"},
        )
        post_id = published.json()["post_id"]
        admin = admin_headers(client)
        hidden = client.patch(
            f"/api/community/admin/posts/{post_id}",
            headers=admin,
            json={"status": "hidden"},
        )
        restored_by_admin = client.patch(
            f"/api/community/admin/posts/{post_id}",
            headers=admin,
            json={"status": "published"},
        )
        community = client.get("/api/community/posts", headers=headers)
        community_deleted = client.delete(
            f"/api/community/posts/{post_id}",
            headers=headers,
        )
        restored = client.get(
            f"/api/travel-journals/{journal['id']}",
            headers=headers,
        )
        deleted_clone = client.delete(
            f"/api/travel-journals/{copied.json()['id']}",
            headers=headers,
        )

    assert updated.status_code == 200
    assert copied.status_code == 200
    assert copied.json()["id"] != journal["id"]
    assert copied.json()["status"] == "draft"
    assert copied_again.json()["id"] == copied.json()["id"]
    assert published.json()["journal"]["status"] == "published"
    assert published_again.json()["post_id"] == published.json()["post_id"]
    assert readonly.status_code == 409
    assert hidden.json()["status"] == "hidden"
    assert restored_by_admin.json()["status"] == "published"
    post = next(item for item in community.json()["items"] if item["id"] == post_id)
    assert post["post_type"] == "travel_journal"
    assert post["travel_journal"]["title"] == "可发布的旅行手账"
    assert community_deleted.status_code == 200
    assert restored.json()["status"] == "draft"
    assert deleted_clone.status_code == 200


def test_journal_images_are_private_until_the_journal_is_published(tmp_path):
    with create_test_client(tmp_path) as client:
        owner = visitor_headers(client, "journal_image_owner")
        reader = visitor_headers(client, "journal_image_reader")
        journal = create_journal(client, owner)
        uploaded = upload_image(client, owner, journal["id"]).json()["journal"]
        image = uploaded["images"][0]

        private_response = client.get(image["display_url"], headers=reader)
        client.patch(
            f"/api/travel-journals/{journal['id']}",
            headers=owner,
            json={
                "title": "公开手账",
                "opening": "开场",
                "images": [
                    {
                        "id": image["id"],
                        "title": "一张照片",
                        "body": "照片附近的旅行讲述。",
                    }
                ],
                "conclusion": "结尾",
            },
        )
        published = client.post(
            f"/api/travel-journals/{journal['id']}/publish",
            headers=owner,
        )
        public_response = client.get(image["display_url"], headers=reader)

    assert private_response.status_code == 403
    assert published.status_code == 200
    assert public_response.status_code == 200
    assert public_response.headers["content-type"] == "image/jpeg"


def test_pdf_export_is_private_and_returns_download(tmp_path):
    with create_test_client(tmp_path) as client:
        owner = visitor_headers(client, "journal_pdf")
        other = visitor_headers(client, "journal_pdf_other")
        journal = create_journal(client, owner)
        uploaded = upload_image(client, owner, journal["id"])
        assert uploaded.status_code == 200
        image_id = uploaded.json()["journal"]["images"][0]["id"]
        client.patch(
            f"/api/travel-journals/{journal['id']}",
            headers=owner,
            json={
                "title": "灵山旅行记",
                "opening": "一段中文开场。",
                "text_sections": [
                    {"id": "one", "title": "慢慢走", "body": "一段中文正文。"}
                ],
                "images": [
                    {
                        "id": image_id,
                        "title": "沿途一景",
                        "body": "沿途风景很美。" * 1200,
                    }
                ],
                "conclusion": "旅程结束，记忆仍在。",
            },
        )
        exported = client.get(
            f"/api/travel-journals/{journal['id']}/export.pdf",
            headers=owner,
        )
        forbidden = client.get(
            f"/api/travel-journals/{journal['id']}/export.pdf",
            headers=other,
        )

    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/pdf"
    assert "attachment" in exported.headers["content-disposition"]
    assert exported.content.startswith(b"%PDF")
    assert b"/Subtype /Image" in exported.content
    assert len(re.findall(rb"/Type\s*/Page\b", exported.content)) >= 2
    assert forbidden.status_code == 404


def test_generated_result_allows_length_variance_but_rejects_invalid_structure():
    too_short = generated_result()
    too_short["text_sections"][0]["body"] = "短"
    for section in too_short["text_sections"][1:]:
        section["body"] = "短"
    accepted = validate_generated_result(
        too_short,
        image_ids=[],
        target_words=200,
    )
    assert accepted is too_short

    invalid = generated_result()
    invalid["text_sections"][1]["id"] = invalid["text_sections"][0]["id"]
    try:
        validate_generated_result(invalid, image_ids=[], target_words=200)
    except Exception as exc:
        assert getattr(exc, "code", "") == "TRAVEL_JOURNAL_GENERATION_STRUCTURE_INVALID"
    else:
        raise AssertionError("Expected duplicate section ids to fail")


def test_kimi_client_normalizes_timeout_rejection_and_invalid_json(tmp_path):
    model_path = tmp_path / "model.jpg"
    model_path.write_bytes(image_bytes())

    def call_with(handler):
        client = KimiJournalClient(
            base_url="https://api.moonshot.cn/v1",
            api_key="test-only",
            model="kimi-k3",
            timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        )
        return client.generate(description="旅途", target_words=200, images=[])

    cases = [
        (
            lambda request: (_ for _ in ()).throw(
                httpx.ReadTimeout("timeout", request=request)
            ),
            "KIMI_TIMEOUT",
        ),
        (
            lambda request: (_ for _ in ()).throw(
                httpx.ConnectError("offline", request=request)
            ),
            "KIMI_REQUEST_FAILED",
        ),
        (
            lambda request: httpx.Response(500, request=request),
            "KIMI_REQUEST_FAILED",
        ),
        (
            lambda request: httpx.Response(
                200,
                request=request,
                json={"choices": [{"message": {"content": "{invalid"}}]},
            ),
            "KIMI_RESPONSE_INVALID",
        ),
    ]
    for handler, expected_code in cases:
        try:
            call_with(handler)
        except Exception as exc:
            assert getattr(exc, "code", "") == expected_code
        else:
            raise AssertionError(f"Expected {expected_code}")
