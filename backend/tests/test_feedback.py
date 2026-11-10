from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client():
    database_name = f"feedback_{uuid4().hex}"
    settings = Settings(
        database_url=f"sqlite:///file:{database_name}?mode=memory&cache=shared&uri=true",
        source_package_path=str(SOURCE_PACKAGE_PATH),
        tts_mode="disabled",
    )
    return TestClient(create_app(settings))


def admin_headers(client):
    response = client.post(
        "/api/auth/admin/login",
        json={"username": "admin", "password": "test-admin-password-123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_feedback_can_be_submitted_and_listed_for_admin():
    with create_test_client() as client:
        created = client.post(
            "/api/feedback",
            json={"rating": 5, "content": "讲解体验很好", "page_path": "/guide"},
        )
        missing_auth = client.get("/api/feedback")
        listed = client.get("/api/feedback", headers=admin_headers(client))

    assert created.status_code == 200
    created_body = created.json()
    assert created_body["rating"] == 5
    assert created_body["content"] == "讲解体验很好"
    assert created_body["created_at"]

    assert missing_auth.status_code == 401

    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 1
    assert listed_body["items"][0]["id"] == created_body["id"]
    assert listed_body["items"][0]["rating"] == 5
    assert listed_body["items"][0]["content"] == "讲解体验很好"


def test_feedback_rejects_invalid_rating():
    with create_test_client() as client:
        response = client.post(
            "/api/feedback",
            json={"rating": 0, "content": "星级不对", "page_path": "/guide"},
        )

    assert response.status_code == 422
