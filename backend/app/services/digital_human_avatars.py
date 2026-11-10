import base64
import hashlib
import hmac
import json
import time
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DigitalHumanAvatar, utc_now


BUILTIN_AVATAR_ID = "builtin-avatar151"
BUILTIN_VERSION = "20260702-avatar151-webgl-v25-no-ear-no-hat-runtime"


def ensure_builtin_avatar(session: Session) -> None:
    if session.get(DigitalHumanAvatar, BUILTIN_AVATAR_ID) is not None:
        return
    now = utc_now()
    session.add(
        DigitalHumanAvatar(
            id=BUILTIN_AVATAR_ID,
            name="151 数字人",
            note="项目内置默认数字人",
            is_builtin=True,
            is_active=True,
            uploaded_by="system",
            created_at=now,
            updated_at=now,
            activated_at=now,
        )
    )
    session.commit()


def list_avatars(session: Session) -> list[DigitalHumanAvatar]:
    return list(
        session.scalars(
            select(DigitalHumanAvatar).order_by(
                DigitalHumanAvatar.is_active.desc(),
                DigitalHumanAvatar.created_at.desc(),
            )
        )
    )


def make_preview_token(
    avatar_id: str,
    secret: str,
    ttl_seconds: int,
) -> tuple[str, int]:
    return _make_asset_token(avatar_id, "preview", secret, ttl_seconds)


def make_runtime_token(
    avatar_id: str,
    secret: str,
    ttl_seconds: int,
) -> tuple[str, int]:
    return _make_asset_token(avatar_id, "runtime", secret, ttl_seconds)


def _make_asset_token(
    avatar_id: str,
    scope: str,
    secret: str,
    ttl_seconds: int,
) -> tuple[str, int]:
    expires_at = int(time.time()) + ttl_seconds
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {"avatar_id": avatar_id, "scope": scope, "exp": expires_at},
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii").rstrip("=")
    signature = hmac.new(
        secret.encode("utf-8"),
        payload.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{signature}", expires_at


def preview_token_allows(
    token: str,
    avatar_id: str,
    secret: str,
) -> bool:
    return _asset_token_allows(token, avatar_id, "preview", secret)


def runtime_token_allows(
    token: str,
    avatar_id: str,
    secret: str,
) -> bool:
    return _asset_token_allows(token, avatar_id, "runtime", secret)


def _asset_token_allows(
    token: str,
    avatar_id: str,
    scope: str,
    secret: str,
) -> bool:
    try:
        payload, signature = token.split(".", 1)
        expected = hmac.new(
            secret.encode("utf-8"),
            payload.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return False
        padding = "=" * (-len(payload) % 4)
        data = json.loads(
            base64.urlsafe_b64decode(payload + padding).decode("utf-8")
        )
        return (
            data.get("avatar_id") == avatar_id
            and data.get("scope") == scope
            and int(data.get("exp", 0)) >= int(time.time())
        )
    except (ValueError, json.JSONDecodeError):
        return False


def uploaded_avatar_config(
    avatar: DigitalHumanAvatar,
    base_url: str,
    token: str | None = None,
    token_parameter: str = "preview_token",
) -> dict:
    manifest = avatar.manifest_json
    query = f"?{token_parameter}={quote(token)}" if token else ""

    def asset_url(path: str, directory: bool = False) -> str:
        encoded = quote(path, safe="/")
        if directory and token:
            scope = token_parameter.removesuffix("_token")
            return (
                f"{base_url.rstrip('/')}/api/avatar-assets/"
                f"{avatar.id}/_access/{scope}/{quote(token)}/{encoded}"
            )
        return (
            f"{base_url.rstrip('/')}/api/avatar-assets/"
            f"{avatar.id}/{encoded}{query}"
        )

    return {
        "avatar_id": avatar.id,
        "version": avatar.id,
        "loader_url": asset_url(manifest["loader"]),
        "data_url": asset_url(manifest["data"]),
        "framework_url": asset_url(manifest["framework"]),
        "wasm_url": asset_url(manifest["wasm"]),
        "streaming_assets_url": asset_url(
            manifest["streaming_assets"],
            directory=True,
        )
        if manifest.get("streaming_assets")
        else "",
        "fallback_url": asset_url(manifest["fallback"])
        if manifest.get("fallback")
        else "",
        "bridge_object_name": "Avatar151Bridge",
    }


def builtin_avatar_config() -> dict:
    build = "/avatar/uketsukejou151/unity-webgl/Build"
    version = f"?v={BUILTIN_VERSION}"
    return {
        "avatar_id": BUILTIN_AVATAR_ID,
        "version": BUILTIN_VERSION,
        "loader_url": f"{build}/avatar151-guide.loader.js{version}",
        "data_url": f"{build}/avatar151-guide.data{version}",
        "framework_url": f"{build}/avatar151-guide.framework.js{version}",
        "wasm_url": f"{build}/avatar151-guide.wasm{version}",
        "streaming_assets_url": (
            "/avatar/uketsukejou151/unity-webgl/StreamingAssets"
        ),
        "fallback_url": "/avatar/uketsukejou151/avatar-151-chat.svg",
        "bridge_object_name": "Avatar151Bridge",
    }
