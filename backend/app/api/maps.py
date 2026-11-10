from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas import (
    AmapConfigResponse,
    RoutePathRequest,
    RoutePathResponse,
    ScenicMapResponse,
)
from app.services.maps import get_route_path, get_scenic_map

router = APIRouter(prefix="/api/maps", tags=["maps"])


@router.get("/ling-shan", response_model=ScenicMapResponse)
def read_ling_shan_map(db: Session = Depends(get_db)) -> ScenicMapResponse:
    return get_scenic_map(db, "ling-shan")


@router.get("/amap-config", response_model=AmapConfigResponse)
def read_amap_config(request: Request) -> AmapConfigResponse:
    active_settings = request.app.state.settings
    key = active_settings.amap_key.strip()
    security_code = active_settings.amap_security_code.strip()
    return AmapConfigResponse(
        enabled=bool(key and security_code),
        key=key,
        security_code=security_code,
    )


@router.get("/{map_id}", response_model=ScenicMapResponse)
def read_scenic_map(
    map_id: str,
    db: Session = Depends(get_db),
) -> ScenicMapResponse:
    return get_scenic_map(db, map_id)


@router.post("/{map_id}/route-path", response_model=RoutePathResponse)
def read_route_path(
    map_id: str,
    payload: RoutePathRequest,
    db: Session = Depends(get_db),
) -> RoutePathResponse:
    return get_route_path(
        db,
        map_id,
        payload.spot_ids,
        payload.routing_profile,
    )
