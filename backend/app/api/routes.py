from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import RoutePreferenceLog
from app.schemas import RouteRecommendRequest, RouteRecommendResponse
from app.services.routes import normalize_route_recommend_request, recommend_routes

router = APIRouter(prefix="/api/routes", tags=["routes"])


@router.post("/recommend", response_model=RouteRecommendResponse)
def recommend_route(
    request: RouteRecommendRequest,
    db: Session = Depends(get_db),
) -> RouteRecommendResponse:
    items = recommend_routes(db, request)
    normalized = normalize_route_recommend_request(request)
    db.add(
        RoutePreferenceLog(
            map_id=normalized.map_id,
            visitor_type=normalized.visitor_type,
            duration_minutes=normalized.duration_minutes,
            physical_level=normalized.physical_level,
            interest_tags=normalized.interest_tags,
            route_count=len(items),
        )
    )
    db.commit()
    return RouteRecommendResponse(items=items)
