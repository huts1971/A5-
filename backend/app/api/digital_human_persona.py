from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_visitor
from app.schemas import (
    DigitalHumanPersonaConfig,
    DigitalHumanPersonaResponse,
    DigitalHumanPersonaTextResponse,
)
from app.services.auth import AuthUser
from app.services.digital_human_persona import (
    generate_persona_text,
    get_persona_response,
    polish_persona_text,
    save_persona,
)


router = APIRouter(
    prefix="/api/digital-human-persona",
    tags=["digital-human-persona"],
)


@router.get("", response_model=DigitalHumanPersonaResponse)
def get_current_persona(
    db: Session = Depends(get_db),
    visitor: AuthUser = Depends(require_visitor),
) -> DigitalHumanPersonaResponse:
    return get_persona_response(db, visitor.id)


@router.put("", response_model=DigitalHumanPersonaResponse)
def put_current_persona(
    payload: DigitalHumanPersonaConfig,
    db: Session = Depends(get_db),
    visitor: AuthUser = Depends(require_visitor),
) -> DigitalHumanPersonaResponse:
    return save_persona(db, visitor.id, payload)


@router.post("/generate", response_model=DigitalHumanPersonaTextResponse)
def generate_persona(
    payload: DigitalHumanPersonaConfig,
    request: Request,
    _visitor: AuthUser = Depends(require_visitor),
) -> DigitalHumanPersonaTextResponse:
    return DigitalHumanPersonaTextResponse(
        text=generate_persona_text(request.app.state.settings, payload)
    )


@router.post("/polish", response_model=DigitalHumanPersonaTextResponse)
def polish_persona(
    payload: DigitalHumanPersonaConfig,
    request: Request,
    _visitor: AuthUser = Depends(require_visitor),
) -> DigitalHumanPersonaTextResponse:
    return DigitalHumanPersonaTextResponse(
        text=polish_persona_text(request.app.state.settings, payload)
    )
