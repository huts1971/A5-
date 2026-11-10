from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client():
    database_name = f"community_{uuid4().hex}"
    settings = Settings(
        database_url=f"sqlite:///file:{database_name}?mode=memory&cache=shared&uri=true",
        source_package_path=str(SOURCE_PACKAGE_PATH),
        tts_mode="disabled",
    )
    return TestClient(create_app(settings))


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


def test_community_posts_are_visible_to_signed_in_visitors():
    with create_test_client() as client:
        missing_auth = client.get("/api/community/posts")
        headers = visitor_headers(client, "visitor_community")
        listed = client.get("/api/community/posts", headers=headers)

    assert missing_auth.status_code == 401
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] >= 12
    assert all(item["status"] == "published" for item in body["items"])
    assert any(item["author_name"] == "清风徐来" for item in body["items"])


def test_seeded_community_has_distinct_latest_and_popular_orders():
    with create_test_client() as client:
        headers = visitor_headers(client, "visitor_sorting")
        latest = client.get(
            "/api/community/posts?sort=latest&page_size=30",
            headers=headers,
        )
        popular = client.get(
            "/api/community/posts?sort=popular&page_size=30",
            headers=headers,
        )

    assert latest.status_code == 200
    assert popular.status_code == 200
    latest_items = latest.json()["items"]
    popular_items = popular.json()["items"]
    popular_like_counts = [item["like_count"] for item in popular_items]
    assert latest_items[0]["id"] != popular_items[0]["id"]
    assert popular_like_counts == sorted(popular_like_counts, reverse=True)
    assert popular_like_counts[0] >= 8


def test_visitor_can_publish_like_and_delete_own_post():
    with create_test_client() as client:
        author_headers = visitor_headers(client, "community_author")
        reader_headers = visitor_headers(client, "community_reader")
        created = client.post(
            "/api/community/posts",
            headers=author_headers,
            json={
                "content": "梵宫下午参观也很舒服，室内路线很清楚。",
                "spot_id": "spot_brahma_palace",
            },
        )
        post_id = created.json()["id"]

        visible = client.get("/api/community/posts", headers=reader_headers)
        liked = client.post(
            f"/api/community/posts/{post_id}/like",
            headers=reader_headers,
        )
        liked_again = client.post(
            f"/api/community/posts/{post_id}/like",
            headers=reader_headers,
        )
        forbidden_delete = client.delete(
            f"/api/community/posts/{post_id}",
            headers=reader_headers,
        )
        deleted = client.delete(
            f"/api/community/posts/{post_id}",
            headers=author_headers,
        )
        after_delete = client.get("/api/community/posts", headers=reader_headers)

    assert created.status_code == 200
    assert created.json()["author_name"] == "community_author"
    assert created.json()["spot"] == {
        "id": "spot_brahma_palace",
        "name": "灵山梵宫",
    }
    assert any(item["id"] == post_id for item in visible.json()["items"])
    assert liked.status_code == 200
    assert liked.json()["liked"] is True
    assert liked.json()["like_count"] == 1
    assert liked_again.json()["like_count"] == 1
    assert forbidden_delete.status_code == 403
    assert deleted.status_code == 200
    assert all(item["id"] != post_id for item in after_delete.json()["items"])


def test_admin_can_hide_and_restore_a_community_post():
    with create_test_client() as client:
        author_headers = visitor_headers(client, "community_moderated")
        admin = admin_headers(client)
        created = client.post(
            "/api/community/posts",
            headers=author_headers,
            json={"content": "这是一条等待管理员处理的留言。"},
        )
        post_id = created.json()["id"]

        hidden = client.patch(
            f"/api/community/admin/posts/{post_id}",
            headers=admin,
            json={"status": "hidden"},
        )
        public_list = client.get(
            "/api/community/posts",
            headers=author_headers,
        )
        mine = client.get(
            "/api/community/posts?scope=mine",
            headers=author_headers,
        )
        admin_list = client.get(
            "/api/community/admin/posts?status=hidden",
            headers=admin,
        )
        restored = client.patch(
            f"/api/community/admin/posts/{post_id}",
            headers=admin,
            json={"status": "published"},
        )

    assert hidden.status_code == 200
    assert hidden.json()["status"] == "hidden"
    assert all(item["id"] != post_id for item in public_list.json()["items"])
    hidden_mine = next(item for item in mine.json()["items"] if item["id"] == post_id)
    assert hidden_mine["status"] == "hidden"
    assert any(item["id"] == post_id for item in admin_list.json()["items"])
    assert restored.status_code == 200
    assert restored.json()["status"] == "published"
