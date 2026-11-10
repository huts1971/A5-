from datetime import UTC, datetime
from math import ceil, floor
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError
from app.models import TourEvent, TourSession
from app.schemas import (
    TourEventCreate,
    TourRecapMovement,
    TourRecapResponse,
    TourRecapSpot,
    TourSessionResponse,
    TourSpotResponse,
)
from app.services.route_drafts import get_route_draft

PROGRESS_EVENTS = {"spot_completed", "spot_skipped"}
RECAP_FORMULA_VERSION = "demo-v1"
SUPPORTED_MAP_IDS = {"ling-shan", "nianhua-bay"}
ALLOWED_EVENTS = {
    "spot_arrived",
    "spot_completed",
    "spot_skipped",
    "route_adjusted",
    "ai_consulted",
    "tour_finished",
}


def create_tour(
    db: Session,
    draft_id: str,
    map_id: str | None = None,
) -> TourSessionResponse:
    draft = get_route_draft(db, draft_id)
    spots = draft.spots
    if map_id is not None:
        if map_id not in SUPPORTED_MAP_IDS:
            raise ApiError("不支持的景区地图", "SCENIC_MAP_INVALID", 422)
        spots = [
            spot
            for spot in spots
            if (
                spot.spot_id.startswith("spot_nh_")
                if map_id == "nianhua-bay"
                else not spot.spot_id.startswith("spot_nh_")
            )
        ]
        if not spots:
            raise ApiError(
                "当前景区路线还没有景点",
                "TOUR_SCENIC_AREA_EMPTY",
                409,
            )
    session_name = (
        "拈花湾自定义路线"
        if map_id == "nianhua-bay"
        else "灵山胜境自定义路线"
        if map_id == "ling-shan"
        else draft.name
    )
    session = TourSession(
        id=f"tour_{uuid4().hex}",
        route_draft_id=draft.id,
        name=session_name,
        status="active",
        current_index=0,
        route_snapshot={
            "spots": [spot.model_dump(mode="json") for spot in spots],
            "revision_count": draft.revision_count,
            "preference_profile": draft.preference_profile,
            "routing_profile": draft.routing_profile,
            "time_estimation_status": draft.time_estimation_status,
            "recommended_spot_ids": [spot.spot_id for spot in spots],
            "recommended_order": [spot.name for spot in spots],
            "map_id": map_id or _infer_map_id(
                [spot.spot_id for spot in spots]
            ),
            "recap_formula_version": RECAP_FORMULA_VERSION,
        },
    )
    db.add(session)
    db.flush()
    db.add(
        TourEvent(
            session_id=session.id,
            event_type="tour_started",
            event_data={"route_draft_id": draft.id},
        )
    )
    db.commit()
    return get_tour(db, session.id)


def get_tour(db: Session, tour_id: str) -> TourSessionResponse:
    session = _load_tour(db, tour_id)
    return _to_session_response(session)


def record_tour_event(
    db: Session,
    tour_id: str,
    payload: TourEventCreate,
) -> TourSessionResponse:
    session = _load_tour(db, tour_id)
    if payload.event_type not in ALLOWED_EVENTS:
        raise ApiError("不支持的游览事件", "TOUR_EVENT_INVALID", 422)
    if session.status == "finished":
        raise ApiError("游览已经结束", "TOUR_ALREADY_FINISHED", 409)

    spots = session.route_snapshot.get("spots", [])
    current = spots[session.current_index] if session.current_index < len(spots) else None
    if payload.event_type.startswith("spot_"):
        if current is None:
            raise ApiError("当前没有可操作的景点", "TOUR_NO_CURRENT_SPOT", 409)
        target_spot_id = payload.spot_id or current["spot_id"]
        if target_spot_id != current["spot_id"]:
            raise ApiError("只能操作当前游览景点", "TOUR_SPOT_OUT_OF_ORDER", 409)
    else:
        target_spot_id = payload.spot_id

    now = datetime.now(UTC)
    event_data = {}
    if payload.note:
        event_data["note"] = payload.note
    if payload.topic:
        event_data["topic"] = payload.topic
    db.add(
        TourEvent(
            session_id=session.id,
            event_type=payload.event_type,
            spot_id=target_spot_id,
            event_data=event_data,
            occurred_at=now,
        )
    )

    if payload.event_type in PROGRESS_EVENTS:
        session.current_index += 1
        if session.current_index >= len(spots):
            _finish_tour(db, session, now)
    elif payload.event_type == "tour_finished":
        _finish_tour(db, session, now, add_event=False)
    session.updated_at = now
    db.commit()
    return get_tour(db, tour_id)


def get_tour_recap(db: Session, tour_id: str) -> TourRecapResponse:
    session = _load_tour(db, tour_id)
    events = sorted(session.events, key=lambda event: (event.occurred_at, event.id))
    route_spots = session.route_snapshot.get("spots", [])
    route_spots_by_id = {
        str(spot.get("spot_id", "")): spot
        for spot in route_spots
    }
    spot_names = {
        spot["spot_id"]: spot["name"]
        for spot in route_spots
    }
    actual_events = [
        event
        for event in events
        if (
            event.event_type in PROGRESS_EVENTS
            and not _is_entrance_spot(event.spot_id)
        )
    ]
    recommended_spots = [
        spot
        for spot in route_spots
        if not _is_entrance_spot(str(spot.get("spot_id", "")))
    ]
    recommended_spot_ids = [
        str(spot.get("spot_id", ""))
        for spot in recommended_spots
    ]
    end_time = session.finished_at or datetime.now(UTC)
    elapsed = max(
        0,
        ceil(
            (
                _as_utc(end_time) - _as_utc(session.started_at)
            ).total_seconds()
            / 60
        ),
    )
    ai_topics = [
        str(event.event_data.get("topic"))
        for event in events
        if event.event_data.get("topic")
    ]
    return TourRecapResponse(
        id=session.id,
        name=session.name,
        map_id=_resolve_map_id(session.route_snapshot),
        status=session.status,
        started_at=session.started_at,
        finished_at=session.finished_at,
        elapsed_minutes=elapsed,
        completed_count=sum(
            event.event_type == "spot_completed" for event in actual_events
        ),
        skipped_count=sum(
            event.event_type == "spot_skipped" for event in actual_events
        ),
        adjustment_count=(
            int(session.route_snapshot.get("revision_count", 0))
            + sum(event.event_type == "route_adjusted" for event in events)
        ),
        deviation_count=sum(
            1
            for index, event in enumerate(actual_events)
            if index >= len(recommended_spot_ids)
            or event.spot_id
            != recommended_spot_ids[index]
        )
        + abs(len(recommended_spot_ids) - len(actual_events)),
        recommended_order=[
            str(spot.get("name", ""))
            for spot in recommended_spots
        ],
        preference_profile=session.route_snapshot.get("preference_profile", {}),
        actual_order=[
            TourRecapSpot(
                spot_id=event.spot_id or "",
                name=spot_names.get(event.spot_id or "", "未知景点"),
                result=(
                    "completed"
                    if event.event_type == "spot_completed"
                    else "skipped"
                ),
                occurred_at=event.occurred_at,
                planned_stay_minutes=_safe_nonnegative_int(
                    route_spots_by_id.get(event.spot_id or "", {}).get(
                        "stay_minutes"
                    )
                ),
                transition_minutes=_safe_optional_nonnegative_int(
                    route_spots_by_id.get(event.spot_id or "", {}).get(
                        "transition_minutes"
                    )
                ),
            )
            for event in actual_events
        ],
        ai_topics=ai_topics,
        movement=_build_recap_movement(route_spots_by_id, actual_events),
    )


def _build_recap_movement(
    route_spots_by_id: dict[str, dict],
    actual_events: list[TourEvent],
) -> TourRecapMovement:
    progressed_spots = [
        (event, route_spots_by_id.get(event.spot_id or ""))
        for event in actual_events
        if not _is_entrance_spot(event.spot_id)
    ]
    if not progressed_spots:
        return _unavailable_recap_movement(0.0)

    transitions = [
        _safe_optional_nonnegative_int(
            spot.get("transition_minutes") if spot is not None else None
        )
        for _, spot in progressed_spots
    ]
    covered_count = sum(value is not None for value in transitions)
    raw_coverage_ratio = covered_count / len(transitions)
    coverage_ratio = round(raw_coverage_ratio, 2)
    if covered_count == len(transitions):
        confidence = "medium"
    elif raw_coverage_ratio >= 0.6:
        confidence = "low"
    else:
        return _unavailable_recap_movement(coverage_ratio)

    walk_minutes = sum(value or 0 for value in transitions)
    planned_scenic_minutes = sum(
        _safe_nonnegative_int(spot.get("stay_minutes"))
        for event, spot in progressed_spots
        if event.event_type == "spot_completed" and spot is not None
    )
    distance_meters = walk_minutes * 70
    estimated_steps = int(round((distance_meters / 0.70) / 100) * 100)
    raw_calories = 3.3 * 3.5 * 60 / 200 * walk_minutes
    estimated_calories = int(floor(raw_calories / 5 + 0.5) * 5)
    return TourRecapMovement(
        estimated_walking_minutes=walk_minutes,
        planned_scenic_minutes=planned_scenic_minutes,
        estimated_distance_meters=distance_meters,
        estimated_steps=estimated_steps,
        estimated_calories_kcal=estimated_calories,
        coverage_ratio=coverage_ratio,
        confidence=confidence,
        formula_version=RECAP_FORMULA_VERSION,
    )


def _unavailable_recap_movement(
    coverage_ratio: float,
) -> TourRecapMovement:
    return TourRecapMovement(
        estimated_walking_minutes=None,
        planned_scenic_minutes=None,
        estimated_distance_meters=None,
        estimated_steps=None,
        estimated_calories_kcal=None,
        coverage_ratio=coverage_ratio,
        confidence="unavailable",
        formula_version=RECAP_FORMULA_VERSION,
    )


def _safe_optional_nonnegative_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _safe_nonnegative_int(value: object) -> int:
    return _safe_optional_nonnegative_int(value) or 0


def _is_entrance_spot(spot_id: str | None) -> bool:
    return bool(spot_id and spot_id.endswith("_entrance"))


def _resolve_map_id(route_snapshot: dict) -> str:
    stored_map_id = route_snapshot.get("map_id")
    if stored_map_id in SUPPORTED_MAP_IDS:
        return str(stored_map_id)
    return _infer_map_id(
        [
            str(spot.get("spot_id", ""))
            for spot in route_snapshot.get("spots", [])
        ]
    )


def _infer_map_id(spot_ids: list[str]) -> str:
    first_spot_id = next((spot_id for spot_id in spot_ids if spot_id), "")
    return (
        "nianhua-bay"
        if first_spot_id.startswith("spot_nh_")
        else "ling-shan"
    )


def _finish_tour(
    db: Session,
    session: TourSession,
    now: datetime,
    add_event: bool = True,
) -> None:
    session.status = "finished"
    session.finished_at = now
    if add_event:
        db.add(
            TourEvent(
                session_id=session.id,
                event_type="tour_finished",
                occurred_at=now,
            )
        )


def _load_tour(db: Session, tour_id: str) -> TourSession:
    session = db.scalar(
        select(TourSession)
        .where(TourSession.id == tour_id)
        .options(selectinload(TourSession.events))
    )
    if session is None:
        raise ApiError("游览会话不存在", "TOUR_NOT_FOUND", 404)
    return session


def _to_session_response(session: TourSession) -> TourSessionResponse:
    events = sorted(session.events, key=lambda event: (event.occurred_at, event.id))
    states: dict[str, dict] = {}
    for event in events:
        if not event.spot_id:
            continue
        state = states.setdefault(event.spot_id, {})
        if event.event_type == "spot_arrived":
            state["arrived_at"] = event.occurred_at
        elif event.event_type == "spot_completed":
            state["status"] = "completed"
            state["completed_at"] = event.occurred_at
        elif event.event_type == "spot_skipped":
            state["status"] = "skipped"
            state["completed_at"] = event.occurred_at

    spots = session.route_snapshot.get("spots", [])
    response_spots = []
    for index, spot in enumerate(spots):
        state = states.get(spot["spot_id"], {})
        if state.get("status"):
            status = state["status"]
        elif session.status == "active" and index == session.current_index:
            status = "current"
        else:
            status = "pending"
        response_spots.append(
            TourSpotResponse(
                **spot,
                status=status,
                arrived_at=state.get("arrived_at"),
                completed_at=state.get("completed_at"),
            )
        )
    return TourSessionResponse(
        id=session.id,
        route_draft_id=session.route_draft_id,
        name=session.name,
        status=session.status,
        current_index=session.current_index,
        started_at=session.started_at,
        updated_at=session.updated_at,
        finished_at=session.finished_at,
        event_count=len(events),
        routing_profile=session.route_snapshot.get(
            "routing_profile",
            "fastest",
        ),
        time_estimation_status=session.route_snapshot.get(
            "time_estimation_status",
            "unavailable",
        ),
        spots=response_spots,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
