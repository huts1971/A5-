import json
import re
from collections import OrderedDict
from dataclasses import dataclass
from time import perf_counter
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.models import ChatMessage, ChatSession, MapPoint, ScenicSpot, WebFactCandidate
from app.schemas import (
    ChatMetrics,
    ChatRequest,
    ChatResponse,
    GuideAction,
    GuideRoutePreference,
    KnowledgeSource,
    RouteRecommendRequest,
)
from app.services.mimo import MimoClient
from app.services.map_point_types import ROUTEABLE_MAP_POINT_TYPES
from app.services.digital_human_persona import (
    get_persona_for_chat,
    persona_prompt,
)
from app.services.question_classifier import classify_question
from app.services.rag import retrieve_context_with_metrics
from app.services.routes import recommend_routes
from app.services.tts import synthesize_answer_audio
from app.services.tts_jobs import TtsJobStore
from app.services.web_search import (
    WebSearchTimeout,
    get_web_search_provider,
    web_results_to_contexts,
)


FACT_EVIDENCE_TERMS = {
    "height_meters": ["高度", "米"],
    "opening_time": ["开放时间", "营业时间", "几点开", "几点关"],
    "ticket": ["门票", "票价", "票务", "多少钱"],
    "visit_minutes": ["游览", "停留", "多久"],
    "suitability": ["适合", "人群", "标签"],
}

WEB_FACT_KEY_RULES = (
    ("night_view", ("夜景", "夜间", "晚上", "今晚", "灯光", "灯光秀", "亮灯", "水雾")),
    ("performance", ("演出", "表演", "节目", "巡游", "开园仪式")),
    ("photo_spot", ("拍照", "摄影", "打卡", "出片", "取景", "朋友圈")),
    ("traffic", ("交通", "怎么去", "到达", "公交", "地铁", "打车", "停车", "入口", "导航")),
    ("ticket", ("门票", "票价", "票务", "购票", "买票", "收费", "多少钱", "价格")),
    ("service", ("厕所", "卫生间", "餐厅", "吃饭", "休息", "服务台", "设施", "寄存")),
    ("weather", ("天气", "气温", "下雨", "降雨", "晴天", "多云")),
    ("visit_minutes", ("游览", "停留", "多久", "几分钟", "几小时")),
    ("suitability", ("适合", "老人", "孩子", "亲子", "无障碍", "人群")),
    ("opening_time", ("开放", "营业", "闭园", "开园", "几点", "时间", "时段")),
)


SUPPORTED_GUIDE_THEMES = (
    "佛教文化",
    "建筑艺术",
    "演艺亲子",
    "摄影打卡",
    "自然休闲",
    "室内体验",
)
GUIDE_THEME_ALIASES = {
    "佛教": "佛教文化",
    "历史": "佛教文化",
    "文化": "佛教文化",
    "礼佛": "佛教文化",
    "建筑": "建筑艺术",
    "艺术": "建筑艺术",
    "空间": "建筑艺术",
    "亲子": "演艺亲子",
    "孩子": "演艺亲子",
    "老人": "自然休闲",
    "演艺": "演艺亲子",
    "表演": "演艺亲子",
    "摄影": "摄影打卡",
    "拍照": "摄影打卡",
    "出片": "摄影打卡",
    "打卡": "摄影打卡",
    "朋友圈": "摄影打卡",
    "发朋友圈": "摄影打卡",
    "好看": "摄影打卡",
    "自然": "自然休闲",
    "风光": "自然休闲",
    "休闲": "自然休闲",
    "轻松": "自然休闲",
    "花海": "自然休闲",
    "室内": "室内体验",
    "避雨": "室内体验",
}

MAP_NAME_LABELS = {
    "ling-shan": "灵山胜境",
    "nianhua-bay": "拈花湾",
}

ROUTE_STRONG_REQUEST_WORDS = (
    "生成路线",
    "规划路线",
    "安排路线",
    "帮我规划",
    "帮我安排",
    "给我规划",
    "给我安排",
    "排路线",
    "一条路线",
    "走一条",
    "路线怎么安排",
    "路线怎么走",
    "安排行程",
    "规划行程",
)

ROUTE_SOFT_ACTION_WORDS = (
    "怎么逛",
    "怎么玩",
    "怎么游",
    "怎么走",
    "推荐玩法",
    "推荐游览",
)

ROUTE_CONTEXT_WORDS = (
    "分钟",
    "小时",
    "可游览",
    "我有",
    "喜欢",
    "兴趣",
    "偏好",
    "佛教",
    "建筑",
    "自然",
    "风光",
    "摄影",
    "拍照",
    "出片",
    "亲子",
    "老人",
    "轻松",
    "体力",
    "强度",
)

ROUTE_FOLLOWUP_REQUEST_WORDS = (
    "换成",
    "改成",
    "调整成",
    "轻松一点",
    "少走一点",
    "少走路",
    "慢一点",
    "低强度",
    "高强度",
    "自然休闲",
    "自然风光",
    "摄影打卡",
    "建筑艺术",
    "佛教文化",
    "亲子",
)


@dataclass
class DirectGuideResult:
    answer: str
    sources: list[KnowledgeSource]
    mode: str
    degraded: bool = False
    guide_action: GuideAction | None = None
    emotion_cue: str = "warm"
    answer_style: str = "direct"
    guide_intent: str = ""
    route_triggered: bool = False


@dataclass(frozen=True)
class CachedGuideAnswer:
    answer: str
    sources: list[KnowledgeSource]
    mode: str
    degraded: bool
    classification: dict
    retrieval_mode: str
    vector_status: str
    evidence_profile: str
    answer_style: str
    llm_model: str
    embedding_model: str


_ANSWER_CACHE: OrderedDict[tuple, tuple[float, CachedGuideAnswer]] = OrderedDict()


def answer_chat(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    tts_jobs: TtsJobStore | None = None,
    visitor_id: str | None = None,
    core_runtime=None,
) -> ChatResponse:
    total_started = perf_counter()
    request = _with_route_context_spot_id(request)
    session_id = request.session_id or f"s_{uuid4().hex}"
    chat_session = db.get(ChatSession, session_id)
    if chat_session is None:
        chat_session = ChatSession(
            id=session_id,
            visitor_type=str(request.profile.get("visitor_type", "")),
            preference=str(request.profile.get("preference", "")),
        )
        db.add(chat_session)
    else:
        _update_session_profile(chat_session, request.profile)

    classification = classify_question(db, request.question, settings)
    route_focus_instruction = _route_context_focus_instruction(
        request.question,
        _route_context_from_request(request),
    )
    persona = get_persona_for_chat(db, visitor_id)
    if request.image is not None:
        return _answer_image_chat(
            db,
            settings,
            request,
            session_id,
            classification,
            total_started,
            tts_jobs,
            persona=persona,
        )
    if core_runtime is not None and core_runtime.handles(request, classification, chat_session):
        return core_runtime.answer(db, request, chat_session, classification, visitor_id, tts_jobs, persona=persona)
    direct_result = _maybe_direct_guide_result(
        db,
        settings,
        request,
        chat_session,
        classification,
        persona,
    )
    if direct_result is not None:
        tts_started = perf_counter()
        audio_url, tts_status, tts_job_id = _start_tts(settings, direct_result.answer, tts_jobs)
        tts_ms = _elapsed_ms(tts_started)
        metrics = ChatMetrics(
            retrieval_ms=0,
            llm_ms=0,
            tts_ms=tts_ms,
            total_ms=_elapsed_ms(total_started),
            cache_hit=False,
            degraded=direct_result.degraded,
            classification=classification,
            web_supplement_required=False,
            web_supplement_status="not_required",
            retrieval_mode="guide_direct",
            context_count=0,
            vector_status="not_required",
            guide_intent=direct_result.guide_intent or str(classification.get("intent", "")),
            evidence_profile="direct",
            route_triggered=direct_result.route_triggered or direct_result.guide_action is not None,
            answer_style=direct_result.answer_style,
            llm_model=settings.llm_model,
            embedding_model=settings.rag_embedding_model,
        )
        db.add(
            ChatMessage(
                session_id=session_id,
                question=request.question,
                answer=direct_result.answer,
                sources_json=[source.model_dump() for source in direct_result.sources],
                metrics_json=metrics.model_dump(),
            )
        )
        db.commit()
        return ChatResponse(
            answer=direct_result.answer,
            sources=direct_result.sources,
            session_id=session_id,
            audio_url=audio_url,
            tts_job_id=tts_job_id,
            tts_status=tts_status,
            mode=direct_result.mode,
            degraded=direct_result.degraded,
            metrics=metrics,
            guide_action=direct_result.guide_action,
            emotion_cue=direct_result.emotion_cue,
        )

    answer_cache_key = _answer_cache_key(
        request.question,
        request.spot_id,
        classification,
        settings,
        persona,
    )
    cached_answer = _get_answer_cache(answer_cache_key, settings)
    if cached_answer is not None:
        answer = _with_route_context_intro(cached_answer.answer, request.question, _route_context_from_request(request))
        tts_started = perf_counter()
        audio_url, tts_status, tts_job_id = _start_tts(settings, answer, tts_jobs)
        tts_ms = _elapsed_ms(tts_started)
        metrics = ChatMetrics(
            retrieval_ms=0,
            llm_ms=0,
            tts_ms=tts_ms,
            total_ms=_elapsed_ms(total_started),
            cache_hit=True,
            degraded=cached_answer.degraded,
            classification=cached_answer.classification,
            web_supplement_required=False,
            web_supplement_status="not_required",
            retrieval_mode=cached_answer.retrieval_mode,
            context_count=len(cached_answer.sources),
            vector_status=cached_answer.vector_status,
            guide_intent=str(cached_answer.classification.get("intent", "")),
            evidence_profile=cached_answer.evidence_profile,
            route_triggered=bool(_route_context_focus_instruction(
                request.question,
                _route_context_from_request(request),
            )),
            answer_style=cached_answer.answer_style,
            llm_model=cached_answer.llm_model,
            embedding_model=cached_answer.embedding_model,
            answer_cache_hit=True,
        )
        db.add(
            ChatMessage(
                session_id=session_id,
                question=request.question,
                answer=answer,
                sources_json=[source.model_dump() for source in cached_answer.sources],
                metrics_json=metrics.model_dump(),
            )
        )
        db.commit()
        return ChatResponse(
            answer=answer,
            sources=cached_answer.sources,
            session_id=session_id,
            audio_url=audio_url,
            tts_job_id=tts_job_id,
            tts_status=tts_status,
            mode=cached_answer.mode,
            degraded=cached_answer.degraded,
            metrics=metrics,
            emotion_cue=_emotion_cue_for_classification(cached_answer.classification, cached_answer.sources),
        )

    retrieval_started = perf_counter()
    contexts, retrieval_detail = retrieve_context_with_metrics(
        db,
        request.question,
        request.spot_id,
        classification=classification,
        settings=settings,
    )
    retrieval_ms = _elapsed_ms(retrieval_started)
    web_supplement_required = _needs_web_supplement(classification, contexts, request.question)
    web_contexts, web_supplement_status = _web_supplement_contexts(
        settings,
        request.question,
        classification,
        web_supplement_required,
    )
    contexts = web_contexts + contexts
    sources = _visible_sources(
        contexts,
        classification,
        web_supplement_required,
        web_supplement_status,
    )
    llm_started = perf_counter()
    base_answer, mode, degraded = _answer_text(
        settings,
        request.question,
        contexts,
        classification,
        web_supplement_required,
        web_supplement_status,
        route_focus_instruction,
        persona,
    )
    answer = _with_route_context_intro(base_answer, request.question, _route_context_from_request(request))
    llm_ms = _elapsed_ms(llm_started)
    tts_started = perf_counter()
    audio_url, tts_status, tts_job_id = _start_tts(settings, answer, tts_jobs)
    tts_ms = _elapsed_ms(tts_started)
    _store_web_fact_candidates(db, request.question, answer, classification, contexts)
    metrics = ChatMetrics(
        retrieval_ms=retrieval_ms,
        llm_ms=llm_ms,
        tts_ms=tts_ms,
        total_ms=_elapsed_ms(total_started),
        cache_hit=retrieval_detail.retrieval_cache_hit,
        degraded=degraded,
        classification=classification,
        web_supplement_required=web_supplement_required,
        web_supplement_status=web_supplement_status,
        retrieval_mode=retrieval_detail.retrieval_mode,
        context_count=retrieval_detail.context_count,
        fts_ms=retrieval_detail.fts_ms,
        embedding_ms=retrieval_detail.embedding_ms,
        rerank_ms=retrieval_detail.rerank_ms,
        vector_status=retrieval_detail.vector_status,
        retrieval_cache_hit=retrieval_detail.retrieval_cache_hit,
        embedding_cache_hit=retrieval_detail.embedding_cache_hit,
        guide_intent=str(classification.get("intent", "")),
        evidence_profile=_evidence_profile(classification, contexts),
        route_triggered=bool(route_focus_instruction),
        answer_style=_answer_style_for_classification(classification),
        llm_model=settings.llm_model,
        embedding_model=settings.rag_embedding_model,
        warmup_status="retrieval_cache_hit" if retrieval_detail.retrieval_cache_hit else "",
    )

    if _cacheable_answer(classification, web_supplement_required, web_supplement_status):
        _set_answer_cache(
            answer_cache_key,
            CachedGuideAnswer(
                answer=base_answer,
                sources=sources,
                mode=mode,
                degraded=degraded,
                classification=classification,
                retrieval_mode=retrieval_detail.retrieval_mode,
                vector_status=retrieval_detail.vector_status,
                evidence_profile=_evidence_profile(classification, contexts),
                answer_style=_answer_style_for_classification(classification),
                llm_model=settings.llm_model,
                embedding_model=settings.rag_embedding_model,
            ),
            settings,
        )

    db.add(
        ChatMessage(
            session_id=session_id,
            question=request.question,
            answer=answer,
            sources_json=[source.model_dump() for source in sources],
            metrics_json=metrics.model_dump(),
        )
    )
    db.commit()

    return ChatResponse(
        answer=answer,
        sources=sources,
        session_id=session_id,
        audio_url=audio_url,
        tts_job_id=tts_job_id,
        tts_status=tts_status,
        mode=mode,
        degraded=degraded,
        metrics=metrics,
        emotion_cue=_emotion_cue_for_classification(classification, sources),
    )


def stream_chat_events(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    tts_jobs: TtsJobStore | None = None,
    visitor_id: str | None = None,
    core_runtime=None,
):
    total_started = perf_counter()
    request = _with_route_context_spot_id(request)
    session_id = request.session_id or f"s_{uuid4().hex}"
    chat_session = db.get(ChatSession, session_id)
    if chat_session is None:
        chat_session = ChatSession(
            id=session_id,
            visitor_type=str(request.profile.get("visitor_type", "")),
            preference=str(request.profile.get("preference", "")),
        )
        db.add(chat_session)
    else:
        _update_session_profile(chat_session, request.profile)

    classification = classify_question(db, request.question, settings)
    route_focus_instruction = _route_context_focus_instruction(
        request.question,
        _route_context_from_request(request),
    )
    persona = get_persona_for_chat(db, visitor_id)
    if request.image is not None:
        yield _sse("status", {"phase": "vision"})
        response = _answer_image_chat(
            db,
            settings,
            request,
            session_id,
            classification,
            total_started,
            tts_jobs,
            first_delta_ms=_elapsed_ms(total_started),
            persona=persona,
        )
        for chunk in _chunk_text(response.answer):
            yield _sse("delta", {"text": chunk})
        yield _sse("final", response.model_dump())
        return
    if core_runtime is not None and core_runtime.handles(request, classification, chat_session):
        yield _sse("status", {"phase": "retrieving"})
        response = core_runtime.answer(db, request, chat_session, classification, visitor_id, tts_jobs, persona=persona)
        response.metrics.first_delta_ms = _elapsed_ms(total_started)
        for chunk in _chunk_text(response.answer):
            yield _sse("delta", {"text": chunk})
        yield _sse("final", response.model_dump())
        return
    direct_result = _maybe_direct_guide_result(
        db,
        settings,
        request,
        chat_session,
        classification,
        persona,
    )
    if direct_result is not None:
        llm_started = perf_counter()
        first_delta_ms = 0.0
        for chunk in _chunk_text(direct_result.answer):
            if first_delta_ms == 0:
                first_delta_ms = _elapsed_ms(total_started)
            yield _sse("delta", {"text": chunk})
        llm_ms = _elapsed_ms(llm_started)
        tts_started = perf_counter()
        audio_url, tts_status, tts_job_id = _start_tts(settings, direct_result.answer, tts_jobs)
        tts_ms = _elapsed_ms(tts_started)
        metrics = ChatMetrics(
            retrieval_ms=0,
            llm_ms=llm_ms,
            tts_ms=tts_ms,
            total_ms=_elapsed_ms(total_started),
            cache_hit=False,
            degraded=direct_result.degraded,
            classification=classification,
            web_supplement_required=False,
            web_supplement_status="not_required",
            retrieval_mode="guide_direct",
            context_count=0,
            vector_status="not_required",
            guide_intent=direct_result.guide_intent or str(classification.get("intent", "")),
            evidence_profile="direct",
            route_triggered=direct_result.route_triggered or direct_result.guide_action is not None,
            answer_style=direct_result.answer_style,
            llm_model=settings.llm_model,
            embedding_model=settings.rag_embedding_model,
            first_delta_ms=first_delta_ms,
        )
        db.add(
            ChatMessage(
                session_id=session_id,
                question=request.question,
                answer=direct_result.answer,
                sources_json=[source.model_dump() for source in direct_result.sources],
                metrics_json=metrics.model_dump(),
            )
        )
        db.commit()
        response = ChatResponse(
            answer=direct_result.answer,
            sources=direct_result.sources,
            session_id=session_id,
            audio_url=audio_url,
            tts_job_id=tts_job_id,
            tts_status=tts_status,
            mode=direct_result.mode,
            degraded=direct_result.degraded,
            metrics=metrics,
            guide_action=direct_result.guide_action,
            emotion_cue=direct_result.emotion_cue,
        )
        yield _sse("final", response.model_dump())
        return

    answer_cache_key = _answer_cache_key(
        request.question,
        request.spot_id,
        classification,
        settings,
        persona,
    )
    cached_answer = _get_answer_cache(answer_cache_key, settings)
    if cached_answer is not None:
        answer = _with_route_context_intro(cached_answer.answer, request.question, _route_context_from_request(request))
        yield _sse("status", {"phase": "cached"})
        llm_started = perf_counter()
        first_delta_ms = 0.0
        for chunk in _chunk_text(answer):
            if first_delta_ms == 0:
                first_delta_ms = _elapsed_ms(total_started)
            yield _sse("delta", {"text": chunk})
        llm_ms = _elapsed_ms(llm_started)
        tts_started = perf_counter()
        audio_url, tts_status, tts_job_id = _start_tts(settings, answer, tts_jobs)
        tts_ms = _elapsed_ms(tts_started)
        metrics = ChatMetrics(
            retrieval_ms=0,
            llm_ms=llm_ms,
            tts_ms=tts_ms,
            total_ms=_elapsed_ms(total_started),
            cache_hit=True,
            degraded=cached_answer.degraded,
            classification=cached_answer.classification,
            web_supplement_required=False,
            web_supplement_status="not_required",
            retrieval_mode=cached_answer.retrieval_mode,
            context_count=len(cached_answer.sources),
            vector_status=cached_answer.vector_status,
            guide_intent=str(cached_answer.classification.get("intent", "")),
            evidence_profile=cached_answer.evidence_profile,
            route_triggered=bool(_route_context_focus_instruction(
                request.question,
                _route_context_from_request(request),
            )),
            answer_style=cached_answer.answer_style,
            llm_model=cached_answer.llm_model,
            embedding_model=cached_answer.embedding_model,
            first_delta_ms=first_delta_ms,
            answer_cache_hit=True,
            warmup_status="answer_cache_hit",
        )
        db.add(
            ChatMessage(
                session_id=session_id,
                question=request.question,
                answer=answer,
                sources_json=[source.model_dump() for source in cached_answer.sources],
                metrics_json=metrics.model_dump(),
            )
        )
        db.commit()
        response = ChatResponse(
            answer=answer,
            sources=cached_answer.sources,
            session_id=session_id,
            audio_url=audio_url,
            tts_job_id=tts_job_id,
            tts_status=tts_status,
            mode=cached_answer.mode,
            degraded=cached_answer.degraded,
            metrics=metrics,
            emotion_cue=_emotion_cue_for_classification(cached_answer.classification, cached_answer.sources),
        )
        yield _sse("final", response.model_dump())
        return

    yield _sse("status", {"phase": "retrieving"})
    retrieval_started = perf_counter()
    contexts, retrieval_detail = retrieve_context_with_metrics(
        db,
        request.question,
        request.spot_id,
        classification=classification,
        settings=settings,
    )
    retrieval_ms = _elapsed_ms(retrieval_started)
    web_supplement_required = _needs_web_supplement(classification, contexts, request.question)
    web_contexts, web_supplement_status = _web_supplement_contexts(
        settings,
        request.question,
        classification,
        web_supplement_required,
    )
    contexts = web_contexts + contexts
    sources = _visible_sources(
        contexts,
        classification,
        web_supplement_required,
        web_supplement_status,
    )

    llm_started = perf_counter()
    answer_parts: list[str] = []
    stream_state = {
        "mode": _mode_for_stream(settings),
        "degraded": settings.llm_mode == "openai_compatible" and not settings.llm_api_key,
    }
    first_delta_ms = 0.0
    yield _sse("status", {"phase": "thinking"})
    for chunk in _answer_text_chunks(
        settings,
        request.question,
        contexts,
        classification,
        web_supplement_required,
        web_supplement_status,
        stream_state,
        route_focus_instruction,
        persona,
    ):
        answer_parts.append(chunk)
        if first_delta_ms == 0:
            first_delta_ms = _elapsed_ms(total_started)
        yield _sse("delta", {"text": chunk})
    base_answer = _stabilize_vague_recommendation_answer(
        _stabilize_entity_name(
            _clean_visitor_answer("".join(answer_parts)),
            classification,
        ),
        request.question,
    )
    answer = _with_route_context_intro(base_answer, request.question, _route_context_from_request(request))
    llm_ms = _elapsed_ms(llm_started)

    mode = stream_state["mode"]
    degraded = stream_state["degraded"]
    tts_started = perf_counter()
    audio_url, tts_status, tts_job_id = _start_tts(settings, answer, tts_jobs)
    tts_ms = _elapsed_ms(tts_started)
    _store_web_fact_candidates(db, request.question, answer, classification, contexts)
    metrics = ChatMetrics(
        retrieval_ms=retrieval_ms,
        llm_ms=llm_ms,
        tts_ms=tts_ms,
        total_ms=_elapsed_ms(total_started),
        cache_hit=retrieval_detail.retrieval_cache_hit,
        degraded=degraded,
        classification=classification,
        web_supplement_required=web_supplement_required,
        web_supplement_status=web_supplement_status,
        retrieval_mode=retrieval_detail.retrieval_mode,
        context_count=retrieval_detail.context_count,
        fts_ms=retrieval_detail.fts_ms,
        embedding_ms=retrieval_detail.embedding_ms,
        rerank_ms=retrieval_detail.rerank_ms,
        vector_status=retrieval_detail.vector_status,
        retrieval_cache_hit=retrieval_detail.retrieval_cache_hit,
        embedding_cache_hit=retrieval_detail.embedding_cache_hit,
        guide_intent=str(classification.get("intent", "")),
        evidence_profile=_evidence_profile(classification, contexts),
        route_triggered=bool(route_focus_instruction),
        answer_style=_answer_style_for_classification(classification),
        llm_model=settings.llm_model,
        embedding_model=settings.rag_embedding_model,
        first_delta_ms=first_delta_ms,
        warmup_status="retrieval_cache_hit" if retrieval_detail.retrieval_cache_hit else "",
    )

    if _cacheable_answer(classification, web_supplement_required, web_supplement_status):
        _set_answer_cache(
            answer_cache_key,
            CachedGuideAnswer(
                answer=base_answer,
                sources=sources,
                mode=mode,
                degraded=degraded,
                classification=classification,
                retrieval_mode=retrieval_detail.retrieval_mode,
                vector_status=retrieval_detail.vector_status,
                evidence_profile=_evidence_profile(classification, contexts),
                answer_style=_answer_style_for_classification(classification),
                llm_model=settings.llm_model,
                embedding_model=settings.rag_embedding_model,
            ),
            settings,
        )

    db.add(
        ChatMessage(
            session_id=session_id,
            question=request.question,
            answer=answer,
            sources_json=[source.model_dump() for source in sources],
            metrics_json=metrics.model_dump(),
        )
    )
    db.commit()

    response = ChatResponse(
        answer=answer,
        sources=sources,
        session_id=session_id,
        audio_url=audio_url,
        tts_job_id=tts_job_id,
        tts_status=tts_status,
        mode=mode,
        degraded=degraded,
        metrics=metrics,
        emotion_cue=_emotion_cue_for_classification(classification, sources),
    )
    yield _sse("final", response.model_dump())


def _elapsed_ms(started_at: float) -> float:
    return round((perf_counter() - started_at) * 1000, 2)


def _update_session_profile(chat_session: ChatSession, profile: dict) -> None:
    visitor_type = str(profile.get("visitor_type", "")).strip()
    preference = str(profile.get("preference", "")).strip()
    route_preference = profile.get("route_preference")
    if visitor_type:
        chat_session.visitor_type = visitor_type
    if isinstance(route_preference, dict):
        chat_session.preference = json.dumps(route_preference, ensure_ascii=False)
        return
    if preference:
        chat_session.preference = preference


def _answer_cache_key(
    question: str,
    spot_id: str | None,
    classification: dict,
    settings: Settings,
    persona: dict | None = None,
) -> tuple:
    entities = tuple(
        sorted(
            str(entity.get("entity_id", ""))
            for entity in (classification or {}).get("entities", [])
            if isinstance(entity, dict)
        )
    )
    return (
        "guide-answer-v3",
        re.sub(r"\s+", " ", question.strip().lower())[:240],
        spot_id or "",
        classification.get("intent", ""),
        entities,
        settings.llm_model,
        settings.guide_style,
        str((persona or {}).get("cache_token") or ""),
        settings.rag_embedding_model,
        settings.database_url,
        settings.source_package_path,
        settings.derived_knowledge_path,
    )


def _get_answer_cache(
    cache_key: tuple,
    settings: Settings,
) -> CachedGuideAnswer | None:
    if settings.guide_answer_cache_ttl_seconds <= 0:
        return None
    cached = _ANSWER_CACHE.get(cache_key)
    if cached is None:
        return None
    cached_at, answer = cached
    if perf_counter() - cached_at > settings.guide_answer_cache_ttl_seconds:
        _ANSWER_CACHE.pop(cache_key, None)
        return None
    _ANSWER_CACHE.move_to_end(cache_key)
    return answer


def _set_answer_cache(
    cache_key: tuple,
    answer: CachedGuideAnswer,
    settings: Settings,
) -> None:
    if settings.guide_answer_cache_ttl_seconds <= 0:
        return
    _ANSWER_CACHE[cache_key] = (perf_counter(), answer)
    _ANSWER_CACHE.move_to_end(cache_key)
    while len(_ANSWER_CACHE) > max(1, settings.guide_answer_cache_size):
        _ANSWER_CACHE.popitem(last=False)


def _cacheable_answer(
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
) -> bool:
    intent = classification.get("intent", "")
    if intent in {"route", "casual", "high_risk_realtime", "external_factual"}:
        return False
    if web_supplement_required or web_supplement_status not in {"not_required", ""}:
        return False
    if classification.get("fact_keys") and any(
        key in {"opening_time", "ticket", "weather"} for key in classification.get("fact_keys", [])
    ):
        return False
    return intent in {"scenic_explanation", "scenic_fact", "mixed_emotional_fact", "service", "unknown"}


def warm_answer_cache(
    db: Session,
    settings: Settings,
    question: str,
    spot_id: str | None = None,
) -> bool:
    classification = classify_question(db, question, settings)
    cache_key = _answer_cache_key(question, spot_id, classification, settings)
    if _get_answer_cache(cache_key, settings) is not None:
        return True
    if _maybe_direct_guide_result(
        db,
        settings,
        ChatRequest(question=question, spot_id=spot_id),
        ChatSession(id="warmup"),
        classification,
    ) is not None:
        return False
    contexts, retrieval_detail = retrieve_context_with_metrics(
        db,
        question,
        spot_id,
        classification=classification,
        settings=settings,
    )
    web_supplement_required = _needs_web_supplement(classification, contexts, question)
    if not _cacheable_answer(classification, web_supplement_required, "not_required"):
        return False
    answer, mode, degraded = _answer_text(
        settings,
        question,
        contexts,
        classification,
        False,
        "not_required",
    )
    sources = _visible_sources(contexts, classification, False, "not_required")
    _set_answer_cache(
        cache_key,
        CachedGuideAnswer(
            answer=answer,
            sources=sources,
            mode=mode,
            degraded=degraded,
            classification=classification,
            retrieval_mode=retrieval_detail.retrieval_mode,
            vector_status=retrieval_detail.vector_status,
            evidence_profile=_evidence_profile(classification, contexts),
            answer_style=_answer_style_for_classification(classification),
            llm_model=settings.llm_model,
            embedding_model=settings.rag_embedding_model,
        ),
        settings,
    )
    return True


def _with_route_context_spot_id(request: ChatRequest) -> ChatRequest:
    context = _route_context_from_request(request)
    if context.get("status") == "expired":
        return request
    next_spot = context.get("next_spot")
    if _route_context_next_scenic_detail_question(request.question):
        if isinstance(next_spot, dict) and next_spot.get("spot_id"):
            return request.model_copy(update={"spot_id": next_spot["spot_id"]})
        return request
    current_spot = context.get("current_spot")
    if _route_context_question_mentions_current(request.question):
        if isinstance(current_spot, dict) and current_spot.get("spot_id"):
            return request.model_copy(update={"spot_id": current_spot["spot_id"]})
    if request.spot_id:
        return request
    return request


def _route_context_from_request(request: ChatRequest) -> dict:
    profile = request.profile if isinstance(request.profile, dict) else {}
    raw = profile.get("route_context") or profile.get("routeContext")
    if not isinstance(raw, dict):
        return {}
    ordered_spots = [
        spot
        for spot in (_route_context_spot(item) for item in raw.get("ordered_spots") or raw.get("orderedSpots") or [])
        if spot
    ]
    current_index = _safe_int(raw.get("current_index") or raw.get("currentIndex"), 0)
    if ordered_spots:
        current_index = min(max(current_index, 0), len(ordered_spots) - 1)
    current_spot = _route_context_spot(raw.get("current_spot") or raw.get("currentSpot"))
    if not current_spot and ordered_spots:
        current_spot = ordered_spots[current_index]
    next_spot = _route_context_spot(raw.get("next_spot") or raw.get("nextSpot"))
    if not next_spot and ordered_spots and current_index + 1 < len(ordered_spots):
        next_spot = ordered_spots[current_index + 1]
    map_id = str(raw.get("map_id") or raw.get("mapId") or "")
    if map_id not in MAP_NAME_LABELS:
        map_id = "ling-shan"
    return {
        "map_id": map_id,
        "scenic_name": str(raw.get("scenic_name") or raw.get("scenicName") or MAP_NAME_LABELS.get(map_id, "景区")),
        "route_id": str(raw.get("route_id") or raw.get("routeId") or ""),
        "draft_id": str(raw.get("draft_id") or raw.get("draftId") or ""),
        "tour_id": str(raw.get("tour_id") or raw.get("tourId") or ""),
        "route_name": str(raw.get("route_name") or raw.get("routeName") or "当前路线"),
        "total_minutes": _safe_optional_int(raw.get("total_minutes") or raw.get("totalMinutes")),
        "current_index": current_index,
        "current_spot": current_spot,
        "next_spot": next_spot,
        "ordered_spots": ordered_spots,
        "location_assist": _route_context_location_assist(
            raw.get("location_assist") or raw.get("locationAssist")
        ),
        "preference": raw.get("preference") if isinstance(raw.get("preference"), dict) else {},
        "status": str(raw.get("status") or ""),
    }


def _route_context_spot(value) -> dict:
    if not isinstance(value, dict):
        return {}
    name = str(value.get("name") or "").strip()
    spot_id = str(value.get("spot_id") or value.get("spotId") or "").strip()
    if not name and not spot_id:
        return {}
    return {
        "spot_id": spot_id,
        "name": name or spot_id,
        "stay_minutes": _safe_int(value.get("stay_minutes") or value.get("stayMinutes"), 0),
        "transition_minutes": _safe_optional_int(value.get("transition_minutes") or value.get("transitionMinutes")),
        "transition_note": str(value.get("transition_note") or value.get("transitionNote") or "").strip(),
        "sequence": _safe_optional_int(value.get("sequence")),
        "status": str(value.get("status") or "").strip(),
        "reason": str(value.get("reason") or "").strip(),
    }


def _route_context_location_assist(value) -> dict:
    if not isinstance(value, dict):
        return {}
    mode = str(value.get("mode") or "off").strip()
    if mode not in {"off", "simulated", "browser"}:
        mode = "off"
    status = str(value.get("status") or "idle").strip()
    if status not in {"idle", "locating", "ready", "denied", "timeout", "unsupported", "error"}:
        status = "idle"
    display_spot_id = str(value.get("display_spot_id") or value.get("displaySpotId") or "").strip()
    return {
        "mode": mode,
        "status": status,
        "accuracy_meters": _safe_optional_int(value.get("accuracy_meters") or value.get("accuracyMeters")),
        "display_spot_id": display_spot_id,
        "updated_at": _safe_optional_int(value.get("updated_at") or value.get("updatedAt")),
    }


def _safe_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_optional_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def _route_context_question_mentions_current(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    return any(
        word in compact
        for word in (
            "当前位置",
            "当前景点",
            "当前站",
            "当前导览站",
            "本站",
            "这站",
            "这里",
            "这儿",
            "此处",
            "我现在",
            "现在在哪",
            "现在到哪",
            "这个景点",
        )
    )


def _route_context_question_mentions_next(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    return any(
        word in compact
        for word in (
            "下一站",
            "下个景点",
            "下一个景点",
            "下一个",
            "下一处",
            "下站",
            "后面一站",
            "后面那个景点",
        )
    )


def _route_context_has_detail_word(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    return any(
        word in compact
        for word in (
            "看点",
            "特色",
            "故事",
            "历史",
            "介绍",
            "讲解",
            "讲讲",
            "讲一下",
            "讲当前站",
            "讲当前导览站",
            "讲当前",
            "了解",
            "适合",
            "拍照",
            "照片",
            "合影",
            "亲子照",
            "出片",
            "好玩",
            "玩什么",
            "怎么玩",
            "玩",
            "值得看",
            "文化",
            "含义",
        )
    )


def _route_context_scenic_detail_question(question: str) -> bool:
    if not _route_context_question_mentions_current(question):
        return False
    return _route_context_has_detail_word(question)


def _route_context_next_scenic_detail_question(question: str) -> bool:
    return _route_context_question_mentions_next(question) and _route_context_has_detail_word(question)


def _route_context_location_assist_question(question: str) -> bool:
    compact = re.sub(r"\s+", "", question).lower()
    return any(
        word in compact
        for word in (
            "gps",
            "定位",
            "位置准",
            "准不准",
            "浏览器位置",
            "浏览器定位",
            "导航",
        )
    )


def _with_route_context_intro(answer: str, question: str, context: dict) -> str:
    return answer


def _route_context_focus_instruction(question: str, context: dict) -> str:
    if context.get("status") == "expired":
        return ""
    if _route_context_next_scenic_detail_question(question):
        spot = context.get("next_spot")
        label = "下一站"
    elif _route_context_scenic_detail_question(question):
        spot = context.get("current_spot")
        label = "当前导览站"
    else:
        return ""
    if not isinstance(spot, dict) or not spot.get("name"):
        return ""
    return (
        "【路线感知约束】\n"
        f"- 用户正在路线导览中，{label}是“{spot['name']}”。\n"
        f"- 这次回答必须围绕“{spot['name']}”讲解；不要把其他景区或景点当作当前位置。\n"
        "- 如果证据不足，直接说不能确认，不要用默认景点补答。\n\n"
    )


def _maybe_direct_guide_result(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    chat_session: ChatSession,
    classification: dict,
    persona: dict | None = None,
) -> DirectGuideResult | None:
    question = request.question.strip()
    result = _route_context_direct_result(question, request, classification)
    if result is None and _route_context_from_request(request) and (
        _route_context_scenic_detail_question(question)
        or _route_context_next_scenic_detail_question(question)
    ):
        return None
    if result is None and _is_scenic_spot_listing_question(question):
        result = _scenic_spot_listing_result(db, request, chat_session)
    if result is None and _is_route_guide_question(question, classification, chat_session):
        result = _route_guide_result(db, settings, request, chat_session)
    if result is None and _is_casual_guide_question(question, classification):
        return _casual_guide_result(settings, question, persona)
    return _personalize_direct_result(settings, result, persona)


def _personalize_direct_result(
    settings: Settings,
    result: DirectGuideResult | None,
    persona: dict | None,
) -> DirectGuideResult | None:
    if result is None or not persona:
        return result
    rewritten = _mimo_style_answer(
        settings,
        system_prompt=(
            f"{_direct_guide_system_prompt(persona)}"
            "请只改写接下来提供的既有回答，使它符合人设。"
            "必须保留所有景点名、路线顺序、数值、状态、风险提醒和能力边界，不得补充新事实。"
        ),
        user_prompt=f"请改写这段既有导游回答：\n{result.answer}",
        answer_style="guide",
    )
    if rewritten:
        result.answer = rewritten
    return result


def _route_context_direct_result(
    question: str,
    request: ChatRequest,
    classification: dict | None = None,
) -> DirectGuideResult | None:
    context = _route_context_from_request(request)
    if not context:
        return None
    if context.get("status") == "expired":
        return DirectGuideResult(
            answer="这条路线状态已经失效了，我先不编造当前站。你可以回到路线页重新生成或重新开始游览，再来问我当前位置和下一站。",
            sources=[],
            mode="route_context_expired",
            degraded=True,
            emotion_cue="fallback",
            answer_style="route_context",
            guide_intent="route_context_expired",
            route_triggered=True,
        )
    current = context.get("current_spot")
    if not isinstance(current, dict) or not current.get("name"):
        return None
    if _route_context_scenic_detail_question(question) or _route_context_next_scenic_detail_question(question):
        return None

    compact = re.sub(r"\s+", "", question)
    if _route_context_location_assist_question(question):
        answer = _route_context_location_assist_answer(context)
        intent = "route_context_location_assist"
    elif any(word in compact for word in ("下一站", "下一个", "怎么走", "往哪走", "还有多久", "多久到", "走到哪")):
        answer = _route_context_next_answer(context)
        intent = "route_context_next"
    elif _route_context_reason_question(compact):
        answer = _route_context_reason_answer(context)
        intent = "route_context_reason"
    elif _route_context_adjust_question(compact, classification, context):
        answer = _route_context_fatigue_answer(context)
        intent = "route_context_adjust"
    elif any(word in compact for word in ("当前位置", "我现在在哪里", "我现在在哪", "现在在哪里", "现在在哪", "当前站", "当前导览站", "这里是哪", "现在到哪")):
        answer = _route_context_current_answer(context)
        intent = "route_context_current"
    else:
        return None

    return DirectGuideResult(
        answer=answer,
        sources=[],
        mode="route_context",
        degraded=False,
        emotion_cue="warm",
        answer_style="route_context",
        guide_intent=intent,
        route_triggered=True,
    )


def _route_context_reason_question(compact_question: str) -> bool:
    if any(
        word in compact_question
        for word in (
            "为什么这样安排",
            "为什么这么安排",
            "为什么要这样",
            "路线理由",
            "安排逻辑",
            "为什么先",
            "为什么后",
        )
    ):
        return True
    if "路线" not in compact_question:
        return False
    return any(
        word in compact_question
        for word in (
            "按",
            "根据",
            "依据",
            "安排",
            "顺序",
            "逻辑",
            "适合",
            "为什么",
        )
    )


def _route_context_adjust_question(
    compact_question: str,
    classification: dict | None,
    context: dict,
) -> bool:
    if not any(
        word in compact_question
        for word in ("累", "休息", "少走", "少走路", "走不动", "轻松", "调整路线", "改路线", "跳过")
    ):
        return False
    if _route_context_mentions_external_entity(classification, context) and not any(
        word in compact_question
        for word in (
            "当前",
            "当前站",
            "当前景点",
            "本站",
            "这站",
            "这里",
            "这儿",
            "我现在",
            "现在附近",
            "下一站",
            "下一个",
            "路线",
            "跳过",
            "调整路线",
            "改路线",
        )
    ):
        return False
    return True


def _route_context_mentions_external_entity(
    classification: dict | None,
    context: dict,
) -> bool:
    if not isinstance(classification, dict):
        return False
    allowed_ids = {
        str(spot.get("spot_id") or "")
        for spot in (context.get("current_spot"), context.get("next_spot"))
        if isinstance(spot, dict)
    }
    allowed_names = {
        str(spot.get("name") or "")
        for spot in (context.get("current_spot"), context.get("next_spot"))
        if isinstance(spot, dict)
    }
    for entity in classification.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        entity_id = str(entity.get("entity_id") or "")
        entity_name = str(entity.get("name") or "")
        if entity_id and entity_id not in allowed_ids:
            return True
        if entity_name and entity_name not in allowed_names:
            return True
    return False


def _route_context_current_answer(context: dict) -> str:
    current = context["current_spot"]
    next_spot = context.get("next_spot")
    ordered = context.get("ordered_spots") or []
    current_number = int(context.get("current_index") or 0) + 1
    total = len(ordered)
    progress = f"第{current_number}/{total}站" if total else f"第{current_number}站"
    stay = _stay_text(current)
    next_text = f"下一站是{next_spot['name']}。" if isinstance(next_spot, dict) and next_spot.get("name") else "你已经到这条路线的最后一站了。"
    return (
        f"你现在的当前导览站是{current['name']}，属于{context.get('scenic_name', '景区')}“{context.get('route_name', '当前路线')}”的{progress}。"
        f"{stay}{next_text}{_route_context_location_note(context)}"
    )


def _route_context_location_assist_answer(context: dict) -> str:
    current = context["current_spot"]
    next_spot = context.get("next_spot")
    next_text = f"下一站是{next_spot['name']}。" if isinstance(next_spot, dict) and next_spot.get("name") else "当前路线没有下一站。"
    return (
        f"当前导览站仍以路线状态为准：你现在在{current['name']}，{next_text}"
        f"{_route_context_location_note(context)}"
    )


def _route_context_location_note(context: dict) -> str:
    location_assist = context.get("location_assist")
    if not isinstance(location_assist, dict):
        return "这里说的是导览路线状态，不是真实 GPS 定位。"
    mode = location_assist.get("mode")
    status = location_assist.get("status")
    if mode in {"simulated", "browser"} and status == "ready":
        if mode == "browser" and location_assist.get("accuracy_meters") is not None:
            return (
                f"浏览器定位辅助已开启，返回精度约{location_assist['accuracy_meters']}米；"
                "弹窗地图展示的是浏览器返回的位置点，当前导览站仍以路线状态为准，不是实时 GPS 导航。"
            )
        return "定位辅助已开启，当前导览站仍以路线状态为准，不是实时 GPS 导航。"
    if mode == "browser" and status in {"denied", "timeout", "unsupported", "error"}:
        return "浏览器定位暂不可用，当前站仍以路线导览状态为准，不是真实 GPS 导航。"
    if mode == "browser" and status == "locating":
        return "浏览器定位正在获取中，当前站仍以路线导览状态为准，不是真实 GPS 导航。"
    return "这里说的是导览路线状态，不是真实 GPS 定位。"


def _route_context_next_answer(context: dict) -> str:
    current = context["current_spot"]
    next_spot = context.get("next_spot")
    if not isinstance(next_spot, dict) or not next_spot.get("name"):
        return f"你当前导览站是{current['name']}，这已经是当前路线的最后一站。可以在这里收尾，也可以回路线页重新生成下一段。"
    transition = _transition_text(next_spot)
    stay = _stay_text(next_spot)
    return (
        f"从当前导览站{current['name']}出发，下一站是{next_spot['name']}。"
        f"{transition}{stay}到达后你可以问我“这里有什么看点”，我会按下一站来讲。"
    )


def _route_context_reason_answer(context: dict) -> str:
    current = context["current_spot"]
    next_spot = context.get("next_spot")
    sequence = _route_context_sequence(context)
    preference_text = _route_context_preference_text(context)
    next_text = f"现在先讲{current['name']}，再去{next_spot['name']}，能让节奏更连贯。" if isinstance(next_spot, dict) and next_spot.get("name") else f"现在到{current['name']}收尾，路线已经接近结束。"
    return (
        f"这条“{context.get('route_name', '当前路线')}”主要按{preference_text}来排，顺序是{sequence}。"
        f"{next_text}第一版我不会直接替你改路线，但可以告诉你哪些点适合跳过或回路线编辑里调整。"
    )


def _route_context_fatigue_answer(context: dict) -> str:
    current = context["current_spot"]
    next_spot = context.get("next_spot")
    if isinstance(next_spot, dict) and next_spot.get("name"):
        transition = _transition_text(next_spot)
        next_sentence = f"如果还想继续，下一站是{next_spot['name']}，{transition}"
    else:
        next_sentence = "这已经是当前路线最后一站，可以在这里结束本段游览。"
    return (
        f"可以的，先别硬撑。你当前导览站是{current['name']}，建议先原地休息几分钟；"
        f"{next_sentence}如果体力不够，可以在导览条里跳过本站或回路线编辑页删掉支线点位，我不会在这里直接伪造一条新路线。"
    )


def _stay_text(spot: dict) -> str:
    minutes = _safe_optional_int(spot.get("stay_minutes"))
    if not minutes:
        return ""
    return f"建议停留约{minutes}分钟。"


def _transition_text(spot: dict) -> str:
    minutes = _safe_optional_int(spot.get("transition_minutes"))
    note = str(spot.get("transition_note") or "").strip()
    if minutes is None:
        return "这段步行时间我这里还没有维护，先不乱报时长。"
    if note:
        return f"从上一站到这里预计约{minutes}分钟，{note}。"
    return f"从上一站到这里预计约{minutes}分钟。"


def _route_context_sequence(context: dict) -> str:
    names = [
        str(spot.get("name"))
        for spot in context.get("ordered_spots", [])
        if isinstance(spot, dict) and spot.get("name")
    ]
    if not names:
        return "当前站点顺序"
    sequence = "、".join(names[:7])
    if len(names) > 7:
        sequence += "等点位"
    return sequence


def _route_context_preference_text(context: dict) -> str:
    preference = context.get("preference")
    if not isinstance(preference, dict):
        return "当前路线状态"
    tags = preference.get("interest_tags") or preference.get("interestTags") or []
    if isinstance(tags, list) and tags:
        return "、".join(str(tag) for tag in tags[:2])
    return "你的游览偏好"


def _is_casual_guide_question(question: str, classification: dict) -> bool:
    compact = re.sub(r"\s+", "", question).lower()
    if classification.get("intent") == "casual":
        return True
    casual_phrases = {
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
        "你能干什么",
        "你能做什么",
        "你能做什么？",
        "介绍一下你自己",
    }
    if compact in casual_phrases:
        return True
    if len(compact) <= 8 and any(phrase in compact for phrase in {"你好", "您好", "嗨", "哈喽", "hello"}):
        return True
    if "你" in compact and any(
        phrase in compact
        for phrase in {
            "你是谁",
            "叫什么",
            "名字",
            "会干什么",
            "能干什么",
            "能做什么",
            "像真人导游",
            "陪我逛",
            "在吗",
        }
    ):
        return True
    if "第一次来" in compact and ("不知道问什么" in compact or "问什么" in compact):
        return True
    return False


def _casual_guide_result(
    settings: Settings,
    question: str,
    persona: dict | None = None,
) -> DirectGuideResult:
    answer = _mimo_style_answer(
        settings,
        system_prompt=_direct_guide_system_prompt(persona),
        user_prompt=(
            f"游客刚刚说：{question}\n"
            "请用 1 到 3 句自然回应。不要引用资料，不要说“根据资料”。"
            "如果游客问你是谁或会做什么，请说明你能讲景点、给游览建议、在明确请求时生成路线。"
        ),
        answer_style="guide",
    )
    used_mimo = bool(answer)
    if not answer:
        answer = _casual_guide_answer(question)
    return DirectGuideResult(
        answer=answer,
        sources=[],
        mode="guide_casual",
        degraded=not used_mimo,
        emotion_cue="warm",
        answer_style="casual",
    )


def _casual_guide_answer(question: str) -> str:
    compact = re.sub(r"\s+", "", question)
    if "谁" in compact or "叫什么" in compact:
        return "我是灵诗音，你的景区 AI 导游，可以陪你聊景点故事、提醒游览节奏，也能按你的时间和兴趣帮你排一条路线。你就像问真人导游一样问我就行。"
    if "干什么" in compact or "能干什么" in compact:
        return "我能做三件事：讲景点、给建议、排路线。比如你可以问我“梵宫有什么看点”，也可以说“我喜欢自然风光，帮我安排一条轻松路线”。"
    return "你好呀，我在这儿。想听景点故事、问路线怎么走，或者让老人孩子玩得轻松一点，都可以直接告诉我。"


def _mimo_style_answer(
    settings: Settings,
    system_prompt: str,
    user_prompt: str,
    answer_style: str = "guide",
) -> str | None:
    if not _llm_available(settings):
        return None
    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        return _clean_visitor_answer(
            _call_mimo_chat_completion(
                client,
                model=settings.llm_model,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=_temperature_for_style(settings, answer_style),
                max_completion_tokens=settings.llm_max_completion_tokens,
            )
        )
    except Exception:
        return None


def _call_mimo_chat_completion(
    client: MimoClient,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float | None = None,
    max_completion_tokens: int | None = None,
) -> str:
    try:
        return client.chat_completion(
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_completion_tokens=max_completion_tokens,
        )
    except TypeError:
        return client.chat_completion(model, system_prompt, user_prompt)


def _call_mimo_chat_stream(
    client: MimoClient,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float | None = None,
    max_completion_tokens: int | None = None,
):
    try:
        yield from client.chat_completion_stream(
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            max_completion_tokens=max_completion_tokens,
        )
    except TypeError:
        yield from client.chat_completion_stream(model, system_prompt, user_prompt)


def _temperature_for_style(settings: Settings, answer_style: str) -> float:
    if answer_style == "fact":
        return settings.llm_temperature_fact
    if answer_style == "service":
        return settings.llm_temperature_service
    if answer_style == "route":
        return settings.llm_temperature_route
    return settings.llm_temperature_guide


def _llm_available(settings: Settings) -> bool:
    return settings.llm_mode == "openai_compatible" and bool(settings.llm_api_key)


def _direct_guide_system_prompt(persona: dict | None = None) -> str:
    return (
        "你是“灵诗音”，灵山胜境景区数字人导游。你的语气像一位温柔、有经验的真人导游，"
        "亲切、有一点个性，但不要卖萌。回答要短，适合游客现场听。"
        "不要用“根据资料”“当前资料显示”“关于……”这类资料播报式开头。"
        "没有证据时不要编造景区事实。"
        f"{persona_prompt(persona)}"
    )


def _is_service_advice_question(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    if not any(word in compact for word in ("注意", "提醒", "老人", "孩子", "小朋友", "休息", "累", "方便")):
        return False
    if any(word in compact for word in ("路线", "生成", "规划", "安排行程", "安排路线")):
        return False
    return True


def _service_advice_answer(question: str, profile: dict, chat_session: ChatSession) -> str:
    preference = _route_preference_from_request(
        ChatRequest(question=question, profile=profile),
        chat_session,
    )
    map_name = MAP_NAME_LABELS.get(str(preference.get("map_id")), "景区")
    if "老人" in question:
        if preference.get("map_id") == "nianhua-bay":
            return "带老人来拈花湾，节奏可以放慢一点，别把街区和花海都排得太满。建议先确认休息点和返程位置，遇到需要长走的支线就少走一点，体验会舒服很多。"
        return "带老人来灵山，最重要是别赶路。这里有些点位之间步行距离不短，建议把核心景点放在前面，中间留休息时间；如果觉得累，就优先保留大佛、梵宫这类重点。"
    if any(word in question for word in ("孩子", "小朋友")):
        return f"带孩子游{map_name}，我建议把讲解拆成小故事，不要连续塞太多文化信息。可以选互动性强、画面感明显的点位，中间穿插休息和拍照，孩子会更容易跟上。"
    return f"游{map_name}不用太赶，先抓住你最想看的主题，再把体力留给最后一两个重点点位。要是现场觉得累，就少走支线，把体验感保住会更重要。"


def _is_scenic_spot_listing_question(question: str) -> bool:
    compact = re.sub(r"\s+", "", question)
    listing_words = ("有什么景点", "有哪些景点", "有啥景点", "景点有哪些", "景点有什么")
    return any(word in compact for word in listing_words)


def _scenic_spot_listing_result(
    db: Session,
    request: ChatRequest,
    chat_session: ChatSession,
) -> DirectGuideResult:
    preference = _route_preference_from_request(request, chat_session)
    map_id = str(preference.get("map_id") or "ling-shan")
    map_name = MAP_NAME_LABELS.get(map_id, "景区")
    rows = db.execute(
        select(ScenicSpot)
        .join(MapPoint, MapPoint.spot_id == ScenicSpot.id)
        .where(
            MapPoint.map_id == map_id,
            MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
        )
        .order_by(ScenicSpot.sort_order.asc(), ScenicSpot.name.asc())
    ).scalars()
    spots: list[ScenicSpot] = []
    seen: set[str] = set()
    for spot in rows:
        if spot.id in seen or "入口" in spot.name or spot.id.endswith("_entrance"):
            continue
        spots.append(spot)
        seen.add(spot.id)
    if not spots:
        return DirectGuideResult(
            answer=f"{map_name}的景点清单我这里暂时没拿稳，先不乱说。你可以问我某个具体景点，比如“梵宫有什么看点”，我会讲得更准一点。",
            sources=[],
            mode="guide_scenic_list",
            degraded=True,
        emotion_cue="fallback",
        answer_style="list",
    )
    names = _prioritized_scenic_list_names(map_id, [spot.name for spot in spots])
    highlights = "、".join(names[:10])
    if map_id == "nianhua-bay":
        opening = "拈花湾主要是禅意小镇和自然街区的感觉，节奏比灵山更松弛。"
    else:
        opening = "灵山胜境的景点更像一条文化中轴线，适合边走边理解佛教文化和建筑层次。"
    tail = "如果你想，我也可以再按“拍照、亲子、建筑、自然”帮你挑重点，不一定马上排完整路线。"
    return DirectGuideResult(
        answer=f"{opening}比较值得先认识的点有：{highlights}。{tail}",
        sources=[],
        mode="guide_scenic_list",
        emotion_cue="warm",
        answer_style="list",
    )


def _prioritized_scenic_list_names(map_id: str, names: list[str]) -> list[str]:
    priority = {
        "ling-shan": [
            "灵山大佛",
            "灵山梵宫",
            "九龙灌浴",
            "五印坛城",
            "祥符禅寺",
            "佛足坛",
            "菩提大道",
            "阿育王柱",
            "百子戏弥勒",
            "曼飞龙塔",
        ],
        "nianhua-bay": [
            "拈花广场",
            "梵天花海",
            "香月花街",
            "拈花堂",
            "五灯湖",
            "鹿鸣谷",
        ],
    }.get(map_id, [])
    ordered = [name for name in priority if name in names]
    ordered.extend(name for name in names if name not in ordered)
    return ordered


def _is_route_guide_question(question: str, classification: dict, chat_session: ChatSession) -> bool:
    compact = re.sub(r"\s+", "", question)
    if any(
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
    ):
        return False
    scenic_info_words = (
        "有什么景点",
        "有哪些景点",
        "有什么看点",
        "有哪些看点",
        "有什么特色",
        "介绍一下",
        "讲讲",
        "说说",
    )
    if any(word in compact for word in scenic_info_words):
        return False
    if _is_service_advice_question(question):
        return False
    if _has_explicit_route_request(compact):
        return True
    route_followup_words = (
        "换成",
        "改成",
        "调整成",
        "轻松一点",
        "少走一点",
        "少走路",
        "多走一点",
        "强度低",
        "强度高",
        "偏自然",
        "偏摄影",
        "偏建筑",
        "偏亲子",
    )
    if _session_route_preference(chat_session) and any(
        word in compact for word in route_followup_words
    ):
        return True
    if _session_route_preference(chat_session) and any(
        word in compact for word in ROUTE_FOLLOWUP_REQUEST_WORDS
    ):
        return True
    return False


def _has_explicit_route_request(compact: str) -> bool:
    if any(word in compact for word in ROUTE_STRONG_REQUEST_WORDS):
        return True
    if "路线" in compact and any(word in compact for word in ("推荐", "生成", "规划", "安排", "怎么", "帮我", "做", "排")):
        return True
    if "行程" in compact and any(word in compact for word in ("推荐", "生成", "规划", "安排", "怎么", "帮我")):
        return True
    if any(word in compact for word in ROUTE_SOFT_ACTION_WORDS):
        return any(word in compact for word in ROUTE_CONTEXT_WORDS)
    if any(word in compact for word in ("我有", "可游览")) and any(word in compact for word in ROUTE_CONTEXT_WORDS):
        return any(word in compact for word in ("怎么", "逛", "游", "玩", "安排", "规划", "推荐"))
    return False


def _route_guide_result(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    chat_session: ChatSession,
) -> DirectGuideResult:
    preference = _route_preference_from_request(request, chat_session)
    _store_route_preference(chat_session, preference)
    try:
        routes = recommend_routes(db, _route_request_from_preference(preference))
    except ApiError:
        routes = []
    except Exception:
        routes = []
    if not routes:
        return DirectGuideResult(
            answer="我刚刚没能从路线系统拿到稳定结果，所以先不替你乱排路线。你可以稍后再试一次，或者告诉我景区、时间和兴趣，我再帮你重新安排。",
            sources=[],
            mode="route_unavailable",
        degraded=True,
        emotion_cue="fallback",
        answer_style="route",
    )
    route = routes[0]
    preference_model = GuideRoutePreference(**preference)
    return DirectGuideResult(
        answer=_route_answer_text(settings, route, preference_model),
        sources=[],
        mode="route_recommendation",
        degraded=False,
        guide_action=GuideAction(
            type="route_recommendation",
            title=route.name,
            route=route,
            preference=preference_model,
        ),
        emotion_cue="success",
        answer_style="route",
    )


def _route_preference_from_request(request: ChatRequest, chat_session: ChatSession) -> dict:
    base = {
        "map_id": "ling-shan",
        "duration_minutes": 120,
        "physical_level": "medium",
        "interest_tags": ["佛教文化", "建筑艺术"],
        "accessible_required": False,
    }
    session_preference = _session_route_preference(chat_session)
    if session_preference:
        base.update(session_preference)
    profile_preference = request.profile.get("route_preference") or request.profile.get("routePreference")
    if isinstance(profile_preference, dict):
        base.update(_normalize_route_preference_dict(profile_preference))
    text_overrides = _route_preference_from_text(request.question)
    base.update({key: value for key, value in text_overrides.items() if value not in (None, [], "")})
    base["interest_tags"] = _normalize_interest_tags(base.get("interest_tags", []))
    if not base["interest_tags"]:
        base["interest_tags"] = ["佛教文化"]
    base["duration_minutes"] = min(1440, max(30, int(base.get("duration_minutes") or 120)))
    if base.get("map_id") not in MAP_NAME_LABELS:
        base["map_id"] = "ling-shan"
    if base.get("physical_level") not in {"low", "medium", "high"}:
        base["physical_level"] = "medium"
    return base


def _normalize_route_preference_dict(value: dict) -> dict:
    return {
        "map_id": value.get("map_id") or value.get("mapId") or "ling-shan",
        "duration_minutes": value.get("duration_minutes") or value.get("durationMinutes") or 120,
        "physical_level": value.get("physical_level") or value.get("physicalLevel") or "medium",
        "interest_tags": value.get("interest_tags") or value.get("interestTags") or [],
        "accessible_required": bool(value.get("accessible_required") or value.get("accessibleRequired") or False),
    }


def _route_preference_from_text(question: str) -> dict:
    compact = re.sub(r"\s+", "", question)
    preference: dict = {}
    if "拈花湾" in compact:
        preference["map_id"] = "nianhua-bay"
    elif "灵山" in compact:
        preference["map_id"] = "ling-shan"
    duration = _duration_from_text(compact)
    if duration:
        preference["duration_minutes"] = duration
    if any(word in compact for word in ("轻松", "少走", "低强度", "老人", "慢一点")):
        preference["physical_level"] = "low"
    elif any(word in compact for word in ("高强度", "多走", "能走", "体力好", "强度高")):
        preference["physical_level"] = "high"
    elif any(word in compact for word in ("中等", "适中", "普通")):
        preference["physical_level"] = "medium"
    tags = _themes_from_text(compact)
    if tags:
        preference["interest_tags"] = tags
    return preference


def _duration_from_text(text: str) -> int | None:
    digit_minutes = re.search(r"(\d{2,4})\s*(?:分钟|分|min|mins)", text, flags=re.IGNORECASE)
    if digit_minutes:
        return int(digit_minutes.group(1))
    digit_hours = re.search(r"(\d+(?:\.\d+)?)\s*(?:小时|小時|h)", text, flags=re.IGNORECASE)
    if digit_hours:
        return round(float(digit_hours.group(1)) * 60)
    chinese_hours = {
        "一小时": 60,
        "一个小时": 60,
        "两小时": 120,
        "两个小时": 120,
        "三小时": 180,
        "三个小时": 180,
        "四小时": 240,
        "四个小时": 240,
    }
    for phrase, minutes in chinese_hours.items():
        if phrase in text:
            return minutes
    return None


def _themes_from_text(text: str) -> list[str]:
    themes: list[str] = []
    for alias, theme in GUIDE_THEME_ALIASES.items():
        if alias in text and theme not in themes:
            themes.append(theme)
    for theme in SUPPORTED_GUIDE_THEMES:
        if theme in text and theme not in themes:
            themes.append(theme)
    return themes[:2]


def _normalize_interest_tags(value) -> list[str]:
    if isinstance(value, str):
        raw_tags = re.split(r"[,，、;；\s]+", value)
    elif isinstance(value, list):
        raw_tags = [str(item) for item in value]
    else:
        raw_tags = []
    tags: list[str] = []
    for raw in raw_tags:
        theme = GUIDE_THEME_ALIASES.get(raw, raw)
        if theme in SUPPORTED_GUIDE_THEMES and theme not in tags:
            tags.append(theme)
    return tags[:2]


def _session_route_preference(chat_session: ChatSession) -> dict:
    try:
        value = json.loads(chat_session.preference or "")
    except Exception:
        return {}
    if not isinstance(value, dict):
        return {}
    return _normalize_route_preference_dict(value)


def _store_route_preference(chat_session: ChatSession, preference: dict) -> None:
    chat_session.preference = json.dumps(preference, ensure_ascii=False)


def _route_request_from_preference(preference: dict) -> RouteRecommendRequest:
    return RouteRecommendRequest(
        map_id=str(preference.get("map_id") or "ling-shan"),
        duration_minutes=int(preference.get("duration_minutes") or 120),
        physical_level=str(preference.get("physical_level") or "medium"),
        interest_tags=[str(item) for item in preference.get("interest_tags", [])],
        accessible_required=bool(preference.get("accessible_required", False)),
    )


def _route_answer_text(settings: Settings, route, preference: GuideRoutePreference) -> str:
    map_name = MAP_NAME_LABELS.get(preference.map_id, "景区")
    themes = "和".join(preference.interest_tags) if preference.interest_tags else "你的兴趣"
    pace = {
        "low": "节奏会放轻一点，少折返、少赶路",
        "medium": "节奏比较均衡，既能看重点也不会太赶",
        "high": "节奏会更充实一些，适合体力比较好的游览",
    }.get(preference.physical_level, "节奏比较均衡")
    spot_names = [spot.name for spot in route.spots if "入口" not in spot.name]
    sequence = "、".join(spot_names[:6])
    if len(spot_names) > 6:
        sequence += "等点位"
    if not sequence:
        sequence = "当前最适合你的核心点位"
    walk_text = f"步行约{route.estimated_walk_minutes}分钟，" if route.estimated_walk_minutes else ""
    mimo_answer = _mimo_style_answer(
        settings,
        system_prompt=_direct_guide_system_prompt()
        + "你正在解释系统已经生成好的路线，只能使用给定顺序，不能增删景点、不能重新排序。",
        user_prompt=(
            f"景区：{map_name}\n"
            f"游客兴趣：{themes}\n"
            f"体力节奏：{pace}\n"
            f"总时长：{route.total_minutes}分钟\n"
            f"预计步行：{route.estimated_walk_minutes}分钟\n"
            f"路线顺序：{sequence}\n\n"
            "请用 3 到 4 句像真人导游一样解释这条路线。"
            "必须提醒用户可以看地图、编辑路线或开始游览。"
            "不要说“根据资料”，不要编造路线之外的景点。"
        ),
        answer_style="route",
    )
    if mimo_answer:
        return mimo_answer
    return (
        f"好呀，我按你这次偏{themes}的喜好，给你排了一条{map_name}路线。"
        f"全程大约{route.total_minutes}分钟，{walk_text}{pace}。"
        f"路线会从景区入口出发，依次去{sequence}。"
        "你可以先看地图确认动线；如果想再轻松一点，点“编辑路线”删掉一两个支线点位就行。"
    )


def _emotion_cue_for_classification(classification: dict, sources) -> str:
    if classification.get("emotional"):
        return "warm"
    if sources:
        return "success"
    return "idle"


def _start_tts(
    settings: Settings,
    answer: str,
    tts_jobs: TtsJobStore | None,
) -> tuple[str | None, str, str | None]:
    if settings.tts_mode == "disabled" or not settings.tts_api_key:
        audio_url, status = synthesize_answer_audio(settings, answer)
        return audio_url, status, None
    if tts_jobs is None:
        audio_url, status = synthesize_answer_audio(settings, answer)
        return audio_url, status, None

    job = tts_jobs.enqueue(settings, answer)
    return None, job.status, job.id


def _answer_image_chat(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    session_id: str,
    classification: dict,
    total_started: float,
    tts_jobs: TtsJobStore | None,
    first_delta_ms: float = 0,
    persona: dict | None = None,
) -> ChatResponse:
    llm_started = perf_counter()
    answer, mode, degraded = _answer_image_text(settings, request, persona)
    llm_ms = _elapsed_ms(llm_started)
    tts_started = perf_counter()
    audio_url, tts_status, tts_job_id = _start_tts(settings, answer, tts_jobs)
    tts_ms = _elapsed_ms(tts_started)
    sources = [_image_upload_source()]
    route_context = _route_context_from_request(request)
    metrics = ChatMetrics(
        retrieval_ms=0,
        llm_ms=llm_ms,
        tts_ms=tts_ms,
        total_ms=_elapsed_ms(total_started),
        cache_hit=False,
        degraded=degraded,
        classification={**classification, "vision": True},
        web_supplement_required=False,
        web_supplement_status="not_required",
        retrieval_mode="vision",
        context_count=0,
        vector_status="not_required",
        guide_intent="image_question",
        evidence_profile="user_image",
        route_triggered=bool(route_context),
        answer_style="vision",
        llm_model=settings.llm_model,
        embedding_model=settings.rag_embedding_model,
        first_delta_ms=first_delta_ms,
    )
    db.add(
        ChatMessage(
            session_id=session_id,
            question=f"图片提问：{request.question}",
            answer=answer,
            sources_json=[source.model_dump() for source in sources],
            metrics_json=metrics.model_dump(),
        )
    )
    db.commit()
    return ChatResponse(
        answer=answer,
        sources=sources,
        session_id=session_id,
        audio_url=audio_url,
        tts_job_id=tts_job_id,
        tts_status=tts_status,
        mode=mode,
        degraded=degraded,
        metrics=metrics,
        emotion_cue="success" if not degraded else "fallback",
    )


def _answer_image_text(
    settings: Settings,
    request: ChatRequest,
    persona: dict | None = None,
) -> tuple[str, str, bool]:
    if settings.llm_mode == "mock":
        return _mock_image_answer(request), "mock_vision", False
    if settings.llm_mode in {"disabled", "fallback"} or not settings.llm_api_key:
        return _image_unavailable_answer(request), "vision_unavailable", True
    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        raw_answer = client.vision_chat_completion(
            model=settings.llm_model,
            system_prompt=_image_system_prompt(),
            user_prompt=_image_user_prompt(request, persona),
            image_data_url=request.image.data_url if request.image else "",
            temperature=settings.llm_temperature_guide,
            max_completion_tokens=max(
                256,
                int(settings.llm_max_completion_tokens or 0),
            ),
        )
        answer = _clean_visitor_answer(raw_answer)
        if not answer:
            return _image_unavailable_answer(request), "vision_unavailable", True
        return answer, "vision", False
    except Exception:
        return _image_unavailable_answer(request), "vision_unavailable", True


def _image_system_prompt() -> str:
    return (
        "你是“灵诗音”，灵山胜境 AI 数字人导游。用户上传了一张图片并提出问题。"
        "请先观察图片，再结合景区导览语境回答。"
        "如果无法确定图中内容，要明确说不确定，不要硬编。"
        "不要编造票价、开放时间、安全结论或精确定位。"
        "回答应自然、简洁，像现场导游一样给出看点和下一步建议。"
    )


def _image_user_prompt(
    request: ChatRequest,
    persona: dict | None = None,
) -> str:
    parts = [
        f"用户问题：{request.question}",
        "请基于用户上传图片回答，并说明这是多模态辅助识别结果。",
    ]
    if persona:
        parts.append(persona_prompt(persona).strip())
    route_summary = _image_route_context_summary(request)
    if route_summary:
        parts.append(route_summary)
    current_spot_name = ""
    if isinstance(request.profile, dict):
        current_spot_name = str(request.profile.get("current_spot_name") or "").strip()
    if current_spot_name:
        parts.append(f"当前页面或导览关联景点：{current_spot_name}")
    return "\n".join(parts)


def _image_route_context_summary(request: ChatRequest) -> str:
    context = _route_context_from_request(request)
    if not context:
        return ""
    current_spot = context.get("current_spot") if isinstance(context.get("current_spot"), dict) else {}
    next_spot = context.get("next_spot") if isinstance(context.get("next_spot"), dict) else {}
    lines = [
        f"当前景区：{context.get('scenic_name') or '景区'}",
        f"当前路线：{context.get('route_name') or '当前路线'}",
    ]
    if current_spot.get("name"):
        lines.append(f"当前导览站：{current_spot['name']}")
    if next_spot.get("name"):
        lines.append(f"下一站：{next_spot['name']}")
    return "路线状态： " + "；".join(lines)


def _image_unavailable_answer(request: ChatRequest) -> str:
    context = _route_context_from_request(request)
    current_spot = context.get("current_spot") if isinstance(context.get("current_spot"), dict) else {}
    current_text = f"当前导览站以路线状态为准：{current_spot['name']}。" if current_spot.get("name") else ""
    return (
        f"我已收到图片。{current_text}"
        "不过当前多模态识别服务暂时不可用，我先不硬猜图中内容。"
        "你可以补充一句图片里大概是什么，或者告诉我是在哪个景点拍的，我再结合景区资料继续帮你讲解。"
    )


def _mock_image_answer(request: ChatRequest) -> str:
    context = _route_context_from_request(request)
    current_spot = context.get("current_spot") if isinstance(context.get("current_spot"), dict) else {}
    spot_text = f"结合当前导览站“{current_spot['name']}”来看，" if current_spot.get("name") else ""
    return (
        f"我已经收到这张图片。{spot_text}"
        "演示模式下我会把它作为“拍照问导游”的多模态输入来处理：先识别画面主体，再结合景区看点解释它可能和佛教文化、建筑空间或游览路线有什么关系。"
        "如果你想让回答更准，可以再补一句“这张是在什么位置拍的”。"
    )


def _image_upload_source() -> KnowledgeSource:
    return KnowledgeSource(
        title="用户上传图片",
        spot_name="多模态辅助识别",
        section="图片提问",
        snippet="本次回答基于游客上传图片和当前导览上下文生成，原图不写入数据库。",
        score=1.0,
        source_type="user_image",
        source_level="user_provided",
    )


def _answer_text(
    settings: Settings,
    question: str,
    contexts,
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
    route_focus_instruction: str = "",
    persona: dict | None = None,
) -> tuple[str, str, bool]:
    if settings.llm_mode == "mock":
        return _fallback_answer(
            question,
            contexts,
            web_supplement_required,
            classification,
            web_supplement_status,
        ), "mock", False
    if settings.llm_mode in {"disabled", "fallback"}:
        return _fallback_answer(
            question,
            contexts,
            web_supplement_required,
            classification,
            web_supplement_status,
        ), "fallback", False
    if not settings.llm_api_key:
        if _has_realtime_web_context(contexts):
            return _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            ), "web_supplement", False
        return _fallback_answer(
            question,
            contexts,
            web_supplement_required,
            classification,
            web_supplement_status,
        ), "fallback", True
    if (
        web_supplement_required
        and web_supplement_status != "success"
        and classification.get("intent") != "external_factual"
    ):
        return _fallback_answer(
            question,
            contexts,
            web_supplement_required,
            classification,
            web_supplement_status,
        ), "web_supplement_unavailable", False

    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        answer_style = _answer_style_for_classification(classification)
        answer = _call_mimo_chat_completion(
            client,
            model=settings.llm_model,
            system_prompt=_system_prompt(),
            user_prompt=_user_prompt(
                question,
                contexts,
                classification,
                web_supplement_required,
                web_supplement_status,
                route_focus_instruction,
                persona,
            ),
            temperature=_temperature_for_style(settings, answer_style),
            max_completion_tokens=max(
                256,
                int(settings.llm_max_completion_tokens or 0),
            ),
        )
        cleaned_answer = _stabilize_vague_recommendation_answer(
            _stabilize_entity_name(
                _clean_visitor_answer(answer),
                classification,
            ),
            question,
        )
        return cleaned_answer, settings.llm_mode, False
    except Exception:
        if _has_realtime_web_context(contexts):
            return _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            ), "web_supplement", False
        return _fallback_answer(
            question,
            contexts,
            web_supplement_required,
            classification,
            web_supplement_status,
        ), "fallback", True


def _answer_text_chunks(
    settings: Settings,
    question: str,
    contexts,
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
    stream_state: dict,
    route_focus_instruction: str = "",
    persona: dict | None = None,
):
    if settings.llm_mode == "mock":
        yield from _chunk_text(
            _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            )
        )
        return
    if settings.llm_mode in {"disabled", "fallback"}:
        yield from _chunk_text(
            _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            )
        )
        return
    if not settings.llm_api_key:
        if _has_realtime_web_context(contexts):
            stream_state["mode"] = "web_supplement"
            stream_state["degraded"] = False
            yield from _chunk_text(
                _fallback_answer(
                    question,
                    contexts,
                    web_supplement_required,
                    classification,
                    web_supplement_status,
                )
            )
            return
        yield from _chunk_text(
            _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            )
        )
        return
    if (
        web_supplement_required
        and web_supplement_status != "success"
        and classification.get("intent") != "external_factual"
    ):
        stream_state["mode"] = "web_supplement_unavailable"
        stream_state["degraded"] = False
        yield from _chunk_text(
            _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            )
        )
        return

    try:
        client = MimoClient(settings.llm_base_url, settings.llm_api_key)
        has_chunk = False
        answer_style = _answer_style_for_classification(classification)
        for chunk in _call_mimo_chat_stream(
            client,
            model=settings.llm_model,
            system_prompt=_system_prompt(),
            user_prompt=_user_prompt(
                question,
                contexts,
                classification,
                web_supplement_required,
                web_supplement_status,
                route_focus_instruction,
                persona,
            ),
            temperature=_temperature_for_style(settings, answer_style),
            max_completion_tokens=max(
                256,
                int(settings.llm_max_completion_tokens or 0),
            ),
        ):
            has_chunk = True
            yield chunk
        return
    except Exception:
        if has_chunk:
            return
        if _has_realtime_web_context(contexts):
            stream_state["mode"] = "web_supplement"
            stream_state["degraded"] = False
            yield from _chunk_text(
                _fallback_answer(
                    question,
                    contexts,
                    web_supplement_required,
                    classification,
                    web_supplement_status,
                )
            )
            return
        stream_state["mode"] = "fallback"
        stream_state["degraded"] = True
        yield from _chunk_text(
            _fallback_answer(
                question,
                contexts,
                web_supplement_required,
                classification,
                web_supplement_status,
            )
        )
        return

def _chunk_text(text: str, size: int = 18):
    for index in range(0, len(text), size):
        yield text[index : index + size]


def _clean_visitor_answer(answer: str) -> str:
    text = answer.strip()
    text = re.sub(
        r"^[（(][^）)]{0,80}(?:走到|走近|指向|看向|微笑|语气|轻声|轻快|挥手|停顿|动作|镜头|表情)[^）)]{0,80}[）)]\s*",
        "",
        text,
    ).strip()
    text = re.sub(
        r"(?m)^\s*[（(][^）)]{0,80}(?:走到|走近|指向|看向|微笑|语气|轻声|轻快|挥手|停顿|动作|镜头|表情)[^）)]{0,80}[）)]\s*",
        "",
        text,
    ).strip()
    text = re.sub(r"^关于[“\"].{0,80}[”\"]，?\s*当前资料(?:显示|显示：|中显示：?)", "", text).strip()
    text = re.sub(r"^关于.{1,80}[，,:：]\s*", "", text).strip()
    text = re.sub(r"^根据(?:提供的)?(?:景区)?(?:资料库|资料|证据|信息)[，,:：]\s*", "", text).strip()
    text = re.sub(r"^根据.{0,20}(?:资料库|资料|证据|信息)[，,:：]\s*", "", text).strip()
    text = re.sub(r"^(?:资料|证据|信息)(?:显示|显示：|中显示：?)\s*", "", text).strip()
    text = re.sub(r"^当前资料(?:显示|显示：|中显示：?)\s*", "", text).strip()
    text = re.sub(
        r"\s*[（(][^（）()]{0,80}(?:联网搜索|来源|source|https?://)[^（）()]{0,220}[）)]\s*$",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    text = re.sub(
        r"\s*(?:来源|资料来源|信息来源)[:：]\s*(?:\[[^\]]+\]\([^)]*\)|https?://\S+|[^\n。]{1,160})\s*$",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    text = re.sub(r"\s*https?://\S+\s*$", "", text).strip()
    text = _ensure_complete_visitor_answer(text)
    return text


def _ensure_complete_visitor_answer(answer: str) -> str:
    text = answer.strip()
    if not text:
        return text
    if text[-1] in "，、；：:" or text.endswith(("如下", "包括", "可以看", "主要有", "分别是")):
        text = text.rstrip("，、；：:")
        return f"{text}。这里先把方位和核心看点看清楚，等你想继续时我再接着讲。"
    if text[-1] not in "。！？；”’）)》…" and len(re.sub(r"\s+", "", text)) > 12:
        return f"{text}。"
    return text


def _stabilize_entity_name(answer: str, classification: dict) -> str:
    names = [
        str(entity.get("name", "")).strip()
        for entity in (classification or {}).get("entities", [])
        if isinstance(entity, dict) and str(entity.get("name", "")).strip()
    ]
    if len(answer.strip()) < 12:
        return answer
    for name in dict.fromkeys(names):
        if name and name not in answer:
            return f"{name}最值得看的地方，{answer}"
    return answer


def _stabilize_vague_recommendation_answer(answer: str, question: str) -> str:
    compact_question = re.sub(r"\s+", "", question)
    compact_answer = re.sub(r"\s+", "", answer)
    culture_question = (
        ("灵山" in compact_question and "文化" in compact_question)
        or ("第一次" in compact_question and "理解" in compact_question)
        or ("初次" in compact_question and "理解" in compact_question)
    )
    if culture_question and not any(
        term in compact_answer for term in ("灵山", "文化", "大佛", "九龙灌浴")
    ):
        return f"第一次理解灵山文化，可以先抓住灵山大佛和九龙灌浴这条主线。{answer}"
    if any(term in compact_question for term in ("礼仪", "注意", "禁忌", "安全吗")):
        return answer
    photo_question = any(
        term in compact_question
        for term in ("出片", "拍照", "摄影", "打卡", "朋友圈", "发朋友圈")
    )
    if not photo_question:
        return answer
    if "拈花湾" in compact_question and not any(
        term in compact_answer for term in ("拈花湾", "花海", "五灯湖", "香月花街")
    ):
        return f"拈花湾想拍得有记忆点，我会优先推荐梵天花海、五灯湖和香月花街。{answer}"
    if not any(term in compact_answer for term in ("拍照", "摄影", "出片", "打卡", "花海", "梵宫")):
        return f"{answer} 如果你是想拍照出片，可以优先看梵宫、五印坛城和梵天花海。"
    return answer


def _mode_for_stream(settings: Settings) -> str:
    if settings.llm_mode == "mock":
        return "mock"
    if settings.llm_mode in {"disabled", "fallback"}:
        return "fallback"
    if not settings.llm_api_key:
        return "fallback"
    return settings.llm_mode


def _sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def _needs_web_supplement(classification: dict, contexts, question: str = "") -> bool:
    fact_keys = set(classification.get("fact_keys", []))
    if classification.get("intent") == "high_risk_realtime" and _is_conflict_check_question(question):
        return True
    if not fact_keys:
        if classification.get("intent") == "high_risk_realtime":
            return not _has_trusted_structured_fact_context(contexts)
        return False
    if "weather" in fact_keys:
        return True
    if classification.get("intent") == "high_risk_realtime" and _is_explicit_realtime_change_question(question):
        return True
    if classification.get("intent") not in {
        "scenic_fact",
        "mixed_emotional_fact",
        "high_risk_realtime",
        "external_factual",
    }:
        return False
    if _has_trusted_structured_fact_context(contexts):
        return False
    if any(
        context.source.section == "结构化标签"
        and context.source.source_type == "database"
        for context in contexts
    ):
        return False
    if _has_document_fact_evidence(classification, contexts):
        return False
    return True


def _has_trusted_structured_fact_context(contexts) -> bool:
    return any(
        context.source.section == "结构化事实"
        and context.source.source_type in {"database", "approved_web"}
        for context in contexts
    )


def _is_explicit_realtime_change_question(question: str) -> bool:
    compact = re.sub(r"\s+", "", question or "")
    realtime_terms = (
        "今天",
        "今日",
        "现在",
        "实时",
        "最新",
        "当天",
        "临时",
        "最近",
        "变了吗",
        "有变化",
        "变化吗",
        "调整了吗",
        "有没有调整",
        "还开放吗",
    )
    return any(term in compact for term in realtime_terms)


def _is_conflict_check_question(question: str) -> bool:
    compact = re.sub(r"\s+", "", question or "")
    conflict_terms = ("冲突", "不同来源", "来源不同", "差异", "不一致")
    return any(term in compact for term in conflict_terms)


def _has_realtime_web_context(contexts) -> bool:
    return any(context.source.source_type == "realtime_web" for context in contexts)


def _visible_sources(
    contexts,
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
):
    realtime_sources = [
        context.source
        for context in contexts
        if context.source.source_type == "realtime_web"
    ]
    if _is_external_realtime_question(classification) and realtime_sources:
        return realtime_sources
    if web_supplement_required and web_supplement_status == "success" and realtime_sources:
        curated_non_realtime = [
            context.source
            for context in _curated_evidence_contexts(contexts, classification)
            if context.source.source_type != "realtime_web"
        ]
        return realtime_sources + curated_non_realtime
    if (
        web_supplement_required
        and web_supplement_status != "success"
        and _is_external_realtime_question(classification)
    ):
        return realtime_sources
    return [context.source for context in _curated_evidence_contexts(contexts, classification)]


def _web_supplement_contexts(
    settings: Settings,
    question: str,
    classification: dict,
    web_supplement_required: bool,
):
    if not web_supplement_required:
        return [], "not_required"
    if settings.web_search_mode == "disabled":
        return [], "disabled"

    provider = get_web_search_provider(settings)
    saw_timeout = False
    saw_failure = False
    saw_untrusted_results = False
    for search_query in _web_search_queries(question, classification):
        try:
            results = provider.search(search_query, settings.web_search_timeout_seconds)
        except (TimeoutError, WebSearchTimeout):
            saw_timeout = True
            continue
        except Exception:
            saw_failure = True
            continue

        contexts = web_results_to_contexts(
            results,
            classification,
            settings.web_search_max_results,
        )
        if contexts:
            return contexts, "success"
        saw_untrusted_results = bool(results)

    if saw_untrusted_results:
        return [], "no_trusted_results"
    if saw_failure:
        return [], "failed"
    if saw_timeout:
        return [], "timeout"
    return [], "no_trusted_results"


def _web_search_queries(question: str, classification: dict) -> list[str]:
    entities = classification.get("entities", [])
    entity_names = [
        str(entity.get("name", "")).strip()
        for entity in entities
        if entity.get("entity_type") == "spot" and entity.get("name")
    ]
    if not entity_names:
        return [question]

    fact_terms = {
        "height_meters": "高度 官方",
        "opening_time": "开放时间 官方",
        "ticket": "门票 官方 票价",
        "visit_minutes": "游览时长 官方",
        "suitability": "适合人群 官方",
    }
    terms = [
        fact_terms[fact_key]
        for fact_key in classification.get("fact_keys", [])
        if fact_key in fact_terms
    ]
    if any(term in question for term in ["冲突", "不同来源", "差异"]):
        terms.append("冲突 不同来源")
    focused_query = " ".join(["灵山胜境", *entity_names, *terms]).strip()
    local_query = " ".join(["无锡", "灵山大佛景区", *entity_names, *terms]).strip()
    return list(dict.fromkeys([focused_query, local_query, question]))


def _fallback_answer(
    question: str,
    contexts,
    web_supplement_required: bool = False,
    classification: dict | None = None,
    web_supplement_status: str = "not_required",
) -> str:
    web_contexts = [
        context for context in contexts if context.source.source_type == "realtime_web"
    ]
    if web_contexts:
        primary = web_contexts[0].source
        reminder = _official_reminder(classification or {})
        conflict_note = ""
        if len({context.source.snippet for context in web_contexts}) > 1:
            conflict_note = "不同联网来源可能存在差异，建议以更高优先级来源为准。"
        return (
            f"我帮你查到的最新信息是：{primary.snippet}。"
            f"{conflict_note}{reminder}"
        )

    if web_supplement_required:
        if _is_external_realtime_question(classification or {}):
            status_text = _web_unavailable_text(web_supplement_status)
            advice = _external_realtime_unavailable_advice(classification or {})
            return (
                f"这个我现在不能替你确认最新版本，刚刚尝试联网时{status_text}。"
                f"{advice}"
            )
        return (
            "这个信息我现在不能直接确认，所以不乱说。"
            "如果涉及开放时间、票价或现场服务变化，建议你优先看景区官方公告，到了现场也可以问服务台。"
        )

    if not contexts:
        return "这个我还不能确定，先不硬编给你。你可以换个更具体的问题，比如问某个景点的看点、路线怎么安排，或者到现场问工作人员确认最新信息。"

    primary = _fallback_primary_source(question, contexts, classification or {})
    subject = primary.spot_name or primary.title
    subject_label = _friendly_subject_label(subject)
    if (classification or {}).get("intent") == "service" or any(word in question for word in ["老人", "孩子", "休息", "轻松"]):
        if "老人" in question:
            return (
                "带老人来玩，最重要的是别把行程排得太满。"
                f"如果你们正在{subject_label}附近，我会建议先确认休息点和返程动线，"
                "核心景点慢慢看，支线点位觉得累就果断少走一点。"
            )
        if any(word in question for word in ["孩子", "小朋友"]):
            return (
                "带孩子游览，可以把讲解拆成小故事，别连续塞太多文化信息。"
                f"如果你们在{subject_label}附近，建议穿插拍照、休息和互动感强的点位，孩子会更容易跟上。"
            )
        return (
            f"这类现场服务问题，我建议你先以舒适和安全为主。"
            f"如果你正在{subject_label}附近，可以先找好休息点或服务点，再决定要不要继续往下一个点走。"
        )
    snippet = _complete_fallback_snippet(primary.snippet)
    return f"{snippet}如果你正在{subject_label}附近，可以边看现场导览标识，边把这里留作一个重点停留点。"


def _fallback_primary_source(question: str, contexts, classification: dict):
    intent = classification.get("intent")
    entity_names = [
        str(entity.get("name") or "").strip()
        for entity in classification.get("entities") or []
        if isinstance(entity, dict) and str(entity.get("name") or "").strip()
    ]
    if intent == "scenic_explanation" or any(
        word in question
        for word in ("有什么", "看点", "特色", "故事", "讲解", "介绍", "了解", "拍照", "出片", "好玩")
    ):
        for section in ("景点简介", "资料片段", "结构化标签", "结构化事实"):
            for context in contexts:
                source = context.source
                if source.section != section:
                    continue
                haystack = " ".join(
                    [
                        source.spot_name or "",
                        source.title or "",
                        source.snippet or "",
                    ]
                )
                if any(name in haystack for name in entity_names):
                    return source
        if any(word in question for word in ("晚上", "夜间", "夜景", "夜游", "灯光")):
            for context in contexts:
                source = context.source
                haystack = f"{source.title} {source.snippet}"
                if any(word in haystack for word in ("夜间", "夜景", "灯光", "灯光秀", "夜游")):
                    return source
        if any(word in question for word in ("拍照", "出片", "合影", "照片", "打卡")):
            for context in contexts:
                source = context.source
                haystack = f"{source.title} {source.snippet}"
                if any(word in haystack for word in ("拍照", "出片", "合影", "打卡", "取景")):
                    return source
        for section in ("景点简介", "资料片段", "结构化标签"):
            for context in contexts:
                if context.source.section == section:
                    return context.source
        for context in contexts:
            if context.source.section != "结构化事实":
                return context.source
    return contexts[0].source


def _complete_fallback_snippet(snippet: str, max_chars: int = 190) -> str:
    text = re.sub(r"\s+", " ", (snippet or "").strip())
    text = re.sub(r"^[A-Z]{2}-\d{3}[-－][^\s#]+[#\s]*", "", text).strip()
    if not text:
        return ""
    if len(text) > max_chars:
        text = text[:max_chars]
    last_stop = max(text.rfind(mark) for mark in ("。", "！", "？", "；"))
    if last_stop >= 45:
        text = text[: last_stop + 1]
    else:
        text = text.rstrip("，、；：:“‘《（(")
        if text[-1:] not in "。！？；":
            text += "。"
    if text[-1:] not in "。！？；":
        text += "。"
    return text


def _friendly_subject_label(subject: str) -> str:
    cleaned = (subject or "").strip()
    cleaned = re.sub(r"^[A-Z]{2}-\d{3}[-－]", "", cleaned).strip()
    if not cleaned:
        return "当前区域"
    if len(cleaned) > 16 or "：" in cleaned or ":" in cleaned:
        return "当前区域"
    return cleaned


def _official_reminder(classification: dict) -> str:
    fact_keys = set(classification.get("fact_keys", []))
    if classification.get("intent") == "high_risk_realtime" or fact_keys.intersection(
        {"opening_time", "ticket"}
    ):
        return "涉及开放时间、票价或现场服务变化时，请以景区官方公告或现场工作人员说明为准。"
    return ""


def _is_external_realtime_question(classification: dict) -> bool:
    if classification.get("entities"):
        return False
    return classification.get("intent") == "high_risk_realtime"


def _web_unavailable_text(status: str) -> str:
    return {
        "disabled": "联网搜索当前未启用",
        "timeout": "联网搜索超时，暂时没有拿到可引用结果",
        "failed": "联网搜索调用失败，暂时没有拿到可引用结果",
        "no_trusted_results": "暂时没有拿到可引用的联网结果",
    }.get(status, "暂时没有拿到可引用的联网结果")


def _external_realtime_unavailable_advice(classification: dict) -> str:
    fact_keys = set(classification.get("fact_keys", []))
    if "weather" in fact_keys:
        return (
            "建议您打开手机天气应用或权威天气网站查看最新预报；"
            "如果准备游览灵山胜境，也可以根据天气准备防晒、雨具和舒适鞋服。"
        )
    if "ticket" in fact_keys:
        return "建议您优先查看景区官方购票渠道、公众号或现场售票处公布的最新票务信息。"
    if "opening_time" in fact_keys:
        return "建议您优先查看景区官方公告、公众号或现场服务台公布的最新开放时间。"
    return "建议您优先查看官方渠道或现场服务台公布的最新信息。"


def _store_web_fact_candidates(
    db: Session,
    question: str,
    answer: str,
    classification: dict,
    contexts,
) -> None:
    for context in contexts:
        source = context.source
        if source.source_type != "realtime_web":
            continue
        fact_key = _web_fact_candidate_fact_key(question, answer, classification, context)
        fact_value = _web_fact_candidate_value(context)
        source_url = (source.source_url or "").strip()
        if not fact_value or not source_url:
            continue
        if _web_fact_candidate_exists(
            db,
            entity_id="",
            fact_key=fact_key,
            source_url=source_url,
        ):
            continue
        db.add(
            WebFactCandidate(
                entity_type="web_fact",
                entity_id="",
                entity_name="",
                fact_key=fact_key,
                fact_value=fact_value,
                source_url=source_url,
                source_level=source.source_level or "ordinary",
                question=question,
                answer_excerpt=(
                    answer
                    if "基于联网搜索" in answer
                    else f"基于联网搜索：{answer}"
                )[:500],
                status="pending_review",
            )
        )


def _web_fact_candidate_fact_key(
    question: str,
    answer: str,
    classification: dict,
    context,
) -> str:
    for fact_key in classification.get("fact_keys", []):
        if fact_key:
            return str(fact_key)

    evidence_text = " ".join(
        [
            question or "",
            answer or "",
            context.text or "",
            context.source.title or "",
            context.source.snippet or "",
        ]
    )
    for fact_key, terms in WEB_FACT_KEY_RULES:
        if any(term in evidence_text for term in terms):
            return fact_key
    return "web_supplement"


def _web_fact_candidate_value(context) -> str:
    value = (context.source.snippet or "").strip()
    if value:
        return value[:800]
    return (context.text or "").strip()[:800]


def _web_fact_candidate_exists(
    db: Session,
    entity_id: str,
    fact_key: str,
    source_url: str,
) -> bool:
    return bool(
        db.scalar(
            select(WebFactCandidate.id)
            .where(
                WebFactCandidate.entity_id == entity_id,
                WebFactCandidate.fact_key == fact_key,
                WebFactCandidate.source_url == source_url,
            )
            .limit(1)
        )
    )


def _has_document_fact_evidence(classification: dict, contexts) -> bool:
    fact_keys = classification.get("fact_keys", [])
    entities = classification.get("entities", [])
    entity_names = [entity.get("name", "") for entity in entities if entity.get("name")]
    for context in contexts:
        if context.source.source_type != "document":
            continue
        evidence_text = " ".join([context.text or "", context.source.snippet or ""])
        if any(_document_has_fact_evidence(evidence_text, fact_key, entity_names) for fact_key in fact_keys):
            return True
    return False


def _document_has_fact_evidence(text: str, fact_key: str, entity_names: list[str]) -> bool:
    if fact_key == "ticket":
        evidence_terms = ["成人票", "半价票", "免票", "票种"]
        has_value = any(term in text for term in evidence_terms) and bool(re.search(r"\d+\s*元", text))
    elif fact_key == "opening_time":
        has_value = bool(re.search(r"\d{1,2}[:：]\d{2}", text)) and _text_has_fact_terms(text, fact_key)
    else:
        has_value = _text_has_fact_terms(text, fact_key)

    if not has_value:
        return False
    if not entity_names:
        return True
    return any(_has_nearby_fact_value(text, entity_name) for entity_name in entity_names)


def _has_nearby_fact_value(text: str, entity_name: str, window: int = 160) -> bool:
    for match in re.finditer(re.escape(entity_name), text):
        nearby = text[match.start() : match.end() + window]
        if re.search(r"\d+\s*元", nearby) or re.search(r"\d{1,2}[:：]\d{2}", nearby):
            return True
    return False


def _text_has_fact_terms(text: str, fact_key: str) -> bool:
    return any(term in text for term in FACT_EVIDENCE_TERMS.get(fact_key, []))


def _answer_style_for_classification(classification: dict) -> str:
    intent = classification.get("intent")
    if intent == "scenic_fact":
        return "fact"
    if intent == "service":
        return "service"
    if intent in {"mixed_emotional_fact", "unknown"}:
        return "service" if classification.get("emotional") else "guide"
    return "guide"


def _evidence_profile(classification: dict, contexts) -> str:
    if not contexts:
        return "empty"
    sections = {context.source.section for context in contexts}
    source_types = {context.source.source_type for context in contexts}
    if "基于联网搜索" in sections or "realtime_web" in source_types:
        return "realtime"
    if "结构化事实" in sections:
        return "structured_fact"
    if "结构化标签" in sections:
        return "structured_tag"
    if classification.get("intent") == "service":
        return "service_advice"
    if "资料片段" in sections:
        return "document"
    return "mixed"


def _system_prompt() -> str:
    return (
        "你是“灵诗音”，灵山胜境景区 AI 数字人导游。"
        "你的表达要像一位温柔、熟悉景区、有现场经验的真人导游，而不是资料检索机器人。"
        "你可以有一点自己的导游性格：亲切、稳、会替游客考虑体力和现场体验，但不要卖萌。"
        "游客表达紧张、第一次来、带老人孩子时，允许亲切安抚，但不要过度煽情。"
        "只允许基于提供的事实证据回答景区事实，不能编造证据之外的景区事实。"
        "数据库证据优先；如果数据库证据与联网或文档证据冲突，说明差异并以数据库证据为主。"
        "涉及开放时间、票价、安全、实时状态等高风险信息时，提醒以官方公告或现场说明为准。"
        "如果没有足够事实证据，不要假装知道；要自然地说“这个我现在不能替你确认，先不乱说”。"
        "允许给游览节奏、拍照角度、停留方式等现场建议，但不能改变或补充事实证据之外的景区事实。"
        "如果游客只是问景点、看点、拍照、老人建议，不要主动规划路线，也不要说已生成路线。"
        "回答要自然、简洁，适合游客现场听。绝对不要用“关于……当前资料显示”“根据资料”“资料显示”等机械开头。"
    )


def _user_prompt(
    question: str,
    contexts,
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
    route_focus_instruction: str = "",
    persona: dict | None = None,
) -> str:
    return (
        f"【游客问题】{question}\n\n"
        f"【问题分类】\n{json.dumps(classification, ensure_ascii=False)}\n\n"
        f"【游客情绪】\n{_emotion_text(classification)}\n\n"
        f"{route_focus_instruction}"
        f"{persona_prompt(persona)}"
        f"【事实证据】\n{_evidence_text(contexts, classification)}\n\n"
        f"{_entity_name_instruction(classification)}"
        f"{_vague_recommendation_instruction(question, contexts, classification)}"
        "【来源规则】\n"
        "- source_type=database 表示景区资料库，事实优先级最高。\n"
        "- source_type=approved_web 表示已审核联网补充，只能作为补充。\n"
        "- source_type=document 表示讲解文档片段，用于故事、背景和原因解释。\n"
        "- source_type=realtime_web 表示实时联网搜索；来源会由前端来源卡片展示，正文不要写网址、来源括号或“基于联网搜索”尾注。\n\n"
        "【冲突处理】\n"
        "如果不同来源冲突，数据库证据优先；同时说明其他来源存在差异，提醒游客以官方公告或现场说明为准。\n\n"
        f"【联网补充】\n{_web_supplement_text(web_supplement_required, web_supplement_status)}\n\n"
        f"{_answer_format_instruction(question)}"
        "如果是服务建议问题，可以结合证据给出温和、务实的游览节奏建议。"
        "如果游客问“哪里比较出片/建筑感强/适合老人慢慢逛”等模糊推荐，可以点名 2 到 3 个景点并说明理由，但不要生成路线。"
        "如果游客问事实数值，先直接给数值，再补一句现场观看建议。"
        "不要在正文末尾追加括号来源、资料来源、URL 或联网搜索说明；也不要用“关于……当前资料显示”“根据资料”“资料显示”开头。"
    )


def _answer_format_instruction(question: str) -> str:
    compact = re.sub(r"\s+", "", question)
    if (
        compact.startswith("请讲解当前景点")
        and "五到六句自然口语" in compact
    ):
        return (
            "【场景逐句讲解格式】\n"
            "- 这是切换景点后自动播放的现场讲解，必须输出 5 或 6 个完整中文句子。\n"
            "- 依次讲整体形象、局部细节、一个事实、故事或文化含义、现场观看动作；证据充足时再补一个容易忽略的看点。\n"
            "- 每句控制在 18 到 34 个汉字，用句号分隔；不要标题、列表、换行或同义重复。\n"
            "- 不要套用普通聊天的 2 到 4 句长度。\n\n"
        )
    return "请输出一段直接回答，2 到 4 句即可：先回应游客，再讲重点，再给一个现场建议。"


def _entity_name_instruction(classification: dict) -> str:
    names = [
        str(entity.get("name", "")).strip()
        for entity in (classification or {}).get("entities", [])
        if isinstance(entity, dict) and str(entity.get("name", "")).strip()
    ]
    if not names:
        return ""
    deduped_names = list(dict.fromkeys(names))[:2]
    return (
        "【景点名稳定性要求】\n"
        f"- 游客明确问到了：{'、'.join(deduped_names)}。回答第一句请保留这个景点名，不要只用“它/这里”代替。\n\n"
    )


def _vague_recommendation_instruction(
    question: str,
    contexts,
    classification: dict,
) -> str:
    intent = str((classification or {}).get("intent", ""))
    if intent not in {"scenic_explanation", "unknown", "service"}:
        return ""

    compact = re.sub(r"\s+", "", question)
    lines: list[str] = []
    if any(term in compact for term in ("建筑感", "建筑", "空间", "艺术")):
        lines.append(
            "- 这题是“建筑感/空间感”推荐，回答开头请直接点名 1 到 2 个建筑代表点，优先使用证据里的“梵宫”或“五印坛城”；不要只泛泛说氛围。"
        )
    if any(term in compact for term in ("朋友圈", "发朋友圈", "出片", "拍照", "摄影", "打卡")):
        if "拈花湾" in compact:
            lines.append(
                "- 这题是拈花湾拍照/朋友圈推荐，回答开头请明确说“拈花湾”，并优先点名“梵天花海、五灯湖、香月花街”中的 1 到 2 个。"
            )
        else:
            lines.append(
                "- 这题是拍照/出片推荐，回答开头请直接点名 2 到 3 个适合拍照的景点，再说为什么适合拍。"
            )
    if not lines:
        return ""
    spot_names = [
        context.source.spot_name
        for context in _curated_evidence_contexts(contexts, classification)
        if context.source.spot_name
    ]
    if spot_names:
        deduped_names = list(dict.fromkeys(spot_names))[:4]
        lines.append(f"- 当前证据中可优先参考的景点名：{'、'.join(deduped_names)}。")
    return "【模糊推荐稳定性要求】\n" + "\n".join(lines) + "\n\n"


def _web_supplement_text(web_supplement_required: bool, status: str) -> str:
    if not web_supplement_required:
        return "当前证据足够，不要自行联网或编造补充事实。"
    if status == "success":
        return "已使用实时联网搜索补充事实；正文自然回答即可，来源和网址由前端来源卡片展示。"
    return "需要联网补充事实，但当前未取得可信联网结果；不要编造补充事实。"


def _evidence_text(contexts, classification: dict | None = None) -> str:
    curated = _curated_evidence_contexts(contexts, classification)
    if not curated:
        return "当前没有可用事实证据。"
    grouped: dict[str, list[str]] = {}
    for context in curated:
        source = context.source
        section = source.section or "资料片段"
        label = source.spot_name or source.title or "通用资料"
        snippet = _compact_evidence_snippet(source.snippet)
        if not snippet:
            continue
        grouped.setdefault(section, []).append(
            f"- {label}｜{source.source_type}｜{snippet}"
        )
    if not grouped:
        return "当前没有可用事实证据。"
    blocks = []
    for section, rows in grouped.items():
        blocks.append(f"【{section}】\n" + "\n".join(rows[:3]))
    return "\n\n".join(blocks)


def _curated_evidence_contexts(contexts, classification: dict | None = None) -> list:
    if not contexts:
        return []
    ordered_contexts = sorted(
        contexts,
        key=lambda context: _evidence_sort_key(context, classification),
    )
    curated = []
    seen: set[tuple[str, str, str]] = set()
    section_counts: dict[str, int] = {}
    max_total = _max_evidence_count(classification)
    for context in ordered_contexts:
        source = context.source
        if _is_internal_route_source(source):
            continue
        snippet = _compact_evidence_snippet(source.snippet)
        if not snippet:
            continue
        key = (source.source_type or "", source.spot_name or "", snippet)
        if key in seen:
            continue
        section = source.section or "资料片段"
        if section_counts.get(section, 0) >= _section_limit(section, classification):
            continue
        seen.add(key)
        section_counts[section] = section_counts.get(section, 0) + 1
        curated.append(context)
        if len(curated) >= max_total:
            break
    return curated


def _max_evidence_count(classification: dict | None) -> int:
    intent = (classification or {}).get("intent")
    if intent == "scenic_fact":
        return 4
    if intent == "service":
        return 5
    return 5


def _section_limit(section: str, classification: dict | None) -> int:
    intent = (classification or {}).get("intent")
    if section == "结构化事实":
        return 3
    if section == "结构化标签":
        return 2 if intent == "service" else 1
    if section == "景点简介":
        return 2
    if section == "资料片段":
        return 3
    if section == "基于联网搜索":
        return 2
    return 2


def _is_internal_route_source(source: KnowledgeSource) -> bool:
    title = (source.title or "").strip()
    spot_name = (source.spot_name or "").strip()
    section = (source.section or "").strip()
    internal_names = {"景区入口", "路线起点"}
    return title in internal_names or spot_name in internal_names or section in internal_names


def _compact_evidence_snippet(snippet: str, limit: int = 160) -> str:
    compact = " ".join((snippet or "").split())
    compact = re.sub(r"^(?:根据资料|资料显示|当前资料显示)[:：，,\s]*", "", compact)
    return compact[:limit]


def _evidence_sort_key(context, classification: dict | None = None) -> tuple[int, int, int, str]:
    source = context.source
    fact_keys = set((classification or {}).get("fact_keys") or [])
    entity_names = {
        str(entity.get("name", "")).strip()
        for entity in (classification or {}).get("entities", [])
        if entity.get("name")
    }
    entity_rank = 0 if source.spot_name and source.spot_name in entity_names else 1
    fact_rank = 0 if _context_has_requested_fact_evidence(context, classification, list(entity_names)) else 1
    if "suitability" in fact_keys and source.section == "结构化标签":
        priority = -1
    elif source.section == "结构化事实" and source.source_type == "database":
        priority = 0
    elif source.section == "结构化事实":
        priority = 1
    elif source.section == "结构化标签":
        priority = 2
    elif source.source_type == "database" and source.spot_name:
        priority = 3
    elif source.source_type == "document":
        priority = 4
    elif source.source_type == "realtime_web":
        priority = 5
    else:
        priority = 6
    return (priority, fact_rank, entity_rank, source.spot_name or source.title)


def _context_has_requested_fact_evidence(context, classification: dict | None, entity_names: list[str]) -> bool:
    if not classification or context.source.source_type != "document":
        return False
    evidence_text = " ".join([context.text or "", context.source.snippet or ""])
    return any(
        _document_has_fact_evidence(evidence_text, fact_key, entity_names)
        for fact_key in classification.get("fact_keys", [])
    )


def _emotion_text(classification: dict) -> str:
    if classification.get("emotional"):
        return "游客表达了情绪或第一次到访等体验信息，可以简短安抚。"
    return "未识别到需要特别安抚的情绪。"
