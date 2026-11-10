from __future__ import annotations

import hashlib
import re
from time import perf_counter

from sqlalchemy import delete, select, text
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
)
from app.services.embeddings import EmbeddingClient
from app.services.map_point_types import ROUTEABLE_MAP_POINT_TYPES


FTS_TABLE = "knowledge_fts"

_STOP_TERMS = {
    "什么",
    "有什么",
    "哪里",
    "怎么",
    "比较",
    "可以",
    "一下",
    "一个",
    "这个",
    "那个",
    "请问",
    "介绍",
}

_HIGH_SIGNAL_TERMS = (
    "\u7075\u5c71\u5927\u4f5b",
    "\u7075\u5c71\u68b5\u5bab",
    "\u4e94\u5370\u575b\u57ce",
    "\u4e5d\u9f99\u704c\u6d74",
    "\u62c8\u82b1\u6e7e",
    "\u68b5\u5929\u82b1\u6d77",
    "\u4e94\u706f\u6e56",
    "\u9e7f\u9e23\u8c37",
    "\u68b5\u5bab",
    "\u770b\u70b9",
    "\u51fa\u7247",
    "\u6444\u5f71",
    "\u62cd\u7167",
    "\u6253\u5361",
    "\u5efa\u7b51",
    "\u827a\u672f",
    "\u5ba4\u5185",
    "\u81ea\u7136",
    "\u4f11\u95f2",
    "\u4f5b\u6559",
    "\u6587\u5316",
    "\u5f00\u653e",
    "\u65f6\u95f4",
    "\u95e8\u7968",
    "\u7968\u4ef7",
    "\u9ad8\u5ea6",
    "\u591a\u9ad8",
)
_HIGH_SIGNAL_TERM_SET = set(_HIGH_SIGNAL_TERMS)


def ensure_knowledge_fts_schema(session: Session) -> bool:
    try:
        session.execute(
            text(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                    row_key UNINDEXED,
                    source_kind UNINDEXED,
                    ref_id UNINDEXED,
                    title,
                    spot_id UNINDEXED,
                    spot_name,
                    section,
                    source_type UNINDEXED,
                    source_url UNINDEXED,
                    source_level UNINDEXED,
                    snippet,
                    search_text,
                    tokenize='unicode61'
                )
                """
            )
        )
        return True
    except Exception:
        session.rollback()
        return False


def rebuild_knowledge_fts_index(session: Session) -> bool:
    if not ensure_knowledge_fts_schema(session):
        return False

    rows = _spot_rows(session) + _fact_rows(session) + _approved_fact_rows(session) + _chunk_rows(session)
    session.execute(text("DELETE FROM knowledge_fts"))
    if not rows:
        return True

    session.execute(
        text(
            """
            INSERT INTO knowledge_fts(
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
                search_text
            )
            VALUES(
                :row_key,
                :source_kind,
                :ref_id,
                :title,
                :spot_id,
                :spot_name,
                :section,
                :source_type,
                :source_url,
                :source_level,
                :snippet,
                :search_text
            )
            """
        ),
        rows,
    )
    return True


def build_fts_query(question: str, max_terms: int = 18) -> str:
    raw_terms = tokenize_for_search(question)
    terms = [term for term in raw_terms if not _term_has_stop(term)]
    lowered_question = question.lower()
    prioritized = [
        term
        for term in _HIGH_SIGNAL_TERMS
        if term in lowered_question or term in terms
    ]
    terms = sorted(set(terms), key=_fts_term_rank)
    selected_terms = _dedupe_preserve_order([*prioritized, *terms])[:max_terms]
    return " OR ".join(_quote_fts_term(term) for term in selected_terms)


def _term_has_stop(term: str) -> bool:
    if term in _STOP_TERMS:
        return True
    return any(stop and len(stop) >= 2 and stop in term for stop in _STOP_TERMS)


def _fts_term_rank(term: str) -> tuple[int, int, str]:
    if term in _HIGH_SIGNAL_TERM_SET:
        return (0, abs(len(term) - 3), term)
    is_cjk = bool(re.fullmatch(r"[\u4e00-\u9fff]+", term))
    if is_cjk and 2 <= len(term) <= 4:
        return (1, abs(len(term) - 3), term)
    return (2, abs(len(term) - 3), term)


def _dedupe_preserve_order(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        output.append(term)
    return output



def tokenize_for_search(text_value: str) -> list[str]:
    text_value = text_value.lower()
    tokens: set[str] = set()
    for token in re.findall(r"[a-z0-9_+-]+", text_value):
        if len(token) >= 2:
            tokens.add(token)
    for cjk_text in re.findall(r"[\u4e00-\u9fff]+", text_value):
        if len(cjk_text) == 1:
            tokens.add(cjk_text)
            continue
        for size in range(2, min(5, len(cjk_text)) + 1):
            for index in range(0, len(cjk_text) - size + 1):
                token = cjk_text[index : index + size]
                if token not in _STOP_TERMS:
                    tokens.add(token)
    return sorted(tokens, key=lambda item: (-len(item), item))


def searchable_text(*parts: str) -> str:
    raw = " ".join(part for part in parts if part)
    return " ".join([raw, *tokenize_for_search(raw)])


def ensure_chunk_embeddings(session: Session, settings: Settings) -> str:
    if not _vector_enabled(settings):
        return "disabled"

    chunks = session.scalars(select(KnowledgeChunk).order_by(KnowledgeChunk.id)).all()
    if not chunks:
        return "empty"

    client = EmbeddingClient(
        settings.rag_embedding_base_url,
        settings.rag_embedding_api_key,
        settings.rag_embedding_index_timeout_seconds,
    )
    model = settings.rag_embedding_model
    missing: list[KnowledgeChunk] = []
    for chunk in chunks:
        content_hash = _content_hash(chunk.chunk_text)
        existing = session.scalar(
            select(KnowledgeChunkEmbedding).where(
                KnowledgeChunkEmbedding.chunk_id == chunk.id,
                KnowledgeChunkEmbedding.model == model,
            )
        )
        if existing and existing.content_hash == content_hash and existing.embedding_json:
            continue
        if existing and existing.content_hash != content_hash:
            session.execute(
                delete(KnowledgeChunkEmbedding).where(
                    KnowledgeChunkEmbedding.id == existing.id,
                )
            )
        missing.append(chunk)

    if not missing:
        return "ready"

    started = perf_counter()
    batch_size = max(1, min(settings.rag_embedding_index_batch_size, 24))
    budget_seconds = max(
        settings.rag_embedding_index_timeout_seconds,
        settings.rag_embedding_index_budget_seconds,
    )
    try:
        for index in range(0, len(missing), batch_size):
            batch = missing[index : index + batch_size]
            embeddings = client.embed_texts(model, [chunk.chunk_text[:1200] for chunk in batch])
            for chunk, embedding in zip(batch, embeddings):
                if not embedding:
                    continue
                session.add(
                    KnowledgeChunkEmbedding(
                        chunk_id=chunk.id,
                        model=model,
                        content_hash=_content_hash(chunk.chunk_text),
                        embedding_json=embedding,
                    )
                )
            session.flush()
            if perf_counter() - started > budget_seconds:
                return "partial"
        return "ready"
    except Exception:
        return "failed"


def _vector_enabled(settings: Settings) -> bool:
    return (
        settings.rag_vector_mode.strip().lower() == "openai_compatible"
        and bool(settings.rag_embedding_base_url)
        and bool(settings.rag_embedding_api_key)
        and bool(settings.rag_embedding_model)
    )


def _spot_rows(session: Session) -> list[dict]:
    aliases_by_spot: dict[str, list[str]] = {}
    for alias in session.scalars(select(EntityAlias)).all():
        if alias.entity_type != "spot":
            continue
        aliases_by_spot.setdefault(alias.entity_id, []).append(alias.alias)

    rows: list[dict] = []
    routeable_spot_ids = select(MapPoint.spot_id).where(
        MapPoint.point_type.in_(ROUTEABLE_MAP_POINT_TYPES),
    )
    for spot in session.scalars(
        select(ScenicSpot)
        .where(ScenicSpot.id.in_(routeable_spot_ids))
        .order_by(ScenicSpot.sort_order)
    ).all():
        snippet = _snippet(" ".join([spot.summary, spot.story]))
        rows.append(
            {
                "row_key": f"spot:{spot.id}",
                "source_kind": "spot",
                "ref_id": spot.id,
                "title": "景区资料库",
                "spot_id": spot.id,
                "spot_name": spot.name,
                "section": "景点简介",
                "source_type": "database",
                "source_url": "",
                "source_level": "",
                "snippet": snippet,
                "search_text": searchable_text(
                    spot.name,
                    spot.summary,
                    spot.story,
                    " ".join(spot.tags),
                    " ".join(spot.crowd_types),
                    " ".join(aliases_by_spot.get(spot.id, [])),
                ),
            }
        )
    return rows


def _fact_rows(session: Session) -> list[dict]:
    rows: list[dict] = []
    for fact in session.scalars(select(SpotFact).order_by(SpotFact.id)).all():
        spot = session.get(ScenicSpot, fact.spot_id)
        if spot is None:
            continue
        snippet = _fact_snippet(fact.fact_label, fact.fact_value, fact.fact_unit)
        rows.append(
            {
                "row_key": f"fact:{fact.id}",
                "source_kind": "fact",
                "ref_id": str(fact.id),
                "title": "景区资料库",
                "spot_id": spot.id,
                "spot_name": spot.name,
                "section": "结构化事实",
                "source_type": fact.source_type,
                "source_url": fact.source_url,
                "source_level": "",
                "snippet": snippet,
                "search_text": searchable_text(
                    spot.name,
                    fact.fact_key,
                    fact.fact_label,
                    fact.fact_value,
                    fact.fact_unit,
                ),
            }
        )
    return rows


def _approved_fact_rows(session: Session) -> list[dict]:
    rows: list[dict] = []
    for fact in session.scalars(select(ApprovedWebFact).order_by(ApprovedWebFact.id)).all():
        spot = session.get(ScenicSpot, fact.entity_id)
        spot_name = spot.name if spot else fact.entity_id
        snippet = _fact_snippet(fact.fact_label, fact.fact_value, fact.fact_unit)
        rows.append(
            {
                "row_key": f"approved_fact:{fact.id}",
                "source_kind": "approved_fact",
                "ref_id": str(fact.id),
                "title": "已审核联网补充",
                "spot_id": fact.entity_id,
                "spot_name": spot_name,
                "section": "结构化事实",
                "source_type": "approved_web",
                "source_url": fact.source_url,
                "source_level": fact.source_level,
                "snippet": snippet,
                "search_text": searchable_text(
                    spot_name,
                    fact.fact_key,
                    fact.fact_label,
                    fact.fact_value,
                    fact.fact_unit,
                ),
            }
        )
    return rows


def _chunk_rows(session: Session) -> list[dict]:
    rows: list[dict] = []
    query = (
        select(KnowledgeChunk, KnowledgeDoc)
        .join(KnowledgeDoc, KnowledgeDoc.id == KnowledgeChunk.doc_id)
        .order_by(KnowledgeDoc.id, KnowledgeChunk.chunk_index)
    )
    for chunk, doc in session.execute(query).all():
        spot_name = ""
        if chunk.spot_id:
            spot = session.get(ScenicSpot, chunk.spot_id)
            spot_name = spot.name if spot else ""
        rows.append(
            {
                "row_key": f"chunk:{chunk.id}",
                "source_kind": "chunk",
                "ref_id": str(chunk.id),
                "title": doc.title,
                "spot_id": chunk.spot_id or "",
                "spot_name": spot_name,
                "section": "资料片段",
                "source_type": "document",
                "source_url": "",
                "source_level": "",
                "snippet": _snippet(chunk.chunk_text),
                "search_text": searchable_text(doc.title, spot_name, chunk.chunk_text),
            }
        )
    return rows


def _quote_fts_term(term: str) -> str:
    escaped = term.replace('"', '""')
    return f'"{escaped}"'


def _content_hash(text_value: str) -> str:
    return hashlib.sha256(text_value.encode("utf-8")).hexdigest()


def _fact_snippet(label: str, value: str, unit: str) -> str:
    return f"{label}：{value}{unit}"


def _snippet(text_value: str, limit: int = 120) -> str:
    compact = " ".join(text_value.split())
    return compact[:limit]
