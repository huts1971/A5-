from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError
from app.models import (
    RouteDraft,
    RouteDraftSpot,
    RouteRevision,
    Route,
    ScenicSpot,
)
from app.schemas import (
    RouteDraftAddSpotRequest,
    RouteDraftCreate,
    RouteDraftReorderRequest,
    RouteDraftResponse,
    RouteDraftScopeRequest,
    RouteDraftSpotResponse,
)
from app.services.road_routing import (
    estimate_spot_sequence,
    routing_profile_for_preferences,
)


def create_route_draft(
    db: Session,
    payload: RouteDraftCreate,
) -> RouteDraftResponse:
    spot_ids = [spot.spot_id for spot in payload.spots]
    if len(set(spot_ids)) != len(spot_ids):
        raise ApiError("路线草稿不能包含重复景点", "DRAFT_DUPLICATE_SPOT", 409)
    _require_spots(db, spot_ids)
    if len({_map_id_for_spot_id(spot_id) for spot_id in spot_ids}) > 1:
        raise ApiError(
            "一条路线只能包含同一景区的景点",
            "DRAFT_SCENIC_AREA_MISMATCH",
            409,
        )
    if payload.source_route_id and db.get(Route, payload.source_route_id) is None:
        raise ApiError("来源路线不存在", "ROUTE_NOT_FOUND", 404)

    draft = RouteDraft(
        id=f"draft_{uuid4().hex}",
        source_route_id=payload.source_route_id,
        name=payload.name,
        theme=payload.theme,
        duration_budget=payload.duration_budget,
        preference_json=payload.preference_profile,
    )
    db.add(draft)
    db.flush()
    for sequence, spot in enumerate(payload.spots):
        db.add(
            RouteDraftSpot(
                draft_id=draft.id,
                spot_id=spot.spot_id,
                sequence=sequence,
                stay_minutes=spot.stay_minutes,
                reason=spot.reason,
            )
        )
    db.commit()
    return get_route_draft(db, draft.id)


def get_route_draft(db: Session, draft_id: str) -> RouteDraftResponse:
    draft = _load_draft(db, draft_id)
    return _to_response(db, draft)


def add_route_draft_spot(
    db: Session,
    draft_id: str,
    payload: RouteDraftAddSpotRequest,
) -> RouteDraftResponse:
    draft = _load_draft(db, draft_id)
    if any(spot.spot_id == payload.spot_id for spot in draft.spots):
        raise ApiError("该景点已在路线中", "DRAFT_DUPLICATE_SPOT", 409)
    scenic_spot = db.get(ScenicSpot, payload.spot_id)
    if scenic_spot is None:
        raise ApiError("景点不存在", "SPOT_NOT_FOUND", 404)

    target_map_id = _map_id_for_spot_id(payload.spot_id)
    has_other_area = any(
        _map_id_for_spot_id(spot.spot_id) != target_map_id
        for spot in draft.spots
    )
    if has_other_area and not payload.replace_other_area:
        raise ApiError(
            "一条路线只能包含同一景区的景点",
            "DRAFT_SCENIC_AREA_MISMATCH",
            409,
        )

    _save_revision(db, draft, "spot_added")
    if has_other_area:
        _retain_map_spots(db, draft, target_map_id)
        draft.source_route_id = None
        draft.name = _custom_route_name(target_map_id)
        draft.theme = "自定义路线"

    ordered = _ordered_spots(draft)
    position = min(
        payload.position if payload.position is not None else len(ordered),
        len(ordered),
    )
    for spot in ordered[position:]:
        spot.sequence += 1
    draft.spots.append(
        RouteDraftSpot(
            spot_id=scenic_spot.id,
            sequence=position,
            stay_minutes=payload.stay_minutes or scenic_spot.visit_minutes,
            reason=payload.reason or "手动加入路线。",
            spot=scenic_spot,
        )
    )
    _touch(draft)
    db.flush()
    _reject_budget_if_needed(db, draft, payload.allow_budget_exceeded)
    db.commit()
    return get_route_draft(db, draft_id)


def scope_route_draft(
    db: Session,
    draft_id: str,
    payload: RouteDraftScopeRequest,
) -> RouteDraftResponse:
    draft = _load_draft(db, draft_id)
    map_id = _require_map_id(payload.map_id)
    retained = [
        spot
        for spot in _ordered_spots(draft)
        if _map_id_for_spot_id(spot.spot_id) == map_id
    ]
    if not retained:
        raise ApiError(
            "当前景区路线还没有景点",
            "DRAFT_SCOPE_EMPTY",
            409,
        )
    if len(retained) == len(draft.spots):
        return _to_response(db, draft)

    _save_revision(db, draft, "scenic_area_changed")
    _retain_map_spots(db, draft, map_id)
    draft.source_route_id = None
    draft.name = _custom_route_name(map_id)
    draft.theme = "自定义路线"
    _touch(draft)
    db.commit()
    return get_route_draft(db, draft_id)


def delete_route_draft_spot(
    db: Session,
    draft_id: str,
    spot_id: str,
) -> RouteDraftResponse:
    draft = _load_draft(db, draft_id)
    ordered = _ordered_spots(draft)
    if len(ordered) <= 1:
        raise ApiError("路线至少保留一个景点", "DRAFT_MINIMUM_SPOTS", 409)
    target = next((spot for spot in ordered if spot.spot_id == spot_id), None)
    if target is None:
        raise ApiError("草稿中不存在该景点", "DRAFT_SPOT_NOT_FOUND", 404)

    _save_revision(db, draft, "spot_deleted")
    db.delete(target)
    for spot in ordered:
        if spot.sequence > target.sequence:
            spot.sequence -= 1
    _touch(draft)
    db.commit()
    return get_route_draft(db, draft_id)


def reorder_route_draft_spots(
    db: Session,
    draft_id: str,
    payload: RouteDraftReorderRequest,
) -> RouteDraftResponse:
    draft = _load_draft(db, draft_id)
    current_ids = [spot.spot_id for spot in _ordered_spots(draft)]
    if len(set(payload.spot_ids)) != len(payload.spot_ids):
        raise ApiError("排序列表不能包含重复景点", "DRAFT_DUPLICATE_SPOT", 409)
    if set(payload.spot_ids) != set(current_ids):
        raise ApiError("排序列表必须与草稿景点完全一致", "DRAFT_REORDER_INVALID", 422)
    if payload.spot_ids == current_ids:
        return _to_response(db, draft)

    _save_revision(db, draft, "spots_reordered")
    by_id = {spot.spot_id: spot for spot in draft.spots}
    for sequence, spot_id in enumerate(payload.spot_ids):
        by_id[spot_id].sequence = sequence
    _touch(draft)
    db.flush()
    _reject_budget_if_needed(db, draft, payload.allow_budget_exceeded)
    db.commit()
    return get_route_draft(db, draft_id)


def undo_route_draft(db: Session, draft_id: str) -> RouteDraftResponse:
    draft = _load_draft(db, draft_id)
    revision = db.scalar(
        select(RouteRevision)
        .where(RouteRevision.draft_id == draft_id)
        .order_by(RouteRevision.id.desc())
    )
    if revision is None:
        raise ApiError("没有可撤销的操作", "DRAFT_NOTHING_TO_UNDO", 409)

    db.execute(delete(RouteDraftSpot).where(RouteDraftSpot.draft_id == draft_id))
    for item in revision.snapshot_json.get("spots", []):
        db.add(
            RouteDraftSpot(
                draft_id=draft_id,
                spot_id=item["spot_id"],
                sequence=item["sequence"],
                stay_minutes=item["stay_minutes"],
                reason=item.get("reason", ""),
            )
        )
    db.delete(revision)
    _touch(draft)
    db.commit()
    return get_route_draft(db, draft_id)


def _load_draft(db: Session, draft_id: str) -> RouteDraft:
    draft = db.scalar(
        select(RouteDraft)
        .where(RouteDraft.id == draft_id)
        .options(selectinload(RouteDraft.spots).selectinload(RouteDraftSpot.spot))
    )
    if draft is None:
        raise ApiError("路线草稿不存在", "DRAFT_NOT_FOUND", 404)
    return draft


def _ordered_spots(draft: RouteDraft) -> list[RouteDraftSpot]:
    return sorted(draft.spots, key=lambda spot: spot.sequence)


def _require_spots(db: Session, spot_ids: list[str]) -> None:
    existing = set(
        db.scalars(select(ScenicSpot.id).where(ScenicSpot.id.in_(spot_ids))).all()
    )
    if missing := set(spot_ids) - existing:
        raise ApiError(
            f"景点不存在：{sorted(missing)[0]}",
            "SPOT_NOT_FOUND",
            404,
        )


def _map_id_for_spot_id(spot_id: str) -> str:
    return "nianhua-bay" if spot_id.startswith("spot_nh_") else "ling-shan"


def _require_map_id(map_id: str) -> str:
    if map_id not in {"ling-shan", "nianhua-bay"}:
        raise ApiError("不支持的景区地图", "SCENIC_MAP_INVALID", 422)
    return map_id


def _custom_route_name(map_id: str) -> str:
    return "拈花湾自定义路线" if map_id == "nianhua-bay" else "灵山胜境自定义路线"


def _retain_map_spots(
    db: Session,
    draft: RouteDraft,
    map_id: str,
) -> None:
    retained = [
        spot
        for spot in _ordered_spots(draft)
        if _map_id_for_spot_id(spot.spot_id) == map_id
    ]
    for spot in list(draft.spots):
        if _map_id_for_spot_id(spot.spot_id) != map_id:
            draft.spots.remove(spot)
            db.delete(spot)
    for sequence, spot in enumerate(retained):
        spot.sequence = sequence


def _save_revision(db: Session, draft: RouteDraft, action: str) -> None:
    db.add(
        RouteRevision(
            draft_id=draft.id,
            action=action,
            snapshot_json={
                "spots": [
                    {
                        "spot_id": spot.spot_id,
                        "sequence": spot.sequence,
                        "stay_minutes": spot.stay_minutes,
                        "reason": spot.reason,
                    }
                    for spot in _ordered_spots(draft)
                ]
            },
        )
    )


def _touch(draft: RouteDraft) -> None:
    draft.updated_at = datetime.now(UTC)


def _estimate(db: Session, draft: RouteDraft):
    ordered = _ordered_spots(draft)
    map_id = (
        _map_id_for_spot_id(ordered[0].spot_id)
        if ordered
        else "ling-shan"
    )
    preference = draft.preference_json or {}
    physical_level = str(
        preference.get("physicalLevel")
        or preference.get("physical_level")
        or "medium"
    )
    accessible_required = bool(
        preference.get("accessibleRequired")
        or preference.get("accessible_required")
        or False
    )
    return estimate_spot_sequence(
        db,
        map_id,
        [
            (spot.spot_id, spot.stay_minutes)
            for spot in ordered
        ],
        routing_profile_for_preferences(
            physical_level,
            accessible_required,
        ),
    )


def _reject_budget_if_needed(
    db: Session,
    draft: RouteDraft,
    allow_budget_exceeded: bool,
) -> None:
    estimate = _estimate(db, draft)
    if (
        estimate.complete
        and estimate.total_minutes > draft.duration_budget
        and not allow_budget_exceeded
    ):
        db.rollback()
        raise ApiError(
            "调整后预计时长超过预算，确认后可继续保留",
            "DRAFT_BUDGET_EXCEEDED",
            409,
        )


def _to_response(db: Session, draft: RouteDraft) -> RouteDraftResponse:
    ordered = _ordered_spots(draft)
    estimate = _estimate(db, draft)
    revision_count = db.scalar(
        select(func.count(RouteRevision.id)).where(
            RouteRevision.draft_id == draft.id
        )
    ) or 0
    transitions = estimate.transitions
    return RouteDraftResponse(
        id=draft.id,
        source_route_id=draft.source_route_id,
        name=draft.name,
        theme=draft.theme,
        duration_budget=draft.duration_budget,
        preference_profile=draft.preference_json or {},
        stay_minutes=estimate.stay_minutes,
        estimated_walk_minutes=estimate.walk_minutes,
        total_minutes=estimate.total_minutes,
        time_data_complete=estimate.complete,
        routing_profile=estimate.routing_profile,
        time_estimation_status=estimate.time_estimation_status,
        budget_exceeded=(
            estimate.complete
            and estimate.total_minutes > draft.duration_budget
        ),
        revision_count=revision_count,
        spots=[
            RouteDraftSpotResponse(
                spot_id=spot.spot_id,
                name=spot.spot.name,
                sequence=index,
                stay_minutes=spot.stay_minutes,
                reason=spot.reason,
                transition_minutes=transitions[index].minutes,
                transition_note=transitions[index].note,
            )
            for index, spot in enumerate(ordered)
        ],
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )
