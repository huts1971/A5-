from uuid import uuid4
from pathlib import Path
import shutil
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.core.errors import ApiError
from app.models import DigitalHumanAvatar, utc_now
from app.services.auth import AuthUser
from app.services.avatar_package_importer import import_avatar_package
from app.services.digital_human_avatars import (
    list_avatars,
    make_preview_token,
    uploaded_avatar_config,
)


router = APIRouter(
    prefix="/api/admin/avatars",
    tags=["digital-human-avatars"],
    dependencies=[Depends(require_admin)],
)


class AvatarMetadataUpdate(BaseModel):
    name: str
    note: str = ""


@router.get("")
def get_avatars(session: Session = Depends(get_db)) -> dict:
    return {"items": [_avatar_payload(avatar) for avatar in list_avatars(session)]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_avatar(
    request: Request,
    name: str = Form(...),
    note: str = Form(""),
    file: UploadFile = File(...),
    session: Session = Depends(get_db),
    admin: AuthUser = Depends(require_admin),
) -> dict:
    normalized_name = name.strip()
    if not normalized_name:
        raise ApiError("形象名称不能为空", "AVATAR_NAME_REQUIRED", 400)
    version_id = uuid4().hex
    content = await _read_upload(
        file,
        request.app.state.settings.avatar_upload_max_bytes,
    )
    imported = import_avatar_package(
        content,
        request.app.state.settings.avatar_package_dir,
        version_id,
        request.app.state.settings.avatar_extracted_max_bytes,
    )
    avatar = DigitalHumanAvatar(
        id=version_id,
        name=normalized_name,
        note=note.strip(),
        source_filename=file.filename or "",
        resource_size=imported.resource_size,
        resource_path=imported.resource_path,
        manifest_json=imported.manifest,
        is_builtin=False,
        is_active=False,
        uploaded_by=admin.username,
    )
    session.add(avatar)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        shutil.rmtree(
            Path(request.app.state.settings.avatar_package_dir)
            / imported.resource_path,
            ignore_errors=True,
        )
        raise ApiError(
            "数字人版本保存失败",
            "AVATAR_IMPORT_SAVE_FAILED",
            500,
        ) from exc
    session.refresh(avatar)
    return _avatar_payload(avatar)


@router.patch("/{avatar_id}")
def update_avatar(
    avatar_id: str,
    payload: AvatarMetadataUpdate,
    session: Session = Depends(get_db),
) -> dict:
    avatar = session.get(DigitalHumanAvatar, avatar_id)
    if avatar is None:
        raise ApiError("数字人版本不存在", "AVATAR_NOT_FOUND", 404)
    if avatar.is_builtin:
        raise ApiError("内置数字人不可编辑", "AVATAR_BUILTIN_READ_ONLY", 409)
    normalized_name = payload.name.strip()
    if not normalized_name:
        raise ApiError("形象名称不能为空", "AVATAR_NAME_REQUIRED", 400)
    avatar.name = normalized_name
    avatar.note = payload.note.strip()
    avatar.updated_at = utc_now()
    session.commit()
    session.refresh(avatar)
    return _avatar_payload(avatar)


@router.delete("/{avatar_id}")
def delete_avatar(
    avatar_id: str,
    request: Request,
    session: Session = Depends(get_db),
) -> dict[str, str]:
    avatar = session.get(DigitalHumanAvatar, avatar_id)
    if avatar is None:
        raise ApiError("数字人版本不存在", "AVATAR_NOT_FOUND", 404)
    if avatar.is_builtin or avatar.is_active:
        raise ApiError(
            "内置或当前使用的数字人不可删除",
            "AVATAR_DELETE_FORBIDDEN",
            409,
        )
    package_root = Path(request.app.state.settings.avatar_package_dir).resolve()
    resource_path = (package_root / avatar.resource_path).resolve()
    if resource_path.parent != package_root:
        raise ApiError("数字人资源路径无效", "AVATAR_RESOURCE_PATH_INVALID", 500)
    try:
        if resource_path.exists():
            shutil.rmtree(resource_path)
    except OSError as exc:
        raise ApiError("数字人资源删除失败", "AVATAR_RESOURCE_DELETE_FAILED", 500) from exc
    session.delete(avatar)
    session.commit()
    return {"status": "deleted"}


@router.post("/{avatar_id}/preview-token")
def create_preview_token(
    avatar_id: str,
    request: Request,
    session: Session = Depends(get_db),
) -> dict:
    avatar = session.get(DigitalHumanAvatar, avatar_id)
    if avatar is None or avatar.is_builtin:
        raise ApiError("候选数字人版本不存在", "AVATAR_NOT_FOUND", 404)
    settings = request.app.state.settings
    token, expires_at = make_preview_token(
        avatar.id,
        settings.auth_token_secret,
        settings.avatar_preview_token_ttl_seconds,
    )
    return {
        **uploaded_avatar_config(avatar, str(request.base_url), token),
        "expires_at": datetime.fromtimestamp(expires_at, UTC).isoformat(),
    }


@router.post("/{avatar_id}/activate")
def activate_avatar(
    avatar_id: str,
    request: Request,
    session: Session = Depends(get_db),
) -> dict:
    avatar = session.get(DigitalHumanAvatar, avatar_id)
    if avatar is None:
        raise ApiError("数字人版本不存在", "AVATAR_NOT_FOUND", 404)
    if not avatar.is_builtin:
        _ensure_avatar_resources(avatar, request.app.state.settings.avatar_package_dir)
    now = utc_now()
    session.execute(update(DigitalHumanAvatar).values(is_active=False))
    avatar.is_active = True
    avatar.activated_at = now
    avatar.updated_at = now
    session.commit()
    session.refresh(avatar)
    return _avatar_payload(avatar)


def _ensure_avatar_resources(avatar: DigitalHumanAvatar, package_dir: str) -> None:
    version_root = (Path(package_dir) / avatar.resource_path).resolve()
    required = ("loader", "data", "framework", "wasm")
    if not avatar.manifest_json or any(
        not version_root.joinpath(*Path(avatar.manifest_json[key]).parts).is_file()
        for key in required
    ):
        raise ApiError(
            "数字人核心资源不完整，无法启用",
            "AVATAR_RESOURCE_INCOMPLETE",
            409,
        )


async def _read_upload(file: UploadFile, maximum_bytes: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(1024 * 1024):
        size += len(chunk)
        if size > maximum_bytes:
            raise ApiError(
                "Unity WebGL ZIP 超过 100 MB 上传限制",
                "AVATAR_ZIP_TOO_LARGE",
                413,
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _avatar_payload(avatar: DigitalHumanAvatar) -> dict:
    payload = {
        "id": avatar.id,
        "name": avatar.name,
        "note": avatar.note,
        "source_filename": avatar.source_filename,
        "resource_size": avatar.resource_size,
        "is_builtin": avatar.is_builtin,
        "is_active": avatar.is_active,
        "uploaded_by": avatar.uploaded_by,
        "created_at": avatar.created_at.isoformat(),
        "updated_at": avatar.updated_at.isoformat(),
        "activated_at": avatar.activated_at.isoformat()
        if avatar.activated_at
        else None,
    }
    if avatar.manifest_json:
        payload["manifest"] = avatar.manifest_json
    return payload
