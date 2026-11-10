from __future__ import annotations

import asyncio
import json
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select

from .agent import GuideAgent
from .contracts import Chunk, Hit, Scope, digest
from .ingestion import Block, chunk_blocks
from .memory import MemoryStore, UserTurn
from .retrieval import HybridRetriever


def import_competition_zip(zip_path: Path, area_map: dict[str, str], *, approved: bool = False) -> list[Chunk]:
    """Read curated JSON without extracting, executing or modifying competition files."""
    def read_json(archive: zipfile.ZipFile, suffix: str):
        entries = [entry for entry in archive.infolist() if entry.filename.endswith(suffix)]
        if len(entries) != 1 or entries[0].file_size > 20_000_000:
            raise ValueError(f"Missing, ambiguous or oversized ZIP member: {suffix}")
        return json.loads(archive.read(entries[0]).decode("utf-8-sig"))

    with zipfile.ZipFile(zip_path) as archive:
        spots = read_json(archive, "/knowledge/curated/spots.json")
        facts = read_json(archive, "/knowledge/curated/facts.json")
    by_id = {spot["entity_id"]: spot for spot in spots}
    if any(spot["scenic_area"] not in area_map for spot in spots):
        raise ValueError("Provide an explicit map ID for every scenic_area; do not infer route IDs")
    chunks = []
    for spot in spots:
        document_id = "curated:spot:" + spot["entity_id"]
        blocks = [Block(key, spot.get(key, "")) for key in ["summary", "story", "location"] if spot.get(key)]
        created = chunk_blocks(blocks, document_id=document_id, title=spot["name"],
                               map_id=area_map[spot["scenic_area"]], spot_id=spot["entity_id"],
                               approved=approved, source_type="database")
        for chunk in created:
            chunk.metadata.update(spot_name=spot["name"], source_ref=spot.get("source_ref", ""))
        chunks.extend(created)
    for fact in facts:
        spot = by_id.get(fact["spot_id"])
        if not spot:
            raise ValueError("Curated fact refers to an unknown spot")
        text = f"{fact['fact_label']}: {fact['fact_value']} {fact.get('fact_unit', '')}".strip()
        created = chunk_blocks([Block(fact["fact_key"], text)],
                               document_id="curated:spot:" + spot["entity_id"], title=spot["name"],
                               map_id=area_map[spot["scenic_area"]], spot_id=spot["entity_id"],
                               source_url=fact.get("source_url", ""), approved=approved,
                               source_type=fact.get("source_type", "database"))
        for chunk in created:
            chunk.id = digest(["fact", spot["entity_id"], fact["fact_key"], chunk.text])[:40]
            chunk.metadata.update(spot_name=spot["name"], source_ref=fact.get("source_ref", ""),
                                  confidence=fact.get("confidence"))
        chunks.extend(created)
    return chunks


def export_legacy_database(db, map_id: str, *, approved: bool = False,
                           include_documents: bool = True) -> list[Chunk]:
    """Run inside original backend process; SELECT only, no schema creation or commits."""
    from app.models import KnowledgeChunk, KnowledgeDoc, MapPoint, ScenicSpot, SpotFact

    chunks = []
    with db.no_autoflush:
        spot_rows = db.execute(select(ScenicSpot).join(MapPoint, MapPoint.spot_id == ScenicSpot.id)
                              .where(MapPoint.map_id == map_id)).scalars().all()
        spots = {spot.id: spot for spot in spot_rows}
        for spot in spots.values():
            blocks = [Block(key, getattr(spot, key)) for key in ("summary", "story") if getattr(spot, key)]
            created = chunk_blocks(blocks, document_id=f"legacy:spot:{map_id}:{spot.id}",
                                   title=spot.name, map_id=map_id, spot_id=spot.id,
                                   source_type="database", approved=approved)
            for chunk in created:
                chunk.metadata.update(spot_name=spot.name, legacy_spot_id=spot.id)
            chunks.extend(created)
        document_rows = db.execute(select(KnowledgeChunk, KnowledgeDoc)
                                   .join(KnowledgeDoc, KnowledgeChunk.doc_id == KnowledgeDoc.id)
                                   .where(KnowledgeChunk.spot_id.in_(spots))).all() if include_documents else []
        for row, doc in document_rows:
            created = chunk_blocks([Block("document", row.chunk_text)], document_id="legacy:" + doc.id,
                                   title=doc.title, map_id=map_id, spot_id=row.spot_id,
                                   source_type=doc.source_type, approved=approved)
            for chunk in created:
                chunk.id = digest(["legacy_chunk", row.id, chunk.id])[:40]
                chunk.metadata.update(legacy_chunk_id=row.id, spot_name=spots[row.spot_id].name)
            chunks.extend(created)
        for fact in db.scalars(select(SpotFact).where(SpotFact.spot_id.in_(spots))):
            text = f"{fact.fact_label}: {fact.fact_value} {fact.fact_unit or ''}".strip()
            created = chunk_blocks([Block(fact.fact_key, text)], document_id="legacy:fact:" + fact.spot_id,
                                   title=spots[fact.spot_id].name, map_id=map_id, spot_id=fact.spot_id,
                                   source_type=fact.source_type, source_url=fact.source_url or "", approved=approved)
            for chunk in created:
                chunk.id = digest(["legacy_fact", map_id, fact.id, chunk.id])[:40]
                chunk.metadata.update(legacy_fact_id=fact.id, spot_name=spots[fact.spot_id].name)
            chunks.extend(created)
    # Global/unscoped legacy docs need a manually reviewed map assignment; never spread to all maps.
    return chunks


def to_legacy_source(hit: Hit):
    from app.schemas import KnowledgeSource

    return KnowledgeSource(title=hit.chunk.title, spot_name=hit.chunk.metadata.get("spot_name"),
                           section=hit.chunk.section, snippet=hit.chunk.text[:500],
                           score=hit.rerank_score if hit.rerank_score is not None else hit.fusion_score,
                           source_type=hit.chunk.source_type, source_url=hit.chunk.source_url,
                           source_level="approved_corpus")


class LegacyRetrievalAdapter:
    def __init__(self, retriever: HybridRetriever, default_map_id: str):
        self.retriever, self.default_map_id = retriever, default_map_id

    def retrieve_context_with_metrics(self, db, question: str, spot_id=None, top_k=4,
                                     classification=None, settings=None):
        from app.models import MapPoint
        from app.services.rag import RetrievedContext, RetrievalMetrics

        if spot_id:
            with db.no_autoflush:
                exists = db.scalar(select(MapPoint.id).where(MapPoint.spot_id == spot_id,
                                                            MapPoint.map_id == self.default_map_id))
            if exists is None:
                raise ValueError("Spot outside this adapter's scenic-area scope")
        result = self.retriever.search(question, Scope(map_id=self.default_map_id, spot_id=spot_id), top_k)
        contexts = [RetrievedContext(source=to_legacy_source(hit), text=hit.chunk.text) for hit in result.hits]
        return contexts, RetrievalMetrics(retrieval_mode="hybrid_rrf_crossencoder", context_count=len(contexts),
                                           fts_ms=result.timings_ms.get("bm25", 0),
                                           embedding_ms=result.timings_ms.get("embedding", 0),
                                           rerank_ms=result.timings_ms.get("rerank", 0), vector_status="milvus_ready")

    def retrieve_context(self, db, question: str, spot_id=None, top_k=4, classification=None, settings=None):
        return self.retrieve_context_with_metrics(db, question, spot_id, top_k, classification, settings)[0]


class DelegateToLegacy(ValueError):
    """The original application owns vision, route calculation and voice generation."""


@dataclass(frozen=True)
class BackendContext:
    # Construct only from verified server-side authentication/ownership, never request.profile.
    map_id: str
    session_id: str
    intent: str
    user_id: str | None = None
    trip_id: str | None = None
    memory_consent: bool = False


class LegacyChatAdapter:
    def __init__(self, agent: GuideAgent, memories: MemoryStore | None = None):
        self.agent, self.memories = agent, memories

    async def answer(self, chat_request, context: BackendContext, *, event_id: str,
                     user_turn_time: float, trusted_history: list[dict] | None = None):
        from app.schemas import ChatMetrics, ChatResponse

        if getattr(chat_request, "image", None) is not None or context.intent not in {
                "scenic_fact", "scenic_explanation", "service", "casual"}:
            raise DelegateToLegacy("Keep original vision, route, mixed/emotional and live-data handling")
        if not context.session_id or not event_id:
            raise ValueError("Server-verified session and idempotency IDs required")
        started = time.perf_counter()
        items = []
        if self.memories and context.user_id and context.memory_consent:
            items = await asyncio.to_thread(self.memories.list, context.user_id, context.trip_id)
        result = await self.agent.answer(chat_request.question,
                                          Scope(map_id=context.map_id, spot_id=chat_request.spot_id),
                                          history=trusted_history, memories=items,
                                          checkpoint_thread_id=digest([context.user_id or "anonymous", context.session_id]))
        memory_status = "disabled"
        if self.memories and context.user_id and context.memory_consent:
            from sqlalchemy.exc import SQLAlchemyError

            try:
                await asyncio.to_thread(self.memories.enqueue, context.user_id, event_id,
                                        [UserTurn(id=event_id, text=chat_request.question, observed_at=user_turn_time)],
                                        context.trip_id, consent=True)
                memory_status = "queued"
            except SQLAlchemyError:
                memory_status = "enqueue_failed"
        degraded = result.answer.status == "budget_exhausted"
        metrics = ChatMetrics(retrieval_ms=result.timings_ms["retrieval"], llm_ms=result.timings_ms["llm"],
                              tts_ms=0, total_ms=(time.perf_counter() - started) * 1000, cache_hit=False, degraded=degraded,
                              classification={"intent": context.intent, "memory_status": memory_status},
                              retrieval_mode="agentic_hybrid", context_count=len(result.sources),
                              vector_status="milvus_ready", llm_model=self.agent.settings.models.chat_model)
        return ChatResponse(answer=result.answer.text, sources=[to_legacy_source(hit) for hit in result.sources],
                            session_id=context.session_id, audio_url=None, tts_status="disabled",
                            mode="agentic_rag", degraded=degraded, metrics=metrics)
