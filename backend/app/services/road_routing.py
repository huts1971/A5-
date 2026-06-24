from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
from math import hypot, inf

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    MapAsset,
    MapPoint,
    RoadEdge,
    RoadNetworkVersion,
    RoadNode,
    RouteTimeAnchor,
)


class RoadNetworkUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class RoadArc:
    edge_id: str
    from_node_id: str
    to_node_id: str
    points: tuple[dict, ...]
    map_length_px: float


@dataclass(frozen=True)
class RoadPathResult:
    edge_ids: tuple[str, ...]
    points: tuple[dict, ...]
    map_length_px: float
    walk_minutes: int | None
    difficulty: str
    accessible: bool


@dataclass(frozen=True)
class TransitionEstimate:
    minutes: int | None
    note: str
    difficulty: str = "medium"
    accessible: bool = True


@dataclass(frozen=True)
class RouteTimeEstimate:
    stay_minutes: int
    walk_minutes: int
    total_minutes: int
    complete: bool
    transitions: list[TransitionEstimate]
    routing_profile: str
    time_estimation_status: str
    network_version: str | None


@dataclass
class RoadNetworkMeta:
    id: str
    map_id: str
    data_version: str
    time_minutes_per_pixel: float | None
    calibration_confidence: float


@dataclass
class RoadNetworkGraph:
    network: RoadNetworkMeta
    graph: dict[str, list[RoadArc]]
    spot_nodes: dict[str, tuple[str, ...]]


_PATH_CACHE: dict[
    tuple[str, str, str, str],
    RoadPathResult | None,
] = {}
_GRAPH_CACHE: dict[tuple[str, str], RoadNetworkGraph] = {}


def normalize_routing_profile(value: str) -> str:
    # Legacy values remain accepted by the API, but every road now shares
    # one simple shortest-path cost.
    return "fastest"


def routing_profile_for_preferences(
    physical_level: str,
    accessible_required: bool = False,
) -> str:
    return "fastest"


def load_active_road_network(
    db: Session,
    map_id: str,
) -> RoadNetworkGraph:
    graph_key = (str(db.get_bind().url), map_id)
    if graph_key in _GRAPH_CACHE:
        return _GRAPH_CACHE[graph_key]
    network = db.scalar(
        select(RoadNetworkVersion)
        .where(
            RoadNetworkVersion.map_id == map_id,
            RoadNetworkVersion.is_active.is_(True),
        )
        .order_by(RoadNetworkVersion.created_at.desc())
    )
    if network is None:
        raise RoadNetworkUnavailable(map_id)
    map_asset = db.get(MapAsset, map_id)
    if map_asset is None:
        raise RoadNetworkUnavailable(map_id)

    nodes = {
        node.id: node
        for node in db.scalars(
            select(RoadNode).where(RoadNode.network_id == network.id)
        ).all()
    }
    edges = db.scalars(
        select(RoadEdge).where(RoadEdge.network_id == network.id)
    ).all()
    if not nodes or not edges:
        raise RoadNetworkUnavailable(map_id)

    graph: dict[str, list[RoadArc]] = {}
    for edge in edges:
        if edge.from_node_id not in nodes or edge.to_node_id not in nodes:
            continue
        points = tuple(edge.points or ())
        if len(points) < 2:
            continue
        forward = RoadArc(
            edge_id=edge.id,
            from_node_id=edge.from_node_id,
            to_node_id=edge.to_node_id,
            points=points,
            map_length_px=float(edge.map_length_px),
        )
        graph.setdefault(edge.from_node_id, []).append(forward)
        if edge.bidirectional:
            graph.setdefault(edge.to_node_id, []).append(
                RoadArc(
                    edge_id=edge.id,
                    from_node_id=edge.to_node_id,
                    to_node_id=edge.from_node_id,
                    points=tuple(reversed(points)),
                    map_length_px=float(edge.map_length_px),
                )
            )

    spot_nodes = {}
    for point in db.scalars(
        select(MapPoint).where(MapPoint.map_id == map_id)
    ).all():
        nearest = min(
            nodes.values(),
            key=lambda node: hypot(
                (node.x_ratio - point.x_ratio) * map_asset.width,
                (node.y_ratio - point.y_ratio) * map_asset.height,
            ),
        )
        spot_nodes[point.spot_id] = (nearest.id,)
    result = RoadNetworkGraph(
        network=RoadNetworkMeta(
            id=network.id,
            map_id=network.map_id,
            data_version=network.data_version,
            time_minutes_per_pixel=network.time_minutes_per_pixel,
            calibration_confidence=network.calibration_confidence,
        ),
        graph=graph,
        spot_nodes=spot_nodes,
    )
    _GRAPH_CACHE[graph_key] = result
    return result


def recalibrate_network(db: Session, map_id: str) -> RoadNetworkVersion | None:
    try:
        network_graph = load_active_road_network(db, map_id)
    except RoadNetworkUnavailable:
        return None
    network_model = db.get(
        RoadNetworkVersion,
        network_graph.network.id,
    )
    if network_model is None:
        return None
    anchors = db.scalars(
        select(RouteTimeAnchor).where(
            RouteTimeAnchor.network_id == network_graph.network.id
        )
    ).all()
    samples: list[tuple[float, float, float]] = []
    for anchor in anchors:
        path = _find_path(
            network_graph,
            anchor.from_spot_id,
            anchor.to_spot_id,
            "fastest",
            minutes_per_pixel=None,
        )
        if path is None:
            continue
        weighted_length = sum(arc.map_length_px for arc in path)
        if weighted_length <= 0:
            continue
        samples.append(
            (
                weighted_length,
                float(anchor.observed_minutes),
                max(0.05, float(anchor.confidence)),
            )
        )
        anchor.road_edge_ids = [arc.edge_id for arc in path]

    if not samples:
        network_model.time_minutes_per_pixel = None
        network_model.calibration_confidence = 0.0
        network_graph.network.time_minutes_per_pixel = None
        network_graph.network.calibration_confidence = 0.0
        return network_model

    numerator = sum(weight * length * minutes for length, minutes, weight in samples)
    denominator = sum(weight * length * length for length, _, weight in samples)
    coefficient = (
        numerator / denominator if denominator else None
    )
    average_confidence = sum(item[2] for item in samples) / len(samples)
    sample_factor = min(1.0, 0.55 + 0.15 * len(samples))
    calibration_confidence = min(
        0.95,
        average_confidence * sample_factor,
    )
    network_model.time_minutes_per_pixel = coefficient
    network_model.calibration_confidence = calibration_confidence
    network_graph.network.time_minutes_per_pixel = coefficient
    network_graph.network.calibration_confidence = calibration_confidence
    _clear_network_cache(network_graph.network.id)
    return network_model


def find_spot_path(
    db: Session,
    map_id: str,
    from_spot_id: str,
    to_spot_id: str,
    routing_profile: str = "fastest",
) -> tuple[RoadPathResult | None, RoadNetworkMeta]:
    profile = normalize_routing_profile(routing_profile)
    network_graph = load_active_road_network(db, map_id)
    network = network_graph.network
    if network.time_minutes_per_pixel is None:
        recalibrate_network(db, map_id)

    cache_key = (
        network.id,
        profile,
        from_spot_id,
        to_spot_id,
    )
    if cache_key in _PATH_CACHE:
        return _PATH_CACHE[cache_key], network

    arcs = _find_path(
        network_graph,
        from_spot_id,
        to_spot_id,
        profile,
        minutes_per_pixel=network.time_minutes_per_pixel,
    )
    if arcs is None:
        _PATH_CACHE[cache_key] = None
        return None, network

    points: list[dict] = []
    for index, arc in enumerate(arcs):
        points.extend(arc.points if index == 0 else arc.points[1:])
    map_length_px = sum(arc.map_length_px for arc in arcs)
    raw_minutes = (
        sum(
            _edge_minutes(arc, network.time_minutes_per_pixel)
            for arc in arcs
        )
        if network.time_minutes_per_pixel is not None
        else None
    )
    result = RoadPathResult(
        edge_ids=tuple(arc.edge_id for arc in arcs),
        points=tuple(points),
        map_length_px=map_length_px,
        walk_minutes=(
            max(1, round(raw_minutes))
            if raw_minutes is not None and from_spot_id != to_spot_id
            else 0 if raw_minutes is not None else None
        ),
        difficulty="low",
        accessible=True,
    )
    _PATH_CACHE[cache_key] = result
    return result, network


def estimate_spot_sequence(
    db: Session,
    map_id: str,
    spots: list[tuple[str, int]],
    routing_profile: str = "fastest",
) -> RouteTimeEstimate:
    profile = normalize_routing_profile(routing_profile)
    stay_minutes = sum(stay_minutes for _, stay_minutes in spots)
    transitions = (
        [
            TransitionEstimate(
                minutes=0,
                note="路线起点",
                difficulty="low",
            )
        ]
        if spots
        else []
    )
    walk_minutes = 0
    complete = True
    network_version: str | None = None
    time_status = "unavailable"

    for previous, current in zip(spots, spots[1:]):
        try:
            path, network = find_spot_path(
                db,
                map_id,
                previous[0],
                current[0],
                profile,
            )
        except RoadNetworkUnavailable:
            path = None
            network = None
        if network is not None:
            network_version = network.data_version
            time_status = (
                "map_estimate"
                if network.time_minutes_per_pixel is not None
                else "uncalibrated"
            )
        if path is None or path.walk_minutes is None:
            complete = False
            transitions.append(
                TransitionEstimate(
                    minutes=None,
                    note="人工路网尚未覆盖该段",
                    accessible=False,
                )
            )
            continue
        walk_minutes += path.walk_minutes
        transitions.append(
            TransitionEstimate(
                minutes=path.walk_minutes,
                note=_transition_note(profile),
                difficulty=path.difficulty,
                accessible=path.accessible,
            )
        )

    if len(spots) <= 1:
        try:
            graph = load_active_road_network(db, map_id)
            network_version = graph.network.data_version
            time_status = (
                "map_estimate"
                if graph.network.time_minutes_per_pixel is not None
                else "uncalibrated"
            )
        except RoadNetworkUnavailable:
            pass
    return RouteTimeEstimate(
        stay_minutes=stay_minutes,
        walk_minutes=walk_minutes,
        total_minutes=stay_minutes + walk_minutes,
        complete=complete,
        transitions=transitions,
        routing_profile=profile,
        time_estimation_status=time_status,
        network_version=network_version,
    )


def _find_path(
    network_graph: RoadNetworkGraph,
    from_spot_id: str,
    to_spot_id: str,
    routing_profile: str,
    minutes_per_pixel: float | None,
) -> list[RoadArc] | None:
    starts = network_graph.spot_nodes.get(from_spot_id, ())
    targets = set(network_graph.spot_nodes.get(to_spot_id, ()))
    if not starts or not targets:
        return None
    if targets.intersection(starts):
        return []

    queue: list[tuple[float, str]] = []
    best: dict[str, float] = {}
    previous: dict[str, tuple[str, RoadArc]] = {}
    for node_id in starts:
        best[node_id] = 0.0
        heappush(queue, (0.0, node_id))

    reached: str | None = None
    while queue:
        cost, node_id = heappop(queue)
        if cost != best.get(node_id):
            continue
        if node_id in targets:
            reached = node_id
            break
        for arc in network_graph.graph.get(node_id, []):
            edge_cost = _search_cost(
                arc,
                routing_profile,
                minutes_per_pixel,
            )
            next_cost = cost + edge_cost
            if next_cost >= best.get(arc.to_node_id, inf):
                continue
            best[arc.to_node_id] = next_cost
            previous[arc.to_node_id] = (node_id, arc)
            heappush(queue, (next_cost, arc.to_node_id))
    if reached is None:
        return None

    path: list[RoadArc] = []
    cursor = reached
    while cursor not in starts:
        previous_node, arc = previous[cursor]
        path.append(arc)
        cursor = previous_node
    path.reverse()
    return path


def _search_cost(
    arc: RoadArc,
    routing_profile: str,
    minutes_per_pixel: float | None,
) -> float:
    return _edge_minutes(arc, minutes_per_pixel)


def _edge_minutes(
    arc: RoadArc,
    minutes_per_pixel: float | None,
) -> float:
    coefficient = minutes_per_pixel if minutes_per_pixel is not None else 1.0
    return arc.map_length_px * coefficient


def _transition_note(profile: str) -> str:
    return "按人工路网粗略估算的步行路径"


def _clear_network_cache(network_id: str) -> None:
    stale = [key for key in _PATH_CACHE if key[0] == network_id]
    for key in stale:
        _PATH_CACHE.pop(key, None)


def clear_road_network_cache(
    db: Session | None = None,
    map_id: str | None = None,
) -> None:
    if db is None and map_id is None:
        _GRAPH_CACHE.clear()
        _PATH_CACHE.clear()
        return
    database_url = str(db.get_bind().url) if db is not None else None
    graph_keys = [
        key
        for key in _GRAPH_CACHE
        if (database_url is None or key[0] == database_url)
        and (map_id is None or key[1] == map_id)
    ]
    network_ids = {
        _GRAPH_CACHE[key].network.id
        for key in graph_keys
    }
    for key in graph_keys:
        _GRAPH_CACHE.pop(key, None)
    for network_id in network_ids:
        _clear_network_cache(network_id)
