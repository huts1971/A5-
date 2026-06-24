from collections import Counter
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.core.config import settings
from app.core.errors import ApiError
from app.models import (
    ApprovedWebFact,
    ChatMessage,
    ChatSession,
    KnowledgeChunk,
    KnowledgeDoc,
    Route,
    RouteSpot,
    ScenicSpot,
    SpotFact,
    WebFactCandidate,
)
from app.schemas import RouteUpsert, SpotDetail, SpotUpsert

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


class WebFactCandidateReview(BaseModel):
    action: str


FACT_LABELS = {
    "height_meters": "高度",
    "opening_time": "开放时间",
    "ticket": "票务信息",
    "visit_minutes": "建议游览时长",
    "suitability": "适合情况",
}


@router.get("/dashboard")
def get_admin_dashboard(request: Request, db: Session = Depends(get_db)) -> dict:
    active_settings = getattr(request.app.state, "settings", settings)
    messages = db.scalars(
        select(ChatMessage).order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
    ).all()
    sessions = {session.id: session for session in db.scalars(select(ChatSession)).all()}
    today = datetime.now(UTC).date()
    trend_days = [(today - timedelta(days=offset)) for offset in range(6, -1, -1)]
    trend_counter: Counter[str] = Counter()
    top_spots: Counter[str] = Counter()
    preference_counter: Counter[str] = Counter()
    degraded_count = 0
    total_ms_values: list[float] = []

    for message in messages:
        message_date = message.created_at.date()
        trend_counter[message_date.isoformat()] += 1
        metrics = message.metrics_json or {}
        if metrics.get("degraded"):
            degraded_count += 1
        total_ms = metrics.get("total_ms")
        if isinstance(total_ms, int | float):
            total_ms_values.append(float(total_ms))

        session = sessions.get(message.session_id)
        visitor_type = (session.visitor_type if session else "") or "未标注"
        preference_counter[visitor_type] += 1

        for source in message.sources_json or []:
            spot_name = str(source.get("spot_name") or source.get("spotName") or "").strip()
            if spot_name and spot_name not in {"通用资料", "灵山胜境资料"}:
                top_spots[spot_name] += 1

    top_questions = Counter(message.question for message in messages).most_common(6)
    recent_logs = [
        {
            "id": message.id,
            "question": message.question,
            "answer": message.answer,
            "source_count": len(message.sources_json or []),
            "created_at": message.created_at.isoformat(),
        }
        for message in messages[:5]
    ]

    return {
        "summary": {
            "total_questions": len(messages),
            "today_questions": trend_counter[today.isoformat()],
            "spot_count": db.scalar(select(func.count()).select_from(ScenicSpot)) or 0,
            "route_count": db.scalar(select(func.count()).select_from(Route)) or 0,
            "knowledge_doc_count": db.scalar(select(func.count()).select_from(KnowledgeDoc)) or 0,
            "knowledge_chunk_count": db.scalar(select(func.count()).select_from(KnowledgeChunk)) or 0,
            "degraded_count": degraded_count,
            "avg_total_ms": round(sum(total_ms_values) / len(total_ms_values), 2)
            if total_ms_values
            else 0,
        },
        "top_questions": [
            {"question": question, "count": count} for question, count in top_questions
        ],
        "top_spots": [
            {"spot_name": spot_name, "count": count}
            for spot_name, count in top_spots.most_common(6)
        ],
        "preference_distribution": [
            {"label": label, "count": count}
            for label, count in preference_counter.most_common()
        ],
        "qa_trend": [
            {"date": day.isoformat(), "count": trend_counter[day.isoformat()]}
            for day in trend_days
        ],
        "recent_logs": recent_logs,
        "behavior_summary": _load_behavior_summary(active_settings.derived_knowledge_path),
    }


def _load_behavior_summary(derived_knowledge_path: str) -> dict:
    summary_path = Path(derived_knowledge_path) / "tabular" / "behavior_summary.json"
    if not summary_path.exists():
        return {
            "record_count": 0,
            "usage_note": "未找到资料包行为分析摘要，请先运行 derive_behavior_summary.py。",
            "overall": {},
            "attraction_type_distribution": [],
            "age_distribution": [],
            "gender_distribution": [],
            "type_behavior": [],
            "insights": [],
        }
    try:
        return json.loads(summary_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {
            "record_count": 0,
            "usage_note": "资料包行为分析摘要读取失败，请重新生成。",
            "overall": {},
            "attraction_type_distribution": [],
            "age_distribution": [],
            "gender_distribution": [],
            "type_behavior": [],
            "insights": [],
        }


@router.post("/spots", response_model=SpotDetail)
def create_spot(payload: SpotUpsert, db: Session = Depends(get_db)) -> SpotDetail:
    spot = ScenicSpot(**payload.model_dump())
    db.add(spot)
    db.commit()
    db.refresh(spot)
    return SpotDetail.model_validate(spot)


@router.put("/spots/{spot_id}", response_model=SpotDetail)
def update_spot(
    spot_id: str,
    payload: SpotUpsert,
    db: Session = Depends(get_db),
) -> SpotDetail:
    spot = db.get(ScenicSpot, spot_id)
    if spot is None:
        raise ApiError("景点不存在", "SPOT_NOT_FOUND", 404)
    for key, value in payload.model_dump().items():
        setattr(spot, key, value)
    db.commit()
    db.refresh(spot)
    return SpotDetail.model_validate(spot)


@router.delete("/spots/{spot_id}")
def delete_spot(spot_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    spot = db.get(ScenicSpot, spot_id)
    if spot is None:
        raise ApiError("景点不存在", "SPOT_NOT_FOUND", 404)
    db.delete(spot)
    db.commit()
    return {"status": "deleted"}


@router.post("/routes")
def create_route(payload: RouteUpsert, db: Session = Depends(get_db)) -> dict:
    route = Route(**payload.model_dump(exclude={"spots"}))
    db.add(route)
    _replace_route_spots(db, payload)
    db.commit()
    return _route_payload(route, payload)


@router.put("/routes/{route_id}")
def update_route(
    route_id: str,
    payload: RouteUpsert,
    db: Session = Depends(get_db),
) -> dict:
    route = db.get(Route, route_id)
    if route is None:
        raise ApiError("路线不存在", "ROUTE_NOT_FOUND", 404)
    for key, value in payload.model_dump(exclude={"spots"}).items():
        setattr(route, key, value)
    db.execute(delete(RouteSpot).where(RouteSpot.route_id == route_id))
    _replace_route_spots(db, payload)
    db.commit()
    db.refresh(route)
    return _route_payload(route, payload)


@router.delete("/routes/{route_id}")
def delete_route(route_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    route = db.get(Route, route_id)
    if route is None:
        raise ApiError("路线不存在", "ROUTE_NOT_FOUND", 404)
    db.execute(delete(RouteSpot).where(RouteSpot.route_id == route_id))
    db.delete(route)
    db.commit()
    return {"status": "deleted"}


@router.get("/web-fact-candidates")
def list_web_fact_candidates(
    status: str = "pending_review",
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(WebFactCandidate)
    if status:
        query = query.filter(WebFactCandidate.status == status)
    candidates = query.order_by(
        WebFactCandidate.created_at.desc(),
        WebFactCandidate.id.desc(),
    ).all()
    return {
        "items": [_web_fact_candidate_payload(candidate) for candidate in candidates],
        "total": len(candidates),
    }


@router.post("/web-fact-candidates/{candidate_id}/review")
def review_web_fact_candidate(
    candidate_id: int,
    payload: WebFactCandidateReview,
    db: Session = Depends(get_db),
) -> dict:
    candidate = db.get(WebFactCandidate, candidate_id)
    if candidate is None:
        raise ApiError("联网事实候选不存在", "WEB_FACT_CANDIDATE_NOT_FOUND", 404)

    if payload.action == "approve_supplemental":
        db.add(
            ApprovedWebFact(
                entity_type=candidate.entity_type,
                entity_id=candidate.entity_id,
                fact_key=candidate.fact_key,
                fact_label=_fact_label(candidate.fact_key),
                fact_value=candidate.fact_value,
                fact_unit="",
                source_url=candidate.source_url,
                source_level=candidate.source_level,
                confidence=0.8,
            )
        )
        candidate.status = "approved_supplemental"
    elif payload.action == "approve_official":
        db.add(
            SpotFact(
                spot_id=candidate.entity_id,
                fact_key=candidate.fact_key,
                fact_label=_fact_label(candidate.fact_key),
                fact_value=candidate.fact_value,
                fact_unit="",
                confidence=0.9,
                source_type="database",
                source_ref="admin_web_review",
                source_url=candidate.source_url,
            )
        )
        candidate.status = "approved_official"
    elif payload.action == "reject":
        candidate.status = "rejected"
    elif payload.action == "ignore":
        candidate.status = "ignored"
    else:
        raise ApiError("不支持的审核动作", "WEB_FACT_REVIEW_ACTION_INVALID", 400)

    db.commit()
    db.refresh(candidate)
    return _web_fact_candidate_payload(candidate)


def _replace_route_spots(db: Session, payload: RouteUpsert) -> None:
    for spot in payload.spots:
        db.add(
            RouteSpot(
                route_id=payload.id,
                spot_id=spot.spot_id,
                sequence=spot.sequence,
                stay_minutes=spot.stay_minutes,
                reason=spot.reason,
            )
        )


def _route_payload(route: Route, payload: RouteUpsert) -> dict:
    return {
        "id": route.id,
        "map_id": route.map_id,
        "name": route.name,
        "theme": route.theme,
        "duration_minutes": route.duration_minutes,
        "suitable_crowd": route.suitable_crowd,
        "description": route.description,
        "spots": [spot.model_dump() for spot in payload.spots],
    }


def _web_fact_candidate_payload(candidate: WebFactCandidate) -> dict:
    return {
        "id": candidate.id,
        "entity_type": candidate.entity_type,
        "entity_id": candidate.entity_id,
        "entity_name": candidate.entity_name,
        "fact_key": candidate.fact_key,
        "fact_value": candidate.fact_value,
        "source_url": candidate.source_url,
        "source_level": candidate.source_level,
        "question": candidate.question,
        "answer_excerpt": candidate.answer_excerpt,
        "status": candidate.status,
        "created_at": candidate.created_at.isoformat(),
    }


def _fact_label(fact_key: str) -> str:
    return FACT_LABELS.get(fact_key, fact_key)
