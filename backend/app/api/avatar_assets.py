import mimetypes
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.errors import ApiError
from app.models import DigitalHumanAvatar
from app.services.digital_human_avatars import (
    preview_token_allows,
    runtime_token_allows,
)


router = APIRouter(prefix="/api/avatar-assets", tags=["digital-human-assets"])


@router.get("/{avatar_id}/{asset_path:path}")
def get_avatar_asset(
    avatar_id: str,
    asset_path: str,
    request: Request,
    preview_token: str = Query(default=""),
    runtime_token: str = Query(default=""),
    session: Session = Depends(get_db),
):
    avatar = session.get(DigitalHumanAvatar, avatar_id)
    if avatar is None or avatar.is_builtin:
        raise ApiError("数字人资源不存在", "AVATAR_ASSET_NOT_FOUND", 404)
    settings = request.app.state.settings
    relative = PurePosixPath(asset_path)
    if (
        len(relative.parts) >= 4
        and relative.parts[0] == "_access"
        and relative.parts[1] in {"preview", "runtime"}
    ):
        scope = relative.parts[1]
        path_token = relative.parts[2]
        relative = PurePosixPath(*relative.parts[3:])
        if scope == "preview":
            preview_token = path_token
        else:
            runtime_token = path_token

    is_preview = preview_token_allows(
        preview_token,
        avatar_id,
        settings.auth_token_secret,
    )
    is_runtime = runtime_token_allows(
        runtime_token,
        avatar_id,
        settings.auth_token_secret,
    )
    if not avatar.is_active and not is_preview and not is_runtime:
        raise ApiError("候选数字人资源不可访问", "AVATAR_ASSET_FORBIDDEN", 403)

    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ApiError("数字人资源路径无效", "AVATAR_ASSET_PATH_INVALID", 400)
    version_root = (
        Path(settings.avatar_package_dir) / avatar.resource_path
    ).resolve()
    target = version_root.joinpath(*relative.parts).resolve()
    if version_root not in target.parents or not target.is_file():
        raise ApiError("数字人资源不存在", "AVATAR_ASSET_NOT_FOUND", 404)

    media_type, content_encoding = _asset_headers(target.name)
    headers = {
        "Cache-Control": "private, max-age=600"
        if is_preview
        else "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    }
    if content_encoding:
        headers["Content-Encoding"] = content_encoding
    return FileResponse(target, media_type=media_type, headers=headers)


def _asset_headers(filename: str) -> tuple[str, str]:
    encoding = ""
    base_name = filename
    if filename.endswith(".br"):
        encoding = "br"
        base_name = filename[:-3]
    elif filename.endswith(".gz"):
        encoding = "gzip"
        base_name = filename[:-3]

    if base_name.endswith((".loader.js", ".framework.js")):
        return "application/javascript", encoding
    if base_name.endswith(".wasm"):
        return "application/wasm", encoding
    if base_name.endswith(".data"):
        return "application/octet-stream", encoding
    return mimetypes.guess_type(base_name)[0] or "application/octet-stream", encoding
