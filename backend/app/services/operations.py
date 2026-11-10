from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import UTC, date, datetime, time, timedelta
import json
import re
from threading import Lock
from typing import Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import ChatMessage
from app.services.mimo import MimoClient


VALID_RANGES = {"today", "week", "7d", "30d"}
ChatLogFingerprint = tuple[str, int, int, str]
VisitorInsightsCacheKey = tuple[str, ChatLogFingerprint]
BackgroundScheduler = Callable[..., None]

_VISITOR_INSIGHTS_CACHE: dict[VisitorInsightsCacheKey, dict] = {}
_VISITOR_INSIGHTS_RUNNING: set[VisitorInsightsCacheKey] = set()
_VISITOR_INSIGHTS_LOCK = Lock()

CONCERN_TOPIC_RULES = [
    (
        "投诉风险",
        (
            "投诉",
            "失望",
            "不好",
            "不清楚",
            "找不到",
            "不好找",
            "太远",
            "太累",
            "好累",
            "走不动",
            "累啊",
            "排队",
            "人太多",
            "太挤",
            "拥挤",
            "太贵",
            "贵了",
            "不方便",
            "迷路",
            "绕路",
        ),
    ),
    (
        "亲子老人",
        (
            "亲子",
            "小孩",
            "孩子",
            "儿童",
            "老人",
            "长辈",
            "带娃",
            "推车",
            "轮椅",
            "无障碍",
        ),
    ),
    (
        "摄影打卡",
        (
            "拍照",
            "拍摄",
            "摄影",
            "打卡",
            "出片",
            "机位",
            "照片",
            "适合拍",
        ),
    ),
    (
        "天气咨询",
        (
            "天气",
            "气温",
            "下雨",
            "晴天",
            "阴天",
            "热不热",
            "冷不冷",
            "温度",
            "晒吗",
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
        "路线规划",
        (
            "路线",
            "线路",
            "规划",
            "游览",
            "游玩",
            "怎么走",
            "怎么逛",
            "安排",
            "几小时",
            "两小时",
            "半日",
            "一日",
            "步行强度",
            "高强度",
            "中等强度",
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
            "表演",
            "怎么样",
            "灵山大佛",
            "大佛",
            "梵宫",
            "九龙灌浴",
            "五印坛城",
            "五灯湖",
            "佛足坛",
            "阿育王柱",
            "鹿鸣谷",
            "梵天花海",
            "焚天花海",
            "香月花街",
        ),
    ),
    (
        "闲聊互动",
        (
            "你好",
            "您好",
            "你是谁",
            "你叫什么",
            "你能干什么",
            "在吗",
            "谢谢",
            "感谢",
            "hello",
            "hi",
        ),
    ),
    ("其他咨询", ()),
]

CONCERN_TOPIC_PRIORITY = (
    "亲子老人",
    "摄影打卡",
    "天气咨询",
    "票务开放",
    "服务设施",
    "交通到达",
    "景点讲解",
    "路线规划",
    "闲聊互动",
)

ROUTE_PLANNING_STRONG_MARKERS = (
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

FEEDBACK_TENDENCIES = ("consultation", "risk", "praise", "uncertain")
CONSULTATION_TOPIC_FIELDS = (
    "ticket_opening",
    "route_planning",
    "location_traffic",
    "spot_explanation",
    "facilities",
)
CONSULTATION_TOPIC_RULES: list[tuple[str, tuple[str, ...]]] = [
    (
        "ticket_opening",
        ("门票", "票价", "价格", "多少钱", "开放", "营业", "预约", "入园", "闭园", "几点"),
    ),
    (
        "route_planning",
        ("路线", "规划", "游览", "怎么走", "怎么玩", "多久", "几小时", "两小时", "半日", "一日", "推荐路线"),
    ),
    (
        "facilities",
        ("卫生间", "厕所", "服务中心", "寄存", "餐厅", "吃饭", "母婴", "轮椅", "设施"),
    ),
    (
        "location_traffic",
        ("怎么去", "位置", "在哪", "哪里", "交通", "停车", "停车场", "公交", "地铁", "打车", "入口", "到达", "导航"),
    ),
    (
        "spot_explanation",
        ("讲解", "大佛", "梵宫", "九龙灌浴", "景点", "看点", "历史", "文化", "表演"),
    ),
]

CONSULTATION_KEYWORDS = (
    "门票",
    "票价",
    "价格",
    "多少钱",
    "怎么去",
    "怎么走",
    "路线",
    "规划",
    "推荐路线",
    "推荐一条",
    "游览",
    "多久",
    "几点",
    "开放",
    "营业",
    "预约",
    "位置",
    "在哪",
    "哪里",
    "停车",
    "入口",
    "卫生间",
    "厕所",
    "餐厅",
    "寄存",
    "讲解",
    "看点",
    "梵宫",
    "大佛",
    "九龙灌浴",
)
QUESTION_MARKERS = (
    "?",
    "？",
    "吗",
    "么",
    "呢",
    "请问",
    "多少",
    "几",
    "哪里",
    "在哪",
    "怎么",
    "如何",
    "有没有",
    "会不会",
    "是不是",
    "是否",
    "能不能",
    "可以",
    "需要",
    "推荐",
    "规划",
    "帮我",
)
CONSULTATION_PATTERNS = (
    "价格贵吗",
    "门票贵吗",
    "票价贵吗",
    "会不会贵",
    "要排队吗",
    "排队久吗",
    "人多吗",
    "拥挤吗",
    "好玩吗",
    "值得去吗",
    "推荐路线",
    "推荐一条路线",
    "帮我规划",
    "规划一下路线",
)
FEEDBACK_QUESTION_KEYWORDS = (
    "贵",
    "排队",
    "挤",
    "拥挤",
    "人多",
    "好找",
    "好玩",
    "值得",
    "方便",
    "清楚",
    "累",
    "远",
)
RISK_STRONG_PHRASES = (
    "太贵",
    "贵了",
    "很贵",
    "特别贵",
    "非常贵",
    "排队太久",
    "排队很久",
    "等太久",
    "人太多",
    "太挤",
    "很挤",
    "拥挤",
    "找不到",
    "不好找",
    "不太好找",
    "不清楚",
    "没听懂",
    "服务差",
    "态度差",
    "不方便",
    "不满意",
    "不喜欢",
    "不推荐",
    "不好玩",
    "没意思",
    "失望",
    "投诉",
    "坑",
    "绕路",
    "走错",
    "导航不准",
    "太远",
    "太累",
)
RISK_WEAK_WORDS = (
    "贵",
    "排队",
    "拥挤",
    "挤",
    "累",
    "远",
    "麻烦",
    "差",
    "慢",
    "乱",
    "吵",
    "堵",
    "退票",
)
PRAISE_PHRASES = (
    "谢谢",
    "感谢",
    "不错",
    "很好",
    "好玩",
    "喜欢",
    "满意",
    "很清楚",
    "讲得清楚",
    "讲解清楚",
    "方便",
    "漂亮",
    "震撼",
    "值得",
    "推荐这个",
    "值得推荐",
    "强烈推荐",
    "很推荐",
    "赞",
)
PRAISE_ASSERTION_PHRASES = (
    "谢谢",
    "感谢",
    "很满意",
    "非常满意",
    "挺满意",
    "很喜欢",
    "非常喜欢",
)
NEGATED_RISK_PHRASES = (
    "不贵",
    "不挤",
    "不用排队",
    "不需要排队",
    "不累",
    "不远",
    "好找",
    "很方便",
    "挺方便",
)
NEGATION_WORDS = ("不", "没", "没有", "别", "勿", "无", "未", "不是", "不太")
DEGREE_WORDS = ("太", "很", "特别", "非常", "超级", "极其", "实在", "严重", "一直", "老是")

CONSULTATION_KEYWORDS = (
    *CONSULTATION_KEYWORDS,
    "天气",
    "气温",
    "下雨",
    "热不热",
    "冷不冷",
    "注意什么",
    "适合",
    "能干什么",
    "有什么",
    "怎么样",
    "拍照",
    "打卡",
)
QUESTION_MARKERS = (
    *QUESTION_MARKERS,
    "什么",
    "怎么样",
    "如何",
    "适合",
    "能不能",
    "可不可以",
)
CONSULTATION_PATTERNS = (
    *CONSULTATION_PATTERNS,
    "带老人来需要注意什么",
    "带小孩去",
    "今天天气",
    "天气怎么样",
    "哪里适合拍照",
)


def build_operations_overview(db: Session, range_name: str = "week") -> dict:
    if range_name not in VALID_RANGES:
        range_name = "week"

    now = datetime.now(UTC)
    today = now.date()
    period_start = _period_start(today, range_name)
    period_end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=UTC)
    trend_days = _trend_days(today, range_name)
    messages = db.scalars(select(ChatMessage)).all()

    today_messages = [message for message in messages if message.created_at.date() == today]
    week_start = _period_start(today, "week")
    week_messages = [
        message
        for message in messages
        if week_start <= _as_utc(message.created_at) < period_end
    ]
    range_messages = [
        message
        for message in messages
        if period_start <= _as_utc(message.created_at) < period_end
    ]

    return {
        "range": range_name,
        "period": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
        "summary": {
            "today_service_sessions": _session_count(today_messages),
            "week_service_sessions": _session_count(week_messages),
            "today_questions": len(today_messages),
            "week_questions": len(week_messages),
            "range_service_sessions": _session_count(range_messages),
            "range_questions": len(range_messages),
            "avg_satisfaction_score": _avg_satisfaction(range_messages),
        },
        "sentiment_trend": _sentiment_trend(messages, trend_days),
        "consultation_topic_trend": _consultation_topic_trend(messages, trend_days),
        "satisfaction_trend": _satisfaction_trend(messages, trend_days),
    }


def build_visitor_insights_report(
    db: Session,
    range_name: str = "7d",
    settings: Settings | None = None,
    schedule_background: BackgroundScheduler | None = None,
) -> dict:
    if range_name not in VALID_RANGES:
        range_name = "7d"

    fingerprint = _chat_log_fingerprint(db)
    cache_key = (range_name, fingerprint)
    cached = _cached_visitor_insights(cache_key)
    if cached is not None:
        return cached

    now = datetime.now(UTC)
    today = now.date()
    period_start = _period_start(today, range_name)
    period_end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=UTC)
    messages = [
        message
        for message in db.scalars(select(ChatMessage)).all()
        if period_start <= _as_utc(message.created_at) < period_end
    ]

    concern_topics = _concern_topics(messages)
    service_suggestions = _service_suggestions(concern_topics)
    popular_question_clusters = _normalized_question_clusters(messages)
    rule_report = _rule_report(messages)
    report_payload = {
        "total_questions": len(messages),
        "concern_topics": concern_topics,
        "popular_question_clusters": popular_question_clusters,
        "service_suggestions": service_suggestions,
        "rule_report": rule_report,
    }
    report = rule_report
    should_schedule_llm = (
        bool(messages)
        and schedule_background is not None
        and _dashboard_llm_available(settings)
    )
    if should_schedule_llm:
        report = _pending_report(rule_report)

    payload = {
        "range": range_name,
        "period": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
        "total_questions": len(messages),
        "topic_categories": [topic for topic, _ in CONCERN_TOPIC_RULES],
        "concern_topics": concern_topics,
        "popular_question_clusters": popular_question_clusters,
        "service_suggestions": service_suggestions,
        "report": report,
    }
    _store_visitor_insights(cache_key, payload)
    if should_schedule_llm:
        _schedule_visitor_insights_llm_refresh(
            schedule_background,
            cache_key,
            settings,
            payload,
            _cluster_candidates(messages)[:12],
            popular_question_clusters,
            report_payload,
            rule_report,
        )
    return deepcopy(payload)


def _chat_log_fingerprint(db: Session) -> ChatLogFingerprint:
    bind = db.get_bind()
    database_identity = str(getattr(bind.url, "database", "") or bind.url)
    count_value, max_id, max_created_at = db.execute(
        select(
            func.count(ChatMessage.id),
            func.max(ChatMessage.id),
            func.max(ChatMessage.created_at),
        )
    ).one()
    created_at_value = (
        max_created_at.isoformat()
        if isinstance(max_created_at, datetime)
        else str(max_created_at or "")
    )
    return (database_identity, int(count_value or 0), int(max_id or 0), created_at_value)


def _cached_visitor_insights(cache_key: VisitorInsightsCacheKey) -> dict | None:
    with _VISITOR_INSIGHTS_LOCK:
        cached = _VISITOR_INSIGHTS_CACHE.get(cache_key)
        if cached is None:
            return None
        return deepcopy(cached)


def _store_visitor_insights(cache_key: VisitorInsightsCacheKey, payload: dict) -> None:
    _, fingerprint = cache_key
    with _VISITOR_INSIGHTS_LOCK:
        for key in list(_VISITOR_INSIGHTS_CACHE):
            if key[1] != fingerprint:
                _VISITOR_INSIGHTS_CACHE.pop(key, None)
                _VISITOR_INSIGHTS_RUNNING.discard(key)
        _VISITOR_INSIGHTS_CACHE[cache_key] = deepcopy(payload)


def _schedule_visitor_insights_llm_refresh(
    schedule_background: BackgroundScheduler,
    cache_key: VisitorInsightsCacheKey,
    settings: Settings | None,
    payload: dict,
    candidates: list[dict],
    fallback_clusters: list[dict],
    report_payload: dict,
    rule_report: dict,
) -> None:
    if settings is None:
        return
    with _VISITOR_INSIGHTS_LOCK:
        if cache_key in _VISITOR_INSIGHTS_RUNNING:
            return
        _VISITOR_INSIGHTS_RUNNING.add(cache_key)
    schedule_background(
        _refresh_visitor_insights_llm_cache,
        cache_key,
        settings,
        deepcopy(payload),
        deepcopy(candidates),
        deepcopy(fallback_clusters),
        deepcopy(report_payload),
        deepcopy(rule_report),
    )


def _refresh_visitor_insights_llm_cache(
    cache_key: VisitorInsightsCacheKey,
    settings: Settings,
    payload: dict,
    candidates: list[dict],
    fallback_clusters: list[dict],
    report_payload: dict,
    rule_report: dict,
) -> None:
    try:
        clusters = _llm_question_clusters(settings, candidates, fallback_clusters)
        llm_report_payload = {
            **report_payload,
            "popular_question_clusters": clusters,
        }
        refreshed_payload = {
            **payload,
            "popular_question_clusters": clusters,
            "report": _enhance_report_summary(settings, llm_report_payload, rule_report),
        }
    except Exception:
        refreshed_payload = {
            **payload,
            "report": {
                **rule_report,
                "llm_status": "failed",
                "llm_error": "llm_summary_failed",
            },
        }
    finally:
        with _VISITOR_INSIGHTS_LOCK:
            _VISITOR_INSIGHTS_RUNNING.discard(cache_key)
            if cache_key in _VISITOR_INSIGHTS_CACHE:
                _VISITOR_INSIGHTS_CACHE[cache_key] = deepcopy(refreshed_payload)


def _concern_topics(messages: list[ChatMessage]) -> list[dict]:
    if not messages:
        return []

    by_topic: dict[str, dict] = {}
    for message in messages:
        topic = _concern_topic(message)
        if topic not in by_topic:
            by_topic[topic] = {
                "topic": topic,
                "count": 0,
                "feedback_tendency": Counter(),
                "representative_questions": [],
            }
        item = by_topic[topic]
        item["count"] += 1
        item["feedback_tendency"][_feedback_tendency(message)] += 1
        if (
            message.question not in item["representative_questions"]
            and len(item["representative_questions"]) < 3
        ):
            item["representative_questions"].append(message.question)

    topic_order = {topic: index for index, (topic, _) in enumerate(CONCERN_TOPIC_RULES)}
    return [
        {
            "topic": item["topic"],
            "count": item["count"],
            "share": round(item["count"] / len(messages), 4),
            "feedback_tendency": _feedback_tendency_counts(item["feedback_tendency"]),
            "sentiment": _legacy_sentiment_counts(item["feedback_tendency"]),
            "representative_questions": item["representative_questions"],
        }
        for item in sorted(
            by_topic.values(),
            key=lambda value: (-value["count"], topic_order.get(value["topic"], 99)),
        )
    ]


def _concern_topic(message: ChatMessage) -> str:
    return classify_concern_topic(message.question)


def classify_concern_topic(question: str) -> str:
    text = _compact_feedback_text(question)
    if not text:
        return "其他咨询"

    rule_map = {topic: keywords for topic, keywords in CONCERN_TOPIC_RULES}
    if any(keyword in text for keyword in rule_map.get("投诉风险", ())):
        return "投诉风险"
    if _looks_like_route_planning_request(text):
        return "路线规划"
    for topic in CONCERN_TOPIC_PRIORITY:
        if any(keyword in text for keyword in rule_map.get(topic, ())):
            return topic
    return "其他咨询"


def _looks_like_route_planning_request(text: str) -> bool:
    return any(marker in text for marker in ROUTE_PLANNING_STRONG_MARKERS)


def _service_suggestions(concern_topics: list[dict]) -> list[dict]:
    suggestions: list[dict] = []
    for topic in concern_topics:
        if topic["count"] >= 2:
            suggestions.append(
                {
                    "type": "high_frequency_topic",
                    "topic": topic["topic"],
                    "message": _supplement_high_frequency_suggestion(topic["topic"])
                    or _high_frequency_suggestion(topic["topic"]),
                }
            )
        if topic["feedback_tendency"]["risk"] > 0:
            suggestions.append(
                {
                    "type": "negative_topic",
                    "topic": topic["topic"],
                    "message": _negative_topic_suggestion(topic["topic"]),
                }
            )
    return suggestions


def _dashboard_llm_available(settings: Settings | None) -> bool:
    if settings is None:
        return False
    enabled = str(settings.dashboard_insights_llm_enabled).strip().lower()
    if enabled in {"0", "false", "no", "off", "disabled"}:
        return False
    return settings.llm_mode == "openai_compatible" and bool(settings.llm_api_key)


def _pending_report(rule_report: dict) -> dict:
    return {
        **rule_report,
        "llm_status": "pending",
    }


def _llm_question_clusters(
    settings: Settings | None,
    candidates: list[dict],
    fallback_clusters: list[dict],
) -> list[dict]:
    if not fallback_clusters or not candidates:
        return []
    if not _dashboard_llm_available(settings):
        return fallback_clusters
    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        raw = client.chat_completion(
            model=settings.llm_model,
            system_prompt=_question_cluster_system_prompt(),
            user_prompt=_question_cluster_user_prompt(candidates),
        )
        return _validated_llm_question_clusters(raw, candidates) or fallback_clusters
    except Exception:
        return fallback_clusters


def _cluster_candidates(messages: list[ChatMessage]) -> list[dict]:
    by_question: dict[str, dict] = {}
    for message in messages:
        question = message.question
        if question not in by_question:
            by_question[question] = {
                "question": question,
                "count": 0,
                "intent_category": _concern_topic(message),
                "feedback_tendencies": Counter(),
            }
        item = by_question[question]
        item["count"] += 1
        item["feedback_tendencies"][_feedback_tendency(message)] += 1
    return [
        {
            "question": item["question"],
            "count": item["count"],
            "intent_category": item["intent_category"],
            "sentiment": _dominant_feedback_tendency(item["feedback_tendencies"]),
        }
        for item in sorted(by_question.values(), key=lambda value: (-value["count"], value["question"]))
    ]


def _question_cluster_system_prompt() -> str:
    return (
        "你是景区运营热门问答语义聚类助手。必须输出严格 JSON，格式为："
        "{\"clusters\":[{\"cluster_label\":\"...\",\"representative_question\":\"...\","
        "\"questions\":[\"...\"],\"intent_category\":\"...\"}]}。"
        "只能使用候选问题中的原文，不允许编造、改写或新增问题。"
    )


def _question_cluster_user_prompt(candidates: list[dict]) -> str:
    return (
        "请对以下候选热门问题做语义聚类，最多返回 8 个 clusters：\n"
        f"{json.dumps(candidates, ensure_ascii=False)}"
    )


def _validated_llm_question_clusters(raw: str, candidates: list[dict]) -> list[dict]:
    data = json.loads(raw)
    clusters = data.get("clusters")
    if not isinstance(clusters, list):
        return []
    candidate_by_question = {item["question"]: item for item in candidates}
    validated: list[dict] = []
    used_questions: set[str] = set()
    for cluster in clusters[:8]:
        questions = cluster.get("questions")
        representative_question = cluster.get("representative_question")
        cluster_label = str(cluster.get("cluster_label") or "").strip()
        intent_category = str(cluster.get("intent_category") or "").strip()
        if not cluster_label or not representative_question or not isinstance(questions, list):
            return []
        if representative_question not in candidate_by_question:
            return []
        if not questions or any(question not in candidate_by_question for question in questions):
            return []
        unique_questions = [question for question in questions if question not in used_questions]
        if not unique_questions:
            continue
        used_questions.update(unique_questions)
        feedback_tendencies = Counter()
        count = 0
        for question in unique_questions:
            candidate = candidate_by_question[question]
            count += int(candidate["count"])
            feedback_tendencies[candidate["sentiment"]] += int(candidate["count"])
        validated.append(
            {
                "cluster_label": cluster_label,
                "representative_question": representative_question,
                "questions": unique_questions,
                "count": count,
                "intent_category": intent_category or candidate_by_question[representative_question]["intent_category"],
                "sentiment": _dominant_feedback_tendency(feedback_tendencies),
            }
        )
    return sorted(validated, key=lambda item: (-item["count"], item["cluster_label"]))


def _normalized_question_clusters(messages: list[ChatMessage]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for message in messages:
        key = _normalize_question(message.question)
        if not key:
            continue
        if key not in grouped:
            grouped[key] = {
                "cluster_label": key,
                "representative_question": message.question,
                "questions": [],
                "count": 0,
                "intent_category": _concern_topic(message),
                "feedback_tendencies": Counter(),
            }
        item = grouped[key]
        item["questions"].append(message.question)
        item["count"] += 1
        item["feedback_tendencies"][_feedback_tendency(message)] += 1

    clusters = []
    for item in grouped.values():
        feedback_tendencies = item.pop("feedback_tendencies")
        clusters.append(
            {
                **item,
                "sentiment": _dominant_feedback_tendency(feedback_tendencies),
            }
        )
    return sorted(clusters, key=lambda item: (-item["count"], item["representative_question"]))[:8]


def _normalize_question(question: str) -> str:
    text = re.sub(r"[\s?？!！。.,，、；;：:（）()【】\[\]\"'“”‘’]+", "", question)
    return text.strip()


def _feedback_tendency_counts(counter: Counter[str]) -> dict:
    return {name: counter[name] for name in FEEDBACK_TENDENCIES}


def _legacy_sentiment_counts(counter: Counter[str]) -> dict:
    return {
        "positive": counter["praise"],
        "neutral": counter["consultation"] + counter["uncertain"],
        "negative": counter["risk"],
    }


def _dominant_feedback_tendency(feedback_tendencies: Counter[str]) -> str:
    for tendency in ("risk", "praise", "consultation", "uncertain"):
        if feedback_tendencies[tendency]:
            return tendency
    return "uncertain"


def _high_frequency_suggestion(topic: str) -> str:
    messages = {
        "路线规划": "路线规划咨询较集中，建议在游客端和现场导览中前置半日、一日、老人亲子等路线说明。",
        "景点讲解": "景点讲解咨询较集中，建议补充热门景点的讲解卡片、看点提示和现场导览话术。",
        "服务设施": "服务设施咨询较集中，建议强化卫生间、餐饮、寄存、服务中心等设施指引。",
        "票务开放": "票务开放咨询较集中，建议在入口和游客端同步展示票价、开放时间与预约说明。",
        "亲子老人": "亲子老人咨询较集中，建议突出无障碍、休息点、亲子服务和低强度路线。",
        "交通到达": "交通到达咨询较集中，建议优化停车、公共交通、入口到达和换乘提示。",
        "投诉风险": "投诉风险咨询较集中，建议优先复盘现场服务短板并建立快速响应机制。",
    }
    return messages.get(topic, "其他咨询较集中，建议补充游客端常见问答并复查现场导览信息。")


def _supplement_high_frequency_suggestion(topic: str) -> str | None:
    messages = {
        "天气咨询": "天气咨询较集中，建议在游客端补充当日天气、遮阳避雨、饮水和室内外路线提醒。",
        "摄影打卡": "摄影打卡咨询较集中，建议补充热门机位、最佳拍摄时段和适合出片的路线提示。",
        "闲聊互动": "闲聊互动较集中，建议优化数字人开场白、能力说明和引导式快捷问题。",
    }
    return messages.get(topic)


def _negative_topic_suggestion(topic: str) -> str:
    messages = {
        "投诉风险": "投诉风险出现风险反馈，建议管理方复查现场服务、排队动线和指引信息，优先闭环代表问题。",
        "路线规划": "路线规划出现风险反馈，建议检查路线推荐是否充分考虑体力、时长和绕行成本。",
        "服务设施": "服务设施出现风险反馈，建议复核设施位置、开放状态和现场标识是否清晰。",
        "交通到达": "交通到达出现风险反馈，建议检查停车、入口、换乘和到达指引是否容易理解。",
    }
    return messages.get(topic, f"{topic}出现风险反馈，建议管理方复查相关服务说明和现场执行。")


def _rule_report(messages: list[ChatMessage]) -> dict:
    if not messages:
        summary = "当前时间范围内暂无游客交互记录。"
    else:
        summary = f"当前时间范围内共分析 {len(messages)} 条游客问答记录，报告由本地规则生成。"
    return {
        "generated_by": "rule_based",
        "llm_status": "skipped_no_key",
        "summary": summary,
        "rule_summary": "规则报告基于问答文本关键词、疑问句、否定词和程度词识别关注点、反馈倾向和服务建议。",
    }


def _enhance_report_summary(
    settings: Settings | None,
    payload: dict,
    rule_report: dict,
) -> dict:
    if settings is None:
        return rule_report
    if not _dashboard_llm_available(settings):
        return rule_report

    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        summary = client.chat_completion(
            model=settings.llm_model,
            system_prompt=_report_summary_system_prompt(),
            user_prompt=_report_summary_user_prompt(payload),
        ).strip()
        if not summary:
            raise ValueError("empty_llm_summary")
        return {
            **rule_report,
            "generated_by": "llm_enhanced",
            "llm_status": "success",
            "summary": summary[:800],
        }
    except Exception:
        return {
            **rule_report,
            "llm_status": "failed",
            "llm_error": "llm_summary_failed",
        }


def _report_summary_system_prompt() -> str:
    return (
        "你是景区运营分析助手。请只基于给定的结构化运营数据生成中文管理摘要，"
        "不要编造数据，不要输出 API key、堆栈、供应商错误或内部实现细节。"
        "摘要应简洁，包含主要关注点、情绪风险和服务改进方向。"
    )


def _report_summary_user_prompt(payload: dict) -> str:
    return (
        "请将以下游客感受度规则分析数据改写为一段适合管理端展示的运营摘要：\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


def _period_start(today: date, range_name: str) -> datetime:
    if range_name == "today":
        start_date = today
    elif range_name == "week":
        start_date = today - timedelta(days=today.weekday())
    elif range_name == "30d":
        start_date = today - timedelta(days=29)
    else:
        start_date = today - timedelta(days=6)
    return datetime.combine(start_date, time.min, tzinfo=UTC)


def _trend_days(today: date, range_name: str) -> list[date]:
    start = _period_start(today, range_name).date()
    return [start + timedelta(days=offset) for offset in range((today - start).days + 1)]


def _session_count(messages: list[ChatMessage]) -> int:
    return len({message.session_id for message in messages})


def _avg_satisfaction(messages: list[ChatMessage]) -> float | None:
    scores = [score for message in messages if (score := _satisfaction_score(message)) is not None]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 2)


def _sentiment_trend(messages: list[ChatMessage], days: list[date]) -> list[dict]:
    by_day: dict[str, Counter[str]] = {day.isoformat(): Counter() for day in days}
    for message in messages:
        day_key = message.created_at.date().isoformat()
        if day_key in by_day:
            by_day[day_key][_feedback_tendency(message)] += 1
    trend = []
    for day in days:
        counts = by_day[day.isoformat()]
        trend.append(
            {
                "date": day.isoformat(),
                **_feedback_tendency_counts(counts),
                **_legacy_sentiment_counts(counts),
            }
        )
    return trend


def _consultation_topic_trend(messages: list[ChatMessage], days: list[date]) -> list[dict]:
    by_day: dict[str, Counter[str]] = {day.isoformat(): Counter() for day in days}
    for message in messages:
        day_key = message.created_at.date().isoformat()
        if day_key not in by_day or _feedback_tendency(message) != "consultation":
            continue
        by_day[day_key][_consultation_topic(message)] += 1

    return [
        {
            "date": day.isoformat(),
            **{field: by_day[day.isoformat()][field] for field in CONSULTATION_TOPIC_FIELDS},
        }
        for day in days
    ]


def _consultation_topic(message: ChatMessage) -> str:
    text = _compact_feedback_text(message.question)
    for field, keywords in CONSULTATION_TOPIC_RULES:
        if any(keyword in text for keyword in keywords):
            return field
    return "spot_explanation"


def _satisfaction_trend(messages: list[ChatMessage], days: list[date]) -> list[dict]:
    return [
        {
            "date": day.isoformat(),
            "avg_satisfaction_score": _avg_satisfaction(
                [message for message in messages if message.created_at.date() == day]
            ),
        }
        for day in days
    ]


def _feedback_tendency(message: ChatMessage) -> str:
    text = _compact_feedback_text(message.question)
    if not text:
        return "uncertain"

    is_question = _looks_like_question(text)
    risk_score = _risk_score(text, is_question)
    praise_score = _praise_score(text, is_question)
    consultation_score = _consultation_score(text, is_question)

    if risk_score >= 3 and risk_score >= praise_score + 1:
        return "risk"
    if praise_score >= 3 and praise_score >= risk_score + 1:
        return "praise"
    if risk_score >= 2 and not is_question:
        return "risk"
    if praise_score >= 2 and not is_question:
        return "praise"
    if consultation_score >= 2 and risk_score < 3 and praise_score < 3:
        return "consultation"
    return "uncertain"


def _compact_feedback_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def _looks_like_question(text: str) -> bool:
    return any(marker in text for marker in QUESTION_MARKERS)


def _consultation_score(text: str, is_question: bool) -> int:
    score = 0
    if any(pattern in text for pattern in CONSULTATION_PATTERNS):
        score += 3
    if any(keyword in text for keyword in CONSULTATION_KEYWORDS):
        score += 2
    if is_question:
        score += 1
        if any(keyword in text for keyword in FEEDBACK_QUESTION_KEYWORDS):
            score += 1
    return score


def _risk_score(text: str, is_question: bool) -> int:
    score = 0
    if any(phrase in text for phrase in RISK_STRONG_PHRASES):
        score += 3
    if _contains_negated_positive(text):
        score += 3
    if _has_intensified_word(text, RISK_WEAK_WORDS):
        score += 2
    if any(word in text for word in RISK_WEAK_WORDS):
        score += 1 if is_question else 2
    if _has_relief_signal(text):
        score -= 2
    if is_question and _is_experience_inquiry(text) and not _has_complaint_assertion(text):
        score = min(score, 1)
    return max(score, 0)


def _praise_score(text: str, is_question: bool) -> int:
    if _contains_negated_positive(text):
        return 0
    score = 0
    if any(phrase in text for phrase in PRAISE_ASSERTION_PHRASES):
        score += 3
    if _has_relief_signal(text):
        score += 2
    for phrase in PRAISE_PHRASES:
        if phrase in text:
            if is_question and phrase not in PRAISE_ASSERTION_PHRASES:
                continue
            score += 2
    if "谢谢" in text or "感谢" in text:
        score += 1
    return score


def _contains_negated_positive(text: str) -> bool:
    positive_roots = ("好玩", "喜欢", "满意", "推荐", "清楚", "方便", "值得", "不错")
    for root in positive_roots:
        start = text.find(root)
        while start != -1:
            prefix = text[max(0, start - 4):start]
            if any(prefix.endswith(marker) for marker in ("有没有", "会不会", "是不是", "能不能", "可不可以")):
                start = text.find(root, start + 1)
                continue
            if any(negation in prefix for negation in NEGATION_WORDS):
                return True
            start = text.find(root, start + 1)
    return False


def _is_experience_inquiry(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "贵吗",
            "贵不贵",
            "会不会贵",
            "会不会太贵",
            "是不是贵",
            "是不是太贵",
            "挤吗",
            "挤不挤",
            "会不会挤",
            "是不是很挤",
            "人多吗",
            "排队久吗",
            "会不会排队",
            "好找吗",
            "好不好找",
            "方便吗",
            "累吗",
            "远吗",
        )
    )


def _has_complaint_assertion(text: str) -> bool:
    return any(marker in text for marker in ("了", "投诉", "失望", "受不了", "差评", "怎么办", "找不到", "不满意"))


def _has_relief_signal(text: str) -> bool:
    for phrase in NEGATED_RISK_PHRASES:
        start = text.find(phrase)
        while start != -1:
            if phrase.startswith(("不", "不用", "不需要", "无需")):
                return True
            prefix = text[max(0, start - 4):start]
            if not any(negation in prefix for negation in NEGATION_WORDS):
                return True
            start = text.find(phrase, start + 1)
    return False


def _has_intensified_word(text: str, words: tuple[str, ...]) -> bool:
    for degree in DEGREE_WORDS:
        if any(f"{degree}{word}" in text for word in words):
            return True
    return False


def _satisfaction_score(message: ChatMessage) -> int | None:
    tendency = _feedback_tendency(message)
    if tendency == "praise":
        return 85
    if tendency == "risk":
        return 45
    return None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
