from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas import (
    RouteDraftAddSpotRequest,
    RouteDraftCreate,
    RouteDraftReorderRequest,
    RouteDraftResponse,
    RouteDraftScopeRequest,
)
from app.services.route_drafts import (
    add_route_draft_spot,
    create_route_draft,
    delete_route_draft_spot,
    get_route_draft,
    reorder_route_draft_spots,
    scope_route_draft,
    undo_route_draft,
)

router = APIRouter(prefix="/api/route-drafts", tags=["route-drafts"])


@router.post("", response_model=RouteDraftResponse, status_code=201)
def create_draft(
    payload: RouteDraftCreate,
    response: Response,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    response.headers["Cache-Control"] = "no-store"
    return create_route_draft(db, payload)


@router.get("/{draft_id}", response_model=RouteDraftResponse)
def get_draft(
    draft_id: str,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    return get_route_draft(db, draft_id)


@router.post("/{draft_id}/spots", response_model=RouteDraftResponse)
def add_spot(
    draft_id: str,
    payload: RouteDraftAddSpotRequest,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    return add_route_draft_spot(db, draft_id, payload)


@router.delete("/{draft_id}/spots/{spot_id}", response_model=RouteDraftResponse)
def delete_spot(
    draft_id: str,
    spot_id: str,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    return delete_route_draft_spot(db, draft_id, spot_id)


@router.post("/{draft_id}/spots/reorder", response_model=RouteDraftResponse)
def reorder_spots(
    draft_id: str,
    payload: RouteDraftReorderRequest,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    return reorder_route_draft_spots(db, draft_id, payload)


@router.post("/{draft_id}/scope", response_model=RouteDraftResponse)
def scope_draft(
    draft_id: str,
    payload: RouteDraftScopeRequest,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    return scope_route_draft(db, draft_id, payload)


@router.post("/{draft_id}/undo", response_model=RouteDraftResponse)
def undo(
    draft_id: str,
    db: Session = Depends(get_db),
) -> RouteDraftResponse:
    return undo_route_draft(db, draft_id)
