from io import BytesIO
from pathlib import Path
import stat
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path, **settings_overrides):
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'app.db'}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_api_key="",
            tts_mode="disabled",
            avatar_package_dir=str(tmp_path / "avatar-packages"),
            **settings_overrides,
        )
    )
    return TestClient(app)


def admin_headers(client):
    response = client.post(
        "/api/auth/admin/login",
        json={"username": "admin", "password": "test-admin-password-123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def upload_avatar(client, headers, name="候选数字人", note=""):
    response = client.post(
        "/api/admin/avatars",
        headers=headers,
        data={"name": name, "note": note},
        files={
            "file": (
                "avatar-build.zip",
                unity_webgl_zip(),
                "application/zip",
            )
        },
    )
    assert response.status_code == 201
    return response.json()


def unity_webgl_zip(*, wrapper="guide-export", prefix="guide", compression_suffix=""):
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        build = f"{wrapper}/Build" if wrapper else "Build"
        archive.writestr(f"{build}/{prefix}.loader.js{compression_suffix}", "window.createUnityInstance = () => {};")
        archive.writestr(f"{build}/{prefix}.data{compression_suffix}", b"data")
        archive.writestr(f"{build}/{prefix}.framework.js{compression_suffix}", "framework")
        archive.writestr(f"{build}/{prefix}.wasm{compression_suffix}", b"wasm")
        root = f"{wrapper}/" if wrapper else ""
        archive.writestr(f"{root}StreamingAssets/config.json", "{}")
        archive.writestr(f"{root}fallback.png", b"\x89PNG\r\n\x1a\n")
    return output.getvalue()


def unity_webgl_zip_with_dangerous_file():
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("Build/guide.loader.js", "loader")
        archive.writestr("Build/guide.data", b"data")
        archive.writestr("Build/guide.framework.js", "framework")
        archive.writestr("Build/guide.wasm", b"wasm")
        archive.writestr("StreamingAssets/install.exe", b"not allowed")
    return output.getvalue()


def invalid_unity_zip(kind):
    output = BytesIO()
    wrapper = "outer/inner" if kind == "deep-wrapper" else ""
    build = f"{wrapper}/Build".lstrip("/")
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(f"{build}/guide.loader.js", "loader")
        archive.writestr(f"{build}/guide.data", b"data")
        archive.writestr(f"{build}/guide.framework.js", "framework")
        archive.writestr(f"{build}/guide.wasm", b"wasm")
        if kind == "nested-archive":
            archive.writestr("StreamingAssets/assets.tar.gz", b"archive")
        elif kind == "zip-bomb":
            archive.writestr("StreamingAssets/highly-compressible.bin", b"0" * (2 * 1024 * 1024))
        elif kind == "symlink":
            link = ZipInfo("StreamingAssets/link")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, "target")
        elif kind == "path-traversal":
            archive.writestr("../escape.txt", "escape")
        elif kind == "multiple-builds":
            for suffix, content in (
                (".loader.js", b"loader"),
                (".data", b"data"),
                (".framework.js", b"framework"),
                (".wasm", b"wasm"),
            ):
                archive.writestr(f"other/Build/other{suffix}", content)
    return output.getvalue()


def test_admin_can_list_builtin_digital_human_avatar(tmp_path):
    with create_test_client(tmp_path) as client:
        unauthorized = client.get("/api/admin/avatars")
        response = client.get("/api/admin/avatars", headers=admin_headers(client))

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "items": [
            {
                "id": "builtin-avatar151",
                "name": "151 数字人",
                "note": "项目内置默认数字人",
                "source_filename": "",
                "resource_size": 0,
                "is_builtin": True,
                "is_active": True,
                "uploaded_by": "system",
                "created_at": body["items"][0]["created_at"],
                "updated_at": body["items"][0]["updated_at"],
                "activated_at": body["items"][0]["activated_at"],
            }
        ]
    }


def test_admin_can_import_unity_webgl_zip_as_candidate(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        response = client.post(
            "/api/admin/avatars",
            headers=headers,
            data={"name": "灵山数字导游二号", "note": "演示候选版本"},
            files={
                "file": (
                    "avatar-build.zip",
                    unity_webgl_zip(),
                    "application/zip",
                )
            },
        )
        listed = client.get("/api/admin/avatars", headers=headers)

    assert response.status_code == 201
    imported = response.json()
    assert imported["name"] == "灵山数字导游二号"
    assert imported["note"] == "演示候选版本"
    assert imported["source_filename"] == "avatar-build.zip"
    assert imported["resource_size"] > 0
    assert imported["is_builtin"] is False
    assert imported["is_active"] is False
    assert imported["uploaded_by"] == "admin"
    assert imported["manifest"] == {
        "loader": "Build/guide.loader.js",
        "data": "Build/guide.data",
        "framework": "Build/guide.framework.js",
        "wasm": "Build/guide.wasm",
        "streaming_assets": "StreamingAssets",
        "fallback": "fallback.png",
    }
    items = listed.json()["items"]
    assert len(items) == 2
    assert sum(item["is_active"] for item in items) == 1
    assert next(item for item in items if item["is_active"])["id"] == "builtin-avatar151"


def test_unsafe_avatar_zip_is_rejected_without_changing_current_version(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        response = client.post(
            "/api/admin/avatars",
            headers=headers,
            data={"name": "不安全候选"},
            files={
                "file": (
                    "unsafe.zip",
                    unity_webgl_zip_with_dangerous_file(),
                    "application/zip",
                )
            },
        )
        listed = client.get("/api/admin/avatars", headers=headers)

    assert response.status_code == 400
    assert response.json()["code"] == "AVATAR_ZIP_UNSAFE_FILE"
    assert [item["id"] for item in listed.json()["items"]] == ["builtin-avatar151"]


def test_avatar_zip_larger_than_upload_limit_is_rejected(tmp_path):
    with create_test_client(tmp_path, avatar_upload_max_bytes=128) as client:
        response = client.post(
            "/api/admin/avatars",
            headers=admin_headers(client),
            data={"name": "过大候选"},
            files={
                "file": (
                    "large.zip",
                    unity_webgl_zip(),
                    "application/zip",
                )
            },
        )

    assert response.status_code == 413
    assert response.json()["code"] == "AVATAR_ZIP_TOO_LARGE"


def test_avatar_zip_larger_than_extracted_limit_is_rejected(tmp_path):
    with create_test_client(tmp_path, avatar_extracted_max_bytes=10) as client:
        response = client.post(
            "/api/admin/avatars",
            headers=admin_headers(client),
            data={"name": "解压过大候选"},
            files={
                "file": (
                    "expanded.zip",
                    unity_webgl_zip(),
                    "application/zip",
                )
            },
        )

    assert response.status_code == 413
    assert response.json()["code"] == "AVATAR_ZIP_EXPANDED_TOO_LARGE"


def test_admin_can_edit_only_candidate_name_and_note(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        imported = upload_avatar(client, headers)
        response = client.patch(
            f"/api/admin/avatars/{imported['id']}",
            headers=headers,
            json={
                "name": "灵山迎宾数字人",
                "note": "用于游客中心",
                "is_active": True,
                "resource_path": "tampered",
            },
        )

    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "灵山迎宾数字人"
    assert updated["note"] == "用于游客中心"
    assert updated["id"] == imported["id"]
    assert updated["is_active"] is False
    assert updated["manifest"] == imported["manifest"]
    assert updated["updated_at"] != imported["updated_at"]


def test_admin_can_delete_candidate_but_not_builtin_avatar(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        imported = upload_avatar(client, headers)
        deleted = client.delete(
            f"/api/admin/avatars/{imported['id']}",
            headers=headers,
        )
        builtin_delete = client.delete(
            "/api/admin/avatars/builtin-avatar151",
            headers=headers,
        )
        listed = client.get("/api/admin/avatars", headers=headers)

    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted"}
    assert builtin_delete.status_code == 409
    assert builtin_delete.json()["code"] == "AVATAR_DELETE_FORBIDDEN"
    assert [item["id"] for item in listed.json()["items"]] == ["builtin-avatar151"]


def test_candidate_preview_token_grants_temporary_access_to_its_assets(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        imported = upload_avatar(client, headers)
        other = upload_avatar(client, headers, name="另一个候选")
        preview = client.post(
            f"/api/admin/avatars/{imported['id']}/preview-token",
            headers=headers,
        )

        assert preview.status_code == 200
        config = preview.json()
        loader_without_token = config["loader_url"].split("?", 1)[0]
        denied = client.get(loader_without_token)
        loader = client.get(config["loader_url"])
        streaming_asset = client.get(
            f"{config['streaming_assets_url']}/config.json"
        )
        tampered = client.get(config["loader_url"].replace(imported["id"], other["id"]))

    assert config["avatar_id"] == imported["id"]
    assert config["expires_at"]
    assert config["bridge_object_name"] == "Avatar151Bridge"
    assert config["streaming_assets_url"]
    assert config["fallback_url"]
    assert denied.status_code == 403
    assert loader.status_code == 200
    assert loader.text == "window.createUnityInstance = () => {};"
    assert loader.headers["content-type"].startswith("application/javascript")
    assert loader.headers["cache-control"] == "private, max-age=600"
    assert streaming_asset.status_code == 200
    assert streaming_asset.json() == {}
    assert tampered.status_code == 403


def test_preview_assets_preserve_unity_compression_headers(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        for suffix, encoding in ((".gz", "gzip"), (".br", "br")):
            response = client.post(
                "/api/admin/avatars",
                headers=headers,
                data={"name": f"压缩候选 {encoding}"},
                files={
                    "file": (
                        f"compressed-{encoding}.zip",
                        unity_webgl_zip(compression_suffix=suffix),
                        "application/zip",
                    )
                },
            )
            assert response.status_code == 201
            preview = client.post(
                f"/api/admin/avatars/{response.json()['id']}/preview-token",
                headers=headers,
            ).json()
            with client.stream("GET", preview["wasm_url"]) as asset:
                assert asset.status_code == 200
                assert asset.headers["content-type"].startswith("application/wasm")
                assert asset.headers["content-encoding"] == encoding


def test_expired_preview_token_cannot_read_candidate_assets(tmp_path):
    with create_test_client(
        tmp_path,
        avatar_preview_token_ttl_seconds=-1,
    ) as client:
        headers = admin_headers(client)
        imported = upload_avatar(client, headers)
        config = client.post(
            f"/api/admin/avatars/{imported['id']}/preview-token",
            headers=headers,
        ).json()
        response = client.get(config["loader_url"])

    assert response.status_code == 403
    assert response.json()["code"] == "AVATAR_ASSET_FORBIDDEN"


def test_admin_can_activate_uploaded_avatar_and_switch_back_to_builtin(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        initial = client.get("/api/avatar/current")
        imported = upload_avatar(client, headers, name="可启用数字人")
        activated = client.post(
            f"/api/admin/avatars/{imported['id']}/activate",
            headers=headers,
        )
        uploaded_config = client.get("/api/avatar/current")
        public_loader = client.get(uploaded_config.json()["loader_url"])
        active_delete = client.delete(
            f"/api/admin/avatars/{imported['id']}",
            headers=headers,
        )
        restored = client.post(
            "/api/admin/avatars/builtin-avatar151/activate",
            headers=headers,
        )
        previously_open_page_asset = client.get(
            uploaded_config.json()["loader_url"]
        )
        previously_open_streaming_asset = client.get(
            f"{uploaded_config.json()['streaming_assets_url']}/config.json"
        )
        builtin_config = client.get("/api/avatar/current")
        listed = client.get("/api/admin/avatars", headers=headers)

    assert initial.status_code == 200
    assert initial.json()["avatar_id"] == "builtin-avatar151"
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True
    assert uploaded_config.status_code == 200
    assert uploaded_config.json()["avatar_id"] == imported["id"]
    assert imported["id"] in uploaded_config.json()["loader_url"]
    assert public_loader.status_code == 200
    assert public_loader.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert active_delete.status_code == 409
    assert restored.status_code == 200
    assert restored.json()["id"] == "builtin-avatar151"
    assert previously_open_page_asset.status_code == 200
    assert previously_open_streaming_asset.status_code == 200
    assert builtin_config.json()["avatar_id"] == "builtin-avatar151"
    assert "/avatar/uketsukejou151/" in builtin_config.json()["loader_url"]
    assert sum(item["is_active"] for item in listed.json()["items"]) == 1


def test_activation_failure_keeps_previous_avatar_active(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        imported = upload_avatar(client, headers, name="资源不完整候选")
        loader = (
            tmp_path
            / "avatar-packages"
            / imported["id"]
            / imported["manifest"]["loader"]
        )
        loader.unlink()
        response = client.post(
            f"/api/admin/avatars/{imported['id']}/activate",
            headers=headers,
        )
        current = client.get("/api/avatar/current")

    assert response.status_code == 409
    assert response.json()["code"] == "AVATAR_RESOURCE_INCOMPLETE"
    assert current.json()["avatar_id"] == "builtin-avatar151"


@pytest.mark.parametrize(
    ("kind", "expected_code"),
    [
        ("deep-wrapper", "AVATAR_BUILD_INVALID"),
        ("nested-archive", "AVATAR_ZIP_UNSAFE_FILE"),
        ("zip-bomb", "AVATAR_ZIP_BOMB"),
        ("symlink", "AVATAR_ZIP_UNSAFE_FILE"),
        ("path-traversal", "AVATAR_ZIP_UNSAFE_PATH"),
        ("multiple-builds", "AVATAR_BUILD_INVALID"),
    ],
)
def test_invalid_unity_package_shapes_do_not_create_candidates(
    tmp_path,
    kind,
    expected_code,
):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        response = client.post(
            "/api/admin/avatars",
            headers=headers,
            data={"name": f"无效包 {kind}"},
            files={
                "file": (
                    f"{kind}.zip",
                    invalid_unity_zip(kind),
                    "application/zip",
                )
            },
        )
        listed = client.get("/api/admin/avatars", headers=headers)

    assert response.status_code in {400, 413}
    assert response.json()["code"] == expected_code
    assert [item["id"] for item in listed.json()["items"]] == ["builtin-avatar151"]


def test_uploaded_avatar_persists_without_retaining_original_zip(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        imported = upload_avatar(client, headers, name="持久化候选")

    package_root = tmp_path / "avatar-packages"
    assert (package_root / imported["id"]).is_dir()
    assert list(package_root.rglob("*.zip")) == []

    with create_test_client(tmp_path) as restarted_client:
        items = restarted_client.get(
            "/api/admin/avatars",
            headers=admin_headers(restarted_client),
        ).json()["items"]
        assert {item["id"] for item in items} == {
            "builtin-avatar151",
            imported["id"],
        }
        deleted = restarted_client.delete(
            f"/api/admin/avatars/{imported['id']}",
            headers=admin_headers(restarted_client),
        )

    assert deleted.status_code == 200
    assert not (package_root / imported["id"]).exists()
