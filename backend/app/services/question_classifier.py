import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import EntityAlias, MapPoint, ScenicSpot
from app.services.map_point_types import ROUTEABLE_MAP_POINT_TYPES
from app.services.mimo import MimoClient


FACT_KEYWORDS = {
    "height_meters": ["多高", "高度", "几米", "多少米"],
    "opening_time": ["开放时间", "几点开", "几点关", "营业时间"],
    "ticket": ["票价", "门票", "多少钱"],
    "weather": ["天气", "气温", "下雨", "降雨", "晴天", "多云"],
    "visit_minutes": ["逛多久", "游览多久", "停留多久", "需要多久"],
    "suitability": ["适合", "能不能", "可不可以"],
}

ROUTE_WORDS = [
    "路线",
    "行程",
    "规划",
    "安排",
    "生成路线",
    "怎么逛",
    "怎么玩",
    "怎么游",
]
ROUTE_STRONG_WORDS = [
    "生成路线",
    "规划路线",
    "安排路线",
    "帮我规划",
    "帮我安排",
    "排路线",
    "一条路线",
    "走一条",
    "安排行程",
    "规划行程",
]
ROUTE_CONTEXT_WORDS = [
    "分钟",
    "小时",
    "可游览",
    "我有",
    "喜欢",
    "兴趣",
    "偏好",
    "体力",
    "强度",
    "佛教",
    "建筑",
    "自然",
    "摄影",
    "亲子",
    "老人",
    "轻松",
]
SERVICE_WORDS = [
    "厕所",
    "洗手间",
    "停车",
    "餐饮",
    "游客中心",
    "出口",
    "无障碍",
    "老人",
    "孩子",
    "小朋友",
    "休息",
    "累",
    "注意",
    "提醒",
]
HIGH_RISK_REALTIME_WORDS = ["今天", "现在", "变了吗", "开放时间", "营业时间", "表演时间", "票价", "门票", "安全", "天气", "人多", "客流", "排队"]
EXPLANATION_WORDS = ["有什么", "特色", "故事", "讲解", "介绍", "了解", "看点"]
VAGUE_SCENIC_RECOMMENDATION_WORDS = [
    "出片",
    "拍照",
    "摄影",
    "打卡",
    "朋友圈",
    "发朋友圈",
    "好看",
    "建筑感",
    "建筑",
    "自然风光",
    "自然休闲",
    "第一次来",
    "初次来",
]
EXTERNAL_FACT_WORDS = ["官方", "售价", "价格", "多少钱", "参数", "配置", "型号", "上市", "发布"]
ALLOWED_INTENTS = {
    "scenic_fact",
    "scenic_explanation",
    "route",
    "service",
    "casual",
    "mixed_emotional_fact",
    "high_risk_realtime",
    "external_factual",
    "unknown",
}


def classify_question(db: Session, question: str, settings: Settings | None = None) -> dict:
    entities = _matched_entities(db, question)
    fact_keys = _matched_fact_keys(question)
    intent = _intent(question, entities, fact_keys)
    classification = {
        "intent": intent,
        "confidence": _confidence(intent, entities, fact_keys),
        "entities": entities,
        "fact_keys": fact_keys or (["external"] if intent == "external_factual" else []),
        "tags": [],
        "emotional": _has_emotion(question),
        "needs_llm_classification": intent == "unknown",
        "classification_method": "rules",
    }
    if classification["needs_llm_classification"] and settings:
        llm_classification = _llm_classify(settings, question)
        if llm_classification:
            return _sanitize_llm_classification(question, llm_classification)
    return classification


def _matched_entities(db: Session, question: str) -> list[dict]:
    candidates: list[dict] = []
    routeable_spot_ids = select(MapPoint.spot_id).where(
        MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
    )
    spots = db.scalars(
        select(ScenicSpot)
        .where(ScenicSpot.id.in_(routeable_spot_ids))
        .order_by(ScenicSpot.name.desc())
    ).all()
    for spot in spots:
        if spot.name in question:
            candidates.append(
                {
                    "entity_type": "spot",
                    "entity_id": spot.id,
                    "name": spot.name,
                    "matched_text": spot.name,
                }
            )

    aliases = db.scalars(select(EntityAlias).order_by(EntityAlias.alias.desc())).all()
    for alias in aliases:
        if alias.alias in question:
            spot = db.get(ScenicSpot, alias.entity_id)
            candidates.append(
                {
                    "entity_type": alias.entity_type,
                    "entity_id": alias.entity_id,
                    "name": spot.name if spot else alias.entity_id,
                    "matched_text": alias.alias,
                }
            )

    matched: list[dict] = []
    matched_ids = set()
    for candidate in sorted(candidates, key=lambda item: len(item["matched_text"]), reverse=True):
        if candidate["entity_id"] in matched_ids:
            continue
        matched.append(candidate)
        matched_ids.add(candidate["entity_id"])
    return matched


def _matched_fact_keys(question: str) -> list[str]:
    fact_keys = [
        fact_key
        for fact_key, keywords in FACT_KEYWORDS.items()
        if any(keyword in question for keyword in keywords)
    ]
    if "height_meters" not in fact_keys and re.search(r"\d+\s*米", question):
        fact_keys.append("height_meters")
    return fact_keys


def _intent(question: str, entities: list[dict], fact_keys: list[str]) -> str:
    emotional = _has_emotion(question)
    high_risk = any(word in question for word in HIGH_RISK_REALTIME_WORDS)
    if _is_casual_question(question):
        return "casual"
    if high_risk:
        return "high_risk_realtime"
    if emotional and (entities or fact_keys):
        return "mixed_emotional_fact"
    if entities and any(phrase in question for phrase in ("适合做什么", "适合干什么", "适合怎么玩")):
        return "scenic_explanation"
    if entities and fact_keys:
        return "scenic_fact"
    if entities and any(word in question for word in EXPLANATION_WORDS):
        return "scenic_explanation"
    if _is_route_intent(question) and not _negates_route_request(question):
        return "route"
    if any(word in question for word in SERVICE_WORDS):
        return "service"
    if any(word in question for word in VAGUE_SCENIC_RECOMMENDATION_WORDS):
        return "scenic_explanation"
    if any(word in question for word in ["你好", "谢谢", "你是谁"]):
        return "casual"
    if not entities and any(word in question for word in EXTERNAL_FACT_WORDS):
        return "external_factual"
    return "unknown"


def _is_route_intent(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    if any(word in compact for word in ROUTE_STRONG_WORDS):
        return True
    if "路线" in compact and any(word in compact for word in ("推荐", "生成", "规划", "安排", "怎么", "帮我", "做", "排")):
        return True
    if "行程" in compact and any(word in compact for word in ("推荐", "生成", "规划", "安排", "怎么", "帮我")):
        return True
    if any(word in compact for word in ("怎么逛", "怎么玩", "怎么游")):
        return any(context_word in compact for context_word in ROUTE_CONTEXT_WORDS)
    return False


def _negates_route_request(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    return any(
        phrase in compact
        for phrase in (
            "不需要路线",
            "不要路线",
            "不用路线",
            "不想规划路线",
            "不想生成路线",
            "不想安排路线",
            "不想要路线",
            "不规划路线",
            "不用规划",
            "只是想了解",
            "只想了解",
        )
    )


def _is_casual_question(question: str) -> bool:
    compact = re.sub(r"\s+", "", question).lower()
    if not compact:
        return False
    exact = {
        "你好",
        "您好",
        "您好呀",
        "嗨",
        "哈喽",
        "hello",
        "在吗",
        "哈喽在吗",
        "谢谢",
        "谢谢你",
        "你是谁",
        "你是谁？",
        "你叫什么",
        "你叫什么名字",
        "你叫什么名字？",
        "你会干什么",
        "你会干什么？",
        "你能做什么",
        "你能做什么？",
        "介绍一下你自己",
    }
    if compact in exact:
        return True
    greeting_terms = ("你好", "您好", "嗨", "哈喽", "hello")
    if len(compact) <= 8 and any(term in compact for term in greeting_terms):
        return True
    self_intro_terms = ("你是谁", "叫什么", "名字", "会干什么", "能做什么", "像真人导游", "陪我逛", "在吗")
    if "你" in compact and any(term in compact for term in self_intro_terms):
        return True
    if "第一次来" in compact and ("不知道问什么" in compact or "问什么" in compact):
        return True
    return False


def _confidence(intent: str, entities: list[dict], fact_keys: list[str]) -> float:
    if intent == "scenic_fact" and entities and fact_keys:
        return 0.95
    if intent in {
        "route",
        "service",
        "mixed_emotional_fact",
        "high_risk_realtime",
        "scenic_explanation",
        "external_factual",
    }:
        return 0.85
    if intent == "casual":
        return 0.9
    return 0.3


def _has_emotion(question: str) -> bool:
    return any(word in question for word in ["紧张", "害怕", "开心", "第一次"])


def _llm_classify(settings: Settings, question: str) -> dict | None:
    if settings.llm_mode != "openai_compatible" or not settings.llm_api_key:
        return None

    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        raw = client.chat_completion(
            model=settings.llm_model,
            system_prompt=_classification_system_prompt(),
            user_prompt=f"请分类这个游客问题：{question}",
        )
        payload = json.loads(raw)
    except Exception:
        return None

    intent = str(payload.get("intent", "unknown"))
    if intent not in ALLOWED_INTENTS:
        intent = "unknown"
    entities = [item for item in payload.get("entities", []) if isinstance(item, dict)]
    fact_keys = [str(item) for item in payload.get("fact_keys", []) if isinstance(item, str)]

    return {
        "intent": intent,
        "confidence": _parse_confidence(payload.get("confidence", 0.75)),
        "entities": entities,
        "fact_keys": fact_keys or (["external"] if intent == "external_factual" else []),
        "tags": [str(item) for item in payload.get("tags", []) if isinstance(item, str)],
        "emotional": bool(payload.get("emotional", False)),
        "needs_llm_classification": False,
        "classification_method": "llm",
    }


def _parse_confidence(value) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, min(1.0, float(value)))
    text = str(value).strip().lower()
    mapped = {
        "high": 0.9,
        "medium": 0.7,
        "mid": 0.7,
        "low": 0.45,
    }
    if text in mapped:
        return mapped[text]
    try:
        return max(0.0, min(1.0, float(text)))
    except ValueError:
        return 0.75


def _sanitize_llm_classification(question: str, classification: dict) -> dict:
    if classification.get("intent") != "route":
        return classification
    if _is_route_intent(question) and not _negates_route_request(question):
        return classification
    sanitized = dict(classification)
    sanitized["intent"] = "service" if any(word in question for word in SERVICE_WORDS) else "unknown"
    sanitized["classification_method"] = "llm_sanitized"
    return sanitized


def _classification_system_prompt() -> str:
    return (
        "你是游知灵后端的问题分类器。"
        "只能输出 JSON，不要回答游客问题。"
        "JSON 字段包括 intent, entities, fact_keys, tags, emotional, confidence。"
        "intent 只能是 scenic_fact, scenic_explanation, route, service, casual, "
        "mixed_emotional_fact, high_risk_realtime, external_factual, unknown。"
    )
