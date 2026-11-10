from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas import (
    TourCreateRequest,
    TourEventCreate,
    TourRecapResponse,
    TourSessionResponse,
)
from app.services.tours import (
    create_tour,
    get_tour,
    get_tour_recap,
    record_tour_event,
)

router = APIRouter(prefix="/api/tours", tags=["tours"])


@router.post("", response_model=TourSessionResponse, status_code=201)
def start_tour(
    payload: TourCreateRequest,
    db: Session = Depends(get_db),
) -> TourSessionResponse:
    return create_tour(db, payload.route_draft_id, payload.map_id)


@router.get("/{tour_id}", response_model=TourSessionResponse)
def load_tour(
    tour_id: str,
    db: Session = Depends(get_db),
) -> TourSessionResponse:
    return get_tour(db, tour_id)


@router.post("/{tour_id}/events", response_model=TourSessionResponse)
def add_event(
    tour_id: str,
    payload: TourEventCreate,
    db: Session = Depends(get_db),
) -> TourSessionResponse:
    return record_tour_event(db, tour_id, payload)


@router.get("/{tour_id}/recap", response_model=TourRecapResponse)
def load_recap(
    tour_id: str,
    db: Session = Depends(get_db),
) -> TourRecapResponse:
    return get_tour_recap(db, tour_id)
