import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.models import AppUser, utc_now


USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")


@dataclass(frozen=True)
class AuthUser:
    id: str
    username: str
    role: str


def validate_visitor_credentials(username: str, password: str) -> None:
    if not USERNAME_RE.fullmatch(username):
        raise ApiError("用户名需为 3-32 位字母、数字或下划线", "USERNAME_INVALID", 400)
    if len(password) < 6 or len(password) > 64:
        raise ApiError("密码需为 6-64 位", "PASSWORD_INVALID", 400)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256$120000${salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = password_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations),
    ).hex()
    return hmac.compare_digest(digest, expected)


def register_visitor(session: Session, username: str, password: str) -> AppUser:
    validate_visitor_credentials(username, password)
    existing = session.scalar(
        select(AppUser).where(AppUser.username == username, AppUser.role == "visitor")
    )
    if existing:
        raise ApiError("用户名已存在", "USERNAME_EXISTS", 409)
    user = AppUser(
        id=uuid.uuid4().hex,
        username=username,
        password_hash=hash_password(password),
        role="visitor",
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def ensure_default_admin(session: Session, settings: Settings) -> None:
    username = settings.admin_default_username
    existing = session.scalar(
        select(AppUser).where(AppUser.username == username, AppUser.role == "admin")
    )
    if existing:
        return
    if len(settings.admin_default_password) < 12:
        raise RuntimeError("Configure a unique ADMIN_DEFAULT_PASSWORD of at least 12 characters")
    session.add(
        AppUser(
            id=uuid.uuid4().hex,
            username=username,
            password_hash=hash_password(settings.admin_default_password),
            role="admin",
            is_active=True,
        )
    )
    session.commit()


def login_user(session: Session, username: str, password: str, role: str) -> AppUser:
    user = session.scalar(
        select(AppUser).where(AppUser.username == username, AppUser.role == role)
    )
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise ApiError("用户名或密码错误", "AUTH_INVALID_CREDENTIALS", 401)
    user.last_login_at = utc_now()
    session.commit()
    session.refresh(user)
    return user


def make_token(user: AppUser, settings: Settings) -> str:
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role,
        "exp": int(time.time()) + settings.auth_token_ttl_seconds,
    }
    payload_text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    payload_b64 = _b64encode(payload_text.encode("utf-8"))
    signature = _sign(payload_b64, settings.auth_token_secret)
    return f"{payload_b64}.{signature}"


def read_token(token: str, settings: Settings) -> AuthUser:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise ApiError("登录状态无效", "AUTH_TOKEN_INVALID", 401) from exc
    if not hmac.compare_digest(_sign(payload_b64, settings.auth_token_secret), signature):
        raise ApiError("登录状态无效", "AUTH_TOKEN_INVALID", 401)
    try:
        payload = json.loads(_b64decode(payload_b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ApiError("登录状态无效", "AUTH_TOKEN_INVALID", 401) from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ApiError("登录状态已过期", "AUTH_TOKEN_EXPIRED", 401)
    return AuthUser(
        id=str(payload.get("sub", "")),
        username=str(payload.get("username", "")),
        role=str(payload.get("role", "")),
    )


def _sign(payload_b64: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return _b64encode(digest)


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
