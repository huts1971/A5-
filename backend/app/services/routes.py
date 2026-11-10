from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from hashlib import sha1

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError
from app.models import (
    MapPoint,
    RoadEdge,
    Route,
    RouteSpot,
    ScenicSpot,
    SpotRecommendationProfile,
)
from app.schemas import (
    RecommendedRoute,
    RecommendedRouteSpot,
    RouteRecommendRequest,
)
from app.services.maps import route_path_is_complete
from app.services.map_point_types import ROUTEABLE_MAP_POINT_TYPES
from app.services.road_routing import (
    RoadNetworkUnavailable,
    RouteTimeEstimate,
    estimate_spot_sequence,
    find_spot_path,
    routing_profile_for_preferences,
)


SUPPORTED_MAP_IDS = {"ling-shan", "nianhua-bay"}
MAP_NAMES = {
    "ling-shan": "灵山胜境",
    "nianhua-bay": "拈花湾",
}
ENTRY_SPOTS = {
    "ling-shan": "spot_ls_entrance",
    "nianhua-bay": "spot_nh_entrance",
}
THEMES = (
    "佛教文化",
    "建筑艺术",
    "演艺亲子",
    "摄影打卡",
    "自然休闲",
    "室内体验",
)
PHYSICAL_WALK_RATIO = {
    "low": 0.25,
    "medium": 0.40,
    "high": 0.55,
}
PHYSICAL_ALIASES = {
    "低": "low",
    "低强度": "low",
    "low": "low",
    "中": "medium",
    "中等强度": "medium",
    "medium": "medium",
    "高": "high",
    "高强度": "high",
    "high": "high",
}
THEME_ALIASES = {
    "佛教文化": "佛教文化",
    "历史": "佛教文化",
    "文化": "佛教文化",
    "藏传佛教": "佛教文化",
    "礼佛": "佛教文化",
    "禅寺": "佛教文化",
    "建筑艺术": "建筑艺术",
    "建筑": "建筑艺术",
    "艺术": "建筑艺术",
    "演艺亲子": "演艺亲子",
    "演艺": "演艺亲子",
    "亲子": "演艺亲子",
    "摄影打卡": "摄影打卡",
    "摄影": "摄影打卡",
    "拍照": "摄影打卡",
    "自然休闲": "自然休闲",
    "自然": "自然休闲",
    "休闲": "自然休闲",
    "休息": "自然休闲",
    "安静": "自然休闲",
    "室内体验": "室内体验",
    "室内": "室内体验",
}
VISITOR_DEFAULT_THEMES = {
    "亲子游": ("演艺亲子",),
    "family": ("演艺亲子",),
    "历史文化游": ("佛教文化", "建筑艺术"),
    "culture": ("佛教文化", "建筑艺术"),
    "轻松游": ("自然休闲",),
    "relax": ("自然休闲",),
    "摄影游": ("摄影打卡", "自然休闲"),
    "photo": ("摄影打卡", "自然休闲"),
}
BEAM_WIDTH = 600
MAX_ROUTE_SPOTS = 9
MAX_REPEAT_MINUTES = 5.0
MAX_REPEAT_RATIO = 0.10


@dataclass(frozen=True)
class RecommendationProfile:
    spot_id: str
    theme_scores: dict[str, int]
    base_priority: int
    min_stay_minutes: int
    ideal_stay_minutes: int
    data_version: str


@dataclass(frozen=True)
class TransitionData:
    minutes: int
    edge_ids: tuple[str, ...]
    edge_lengths_px: tuple[float, ...]
    map_length_px: float


@dataclass(frozen=True)
class CandidateRoute:
    spot_ids: tuple[str, ...]
    walk_minutes: int
    traversed_edge_ids: tuple[str, ...]
    total_edge_length_px: float
    repeated_edge_length_px: float
    repeated_walk_minutes: float
    base_value: float


@dataclass(frozen=True)
class ScoredRoute:
    candidate: CandidateRoute
    stay_minutes: dict[str, int]
    total_minutes: int
    score: float
    preference_match: int


def recommend_routes(
    db: Session,
    request: RouteRecommendRequest,
) -> list[RecommendedRoute]:
    if request.map_id not in SUPPORTED_MAP_IDS:
        raise ApiError("不支持的景区地图", "SCENIC_MAP_INVALID", 422)

    normalized = normalize_route_recommend_request(request)
    routing_profile = routing_profile_for_preferences(
        normalized.physical_level,
        normalized.accessible_required,
    )
    map_spot_ids = set(
        db.scalars(
            select(MapPoint.spot_id).where(
                MapPoint.map_id == request.map_id,
                MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
            )
        ).all()
    )
    spots = db.scalars(
        select(ScenicSpot)
        .where(ScenicSpot.id.in_(map_spot_ids))
        .order_by(ScenicSpot.sort_order, ScenicSpot.id)
    ).all()
    spot_by_id = {spot.id: spot for spot in spots}
    entry_id = ENTRY_SPOTS[request.map_id]
    if entry_id not in spot_by_id:
        return _template_fallback(db, normalized, routing_profile, {}, {})

    profiles = _load_profiles(db, spots, entry_id)
    transitions = _build_transition_cache(
        db,
        request.map_id,
        tuple(spot_by_id),
        routing_profile,
    )
    if not transitions:
        return _template_fallback(
            db,
            normalized,
            routing_profile,
            profiles,
            transitions,
        )

    candidates = _generate_candidates(
        spot_by_id,
        profiles,
        transitions,
        entry_id,
        normalized,
    )
    if not candidates:
        single = _single_spot_fallback(
            spot_by_id,
            profiles,
            transitions,
            entry_id,
            normalized,
        )
        if single is None:
            return _template_fallback(
                db,
                normalized,
                routing_profile,
                profiles,
                transitions,
            )
        candidates = [single]

    scored = [
        _score_candidate(candidate, profiles, normalized)
        for candidate in candidates
    ]
    well_filled = [
        route
        for route in scored
        if route.total_minutes >= normalized.duration_minutes * 0.70
    ]
    ranked_pool = well_filled or scored
    chosen = sorted(
        ranked_pool,
        key=lambda route: (
            -route.score,
            -route.preference_match,
            route.candidate.repeated_walk_minutes,
            route.candidate.walk_minutes,
            route.candidate.spot_ids,
        ),
    )[0]
    return [
        _candidate_to_response(
            db,
            chosen,
            spot_by_id,
            profiles,
            normalized,
            routing_profile,
        )
    ]


def normalize_route_recommend_request(
    request: RouteRecommendRequest,
) -> RouteRecommendRequest:
    return _normalized_request(request)


def _normalized_request(
    request: RouteRecommendRequest,
) -> RouteRecommendRequest:
    physical_level = PHYSICAL_ALIASES.get(
        request.physical_level,
        "medium",
    )
    interest_tags: list[str] = []
    for tag in request.interest_tags:
        normalized = THEME_ALIASES.get(tag)
        if normalized and normalized not in interest_tags:
            interest_tags.append(normalized)
    if not interest_tags:
        interest_tags.extend(
            VISITOR_DEFAULT_THEMES.get(request.visitor_type or "", ())
        )
    if not interest_tags:
        interest_tags.append("佛教文化")
    return RouteRecommendRequest(
        map_id=request.map_id,
        visitor_type=request.visitor_type,
        duration_minutes=request.duration_minutes,
        physical_level=physical_level,
        interest_tags=interest_tags[:2],
        accessible_required=request.accessible_required,
    )


def _load_profiles(
    db: Session,
    spots: list[ScenicSpot],
    entry_id: str,
) -> dict[str, RecommendationProfile]:
    stored = {
        profile.spot_id: profile
        for profile in db.scalars(
            select(SpotRecommendationProfile).where(
                SpotRecommendationProfile.spot_id.in_(
                    [spot.id for spot in spots]
                )
            )
        ).all()
    }
    profiles: dict[str, RecommendationProfile] = {}
    for spot in spots:
        if spot.id == entry_id:
            profiles[spot.id] = RecommendationProfile(
                spot_id=spot.id,
                theme_scores={theme: 0 for theme in THEMES},
                base_priority=0,
                min_stay_minutes=min(5, max(0, spot.visit_minutes)),
                ideal_stay_minutes=min(5, max(0, spot.visit_minutes)),
                data_version="entry",
            )
            continue
        stored_profile = stored.get(spot.id)
        if stored_profile is not None:
            profiles[spot.id] = RecommendationProfile(
                spot_id=spot.id,
                theme_scores={
                    theme: max(
                        0,
                        min(
                            3,
                            int(
                                (stored_profile.theme_scores or {}).get(
                                    theme,
                                    0,
                                )
                            ),
                        ),
                    )
                    for theme in THEMES
                },
                base_priority=max(
                    1,
                    min(3, stored_profile.base_priority),
                ),
                min_stay_minutes=max(
                    5,
                    stored_profile.min_stay_minutes,
                ),
                ideal_stay_minutes=max(
                    stored_profile.min_stay_minutes,
                    stored_profile.ideal_stay_minutes,
                ),
                data_version=stored_profile.data_version,
            )
            continue
        fallback_scores = {theme: 0 for theme in THEMES}
        for tag in spot.tags:
            theme = THEME_ALIASES.get(tag)
            if theme:
                fallback_scores[theme] = max(
                    fallback_scores[theme],
                    1,
                )
        profiles[spot.id] = RecommendationProfile(
            spot_id=spot.id,
            theme_scores=fallback_scores,
            base_priority=1,
            min_stay_minutes=min(15, max(5, spot.visit_minutes)),
            ideal_stay_minutes=max(15, spot.visit_minutes),
            data_version="legacy-fallback",
        )
    return profiles


def _build_transition_cache(
    db: Session,
    map_id: str,
    spot_ids: tuple[str, ...],
    routing_profile: str,
) -> dict[tuple[str, str], TransitionData]:
    edge_lengths = {
        edge_id: float(map_length_px)
        for edge_id, map_length_px in db.execute(
            select(RoadEdge.id, RoadEdge.map_length_px).where(
                RoadEdge.map_id == map_id
            )
        ).all()
    }
    transitions: dict[tuple[str, str], TransitionData] = {}
    for from_spot_id in spot_ids:
        for to_spot_id in spot_ids:
            if from_spot_id == to_spot_id:
                continue
            try:
                path, _ = find_spot_path(
                    db,
                    map_id,
                    from_spot_id,
                    to_spot_id,
                    routing_profile,
                )
            except RoadNetworkUnavailable:
                return {}
            if path is None or path.walk_minutes is None:
                continue
            transitions[(from_spot_id, to_spot_id)] = TransitionData(
                minutes=path.walk_minutes,
                edge_ids=path.edge_ids,
                edge_lengths_px=tuple(
                    edge_lengths.get(edge_id, 0.0)
                    for edge_id in path.edge_ids
                ),
                map_length_px=(
                    sum(
                        edge_lengths.get(edge_id, 0.0)
                        for edge_id in path.edge_ids
                    )
                    or path.map_length_px
                ),
            )
    return transitions


def _generate_candidates(
    spot_by_id: dict[str, ScenicSpot],
    profiles: dict[str, RecommendationProfile],
    transitions: dict[tuple[str, str], TransitionData],
    entry_id: str,
    request: RouteRecommendRequest,
) -> list[CandidateRoute]:
    entry_profile = profiles[entry_id]
    frontier = [
        CandidateRoute(
            spot_ids=(entry_id,),
            walk_minutes=0,
            traversed_edge_ids=(),
            total_edge_length_px=0.0,
            repeated_edge_length_px=0.0,
            repeated_walk_minutes=0.0,
            base_value=0.0,
        )
    ]
    results: dict[tuple[str, ...], CandidateRoute] = {}
    max_walk = max(
        1,
        int(
            request.duration_minutes
            * PHYSICAL_WALK_RATIO[request.physical_level]
        ),
    )
    selectable_spot_ids = tuple(
        spot_id
        for spot_id in spot_by_id
        if spot_id != entry_id
    )

    route_spot_limit = _route_spot_limit(request.duration_minutes)
    for _ in range(
        min(route_spot_limit, len(selectable_spot_ids))
    ):
        expanded_routes: list[CandidateRoute] = []
        for candidate in frontier:
            current_id = candidate.spot_ids[-1]
            for spot_id in selectable_spot_ids:
                if spot_id in candidate.spot_ids:
                    continue
                transition = transitions.get((current_id, spot_id))
                if transition is None:
                    continue
                expanded = _extend_candidate(
                    candidate,
                    spot_id,
                    transition,
                    profiles,
                    request,
                )
                if expanded is None:
                    continue
                min_stay = entry_profile.min_stay_minutes + sum(
                    profiles[item].min_stay_minutes
                    for item in expanded.spot_ids[1:]
                )
                if min_stay + expanded.walk_minutes > request.duration_minutes:
                    continue
                if expanded.walk_minutes > max_walk:
                    continue
                expanded_routes.append(expanded)
                results[expanded.spot_ids] = expanded

        dominated: dict[
            tuple[frozenset[str], str],
            CandidateRoute,
        ] = {}
        for candidate in expanded_routes:
            key = (
                frozenset(candidate.spot_ids[1:]),
                candidate.spot_ids[-1],
            )
            existing = dominated.get(key)
            if existing is None or _beam_sort_key(
                candidate,
                profiles,
                request,
            ) < _beam_sort_key(existing, profiles, request):
                dominated[key] = candidate
        frontier = sorted(
            dominated.values(),
            key=lambda candidate: _beam_sort_key(
                candidate,
                profiles,
                request,
            ),
        )[:BEAM_WIDTH]
        if not frontier:
            break
    return list(results.values())


def _route_spot_limit(duration_minutes: int) -> int:
    if duration_minutes <= 60:
        return 3
    if duration_minutes <= 90:
        return 4
    if duration_minutes <= 120:
        return 6
    if duration_minutes <= 180:
        return 8
    return MAX_ROUTE_SPOTS


def _extend_candidate(
    candidate: CandidateRoute,
    spot_id: str,
    transition: TransitionData,
    profiles: dict[str, RecommendationProfile],
    request: RouteRecommendRequest,
) -> CandidateRoute | None:
    edge_counts = Counter(candidate.traversed_edge_ids)
    repeated_added = 0.0
    for edge_id, edge_length in zip(
        transition.edge_ids,
        transition.edge_lengths_px,
    ):
        if edge_counts[edge_id] > 0:
            repeated_added += edge_length
        edge_counts[edge_id] += 1

    total_edge_length = (
        candidate.total_edge_length_px + transition.map_length_px
    )
    repeated_edge_length = (
        candidate.repeated_edge_length_px + repeated_added
    )
    walk_minutes = candidate.walk_minutes + transition.minutes
    repeat_ratio = (
        repeated_edge_length / total_edge_length
        if total_edge_length > 0
        else 0.0
    )
    repeat_minutes = walk_minutes * repeat_ratio
    if (
        repeat_minutes > MAX_REPEAT_MINUTES
        or repeat_ratio > MAX_REPEAT_RATIO
    ):
        return None
    return CandidateRoute(
        spot_ids=(*candidate.spot_ids, spot_id),
        walk_minutes=walk_minutes,
        traversed_edge_ids=(
            *candidate.traversed_edge_ids,
            *transition.edge_ids,
        ),
        total_edge_length_px=total_edge_length,
        repeated_edge_length_px=repeated_edge_length,
        repeated_walk_minutes=repeat_minutes,
        base_value=(
            candidate.base_value
            + _spot_base_value(profiles[spot_id], request)
        ),
    )


def _beam_sort_key(
    candidate: CandidateRoute,
    profiles: dict[str, RecommendationProfile],
    request: RouteRecommendRequest,
) -> tuple:
    min_stay = sum(
        profiles[spot_id].min_stay_minutes
        for spot_id in candidate.spot_ids
    )
    minimum_total = min_stay + candidate.walk_minutes
    utilization = min(
        1.0,
        minimum_total / request.duration_minutes,
    )
    repeat_ratio = _repeat_ratio(candidate)
    rank = (
        candidate.base_value
        + utilization * 18
        - repeat_ratio * 50
        - candidate.walk_minutes * 0.08
    )
    return (
        -rank,
        candidate.repeated_walk_minutes,
        candidate.walk_minutes,
        candidate.spot_ids,
    )


def _score_candidate(
    candidate: CandidateRoute,
    profiles: dict[str, RecommendationProfile],
    request: RouteRecommendRequest,
) -> ScoredRoute:
    stay_minutes = _allocate_stay_minutes(
        candidate,
        profiles,
        request,
    )
    total_minutes = (
        sum(stay_minutes.values()) + candidate.walk_minutes
    )
    covered_themes = sum(
        any(
            profiles[spot_id].theme_scores.get(theme, 0) == 3
            for spot_id in candidate.spot_ids[1:]
        )
        for theme in request.interest_tags
    )
    unrelated_low_priority = sum(
        _theme_score_total(profiles[spot_id], request) == 0
        and profiles[spot_id].base_priority == 1
        for spot_id in candidate.spot_ids[1:]
    )
    max_walk = max(
        1,
        request.duration_minutes
        * PHYSICAL_WALK_RATIO[request.physical_level],
    )
    utilization_bonus = min(
        1.0,
        total_minutes / request.duration_minutes,
    ) * 30
    walk_penalty = min(
        12.0,
        12 * candidate.walk_minutes / max_walk,
    )
    repeat_penalty = min(50.0, _repeat_ratio(candidate) * 50)
    score = (
        candidate.base_value
        + covered_themes * 12
        + utilization_bonus
        - walk_penalty
        - repeat_penalty
        - unrelated_low_priority * 12
    )
    return ScoredRoute(
        candidate=candidate,
        stay_minutes=stay_minutes,
        total_minutes=total_minutes,
        score=score,
        preference_match=_preference_match(
            candidate.spot_ids,
            profiles,
            request,
        ),
    )


def _allocate_stay_minutes(
    candidate: CandidateRoute,
    profiles: dict[str, RecommendationProfile],
    request: RouteRecommendRequest,
) -> dict[str, int]:
    stays = {
        spot_id: profiles[spot_id].min_stay_minutes
        for spot_id in candidate.spot_ids
    }
    remaining = (
        request.duration_minutes
        - candidate.walk_minutes
        - sum(stays.values())
    )
    allocation_order = sorted(
        candidate.spot_ids[1:],
        key=lambda spot_id: (
            -_theme_score_total(profiles[spot_id], request),
            -profiles[spot_id].base_priority,
            candidate.spot_ids.index(spot_id),
        ),
    )
    while remaining >= 5:
        changed = False
        for spot_id in allocation_order:
            ideal = profiles[spot_id].ideal_stay_minutes
            if stays[spot_id] >= ideal:
                continue
            increment = min(5, ideal - stays[spot_id], remaining)
            if increment < 5:
                continue
            stays[spot_id] += increment
            remaining -= increment
            changed = True
            if remaining < 5:
                break
        if not changed:
            break
    return stays


def _spot_base_value(
    profile: RecommendationProfile,
    request: RouteRecommendRequest,
) -> float:
    return (
        10 * _theme_score_total(profile, request)
        + 8 * profile.base_priority
    )


def _theme_score_total(
    profile: RecommendationProfile,
    request: RouteRecommendRequest,
) -> int:
    return sum(
        profile.theme_scores.get(theme, 0)
        for theme in request.interest_tags
    )


def _repeat_ratio(candidate: CandidateRoute) -> float:
    if candidate.total_edge_length_px <= 0:
        return 0.0
    return (
        candidate.repeated_edge_length_px
        / candidate.total_edge_length_px
    )


def _candidate_to_response(
    db: Session,
    scored: ScoredRoute,
    spot_by_id: dict[str, ScenicSpot],
    profiles: dict[str, RecommendationProfile],
    request: RouteRecommendRequest,
    routing_profile: str,
) -> RecommendedRoute:
    candidate = scored.candidate
    estimate = estimate_spot_sequence(
        db,
        request.map_id,
        [
            (spot_id, scored.stay_minutes[spot_id])
            for spot_id in candidate.spot_ids
        ],
        routing_profile,
    )
    digest = sha1(
        (
            f"{request.map_id}|{'|'.join(request.interest_tags)}|"
            + "|".join(candidate.spot_ids)
        ).encode("utf-8")
    ).hexdigest()[:12]
    route_theme = "、".join(request.interest_tags)
    return RecommendedRoute(
        id=f"dynamic_{digest}",
        map_id=request.map_id,
        name=f"{MAP_NAMES[request.map_id]}个性化推荐路线",
        theme=route_theme,
        stay_minutes=estimate.stay_minutes,
        estimated_walk_minutes=estimate.walk_minutes,
        total_minutes=estimate.total_minutes,
        time_data_complete=estimate.complete,
        generation_mode="dynamic",
        preference_match=scored.preference_match,
        constraint_summary="",
        path_complete=route_path_is_complete(
            db,
            request.map_id,
            list(candidate.spot_ids),
            routing_profile,
        ),
        routing_profile=routing_profile,
        time_estimation_status=estimate.time_estimation_status,
        spots=[
            RecommendedRouteSpot(
                id=spot_id,
                name=spot_by_id[spot_id].name,
                stay_minutes=scored.stay_minutes[spot_id],
                reason="",
                transition_minutes=estimate.transitions[index].minutes,
                transition_note=estimate.transitions[index].note,
            )
            for index, spot_id in enumerate(candidate.spot_ids)
        ],
        recommendation_reason="",
    )


def _single_spot_fallback(
    spot_by_id: dict[str, ScenicSpot],
    profiles: dict[str, RecommendationProfile],
    transitions: dict[tuple[str, str], TransitionData],
    entry_id: str,
    request: RouteRecommendRequest,
) -> CandidateRoute | None:
    candidates: list[CandidateRoute] = []
    initial = CandidateRoute(
        spot_ids=(entry_id,),
        walk_minutes=0,
        traversed_edge_ids=(),
        total_edge_length_px=0.0,
        repeated_edge_length_px=0.0,
        repeated_walk_minutes=0.0,
        base_value=0.0,
    )
    for spot_id in spot_by_id:
        if spot_id == entry_id:
            continue
        transition = transitions.get((entry_id, spot_id))
        if transition is None:
            continue
        candidate = _extend_candidate(
            initial,
            spot_id,
            transition,
            profiles,
            request,
        )
        if candidate is None:
            continue
        minimum_total = (
            profiles[entry_id].min_stay_minutes
            + profiles[spot_id].min_stay_minutes
            + candidate.walk_minutes
        )
        if minimum_total <= request.duration_minutes:
            candidates.append(candidate)
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda candidate: (
            -candidate.base_value,
            candidate.walk_minutes,
            candidate.spot_ids,
        ),
    )[0]


def _template_fallback(
    db: Session,
    request: RouteRecommendRequest,
    routing_profile: str,
    profiles: dict[str, RecommendationProfile],
    transitions: dict[tuple[str, str], TransitionData],
) -> list[RecommendedRoute]:
    routes = db.scalars(
        select(Route)
        .where(Route.map_id == request.map_id)
        .options(selectinload(Route.spots).selectinload(RouteSpot.spot))
    ).all()
    if not routes:
        return []
    estimates = {
        route.id: _estimate_route_time(db, route, routing_profile)
        for route in routes
    }
    ranked = sorted(
        routes,
        key=lambda route: _template_sort_key(
            route,
            request,
            estimates[route.id],
            profiles,
            transitions,
        ),
    )
    return [
        _template_to_response(
            db,
            ranked[0],
            request,
            estimates[ranked[0].id],
            routing_profile,
        )
    ]


def _template_sort_key(
    route: Route,
    request: RouteRecommendRequest,
    estimate: RouteTimeEstimate,
    profiles: dict[str, RecommendationProfile],
    transitions: dict[tuple[str, str], TransitionData],
) -> tuple:
    ordered_ids = tuple(
        item.spot_id
        for item in sorted(route.spots, key=lambda item: item.sequence)
        if item.spot is not None
    )
    interest_score = sum(
        _theme_score_total(profiles[spot_id], request)
        for spot_id in ordered_ids
        if spot_id in profiles
    )
    repeat_minutes, repeat_ratio = _sequence_repeat_metrics(
        ordered_ids,
        transitions,
    )
    repeat_invalid = (
        repeat_minutes > MAX_REPEAT_MINUTES
        or repeat_ratio > MAX_REPEAT_RATIO
    )
    total = (
        estimate.total_minutes
        if estimate.complete
        else route.duration_minutes
    )
    return (
        repeat_invalid,
        total > request.duration_minutes,
        -interest_score,
        abs(total - request.duration_minutes),
        route.id,
    )


def _sequence_repeat_metrics(
    spot_ids: tuple[str, ...],
    transitions: dict[tuple[str, str], TransitionData],
) -> tuple[float, float]:
    traversed: Counter[str] = Counter()
    total_length = 0.0
    repeated_length = 0.0
    walk_minutes = 0
    for from_spot_id, to_spot_id in zip(spot_ids, spot_ids[1:]):
        transition = transitions.get((from_spot_id, to_spot_id))
        if transition is None:
            continue
        walk_minutes += transition.minutes
        total_length += transition.map_length_px
        for edge_id, edge_length in zip(
            transition.edge_ids,
            transition.edge_lengths_px,
        ):
            if traversed[edge_id] > 0:
                repeated_length += edge_length
            traversed[edge_id] += 1
    repeat_ratio = (
        repeated_length / total_length
        if total_length > 0
        else 0.0
    )
    return walk_minutes * repeat_ratio, repeat_ratio


def _template_to_response(
    db: Session,
    route: Route,
    request: RouteRecommendRequest,
    estimate: RouteTimeEstimate,
    routing_profile: str,
) -> RecommendedRoute:
    ordered = [
        route_spot
        for route_spot in sorted(
            route.spots,
            key=lambda item: item.sequence,
        )
        if route_spot.spot is not None
    ]
    total_minutes = (
        estimate.total_minutes
        if estimate.complete
        else route.duration_minutes
    )
    return RecommendedRoute(
        id=route.id,
        map_id=route.map_id,
        name=route.name,
        theme=route.theme,
        stay_minutes=estimate.stay_minutes,
        estimated_walk_minutes=estimate.walk_minutes,
        total_minutes=total_minutes,
        time_data_complete=estimate.complete,
        generation_mode="template_fallback",
        preference_match=0,
        constraint_summary="",
        path_complete=route_path_is_complete(
            db,
            route.map_id,
            [item.spot_id for item in ordered],
            routing_profile,
        ),
        routing_profile=routing_profile,
        time_estimation_status=estimate.time_estimation_status,
        spots=[
            RecommendedRouteSpot(
                id=item.spot.id,
                name=item.spot.name,
                stay_minutes=item.stay_minutes,
                reason="",
                transition_minutes=estimate.transitions[index].minutes,
                transition_note=estimate.transitions[index].note,
            )
            for index, item in enumerate(ordered)
        ],
        recommendation_reason="",
    )


def _preference_match(
    spot_ids: tuple[str, ...],
    profiles: dict[str, RecommendationProfile],
    request: RouteRecommendRequest,
) -> int:
    evaluated = [
        spot_id
        for spot_id in spot_ids
        if spot_id not in ENTRY_SPOTS.values()
    ]
    if not evaluated or not request.interest_tags:
        return 0
    actual = sum(
        _theme_score_total(profiles[spot_id], request)
        for spot_id in evaluated
    )
    maximum = 3 * len(request.interest_tags) * len(evaluated)
    return min(100, round(actual / maximum * 100))


def _estimate_route_time(
    db: Session,
    route: Route,
    routing_profile: str,
) -> RouteTimeEstimate:
    ordered = [
        route_spot
        for route_spot in sorted(
            route.spots,
            key=lambda item: item.sequence,
        )
        if route_spot.spot is not None
    ]
    return estimate_spot_sequence(
        db,
        route.map_id,
        [
            (item.spot_id, item.stay_minutes)
            for item in ordered
        ],
        routing_profile,
    )
