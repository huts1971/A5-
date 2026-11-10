from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path, db_path=None, **overrides):
    db_path = db_path or tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            tts_mode="disabled",
            **overrides,
        )
    )
    return TestClient(app)


def test_visitor_can_register_and_read_current_user(tmp_path):
    with create_test_client(tmp_path) as client:
        registered = client.post(
            "/api/auth/register",
            json={"username": "visitor_001", "password": "secret123"},
        )
        token = registered.json()["token"]
        current_user = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert registered.status_code == 200
    body = registered.json()
    assert body["token_type"] == "bearer"
    assert body["user"] == {
        "id": body["user"]["id"],
        "username": "visitor_001",
        "role": "visitor",
    }
    assert current_user.status_code == 200
    assert current_user.json() == body["user"]


def test_visitor_registration_rejects_invalid_or_duplicate_credentials(tmp_path):
    with create_test_client(tmp_path) as client:
        first = client.post(
            "/api/auth/register",
            json={"username": "visitor_001", "password": "secret123"},
        )
        duplicate = client.post(
            "/api/auth/register",
            json={"username": "visitor_001", "password": "secret123"},
        )
        invalid_username = client.post(
            "/api/auth/register",
            json={"username": "游客", "password": "secret123"},
        )
        short_password = client.post(
            "/api/auth/register",
            json={"username": "visitor_002", "password": "12345"},
        )

    assert first.status_code == 200
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "USERNAME_EXISTS"
    assert invalid_username.status_code == 400
    assert invalid_username.json()["code"] == "USERNAME_INVALID"
    assert short_password.status_code == 400
    assert short_password.json()["code"] == "PASSWORD_INVALID"


def test_visitor_can_login_and_wrong_password_is_rejected(tmp_path):
    with create_test_client(tmp_path) as client:
        client.post(
            "/api/auth/register",
            json={"username": "visitor_001", "password": "secret123"},
        )
        logged_in = client.post(
            "/api/auth/login",
            json={"username": "visitor_001", "password": "secret123"},
        )
        rejected = client.post(
            "/api/auth/login",
            json={"username": "visitor_001", "password": "wrong123"},
        )

    assert logged_in.status_code == 200
    assert logged_in.json()["token_type"] == "bearer"
    assert logged_in.json()["user"]["username"] == "visitor_001"
    assert logged_in.json()["user"]["role"] == "visitor"
    assert rejected.status_code == 401
    assert rejected.json()["code"] == "AUTH_INVALID_CREDENTIALS"


def test_current_user_rejects_missing_or_invalid_token(tmp_path):
    with create_test_client(tmp_path) as client:
        missing = client.get("/api/auth/me")
        invalid = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer not-a-real-token"},
        )

    assert missing.status_code == 401
    assert missing.json()["code"] == "AUTH_TOKEN_INVALID"
    assert invalid.status_code == 401
    assert invalid.json()["code"] == "AUTH_TOKEN_INVALID"


def test_visitor_password_is_not_stored_as_plaintext(tmp_path):
    db_path = tmp_path / "app.db"
    with create_test_client(tmp_path, db_path=db_path) as client:
        response = client.post(
            "/api/auth/register",
            json={"username": "visitor_001", "password": "secret123"},
        )

    assert response.status_code == 200
    with sqlite3.connect(db_path) as connection:
        password_hash = connection.execute(
            "select password_hash from app_user where username = ? and role = ?",
            ("visitor_001", "visitor"),
        ).fetchone()[0]

    assert password_hash != "secret123"
    assert password_hash.startswith("pbkdf2_sha256$")


def test_default_admin_can_login_after_startup(tmp_path):
    with create_test_client(tmp_path) as client:
        logged_in = client.post(
            "/api/auth/admin/login",
            json={"username": "admin", "password": "test-admin-password-123"},
        )

    assert logged_in.status_code == 200
    body = logged_in.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["username"] == "admin"
    assert body["user"]["role"] == "admin"


def test_default_admin_settings_can_override_seed_credentials(tmp_path):
    with create_test_client(
        tmp_path,
        admin_default_username="ops",
        admin_default_password="test-ops-password-654",
    ) as client:
        default_login = client.post(
            "/api/auth/admin/login",
            json={"username": "admin", "password": "test-admin-password-123"},
        )
        custom_login = client.post(
            "/api/auth/admin/login",
            json={"username": "ops", "password": "test-ops-password-654"},
        )

    assert default_login.status_code == 401
    assert custom_login.status_code == 200
    assert custom_login.json()["user"]["username"] == "ops"
    assert custom_login.json()["user"]["role"] == "admin"


def test_default_admin_startup_does_not_overwrite_existing_password(tmp_path):
    db_path = tmp_path / "app.db"
    with create_test_client(tmp_path, db_path=db_path) as client:
        first_login = client.post(
            "/api/auth/admin/login",
            json={"username": "admin", "password": "test-admin-password-123"},
        )
    with create_test_client(
        tmp_path,
        db_path=db_path,
        admin_default_password="changed-password",
    ) as client:
        original_password = client.post(
            "/api/auth/admin/login",
            json={"username": "admin", "password": "test-admin-password-123"},
        )
        changed_password = client.post(
            "/api/auth/admin/login",
            json={"username": "admin", "password": "changed-password"},
        )

    assert first_login.status_code == 200
    assert original_password.status_code == 200
    assert changed_password.status_code == 401


def test_admin_login_rejects_wrong_password_and_visitor_account(tmp_path):
    with create_test_client(tmp_path) as client:
        visitor = client.post(
            "/api/auth/register",
            json={"username": "visitor_001", "password": "secret123"},
        )
        wrong_admin_password = client.post(
            "/api/auth/admin/login",
            json={"username": "admin", "password": "wrong123"},
        )
        visitor_as_admin = client.post(
            "/api/auth/admin/login",
            json={"username": "visitor_001", "password": "secret123"},
        )

    assert visitor.status_code == 200
    assert wrong_admin_password.status_code == 401
    assert wrong_admin_password.json()["code"] == "AUTH_INVALID_CREDENTIALS"
    assert visitor_as_admin.status_code == 401
    assert visitor_as_admin.json()["code"] == "AUTH_INVALID_CREDENTIALS"
