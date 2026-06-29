import json
import re
from time import perf_counter
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import ChatMessage, ChatSession, WebFactCandidate
from app.schemas import ChatMetrics, ChatRequest, ChatResponse
from app.services.mimo import MimoClient
from app.services.question_classifier import classify_question
from app.services.rag import retrieve_context
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


def answer_chat(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    tts_jobs: TtsJobStore | None = None,
) -> ChatResponse:
    total_started = perf_counter()
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
    retrieval_started = perf_counter()
    contexts = retrieve_context(db, request.question, request.spot_id, classification=classification)
    retrieval_ms = _elapsed_ms(retrieval_started)
    web_supplement_required = _needs_web_supplement(classification, contexts)
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
    answer, mode, degraded = _answer_text(
        settings,
        request.question,
        contexts,
        classification,
        web_supplement_required,
        web_supplement_status,
    )
    llm_ms = _elapsed_ms(llm_started)
    audio_url, tts_status, tts_job_id = None, "disabled", None
    tts_ms = 0.0
    _store_web_fact_candidates(db, request.question, answer, classification, contexts)
    metrics = ChatMetrics(
        retrieval_ms=retrieval_ms,
        llm_ms=llm_ms,
        tts_ms=tts_ms,
        total_ms=_elapsed_ms(total_started),
        cache_hit=False,
        degraded=degraded,
        classification=classification,
        web_supplement_required=web_supplement_required,
        web_supplement_status=web_supplement_status,
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
    )


def stream_chat_events(
    db: Session,
    settings: Settings,
    request: ChatRequest,
    tts_jobs: TtsJobStore | None = None,
):
    total_started = perf_counter()
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
    retrieval_started = perf_counter()
    contexts = retrieve_context(db, request.question, request.spot_id, classification=classification)
    retrieval_ms = _elapsed_ms(retrieval_started)
    web_supplement_required = _needs_web_supplement(classification, contexts)
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
    for chunk in _answer_text_chunks(
        settings,
        request.question,
        contexts,
        classification,
        web_supplement_required,
        web_supplement_status,
        stream_state,
    ):
        answer_parts.append(chunk)
        yield _sse("delta", {"text": chunk})
    answer = _clean_visitor_answer("".join(answer_parts))
    llm_ms = _elapsed_ms(llm_started)

    mode = stream_state["mode"]
    degraded = stream_state["degraded"]
    audio_url, tts_status, tts_job_id = None, "disabled", None
    tts_ms = 0.0
    _store_web_fact_candidates(db, request.question, answer, classification, contexts)
    metrics = ChatMetrics(
        retrieval_ms=retrieval_ms,
        llm_ms=llm_ms,
        tts_ms=tts_ms,
        total_ms=_elapsed_ms(total_started),
        cache_hit=False,
        degraded=degraded,
        classification=classification,
        web_supplement_required=web_supplement_required,
        web_supplement_status=web_supplement_status,
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
    )
    yield _sse("final", response.model_dump())


def _elapsed_ms(started_at: float) -> float:
    return round((perf_counter() - started_at) * 1000, 2)


def _update_session_profile(chat_session: ChatSession, profile: dict) -> None:
    visitor_type = str(profile.get("visitor_type", "")).strip()
    preference = str(profile.get("preference", "")).strip()
    if visitor_type:
        chat_session.visitor_type = visitor_type
    if preference:
        chat_session.preference = preference


def _answer_text(
    settings: Settings,
    question: str,
    contexts,
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
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
        answer = client.chat_completion(
            model=settings.llm_model,
            system_prompt=_system_prompt(),
            user_prompt=_user_prompt(
                question,
                contexts,
                classification,
                web_supplement_required,
                web_supplement_status,
            ),
        )
        return _clean_visitor_answer(answer), settings.llm_mode, False
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
        for chunk in client.chat_completion_stream(
            model=settings.llm_model,
            system_prompt=_system_prompt(),
            user_prompt=_user_prompt(
                question,
                contexts,
                classification,
                web_supplement_required,
                web_supplement_status,
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
    return text


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


def _needs_web_supplement(classification: dict, contexts) -> bool:
    if not classification.get("fact_keys"):
        return False
    if classification.get("intent") not in {
        "scenic_fact",
        "mixed_emotional_fact",
        "high_risk_realtime",
        "external_factual",
    }:
        return False
    if any(
        context.source.section == "结构化事实"
        and context.source.source_type in {"database", "approved_web"}
        for context in contexts
    ):
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
    if (
        web_supplement_required
        and web_supplement_status != "success"
        and _is_external_realtime_question(classification)
    ):
        return realtime_sources
    return [context.source for context in contexts]


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
            f"基于联网搜索：{primary.snippet}"
            f" 来源：{primary.source_url}。"
            f"{conflict_note}{reminder}"
        )

    if web_supplement_required:
        if _is_external_realtime_question(classification or {}):
            status_text = _web_unavailable_text(web_supplement_status)
            advice = _external_realtime_unavailable_advice(classification or {})
            return (
                f"关于“{question}”，我已经尝试进行联网查询，"
                f"但{status_text}。{advice}"
            )
        return (
            f"关于“{question}”，当前景区资料库里没有找到可直接确认的结构化事实。"
            "这个问题适合进入联网补充流程，并在回答中标注来源网址；"
            "在联网补充完成前，建议以景区官方公告或现场工作人员说明为准。"
        )

    if not contexts:
        return "当前资料中没有找到确切信息，建议咨询景区工作人员获取最新说明。"

    primary = contexts[0].source
    subject = primary.spot_name or primary.title
    return (
        f"关于“{question}”，当前资料显示：{primary.snippet}"
        f"。如果你正在游览{subject}，可以结合现场导览标识安排停留时间。"
    )


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
    entities = classification.get("entities", [])
    fact_keys = classification.get("fact_keys", [])
    if not entities or not fact_keys:
        return

    entity = entities[0]
    fact_key = fact_keys[0]
    for context in contexts:
        source = context.source
        if source.source_type != "realtime_web":
            continue
        db.add(
            WebFactCandidate(
                entity_type=str(entity.get("entity_type", "spot")),
                entity_id=str(entity.get("entity_id", "")),
                entity_name=str(entity.get("name", "")),
                fact_key=str(fact_key),
                fact_value=source.snippet,
                source_url=source.source_url,
                source_level=source.source_level,
                question=question,
                answer_excerpt=answer[:500],
                status="pending_review",
            )
        )


def _has_document_fact_evidence(classification: dict, contexts) -> bool:
    fact_keys = classification.get("fact_keys", [])
    entities = classification.get("entities", [])
    entity_names = [entity.get("name", "") for entity in entities if entity.get("name")]
    for context in contexts:
        if context.source.source_type != "document":
            continue
        if any(_document_has_fact_evidence(context.text, fact_key, entity_names) for fact_key in fact_keys):
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


def _system_prompt() -> str:
    return (
        "你是“游知灵”景区 AI 数字人导游。"
        "只允许基于提供的事实证据回答景区事实，不能编造证据之外的景区事实。"
        "数据库证据优先；如果数据库证据与联网或文档证据冲突，说明差异并以数据库证据为主。"
        "涉及开放时间、票价、安全、实时状态等高风险信息时，提醒以官方公告或现场说明为准。"
        "如果没有足够事实证据，不要假装知道；可以说明需要联网补充。"
        "允许亲切安抚游客情绪，但不能改变或补充事实证据之外的景区事实。"
        "回答要自然、简洁，适合游客现场听。"
    )


def _user_prompt(
    question: str,
    contexts,
    classification: dict,
    web_supplement_required: bool,
    web_supplement_status: str,
) -> str:
    return (
        f"【游客问题】{question}\n\n"
        f"【问题分类】\n{json.dumps(classification, ensure_ascii=False)}\n\n"
        f"【游客情绪】\n{_emotion_text(classification)}\n\n"
        f"【事实证据】\n{_evidence_text(contexts)}\n\n"
        "【来源规则】\n"
        "- source_type=database 表示景区资料库，事实优先级最高。\n"
        "- source_type=approved_web 表示已审核联网补充，只能作为补充。\n"
        "- source_type=document 表示讲解文档片段，用于故事、背景和原因解释。\n"
        "- source_type=realtime_web 表示实时联网搜索；来源会由前端来源卡片展示，正文不要写网址、来源括号或“基于联网搜索”尾注。\n\n"
        "【冲突处理】\n"
        "如果不同来源冲突，数据库证据优先；同时说明其他来源存在差异，提醒游客以官方公告或现场说明为准。\n\n"
        f"【联网补充】\n{_web_supplement_text(web_supplement_required, web_supplement_status)}\n\n"
        "请输出一段直接回答，并给出一个实用游览建议。不要在正文末尾追加括号来源、资料来源、URL 或联网搜索说明。"
    )


def _web_supplement_text(web_supplement_required: bool, status: str) -> str:
    if not web_supplement_required:
        return "当前证据足够，不要自行联网或编造补充事实。"
    if status == "success":
        return "已使用实时联网搜索补充事实；正文自然回答即可，来源和网址由前端来源卡片展示。"
    return "需要联网补充事实，但当前未取得可信联网结果；不要编造补充事实。"


def _evidence_text(contexts) -> str:
    if not contexts:
        return "当前没有可用事实证据。"
    return "\n\n".join(
        "\n".join(
            [
                f"- title={context.source.title}",
                f"- spot_name={context.source.spot_name or '通用资料'}",
                f"- section={context.source.section}",
                f"- source_type={context.source.source_type}",
                f"- source_url={context.source.source_url or ''}",
                f"- snippet={context.source.snippet}",
            ]
        )
        for context in contexts
    )


def _emotion_text(classification: dict) -> str:
    if classification.get("emotional"):
        return "游客表达了情绪或第一次到访等体验信息，可以简短安抚。"
    return "未识别到需要特别安抚的情绪。"
