from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
import json
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.core.config import settings
from app.core.errors import ApiError
from app.models import (
    ApprovedWebFact,
    ChatMessage,
    KnowledgeChunk,
    KnowledgeDoc,
    Route,
    RoutePreferenceLog,
    RouteSpot,
    ScenicSpot,
    SpotFact,
    WebFactCandidate,
)
from app.schemas import RouteUpsert, SpotDetail, SpotUpsert
from app.services.operations import (
    VALID_RANGES,
    build_operations_overview,
    build_visitor_insights_report,
    classify_concern_topic,
)
from app.services.rag import clear_retrieval_cache
from app.services.rag_index import rebuild_knowledge_fts_index
from app.services.routes import THEME_ALIASES, THEMES

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


class WebFactCandidateReview(BaseModel):
    action: str


class WebFactCandidateUpdate(BaseModel):
    entity_type: str | None = None
    entity_id: str | None = None
    entity_name: str | None = None
    fact_key: str | None = None
    fact_value: str | None = None
    source_url: str | None = None
    source_level: str | None = None
    question: str | None = None
    answer_excerpt: str | None = None


class OfficialWebFactUpdate(BaseModel):
    spot_id: str | None = None
    fact_key: str | None = None
    fact_value: str | None = None
    source_url: str | None = None


FACT_LABELS = {
    "height_meters": "高度",
    "opening_time": "开放时间",
    "ticket": "票务信息",
    "visit_minutes": "建议游览时长",
    "suitability": "适合情况",
    "traffic": "交通到达",
    "night_view": "夜间景观",
    "performance": "演艺活动",
    "photo_spot": "摄影打卡",
    "service": "服务设施",
    "weather": "天气信息",
    "web_supplement": "联网补充",
}


QA_HEATMAP_HOURS = tuple(range(6, 23))

QUESTION_TOPIC_RULES = [
    (
        "路线规划",
        (
            "路线",
            "线路",
            "规划",
            "怎么走",
            "怎么逛",
            "几小时",
            "两小时",
            "半日",
            "一日",
            "可游览",
            "步行强度",
        ),
    ),
    (
        "景点讲解",
        (
            "景点",
            "讲解",
            "介绍",
            "看点",
            "历史",
            "文化",
            "灵山大佛",
            "梵宫",
            "九龙灌浴",
            "五印坛城",
            "佛足坛",
            "阿育王柱",
            "鹿鸣谷",
        ),
    ),
    (
        "票务开放",
        (
            "门票",
            "票价",
            "多少钱",
            "价格",
            "开放",
            "营业",
            "闭园",
            "几点",
            "预约",
            "入园",
            "买票",
        ),
    ),
    (
        "交通到达",
        (
            "交通",
            "怎么去",
            "到达",
            "位置",
            "在哪",
            "哪里",
            "入口",
            "停车",
            "停车场",
            "公交",
            "地铁",
            "打车",
            "导航",
        ),
    ),
    (
        "服务设施",
        (
            "卫生间",
            "厕所",
            "餐厅",
            "吃饭",
            "寄存",
            "轮椅",
            "母婴",
            "服务中心",
            "休息",
            "设施",
            "饮水",
        ),
    ),
]

QUESTION_ROUTE_STRONG_MARKERS = (
    "生成游览路线",
    "游览路线",
    "规划路线",
    "规划一下路线",
    "规划一个",
    "帮我规划",
    "路线",
    "线路",
    "几小时",
    "两小时",
    "半日",
    "一日",
    "可游览",
    "步行强度",
    "高强度",
    "中等强度",
)


@router.get("/dashboard")
def get_admin_dashboard(
    request: Request,
    range: str = "7d",
    db: Session = Depends(get_db),
) -> dict:
    if range not in VALID_RANGES:
        range = "7d"

    active_settings = getattr(request.app.state, "settings", settings)
    messages = db.scalars(
        select(ChatMessage).order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
    ).all()
    today = datetime.now(UTC).date()
    period_start = _dashboard_period_start(today, range)
    period_end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=UTC)
    trend_days = _dashboard_trend_days(today, range)
    trend_day_set = set(trend_days)
    range_messages = [
        message
        for message in messages
        if period_start <= _as_utc(message.created_at) < period_end
    ]
    route_preference_logs = [
        log
        for log in db.scalars(select(RoutePreferenceLog)).all()
        if period_start <= _as_utc(log.created_at) < period_end
    ]
    trend_counter: Counter[str] = Counter()
    hourly_counter: Counter[tuple[str, int]] = Counter()
    topic_counter: Counter[str] = Counter()
    top_spots: Counter[str] = Counter()
    preference_counter: Counter[str] = Counter()
    degraded_count = 0
    total_ms_values: list[float] = []

    for message in range_messages:
        message_date = _as_utc(message.created_at).date()
        message_day_key = message_date.isoformat()
        trend_counter[message_day_key] += 1
        message_hour = _as_utc(message.created_at).hour
        if message_date in trend_day_set and message_hour in QA_HEATMAP_HOURS:
            hourly_counter[(message_day_key, message_hour)] += 1
        question_topic = classify_concern_topic(message.question)
        if question_topic:
            topic_counter[question_topic] += 1
        metrics = message.metrics_json or {}
        if metrics.get("degraded"):
            degraded_count += 1
        total_ms = metrics.get("total_ms")
        if isinstance(total_ms, int | float):
            total_ms_values.append(float(total_ms))

        for source in message.sources_json or []:
            spot_name = str(source.get("spot_name") or source.get("spotName") or "").strip()
            if spot_name and spot_name not in {"通用资料", "灵山胜境资料"}:
                top_spots[spot_name] += 1

    for log in route_preference_logs:
        for interest_tag in _route_preference_log_interest_tags(log):
            preference_counter[interest_tag] += 1

    top_questions = Counter(message.question for message in range_messages).most_common(6)
    recent_logs = [
        {
            "id": message.id,
            "question": message.question,
            "answer": message.answer,
            "source_count": len(message.sources_json or []),
            "created_at": message.created_at.isoformat(),
        }
        for message in range_messages[:5]
    ]

    return {
        "summary": {
            "total_questions": len(messages),
            "today_questions": sum(
                1 for message in messages if _as_utc(message.created_at).date() == today
            ),
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
            {"label": label, "count": preference_counter[label]}
            for label in THEMES
            if preference_counter[label] > 0
        ],
        "qa_trend": [
            {"date": day.isoformat(), "count": trend_counter[day.isoformat()]}
            for day in trend_days
        ],
        "hourly_heatmap": [
            {
                "date": day.isoformat(),
                "hour": hour,
                "count": hourly_counter[(day.isoformat(), hour)],
            }
            for day in trend_days
            for hour in QA_HEATMAP_HOURS
        ],
        "topic_rank": [
            {"topic": topic, "count": count}
            for topic, count in topic_counter.most_common(5)
        ],
        "recent_logs": recent_logs,
        "behavior_summary": _load_behavior_summary(active_settings.derived_knowledge_path),
    }


def _dashboard_period_start(today: date, range_name: str) -> datetime:
    if range_name == "today":
        start_date = today
    elif range_name == "week":
        start_date = today - timedelta(days=today.weekday())
    elif range_name == "30d":
        start_date = today - timedelta(days=29)
    else:
        start_date = today - timedelta(days=6)
    return datetime.combine(start_date, time.min, tzinfo=UTC)


def _dashboard_trend_days(today: date, range_name: str) -> list[date]:
    start = _dashboard_period_start(today, range_name).date()
    return [start + timedelta(days=offset) for offset in range((today - start).days + 1)]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _classify_question_topic(question: str) -> str | None:
    text = (question or "").strip().lower()
    if not text:
        return None
    if any(marker in text for marker in QUESTION_ROUTE_STRONG_MARKERS):
        return "路线规划"
    topic_priority = ("票务开放", "服务设施", "交通到达", "景点讲解", "路线规划")
    for priority_topic in topic_priority:
        for topic, keywords in QUESTION_TOPIC_RULES:
            if topic == priority_topic and any(keyword.lower() in text for keyword in keywords):
                return topic
    return None


def _route_preference_log_interest_tags(log: RoutePreferenceLog) -> list[str]:
    tags = log.interest_tags or []
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = []
    if not isinstance(tags, list):
        return []
    normalized = [
        tag
        for raw_tag in tags
        if (tag := _normalize_dashboard_interest_tag(raw_tag))
    ]
    return list(dict.fromkeys(normalized))


def _normalize_dashboard_interest_tag(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = THEME_ALIASES.get(text)
    if normalized in THEMES:
        return normalized

    compact = text.replace(" ", "")
    keyword_aliases = (
        ("佛教文化", ("佛教", "历史", "文化", "礼佛", "禅寺")),
        ("建筑艺术", ("建筑", "艺术", "空间")),
        ("演艺亲子", ("演艺", "表演", "亲子", "孩子", "儿童")),
        ("摄影打卡", ("摄影", "拍照", "打卡", "出片")),
        ("自然休闲", ("自然", "休闲", "慢游", "花海", "风光", "餐饮", "购物")),
        ("室内体验", ("室内", "避雨", "展馆")),
    )
    for canonical, keywords in keyword_aliases:
        if any(keyword in compact for keyword in keywords):
            return canonical
    return None


@router.get("/operations/overview")
def get_operations_overview(range: str = "week", db: Session = Depends(get_db)) -> dict:
    if range not in VALID_RANGES:
        raise ApiError("不支持的运营分析时间范围", "OPERATIONS_RANGE_INVALID", 400)
    return build_operations_overview(db, range)


@router.get("/visitor-insights/report")
def get_visitor_insights_report(
    background_tasks: BackgroundTasks,
    request: Request,
    range: str = "7d",
    db: Session = Depends(get_db),
) -> dict:
    if range not in VALID_RANGES:
        raise ApiError("不支持的游客感受度报告时间范围", "VISITOR_INSIGHTS_RANGE_INVALID", 400)
    active_settings = getattr(request.app.state, "settings", settings)
    return build_visitor_insights_report(
        db,
        range,
        active_settings,
        background_tasks.add_task,
    )


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


@router.get("/web-facts")
def list_web_facts(db: Session = Depends(get_db)) -> dict:
    facts = db.scalars(
        select(ApprovedWebFact)
        .where(ApprovedWebFact.entity_type == "web_fact")
        .order_by(ApprovedWebFact.updated_at.desc(), ApprovedWebFact.id.desc())
    ).all()
    return {
        "items": [_web_fact_payload(db, fact) for fact in facts],
        "total": len(facts),
    }


@router.patch("/web-facts/{fact_id}")
def update_web_fact(
    fact_id: int,
    payload: OfficialWebFactUpdate,
    db: Session = Depends(get_db),
) -> dict:
    fact = _get_admin_web_fact(db, fact_id)

    if payload.spot_id is not None:
        spot_id = payload.spot_id.strip()
        if spot_id and db.get(ScenicSpot, spot_id) is None:
            raise ApiError("请选择有效景点后再保存", "WEB_FACT_SPOT_INVALID", 400)
        fact.entity_type = "spot" if spot_id else "web_fact"
        fact.entity_id = spot_id
    if payload.fact_key is not None:
        fact_key = payload.fact_key.strip()
        if not fact_key:
            raise ApiError("字段不能为空", "WEB_FACT_KEY_INVALID", 400)
        fact.fact_key = fact_key
        fact.fact_label = _fact_label(fact_key)
    if payload.fact_value is not None:
        fact_value = payload.fact_value.strip()
        if not fact_value:
            raise ApiError("事实内容不能为空", "WEB_FACT_VALUE_INVALID", 400)
        fact.fact_value = fact_value
    if payload.source_url is not None:
        fact.source_url = payload.source_url.strip()

    fact.updated_at = datetime.now(UTC)
    rebuild_knowledge_fts_index(db)
    clear_retrieval_cache()
    db.commit()
    db.refresh(fact)
    return _web_fact_payload(db, fact)


@router.delete("/web-facts/{fact_id}")
def delete_web_fact(fact_id: int, db: Session = Depends(get_db)) -> dict:
    fact = _get_admin_web_fact(db, fact_id)
    db.delete(fact)
    rebuild_knowledge_fts_index(db)
    clear_retrieval_cache()
    db.commit()
    return {"status": "deleted", "deleted_id": fact_id}


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
        raise ApiError(
            "补充只用于编辑候选内容，确认无误后请点击入库",
            "WEB_FACT_SUPPLEMENT_REQUIRES_EDIT",
            400,
        )
    if payload.action == "approve_official":
        _validate_candidate_for_official(candidate, db)
        official_fact = _existing_official_web_fact(db, candidate)
        if official_fact is None:
            db.add(
                ApprovedWebFact(
                    entity_type="web_fact",
                    entity_id="",
                    fact_key=candidate.fact_key,
                    fact_label=_fact_label(candidate.fact_key),
                    fact_value=candidate.fact_value,
                    fact_unit="",
                    confidence=0.9,
                    source_url=candidate.source_url,
                    source_level=candidate.source_level,
                )
            )
        else:
            official_fact.entity_type = "web_fact"
            official_fact.entity_id = ""
            official_fact.fact_label = _fact_label(candidate.fact_key)
            official_fact.fact_value = candidate.fact_value
            official_fact.confidence = 0.9
            official_fact.source_url = candidate.source_url
            official_fact.source_level = candidate.source_level
            official_fact.updated_at = datetime.now(UTC)
        candidate.status = "approved_official"
        rebuild_knowledge_fts_index(db)
        clear_retrieval_cache()
    elif payload.action == "reject":
        candidate.status = "rejected"
    elif payload.action == "ignore":
        candidate.status = "ignored"
    else:
        raise ApiError("不支持的审核动作", "WEB_FACT_REVIEW_ACTION_INVALID", 400)

    db.commit()
    db.refresh(candidate)
    return _web_fact_candidate_payload(candidate)


@router.patch("/web-fact-candidates/{candidate_id}")
def update_web_fact_candidate(
    candidate_id: int,
    payload: WebFactCandidateUpdate,
    db: Session = Depends(get_db),
) -> dict:
    candidate = db.get(WebFactCandidate, candidate_id)
    if candidate is None:
        raise ApiError("联网事实候选不存在", "WEB_FACT_CANDIDATE_NOT_FOUND", 404)

    for field_name in (
        "entity_type",
        "entity_id",
        "entity_name",
        "fact_key",
        "fact_value",
        "source_url",
        "source_level",
        "question",
        "answer_excerpt",
    ):
        value = getattr(payload, field_name)
        if value is not None:
            setattr(candidate, field_name, value.strip())
    candidate.status = "pending_review"
    db.commit()
    db.refresh(candidate)
    return _web_fact_candidate_payload(candidate)


def _validate_candidate_for_official(candidate: WebFactCandidate, db: Session) -> None:
    if not candidate.fact_key.strip() or not candidate.fact_value.strip():
        raise ApiError(
            "请先补充字段和值后再入库",
            "WEB_FACT_CANDIDATE_VALUE_INVALID",
            400,
        )
    if not candidate.source_url.strip():
        raise ApiError(
            "请先补充来源链接后再入库",
            "WEB_FACT_CANDIDATE_SOURCE_INVALID",
            400,
        )


def _get_admin_web_fact(db: Session, fact_id: int) -> ApprovedWebFact:
    fact = db.get(ApprovedWebFact, fact_id)
    if fact is None or fact.entity_type != "web_fact":
        raise ApiError("已入库联网事实不存在", "WEB_FACT_NOT_FOUND", 404)
    return fact


def _existing_official_web_fact(
    db: Session,
    candidate: WebFactCandidate,
) -> ApprovedWebFact | None:
    return db.scalar(
        select(ApprovedWebFact).where(
            ApprovedWebFact.entity_type == "web_fact",
            ApprovedWebFact.fact_key == candidate.fact_key,
            ApprovedWebFact.source_url == candidate.source_url,
        )
    )


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


def _web_fact_payload(db: Session, fact: ApprovedWebFact) -> dict:
    spot = db.get(ScenicSpot, fact.entity_id) if fact.entity_id else None
    return {
        "id": fact.id,
        "spot_id": fact.entity_id,
        "spot_name": spot.name if spot else "联网事实",
        "fact_key": fact.fact_key,
        "fact_label": fact.fact_label,
        "fact_value": fact.fact_value,
        "source_url": fact.source_url,
        "source_type": "approved_web",
        "updated_at": fact.updated_at.isoformat(),
    }


def _fact_label(fact_key: str) -> str:
    return FACT_LABELS.get(fact_key, fact_key)
