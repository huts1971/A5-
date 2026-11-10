from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import get_db, require_visitor
from app.core.errors import ApiError
from app.models.agentic import ChatSessionAccess
from app.services.auth import AuthUser
from sqlalchemy.orm import Session
from scenic_guide_core.memory import MemoryItem

router = APIRouter(prefix="/api/memory", tags=["memory"])


class ConsentInput(BaseModel):
    enabled: bool


class MemoryEdit(BaseModel):
    key: str
    value: str = Field(min_length=1, max_length=500)
    expected_version: int | None = None


def store(request):
    if request.app.state.guide_core is None:
        raise ApiError("请启用 Agentic 模式", "CORE_DISABLED", 409)
    return request.app.state.guide_core.memory()


@router.get("/consent")
def get_consent(request: Request, user: AuthUser = Depends(require_visitor)):
    return store(request).consent(user.id)


@router.put("/consent")
def set_consent(payload: ConsentInput, request: Request, user: AuthUser = Depends(require_visitor)):
    return store(request).set_consent(user.id, payload.enabled)


@router.get("")
def read_memory(request: Request, session_id: str | None = None,
                user: AuthUser = Depends(require_visitor), db: Session = Depends(get_db)):
    memory = store(request)
    if session_id:
        access = db.get(ChatSessionAccess, session_id)
        if access is None or access.user_id != user.id:
            raise ApiError("对话不属于当前用户", "CHAT_SESSION_FORBIDDEN", 403)
    return {"consent": memory.consent(user.id), "items": memory.list(user.id, session_id)}


@router.put("")
def edit_memory(payload: MemoryEdit, request: Request, user: AuthUser = Depends(require_visitor)):
    memory = store(request)
    consent = memory.consent(user.id)
    if not consent["enabled"]:
        raise ApiError("请先授权长期记忆", "MEMORY_CONSENT_REQUIRED", 403)
    try:
        memory.edit(user.id, MemoryItem(key=payload.key, value=payload.value, layer="static",
                                       message_id="user-edit", quote=payload.value), None, payload.expected_version,
                    expected_epoch=consent["epoch"])
    except PermissionError as exc:
        raise ApiError("记忆授权已变化，请刷新后重试", "MEMORY_CONSENT_CHANGED", 403) from exc
    except ValueError as exc:
        raise ApiError(str(exc), "MEMORY_EDIT_CONFLICT", 409) from exc
    return {"status": "saved"}


@router.delete("/{memory_id}")
def delete_memory(memory_id: str, request: Request, user: AuthUser = Depends(require_visitor)):
    memory = store(request)
    memory.register_user(user.id)
    memory.delete(user.id, memory_id)
    return {"status": "deleted"}
