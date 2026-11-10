from typing import Literal

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.errors import ApiError
from app.services.auth import login_user, make_token, read_token, register_visitor


router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    role: Literal["visitor", "admin"]


class AuthResponse(BaseModel):
    token: str
    token_type: str
    user: UserResponse


@router.post("/register", response_model=AuthResponse)
def register(
    payload: AuthRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> AuthResponse:
    user = register_visitor(session, payload.username, payload.password)
    return _auth_response(user, request)


@router.post("/login", response_model=AuthResponse)
def login(
    payload: AuthRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> AuthResponse:
    user = login_user(session, payload.username, payload.password, "visitor")
    return _auth_response(user, request)


@router.post("/admin/login", response_model=AuthResponse)
def admin_login(
    payload: AuthRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> AuthResponse:
    user = login_user(session, payload.username, payload.password, "admin")
    return _auth_response(user, request)


@router.get("/me", response_model=UserResponse)
def me(
    request: Request,
    authorization: str | None = Header(default=None),
) -> UserResponse:
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError("登录状态无效", "AUTH_TOKEN_INVALID", 401)
    user = read_token(authorization.removeprefix("Bearer ").strip(), request.app.state.settings)
    return UserResponse(id=user.id, username=user.username, role=user.role)


def _auth_response(user, request: Request) -> AuthResponse:
    return AuthResponse(
        token=make_token(user, request.app.state.settings),
        token_type="bearer",
        user=UserResponse(id=user.id, username=user.username, role=user.role),
    )
