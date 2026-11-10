from collections.abc import Iterator

from fastapi import Header, Request
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.services.auth import AuthUser, read_token


def get_db(request: Request) -> Iterator[Session]:
    session_factory = request.app.state.SessionLocal
    with session_factory() as session:
        yield session


def require_admin(
    request: Request,
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
) -> AuthUser:
    settings = request.app.state.settings
    if (
        str(settings.enable_admin_token).lower() == "true"
        and x_admin_token
        and x_admin_token == settings.admin_token
    ):
        return AuthUser(id="admin-token", username="admin", role="admin")
    if authorization and authorization.startswith("Bearer "):
        user = read_token(authorization.removeprefix("Bearer ").strip(), settings)
        if user.role == "admin":
            return user
        raise ApiError("管理员权限不足", "ADMIN_PERMISSION_DENIED", 403)
    raise ApiError("管理员令牌无效", "ADMIN_TOKEN_INVALID", 401)


def require_visitor(
    request: Request,
    authorization: str | None = Header(default=None),
) -> AuthUser:
    if authorization and authorization.startswith("Bearer "):
        user = read_token(
            authorization.removeprefix("Bearer ").strip(),
            request.app.state.settings,
        )
        if user.role == "visitor":
            return user
        raise ApiError("游客权限不足", "VISITOR_PERMISSION_DENIED", 403)
    raise ApiError("游客登录状态无效", "AUTH_TOKEN_INVALID", 401)


def optional_visitor(
    request: Request,
    authorization: str | None = Header(default=None),
) -> AuthUser | None:
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        raise ApiError("游客登录状态无效", "AUTH_TOKEN_INVALID", 401)
    user = read_token(
        authorization.removeprefix("Bearer ").strip(),
        request.app.state.settings,
    )
    if user.role != "visitor":
        raise ApiError("游客权限不足", "VISITOR_PERMISSION_DENIED", 403)
    return user
