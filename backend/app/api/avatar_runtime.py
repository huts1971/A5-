from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.errors import ApiError
from app.models import DigitalHumanAvatar
from app.services.digital_human_avatars import (
    builtin_avatar_config,
    make_runtime_token,
    uploaded_avatar_config,
)


router = APIRouter(prefix="/api/avatar", tags=["digital-human-runtime"])


@router.get("/current")
def get_current_avatar(
    request: Request,
    session: Session = Depends(get_db),
) -> dict:
    avatar = session.scalar(
        select(DigitalHumanAvatar).where(DigitalHumanAvatar.is_active.is_(True))
    )
    if avatar is None or avatar.is_builtin:
        return builtin_avatar_config()
    if not avatar.manifest_json:
        raise ApiError("当前数字人配置无效", "AVATAR_CONFIG_INVALID", 500)
    settings = request.app.state.settings
    token, _ = make_runtime_token(
        avatar.id,
        settings.auth_token_secret,
        settings.avatar_runtime_token_ttl_seconds,
    )
    return uploaded_avatar_config(
        avatar,
        str(request.base_url),
        token,
        token_parameter="runtime_token",
    )
