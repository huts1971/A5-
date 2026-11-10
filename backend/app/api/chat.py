from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, optional_visitor
from app.schemas import ChatRequest, ChatResponse
from app.services.auth import AuthUser
from app.services.chat import answer_chat, stream_chat_events
from app.services.agentic_runtime import authorize_chat_session

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
    chat_request: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    visitor: AuthUser | None = Depends(optional_visitor),
) -> ChatResponse:
    chat_request = authorize_chat_session(db, chat_request, visitor.id if visitor else None)
    return answer_chat(
        db,
        request.app.state.settings,
        chat_request,
        request.app.state.tts_jobs,
        visitor_id=visitor.id if visitor else None,
        core_runtime=request.app.state.guide_core,
    )


@router.post("/stream")
def stream_chat(
    chat_request: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    visitor: AuthUser | None = Depends(optional_visitor),
) -> StreamingResponse:
    chat_request = authorize_chat_session(db, chat_request, visitor.id if visitor else None)
    db.commit()

    def events():
        # The stream owns its session; dependency cleanup must not close it mid-response.
        with request.app.state.SessionLocal() as stream_db:
            yield from stream_chat_events(
                stream_db,
                request.app.state.settings,
                chat_request,
                request.app.state.tts_jobs,
                visitor_id=visitor.id if visitor else None,
                core_runtime=request.app.state.guide_core,
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
