from heapq import heappop, heappush

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError
from app.models import (
    ManualPathSegment,
    MapAsset,
    MapPoint,
    SpotAdjacency,
)
from app.schemas import (
    MissingPathTransition,
    MapPointResponse,
    RoutePathPoint,
    RoutePathResponse,
    RoutePathSegmentResponse,
    ScenicMapResponse,
)
from app.services.road_routing import (
    RoadNetworkUnavailable,
    find_spot_path,
    load_active_road_network,
    normalize_routing_profile,
)
from app.services.map_point_types import ROUTEABLE_MAP_POINT_TYPES


LING_SHAN_MAP_ID = "ling-shan"


def get_scenic_map(db: Session, map_id: str) -> ScenicMapResponse:
    map_asset = db.scalar(
        select(MapAsset)
        .where(
            MapAsset.id == map_id,
            MapAsset.is_active.is_(True),
        )
        .options(selectinload(MapAsset.points).selectinload(MapPoint.spot))
    )
    if map_asset is None:
        raise ApiError(
            message="灵山胜境地图尚未配置",
            code="SCENIC_MAP_NOT_FOUND",
            status=404,
        )

    points = [
        MapPointResponse(
            spot_id=point.spot_id,
            name=point.spot.name,
            x_ratio=point.x_ratio,
            y_ratio=point.y_ratio,
            point_type=point.point_type,
            calibration_status=point.calibration_status,
        )
        for point in sorted(
            map_asset.points,
            key=lambda item: item.spot.sort_order if item.spot else 0,
        )
        if point.spot is not None
    ]
    return ScenicMapResponse(
        id=map_asset.id,
        name=map_asset.name,
        image_url=map_asset.image_url,
        version=map_asset.version,
        width=map_asset.width,
        height=map_asset.height,
        center_lat=map_asset.center_lat,
        center_lng=map_asset.center_lng,
        authorization_status=map_asset.authorization_status,
        source_note=map_asset.source_note,
        points=points,
    )


def get_ling_shan_map(db: Session) -> ScenicMapResponse:
    return get_scenic_map(db, LING_SHAN_MAP_ID)


def get_route_path(
    db: Session,
    map_id: str,
    spot_ids: list[str],
    routing_profile: str = "fastest",
) -> RoutePathResponse:
    map_asset = db.get(MapAsset, map_id)
    if map_asset is None or not map_asset.is_active:
        raise ApiError(
            message="景区地图尚未配置",
            code="SCENIC_MAP_NOT_FOUND",
            status=404,
        )

    map_spot_ids = set(
        db.scalars(
            select(MapPoint.spot_id).where(
                MapPoint.map_id == map_id,
                MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
            )
        ).all()
    )
    if invalid := next(
        (spot_id for spot_id in spot_ids if spot_id not in map_spot_ids),
        None,
    ):
        raise ApiError(
            message=f"景点不属于当前景区：{invalid}",
            code="ROUTE_PATH_SCENIC_AREA_MISMATCH",
            status=422,
        )

    profile = normalize_routing_profile(routing_profile)
    try:
        network_graph = load_active_road_network(db, map_id)
    except RoadNetworkUnavailable:
        return _get_legacy_route_path(db, map_id, spot_ids, profile)

    resolved_segments: list[RoutePathSegmentResponse] = []
    missing: list[MissingPathTransition] = []
    total_map_length = 0.0
    for from_spot_id, to_spot_id in zip(spot_ids, spot_ids[1:]):
        path, network = find_spot_path(
            db,
            map_id,
            from_spot_id,
            to_spot_id,
            profile,
        )
        if path is None:
            missing.append(
                MissingPathTransition(
                    from_spot_id=from_spot_id,
                    to_spot_id=to_spot_id,
                )
            )
            continue
        total_map_length += path.map_length_px
        resolved_segments.append(
            RoutePathSegmentResponse(
                from_spot_id=from_spot_id,
                to_spot_id=to_spot_id,
                via_spot_ids=[],
                road_edge_ids=list(path.edge_ids),
                points=[RoutePathPoint(**point) for point in path.points],
                walk_minutes=path.walk_minutes,
                difficulty=path.difficulty,
                accessible=path.accessible,
                map_length_px=round(path.map_length_px, 3),
            )
        )

    return RoutePathResponse(
        map_id=map_id,
        path_complete=not missing,
        network_version=network_graph.network.data_version,
        routing_profile=profile,
        time_estimation_status=(
            "map_estimate"
            if network_graph.network.time_minutes_per_pixel is not None
            else "uncalibrated"
        ),
        calibration_confidence=round(
            network_graph.network.calibration_confidence,
            3,
        ),
        map_length_px=round(total_map_length, 3),
        segments=resolved_segments,
        missing_transitions=missing,
    )


def _get_legacy_route_path(
    db: Session,
    map_id: str,
    spot_ids: list[str],
    routing_profile: str,
) -> RoutePathResponse:
    map_spot_ids = set(
        db.scalars(
            select(MapPoint.spot_id).where(
                MapPoint.map_id == map_id,
                MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
            )
        ).all()
    )
    adjacencies = db.scalars(select(SpotAdjacency)).all()
    path_segments = db.scalars(
        select(ManualPathSegment).where(
            ManualPathSegment.map_id == map_id,
        )
    ).all()
    graph: dict[str, list[tuple[str, int]]] = {}
    adjacency_by_pair = {}
    for edge in adjacencies:
        if edge.from_spot_id not in map_spot_ids or edge.to_spot_id not in map_spot_ids:
            continue
        graph.setdefault(edge.from_spot_id, []).append(
            (edge.to_spot_id, edge.walk_minutes)
        )
        adjacency_by_pair[(edge.from_spot_id, edge.to_spot_id)] = edge
    segment_by_pair = {
        (segment.from_spot_id, segment.to_spot_id): segment
        for segment in path_segments
    }

    resolved_segments: list[RoutePathSegmentResponse] = []
    missing: list[MissingPathTransition] = []
    for from_spot_id, to_spot_id in zip(spot_ids, spot_ids[1:]):
        path = _shortest_spot_path(
            graph,
            from_spot_id,
            to_spot_id,
        )
        if not path:
            missing.append(
                MissingPathTransition(
                    from_spot_id=from_spot_id,
                    to_spot_id=to_spot_id,
                )
            )
            continue

        edges = list(zip(path, path[1:]))
        manual_edges = [segment_by_pair.get(edge) for edge in edges]
        if any(segment is None for segment in manual_edges):
            missing.append(
                MissingPathTransition(
                    from_spot_id=from_spot_id,
                    to_spot_id=to_spot_id,
                )
            )
            continue

        points: list[dict] = []
        walk_minutes = 0
        difficulties: list[str] = []
        accessible = True
        for index, (edge_pair, segment) in enumerate(zip(edges, manual_edges)):
            assert segment is not None
            segment_points = segment.points
            points.extend(segment_points if index == 0 else segment_points[1:])
            adjacency = adjacency_by_pair[edge_pair]
            walk_minutes += adjacency.walk_minutes
            difficulties.append(segment.difficulty)
            accessible = accessible and segment.accessible and adjacency.accessible
        resolved_segments.append(
            RoutePathSegmentResponse(
                from_spot_id=from_spot_id,
                to_spot_id=to_spot_id,
                via_spot_ids=[],
                road_edge_ids=[],
                points=[RoutePathPoint(**point) for point in points],
                walk_minutes=walk_minutes,
                difficulty=_max_difficulty(difficulties),
                accessible=accessible,
                map_length_px=0.0,
            )
        )

    return RoutePathResponse(
        map_id=map_id,
        path_complete=not missing,
        network_version=None,
        routing_profile=routing_profile,
        time_estimation_status="legacy_fallback",
        calibration_confidence=0.0,
        map_length_px=0.0,
        segments=resolved_segments,
        missing_transitions=missing,
    )


def route_path_is_complete(
    db: Session,
    map_id: str,
    spot_ids: list[str],
    routing_profile: str = "fastest",
) -> bool:
    return get_route_path(
        db,
        map_id,
        spot_ids,
        routing_profile,
    ).path_complete


def _shortest_spot_path(
    graph: dict[str, list[tuple[str, int]]],
    from_spot_id: str,
    to_spot_id: str,
) -> list[str] | None:
    if from_spot_id == to_spot_id:
        return [from_spot_id]
    queue: list[tuple[int, str, list[str]]] = [(0, from_spot_id, [from_spot_id])]
    best = {from_spot_id: 0}
    while queue:
        minutes, spot_id, path = heappop(queue)
        if minutes != best.get(spot_id):
            continue
        if spot_id == to_spot_id:
            return path
        for next_spot_id, edge_minutes in graph.get(spot_id, []):
            next_minutes = minutes + edge_minutes
            if next_minutes >= best.get(next_spot_id, 10**9):
                continue
            best[next_spot_id] = next_minutes
            heappush(
                queue,
                (next_minutes, next_spot_id, [*path, next_spot_id]),
            )
    return None


def _max_difficulty(values: list[str]) -> str:
    rank = {"low": 0, "medium": 1, "high": 2}
    return max(values or ["medium"], key=lambda value: rank.get(value, 1))
