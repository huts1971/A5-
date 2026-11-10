from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, replace
import hashlib
import re
from time import perf_counter

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    ApprovedWebFact,
    EntityAlias,
    KnowledgeChunk,
    KnowledgeChunkEmbedding,
    KnowledgeDoc,
    MapPoint,
    ScenicSpot,
    SpotFact,
    TagAlias,
)
from app.schemas import KnowledgeSource
from app.services.embeddings import EmbeddingClient, cosine_similarity
from app.services.map_point_types import ROUTEABLE_MAP_POINT_TYPES
from app.services.rag_index import build_fts_query, ensure_knowledge_fts_schema, searchable_text


CHINESE_STOP_TERMS = {
    "什么",
    "有什么",
    "看点",
    "特色",
    "适合",
    "哪里",
    "怎么",
    "比较",
    "可以",
    "请问",
    "介绍",
    "一个",
    "吗",
    "呢",
}

SOURCE_PRIORITY = {
    "database": 100,
    "approved_web": 88,
    "document": 50,
    "realtime_web": 20,
}

STRUCTURED_FACT_SECTION = "结构化事实"
STRUCTURED_TAG_SECTION = "结构化标签"
SPOT_OVERVIEW_SECTION = "景点简介"
DOCUMENT_CHUNK_SECTION = "资料片段"
VECTOR_QUERY_CACHE_SIZE = 64
VECTOR_ENABLED_INTENTS = {
    "scenic_explanation",
    "mixed_emotional_fact",
    "unknown",
}
VECTOR_SKIP_INTENTS = {
    "casual",
    "route",
    "high_risk_realtime",
    "external_factual",
}
VECTOR_HELPFUL_TERMS = (
    "出片",
    "拍照",
    "摄影",
    "打卡",
    "朋友圈",
    "发朋友圈",
    "好看",
    "建筑感",
    "建筑",
    "自然",
    "休闲",
    "放松",
    "第一次",
    "初次",
    "理解",
    "文化",
    "看点",
    "特色",
    "故事",
    "老人",
    "孩子",
    "小朋友",
    "慢慢",
    "少走",
    "轻松",
)

_QUERY_EMBEDDING_CACHE: OrderedDict[tuple[str, str], list[float]] = OrderedDict()
_RETRIEVAL_CACHE: OrderedDict[tuple, tuple[float, list["RetrievedContext"], "RetrievalMetrics"]] = OrderedDict()


@dataclass(frozen=True)
class RetrievedContext:
    source: KnowledgeSource
    text: str


@dataclass(frozen=True)
class RetrievalMetrics:
    retrieval_mode: str
    context_count: int
    fts_ms: float = 0
    embedding_ms: float = 0
    rerank_ms: float = 0
    vector_status: str = "disabled"
    retrieval_cache_hit: bool = False
    embedding_cache_hit: bool = False


@dataclass(frozen=True)
class _ScoredCandidate:
    context: RetrievedContext
    score: float


def retrieve_context(
    db: Session,
    question: str,
    spot_id: str | None = None,
    top_k: int = 4,
    classification: dict | None = None,
    settings: Settings | None = None,
) -> list[RetrievedContext]:
    contexts, _ = retrieve_context_with_metrics(
        db,
        question,
        spot_id=spot_id,
        top_k=top_k,
        classification=classification,
        settings=settings,
    )
    return contexts


def retrieve_context_with_metrics(
    db: Session,
    question: str,
    spot_id: str | None = None,
    top_k: int = 4,
    classification: dict | None = None,
    settings: Settings | None = None,
) -> tuple[list[RetrievedContext], RetrievalMetrics]:
    mode = (settings.rag_retrieval_mode if settings else "hybrid").strip().lower()
    if mode == "keyword":
        contexts = _retrieve_keyword(db, question, spot_id, top_k, classification)
        return contexts, RetrievalMetrics(
            retrieval_mode="keyword",
            context_count=len(contexts),
            vector_status="disabled",
        )

    cache_key = _retrieval_cache_key(question, spot_id, top_k, classification, settings)
    cached = _get_retrieval_cache(cache_key, settings)
    if cached is not None:
        contexts, metrics = cached
        return contexts, metrics

    contexts, metrics = _retrieve_hybrid(
        db,
        question,
        spot_id=spot_id,
        top_k=top_k,
        classification=classification,
        settings=settings,
    )
    _set_retrieval_cache(cache_key, contexts, metrics, classification, settings)
    return contexts, metrics


def _retrieve_hybrid(
    db: Session,
    question: str,
    spot_id: str | None,
    top_k: int,
    classification: dict | None,
    settings: Settings | None,
) -> tuple[list[RetrievedContext], RetrievalMetrics]:
    fts_started = perf_counter()
    fts_candidates = _filter_scoped_pairs(
        db,
        _fts_candidates(db, question, classification),
        spot_id,
    )
    fts_ms = _elapsed_ms(fts_started)

    embedding_started = perf_counter()
    vector_candidates, vector_status, embedding_cache_hit = _vector_candidates(
        db,
        question,
        classification,
        settings,
    )
    vector_candidates = _filter_scoped_pairs(db, vector_candidates, spot_id)
    embedding_ms = _elapsed_ms(embedding_started)

    rerank_started = perf_counter()
    scored: list[_ScoredCandidate] = []
    scored.extend(
        _score_structured_candidates(
            db,
            question,
            spot_id,
            classification,
        )
    )
    scored.extend(
        _score_spot_candidates(
            db,
            question,
            spot_id,
            classification,
        )
    )
    scored.extend(
        _score_reviewed_web_fact_candidates(
            db,
            question,
            spot_id,
            classification,
        )
    )
    scored.extend(
        _ScoredCandidate(
            context=candidate,
            score=_final_score(
                question,
                candidate,
                spot_id,
                classification,
                keyword_score=fts_score,
            ),
        )
        for candidate, fts_score in fts_candidates
    )
    scored.extend(
        _ScoredCandidate(
            context=candidate,
            score=_final_score(
                question,
                candidate,
                spot_id,
                classification,
                keyword_score=_score(question, candidate.text) * 16,
            ),
        )
        for candidate in _filter_scoped_contexts(
            db,
            _legacy_keyword_candidates(db, question, spot_id),
            spot_id,
        )
    )
    scored.extend(
        _ScoredCandidate(
            context=candidate,
            score=_final_score(
                question,
                candidate,
                spot_id,
                classification,
                vector_score=vector_score,
            ),
        )
        for candidate, vector_score in vector_candidates
    )

    contexts = _dedupe_and_limit(scored, top_k, classification)
    rerank_ms = _elapsed_ms(rerank_started)
    return contexts, RetrievalMetrics(
        retrieval_mode="hybrid",
        context_count=len(contexts),
        fts_ms=fts_ms,
        embedding_ms=embedding_ms,
        rerank_ms=rerank_ms,
        vector_status=vector_status,
        embedding_cache_hit=embedding_cache_hit,
    )


def _retrieval_cache_key(
    question: str,
    spot_id: str | None,
    top_k: int,
    classification: dict | None,
    settings: Settings | None,
) -> tuple:
    entities = tuple(
        sorted(
            str(entity.get("entity_id", ""))
            for entity in (classification or {}).get("entities", [])
            if isinstance(entity, dict)
        )
    )
    fact_keys = tuple(sorted(str(item) for item in (classification or {}).get("fact_keys", [])))
    return (
        "retrieval-v1",
        _normalize_embedding_query(question),
        spot_id or "",
        top_k,
        (classification or {}).get("intent", ""),
        entities,
        fact_keys,
        settings.rag_retrieval_mode if settings else "hybrid",
        settings.rag_vector_mode if settings else "",
        settings.rag_embedding_model if settings else "",
        settings.database_url if settings else "",
        settings.source_package_path if settings else "",
        settings.derived_knowledge_path if settings else "",
    )


def _get_retrieval_cache(
    cache_key: tuple,
    settings: Settings | None,
) -> tuple[list[RetrievedContext], RetrievalMetrics] | None:
    if settings is None or settings.guide_retrieval_cache_ttl_seconds <= 0:
        return None
    cached = _RETRIEVAL_CACHE.get(cache_key)
    if cached is None:
        return None
    cached_at, contexts, metrics = cached
    if perf_counter() - cached_at > settings.guide_retrieval_cache_ttl_seconds:
        _RETRIEVAL_CACHE.pop(cache_key, None)
        return None
    _RETRIEVAL_CACHE.move_to_end(cache_key)
    return contexts, replace(metrics, retrieval_cache_hit=True)


def _set_retrieval_cache(
    cache_key: tuple,
    contexts: list[RetrievedContext],
    metrics: RetrievalMetrics,
    classification: dict | None,
    settings: Settings | None,
) -> None:
    if settings is None or settings.guide_retrieval_cache_ttl_seconds <= 0:
        return
    if not _cacheable_retrieval(classification):
        return
    _RETRIEVAL_CACHE[cache_key] = (perf_counter(), contexts, metrics)
    _RETRIEVAL_CACHE.move_to_end(cache_key)
    while len(_RETRIEVAL_CACHE) > max(1, settings.guide_retrieval_cache_size):
        _RETRIEVAL_CACHE.popitem(last=False)


def _cacheable_retrieval(classification: dict | None) -> bool:
    intent = (classification or {}).get("intent", "")
    return intent not in {
        "route",
        "casual",
        "high_risk_realtime",
        "external_factual",
    }


def clear_retrieval_cache() -> None:
    _RETRIEVAL_CACHE.clear()


def _retrieve_keyword(
    db: Session,
    question: str,
    spot_id: str | None,
    top_k: int,
    classification: dict | None,
) -> list[RetrievedContext]:
    candidates = (
        _structured_candidates(db, classification)
        + _spot_candidates(db, spot_id)
        + _knowledge_chunk_candidates(db)
    )
    scored = [
        _ScoredCandidate(
            candidate,
            _score(question, candidate.text)
            + _spot_context_score(candidate, spot_id)
            + _structured_context_score(candidate)
            + _document_fact_context_score(candidate, classification),
        )
        for candidate in candidates
    ]
    scored.extend(
        _score_reviewed_web_fact_candidates(
            db,
            question,
            spot_id,
            classification,
        )
    )
    return _dedupe_and_limit(scored, top_k, classification)


def _score_structured_candidates(
    db: Session,
    question: str,
    spot_id: str | None,
    classification: dict | None,
) -> list[_ScoredCandidate]:
    return [
        _ScoredCandidate(
            context=candidate,
            score=_final_score(
                question,
                candidate,
                spot_id,
                classification,
                structured_score=_structured_context_score(candidate),
            ),
        )
        for candidate in _structured_candidates(db, classification)
    ]


def _score_spot_candidates(
    db: Session,
    question: str,
    spot_id: str | None,
    classification: dict | None,
) -> list[_ScoredCandidate]:
    return [
        _ScoredCandidate(
            context=candidate,
            score=_final_score(
                question,
                candidate,
                spot_id,
                classification,
                keyword_score=_score(question, candidate.text) * 12,
            ),
        )
        for candidate in _spot_candidates(db, spot_id)
    ]


def _score_reviewed_web_fact_candidates(
    db: Session,
    question: str,
    spot_id: str | None,
    classification: dict | None,
) -> list[_ScoredCandidate]:
    scored: list[_ScoredCandidate] = []
    candidates = _filter_scoped_contexts(db, _reviewed_web_fact_candidates(db), spot_id)
    for candidate in candidates:
        keyword_hits = _score(question, candidate.text)
        structured_score = _reviewed_web_fact_context_score(
            question,
            candidate,
            classification,
            keyword_hits,
        )
        if keyword_hits <= 0 and structured_score <= 0:
            continue
        scored.append(
            _ScoredCandidate(
                context=candidate,
                score=_final_score(
                    question,
                    candidate,
                    spot_id,
                    classification,
                    structured_score=structured_score,
                    keyword_score=keyword_hits * 24,
                ),
            )
        )
    return scored


def _fts_candidates(
    db: Session,
    question: str,
    classification: dict | None,
    limit: int = 24,
) -> list[tuple[RetrievedContext, float]]:
    if not ensure_knowledge_fts_schema(db):
        return []

    query_text = build_fts_query(_expanded_query(question, classification))
    if not query_text:
        return []

    try:
        rows = db.execute(
            text(
                """
                SELECT
                    row_key,
                    source_kind,
                    ref_id,
                    title,
                    spot_id,
                    spot_name,
                    section,
                    source_type,
                    source_url,
                    source_level,
                    snippet,
                    search_text,
                    bm25(knowledge_fts) AS bm25_score
                FROM knowledge_fts
                WHERE knowledge_fts MATCH :query_text
                ORDER BY bm25_score
                LIMIT :limit
                """
            ),
            {"query_text": query_text, "limit": limit},
        ).mappings().all()
    except Exception:
        db.rollback()
        return []

    candidates: list[tuple[RetrievedContext, float]] = []
    for row in rows:
        if not _fts_row_allowed(db, row, classification):
            continue
        bm25_score = float(row["bm25_score"] or 0)
        keyword_score = 140 + min(420, max(0, -bm25_score * 80))
        context = RetrievedContext(
            source=KnowledgeSource(
                title=row["title"] or "景区资料",
                spot_name=row["spot_name"] or None,
                section=row["section"] or DOCUMENT_CHUNK_SECTION,
                snippet=(
                    _context_snippet(row["search_text"] or row["snippet"] or "", classification)
                    if (row["source_type"] or "") == "document"
                    else row["snippet"] or ""
                ),
                score=0,
                source_type=row["source_type"] or "document",
                source_url=row["source_url"] or "",
                source_level=row["source_level"] or "",
            ),
            text=row["search_text"] or row["snippet"] or "",
        )
        candidates.append((context, keyword_score))
    return candidates


def _filter_scoped_pairs(
    db: Session,
    candidates: list[tuple[RetrievedContext, float]],
    spot_id: str | None,
) -> list[tuple[RetrievedContext, float]]:
    if not spot_id:
        return candidates
    spot = db.get(ScenicSpot, spot_id)
    if spot is None:
        return []
    return [
        (context, score)
        for context, score in candidates
        if context.source.spot_name == spot.name
    ]


def _filter_scoped_contexts(
    db: Session,
    candidates: list[RetrievedContext],
    spot_id: str | None,
) -> list[RetrievedContext]:
    if not spot_id:
        return candidates
    spot = db.get(ScenicSpot, spot_id)
    if spot is None:
        return []
    return [
        context
        for context in candidates
        if context.source.spot_name == spot.name
    ]


def _fts_row_allowed(db: Session, row, classification: dict | None) -> bool:
    section = row["section"] or ""
    if section != STRUCTURED_FACT_SECTION:
        return True

    fact_keys = (classification or {}).get("fact_keys", [])
    if not fact_keys:
        return False
    source_kind = row["source_kind"] or ""
    ref_id = str(row["ref_id"] or "")
    if source_kind == "fact" and ref_id.isdigit():
        fact = db.get(SpotFact, int(ref_id))
        return bool(fact and fact.fact_key in fact_keys)
    if source_kind == "approved_fact" and ref_id.isdigit():
        fact = db.get(ApprovedWebFact, int(ref_id))
        return bool(fact and fact.fact_key in fact_keys)
    row_text = row["search_text"] or row["snippet"] or ""
    return any(_text_matches_fact_key(row_text, fact_key) for fact_key in fact_keys)


def _text_matches_fact_key(text_value: str, fact_key: str) -> bool:
    terms = {
        "height_meters": ["height_meters", "高度", "多高", "米"],
        "opening_time": ["opening_time", "开放时间", "营业时间", "几点开", "几点关"],
        "ticket": ["ticket", "门票", "票价", "票种", "成人票", "半价票", "免票", "收费"],
        "weather": ["weather", "天气", "气温", "降雨"],
        "visit_minutes": ["visit_minutes", "游览", "停留", "多久"],
        "suitability": ["suitability", "适合", "人群", "标签"],
    }
    return any(term in text_value for term in terms.get(fact_key, [fact_key]))


def _vector_candidates(
    db: Session,
    question: str,
    classification: dict | None,
    settings: Settings | None,
    limit: int = 8,
) -> tuple[list[tuple[RetrievedContext, float]], str, bool]:
    if settings is None or not _vector_enabled(settings):
        return [], "disabled", False
    should_run, skip_status = _should_run_vector_search(question, classification)
    if not should_run:
        return [], skip_status, False

    query_embedding, query_status, embedding_cache_hit = _query_embedding(question, settings)
    if query_status != "ready":
        return [], query_status, embedding_cache_hit

    query = (
        select(KnowledgeChunkEmbedding, KnowledgeChunk, KnowledgeDoc)
        .join(KnowledgeChunk, KnowledgeChunk.id == KnowledgeChunkEmbedding.chunk_id)
        .join(KnowledgeDoc, KnowledgeDoc.id == KnowledgeChunk.doc_id)
        .where(KnowledgeChunkEmbedding.model == settings.rag_embedding_model)
    )
    rows = db.execute(query).all()
    if not rows:
        return [], "empty", embedding_cache_hit

    chunk_count = db.scalar(select(func.count(KnowledgeChunk.id))) or 0
    index_status = "partial_index" if chunk_count and len(rows) < chunk_count else "ready"
    scored_rows: list[tuple[float, KnowledgeChunkEmbedding, KnowledgeChunk, KnowledgeDoc]] = []
    for embedding, chunk, doc in rows:
        if embedding.content_hash != _content_hash(chunk.chunk_text):
            continue
        similarity = cosine_similarity(query_embedding, embedding.embedding_json)
        if similarity <= 0:
            continue
        scored_rows.append((similarity, embedding, chunk, doc))

    contexts: list[tuple[RetrievedContext, float]] = []
    for similarity, _embedding, chunk, doc in sorted(
        scored_rows,
        key=lambda item: item[0],
        reverse=True,
    )[:limit]:
        contexts.append(
            (
                RetrievedContext(
                    source=KnowledgeSource(
                        title=doc.title,
                        spot_name=_spot_name(db, chunk.spot_id),
                        section=DOCUMENT_CHUNK_SECTION,
                        snippet=_snippet(chunk.chunk_text),
                        score=0,
                        source_type="document",
                    ),
                    text=chunk.chunk_text,
                ),
                similarity * 180,
            )
        )
    if contexts:
        return contexts, index_status, embedding_cache_hit
    return [], "empty" if index_status == "ready" else index_status, embedding_cache_hit


def _should_run_vector_search(
    question: str,
    classification: dict | None,
) -> tuple[bool, str]:
    intent = (classification or {}).get("intent", "")
    if intent in VECTOR_SKIP_INTENTS:
        return False, f"skipped_{intent}"
    if intent == "scenic_fact" and (classification or {}).get("entities") and (classification or {}).get("fact_keys"):
        return False, "skipped_structured"
    if intent in VECTOR_ENABLED_INTENTS:
        return True, "ready"
    if any(term in question for term in VECTOR_HELPFUL_TERMS):
        return True, "ready"
    return False, "skipped_low_value"


def _query_embedding(question: str, settings: Settings) -> tuple[list[float], str, bool]:
    cache_key = (settings.rag_embedding_model, _normalize_embedding_query(question))
    if cache_key in _QUERY_EMBEDDING_CACHE:
        embedding = _QUERY_EMBEDDING_CACHE.pop(cache_key)
        _QUERY_EMBEDDING_CACHE[cache_key] = embedding
        return embedding, "ready", True

    try:
        client = EmbeddingClient(
            settings.rag_embedding_base_url,
            settings.rag_embedding_api_key,
            settings.rag_embedding_timeout_seconds,
        )
        embedding = client.embed_texts(settings.rag_embedding_model, [question[:800]])[0]
    except httpx.TimeoutException:
        return [], "query_timeout", False
    except Exception:
        return [], "query_failed", False

    if not embedding:
        return [], "query_failed", False
    _QUERY_EMBEDDING_CACHE[cache_key] = embedding
    while len(_QUERY_EMBEDDING_CACHE) > VECTOR_QUERY_CACHE_SIZE:
        _QUERY_EMBEDDING_CACHE.popitem(last=False)
    return embedding, "ready", False


def _normalize_embedding_query(question: str) -> str:
    return re.sub(r"\s+", " ", question.strip().lower())[:240]


def warm_query_embedding(question: str, settings: Settings) -> str:
    _embedding, status, _cache_hit = _query_embedding(question, settings)
    return status


def _legacy_keyword_candidates(
    db: Session,
    question: str,
    spot_id: str | None,
    limit: int = 8,
) -> list[RetrievedContext]:
    candidates = _spot_candidates(db, spot_id) + _knowledge_chunk_candidates(db)
    scored = [
        (candidate, _score(question, candidate.text))
        for candidate in candidates
    ]
    return [
        candidate
        for candidate, score in sorted(scored, key=lambda item: item[1], reverse=True)
        if score > 0
    ][:limit]


def _structured_candidates(db: Session, classification: dict | None) -> list[RetrievedContext]:
    if not classification:
        return []

    candidates: list[RetrievedContext] = []
    entities = classification.get("entities", [])
    fact_keys = classification.get("fact_keys", [])
    for entity in entities:
        if entity.get("entity_type") != "spot":
            continue
        spot = db.get(ScenicSpot, entity.get("entity_id"))
        if spot is None:
            continue
        for fact_key in fact_keys:
            candidates.extend(_fact_candidates(db, spot, fact_key))
            if fact_key == "suitability":
                candidates.append(_suitability_candidate(spot))
        if classification.get("intent") == "scenic_explanation":
            candidates.append(_spot_overview_candidate(spot))
    return candidates


def _fact_candidates(db: Session, spot: ScenicSpot, fact_key: str) -> list[RetrievedContext]:
    contexts: list[RetrievedContext] = []
    facts = db.scalars(
        select(SpotFact).where(
            SpotFact.spot_id == spot.id,
            SpotFact.fact_key == fact_key,
        )
    ).all()
    for fact in facts:
        snippet = _fact_snippet(fact.fact_label, fact.fact_value, fact.fact_unit)
        contexts.append(
            RetrievedContext(
                source=KnowledgeSource(
                    title="景区资料库",
                    spot_name=spot.name,
                    section=STRUCTURED_FACT_SECTION,
                    snippet=snippet,
                    score=0,
                    source_type=fact.source_type,
                    source_url=fact.source_url,
                ),
                text=f"{spot.name} {fact.fact_label} {snippet}",
            )
        )

    approved_facts = db.scalars(
        select(ApprovedWebFact).where(
            ApprovedWebFact.entity_id == spot.id,
            ApprovedWebFact.fact_key == fact_key,
        )
    ).all()
    for fact in approved_facts:
        snippet = _fact_snippet(fact.fact_label, fact.fact_value, fact.fact_unit)
        contexts.append(
            RetrievedContext(
                source=KnowledgeSource(
                    title="已审核联网补充",
                    spot_name=spot.name,
                    section=STRUCTURED_FACT_SECTION,
                    snippet=snippet,
                    score=0,
                    source_type="approved_web",
                    source_url=fact.source_url,
                    source_level=fact.source_level,
                ),
                text=f"{spot.name} {fact.fact_label} {snippet}",
            )
        )
    return contexts


def _suitability_candidate(spot: ScenicSpot) -> RetrievedContext:
    snippet = (
        f"标签：{'、'.join(spot.tags)}；"
        f"适合人群：{'、'.join(spot.crowd_types)}"
    )
    return RetrievedContext(
        source=KnowledgeSource(
            title="景区资料库",
            spot_name=spot.name,
            section=STRUCTURED_TAG_SECTION,
            snippet=snippet,
            score=0,
            source_type="database",
        ),
        text=f"{spot.name} {snippet}",
    )


def _spot_overview_candidate(spot: ScenicSpot) -> RetrievedContext:
    return RetrievedContext(
        source=KnowledgeSource(
            title="景区资料库",
            spot_name=spot.name,
            section=SPOT_OVERVIEW_SECTION,
            snippet=_snippet(f"{spot.summary}{spot.story}"),
            score=0,
            source_type="database",
        ),
        text=" ".join([spot.name, spot.summary, spot.story, " ".join(spot.tags)]),
    )


def _spot_candidates(db: Session, spot_id: str | None) -> list[RetrievedContext]:
    routeable_spot_ids = select(MapPoint.spot_id).where(
        MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
    )
    statement = select(ScenicSpot).where(ScenicSpot.id.in_(routeable_spot_ids))
    if spot_id:
        statement = statement.where(ScenicSpot.id == spot_id)
    spots = db.scalars(statement).all()
    return [
        RetrievedContext(
            source=KnowledgeSource(
                title="景区资料库",
                spot_name=spot.name,
                section=SPOT_OVERVIEW_SECTION,
                snippet=_snippet(f"{spot.summary}{spot.story}"),
                score=0,
                source_type="database",
            ),
            text=" ".join(
                [
                    spot.name,
                    spot.summary,
                    spot.story,
                    " ".join(spot.tags),
                    " ".join(spot.crowd_types),
                ]
            ),
        )
        for spot in spots
    ]


def _knowledge_chunk_candidates(db: Session) -> list[RetrievedContext]:
    rows = db.execute(
        select(KnowledgeChunk, KnowledgeDoc)
        .join(KnowledgeDoc, KnowledgeDoc.id == KnowledgeChunk.doc_id)
    ).all()
    return [
        RetrievedContext(
            source=KnowledgeSource(
                title=doc.title,
                spot_name=_spot_name(db, chunk.spot_id),
                section=DOCUMENT_CHUNK_SECTION,
                snippet=_snippet(chunk.chunk_text),
                score=0,
                source_type="document",
            ),
            text=chunk.chunk_text,
        )
        for chunk, doc in rows
    ]


def _reviewed_web_fact_candidates(db: Session) -> list[RetrievedContext]:
    contexts: list[RetrievedContext] = []
    official_facts = db.scalars(
        select(SpotFact).where(SpotFact.source_ref == "admin_web_review")
    ).all()
    for fact in official_facts:
        spot = db.get(ScenicSpot, fact.spot_id)
        if spot is None:
            continue
        snippet = _fact_snippet(fact.fact_label, fact.fact_value, fact.fact_unit)
        contexts.append(
            RetrievedContext(
                source=KnowledgeSource(
                    title="景区资料库",
                    spot_name=spot.name,
                    section=STRUCTURED_FACT_SECTION,
                    snippet=snippet,
                    score=0,
                    source_type="database",
                    source_url=fact.source_url,
                ),
                text=f"{spot.name} {fact.fact_key} {fact.fact_label} {snippet}",
            )
        )

    approved_facts = db.scalars(select(ApprovedWebFact)).all()
    for fact in approved_facts:
        spot = db.get(ScenicSpot, fact.entity_id) if fact.entity_id else None
        spot_name = spot.name if spot else ""
        snippet = _fact_snippet(fact.fact_label, fact.fact_value, fact.fact_unit)
        contexts.append(
            RetrievedContext(
                source=KnowledgeSource(
                    title="已审核联网补充",
                    spot_name=spot_name,
                    section=STRUCTURED_FACT_SECTION,
                    snippet=snippet,
                    score=0,
                    source_type="approved_web",
                    source_url=fact.source_url,
                    source_level=fact.source_level,
                ),
                text=f"{spot_name} {fact.fact_key} {fact.fact_label} {snippet}",
            )
        )
    return contexts


def _final_score(
    question: str,
    candidate: RetrievedContext,
    spot_id: str | None,
    classification: dict | None,
    structured_score: float = 0,
    keyword_score: float = 0,
    vector_score: float = 0,
) -> float:
    return (
        structured_score
        + keyword_score
        + vector_score
        + _source_priority_score(candidate)
        + _spot_context_score(candidate, spot_id)
        + _alias_score(question, candidate)
        + _document_fact_context_score(candidate, classification)
    )


def _dedupe_and_limit(
    scored: list[_ScoredCandidate],
    top_k: int,
    classification: dict | None = None,
) -> list[RetrievedContext]:
    ranked = sorted(scored, key=lambda item: item.score, reverse=True)
    unique_ranked: list[tuple[RetrievedContext, float]] = []
    seen_source_keys: set[tuple[str, str, str, str]] = set()
    for item in ranked:
        if item.score <= 0:
            continue
        source_key = _source_dedupe_key(item.context)
        if source_key in seen_source_keys:
            continue
        seen_source_keys.add(source_key)
        unique_ranked.append((item.context, item.score))
        if len(unique_ranked) >= top_k:
            break

    return [
        RetrievedContext(
            source=KnowledgeSource(
                title=context.source.title,
                spot_name=context.source.spot_name,
                section=context.source.section,
                snippet=(
                    _context_snippet(context.text, classification)
                    if context.source.source_type == "document"
                    else context.source.snippet
                ),
                score=float(score),
                source_type=context.source.source_type,
                source_url=context.source.source_url,
                source_level=context.source.source_level,
            ),
            text=context.text,
        )
        for context, score in unique_ranked
    ]


def _score(question: str, text_value: str) -> int:
    terms = _terms(_expanded_query(question, None))
    return sum(1 for term in terms if term in text_value)


def _spot_context_score(candidate: RetrievedContext, spot_id: str | None) -> int:
    if spot_id and candidate.source.section == SPOT_OVERVIEW_SECTION:
        return 100
    return 0


def _structured_context_score(candidate: RetrievedContext) -> int:
    if candidate.source.section == STRUCTURED_FACT_SECTION and candidate.source.source_type == "database":
        return 4200
    if candidate.source.section == STRUCTURED_FACT_SECTION:
        return 3800
    if candidate.source.section == STRUCTURED_TAG_SECTION:
        return 900
    return 0


def _source_priority_score(candidate: RetrievedContext) -> int:
    if candidate.source.section == STRUCTURED_FACT_SECTION and candidate.source.source_type == "database":
        return 520
    if candidate.source.section == STRUCTURED_FACT_SECTION and candidate.source.source_type == "approved_web":
        return 460
    if candidate.source.section == STRUCTURED_TAG_SECTION and candidate.source.source_type == "database":
        return 260
    return SOURCE_PRIORITY.get(candidate.source.source_type, 0)


def _alias_score(question: str, candidate: RetrievedContext) -> int:
    text_value = candidate.text
    score = 0
    if any(term in question for term in ("出片", "拍照", "摄影", "打卡", "取景")):
        if any(term in text_value for term in ("摄影", "拍照", "打卡", "取景")):
            score += 160
    if any(term in question for term in ("建筑感", "建筑", "艺术", "空间")):
        if any(term in text_value for term in ("建筑", "艺术", "室内", "空间", "梵宫", "坛城")):
            score += 150
    if any(term in question for term in ("第一次", "初次", "经典", "新手")):
        if any(term in text_value for term in ("经典", "初游", "核心", "地标", "灵山大佛", "九龙灌浴")):
            score += 130
    if any(term in question for term in ("自然", "休闲", "放松", "散步")):
        if any(term in text_value for term in ("自然", "休闲", "花海", "湖", "鹿鸣谷")):
            score += 130
    return score


def _document_fact_context_score(
    candidate: RetrievedContext,
    classification: dict | None,
) -> int:
    if not classification or candidate.source.source_type != "document":
        return 0
    fact_terms = {
        "height_meters": ["高度", "米"],
        "opening_time": ["开放时间", "营业时间", "几点开", "几点关"],
        "ticket": ["门票", "票价", "票种", "成人票", "半价票", "免票", "收费"],
        "visit_minutes": ["游览", "停留", "多久"],
    }
    score = 0
    for fact_key in classification.get("fact_keys", []):
        matched_terms = [term for term in fact_terms.get(fact_key, []) if term in candidate.text]
        if matched_terms:
            score += 720 + len(matched_terms) * 70
            if fact_key == "ticket" and re.search(r"\d+\s*元", candidate.text):
                score += 260
            if fact_key == "opening_time" and re.search(r"\d{1,2}[:：]\d{2}", candidate.text):
                score += 220
    return score


def _reviewed_web_fact_context_score(
    question: str,
    candidate: RetrievedContext,
    classification: dict | None,
    keyword_hits: int,
) -> int:
    if _fact_candidate_matches_classification(candidate, classification):
        return _structured_context_score(candidate)
    if keyword_hits >= 3:
        return 1100
    if keyword_hits == 2:
        return 780
    if keyword_hits == 1 and candidate.source.spot_name and candidate.source.spot_name in question:
        return 420
    if keyword_hits == 1:
        return 220
    return 0


def _fact_candidate_matches_classification(
    candidate: RetrievedContext,
    classification: dict | None,
) -> bool:
    if not classification:
        return False
    entities = [
        entity
        for entity in classification.get("entities", [])
        if isinstance(entity, dict) and entity.get("entity_type") == "spot"
    ]
    if entities and candidate.source.spot_name:
        entity_names = {str(entity.get("name", "")) for entity in entities}
        if candidate.source.spot_name not in entity_names:
            return False
    fact_keys = classification.get("fact_keys", [])
    if not fact_keys:
        return False
    return any(
        fact_key in candidate.text or _text_matches_fact_key(candidate.text, fact_key)
        for fact_key in fact_keys
    )


def _source_dedupe_key(candidate: RetrievedContext) -> tuple[str, str, str, str]:
    source = candidate.source
    return (
        source.source_type or "",
        source.spot_name or "",
        " ".join(source.snippet.split()),
        source.source_url or "",
    )


def _fact_snippet(label: str, value: str, unit: str) -> str:
    return f"{label}：{value}{unit}"


def _terms(text_value: str) -> list[str]:
    terms: set[str] = set()
    for token in re.split(r"[\s，。！？、,.!?；;：（）()]+", text_value):
        token = token.strip()
        if not token:
            continue
        _add_term(terms, token)
        for cjk_text in re.findall(r"[\u4e00-\u9fff]+", token):
            for size in range(2, min(6, len(cjk_text)) + 1):
                for index in range(0, len(cjk_text) - size + 1):
                    _add_term(terms, cjk_text[index : index + size])
    return sorted(terms, key=lambda term: (-len(term), term))


def _add_term(terms: set[str], term: str) -> None:
    if term and term not in CHINESE_STOP_TERMS:
        terms.add(term)


def _expanded_query(question: str, classification: dict | None) -> str:
    extras: list[str] = []
    if any(term in question for term in ("出片", "拍照", "摄影", "打卡", "取景")):
        extras.extend(["摄影", "拍照", "打卡", "取景"])
    if any(term in question for term in ("建筑感", "建筑", "艺术", "空间")):
        extras.extend(["建筑", "艺术", "室内", "空间", "梵宫", "五印坛城"])
    if any(term in question for term in ("第一次", "初次", "经典", "新手")):
        extras.extend(["经典", "初游", "核心", "地标", "灵山大佛", "九龙灌浴"])
    if any(term in question for term in ("自然", "休闲", "放松", "散步")):
        extras.extend(["自然", "休闲", "花海", "五灯湖", "鹿鸣谷"])
    if classification:
        fact_expansions = {
            "height_meters": ["高度", "多高", "多少米"],
            "opening_time": ["开放时间", "营业时间", "几点开", "几点关"],
            "ticket": ["门票", "票价", "成人票", "半价票", "免票", "收费"],
            "weather": ["天气", "气温", "降雨", "多云", "晴天"],
            "visit_minutes": ["游览", "停留", "多久"],
            "suitability": ["适合", "人群", "标签"],
        }
        for fact_key in classification.get("fact_keys", []):
            extras.extend(fact_expansions.get(fact_key, []))
        extras.extend(str(tag) for tag in classification.get("tags", []) if tag)
    return " ".join([question, *extras])


def _spot_name(db: Session, spot_id: str | None) -> str | None:
    if not spot_id:
        return None
    spot = db.get(ScenicSpot, spot_id)
    return spot.name if spot else None


def _context_snippet(text_value: str, classification: dict | None) -> str:
    if not classification:
        return _snippet(text_value)
    fact_terms = {
        "height_meters": ["高度", "多高", "米"],
        "opening_time": ["开放时间", "营业时间", "几点开", "几点关"],
        "ticket": ["成人票", "半价票", "免票", "网购联票", "门票", "票价", "票种", "收费"],
        "weather": ["天气", "气温", "降雨", "多云", "晴"],
        "visit_minutes": ["游览", "停留", "多久"],
        "suitability": ["适合", "人群", "标签"],
    }
    terms = [
        term
        for fact_key in classification.get("fact_keys", [])
        for term in fact_terms.get(fact_key, [])
    ]
    indexes = [text_value.find(term) for term in terms if term in text_value]
    if not indexes:
        return _snippet(text_value)
    start = max(0, min(indexes) - 30)
    return _snippet(text_value[start:], 180)


def _snippet(text_value: str, limit: int = 120) -> str:
    compact = " ".join(text_value.split())
    return compact[:limit]


def _content_hash(text_value: str) -> str:
    return hashlib.sha256(text_value.encode("utf-8")).hexdigest()


def _vector_enabled(settings: Settings) -> bool:
    return (
        settings.rag_vector_mode.strip().lower() == "openai_compatible"
        and bool(settings.rag_embedding_base_url)
        and bool(settings.rag_embedding_api_key)
        and bool(settings.rag_embedding_model)
    )


def _elapsed_ms(started_at: float) -> float:
    return round((perf_counter() - started_at) * 1000, 2)
