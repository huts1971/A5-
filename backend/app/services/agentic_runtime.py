from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from pathlib import Path
from threading import BoundedSemaphore, Lock
from time import perf_counter, time
from uuid import uuid4

from filelock import FileLock, Timeout
from sqlalchemy import select, update

from app.core.errors import ApiError
from app.core.config import BACKEND_ROOT
from app.models import ChatMessage, KnowledgeChunk, KnowledgeDoc, MapPoint, utc_now
from app.models.agentic import ChatSessionAccess, CoreCorpusRevision, CoreDocumentScope
from scenic_guide_core.agent import GuideAgent
from scenic_guide_core.config import Settings as CoreSettings
from scenic_guide_core.contracts import Scope, digest
from scenic_guide_core.ingestion import Corpus, chunk_blocks, parse_document, write_jsonl
from scenic_guide_core.integration import export_legacy_database, to_legacy_source
from scenic_guide_core.memory import MemoryStore, UserTurn
from scenic_guide_core.models import ChatClient, QwenEmbedder
from scenic_guide_core.retrieval import HybridRetriever, MilvusIndex


logger = logging.getLogger(__name__)
MAP_IDS = {"ling-shan", "nianhua-bay"}


def current_revision(db) -> int:
    value = db.get(CoreCorpusRevision, 1, populate_existing=True)
    return value.revision if value else 1


def mark_corpus_dirty(db) -> None:
    pending = next((row for row in db.new if isinstance(row, CoreCorpusRevision)), None)
    if pending:
        return
    if db.get(CoreCorpusRevision, 1) is None:
        db.add(CoreCorpusRevision(id=1, revision=2))
    else:
        db.execute(update(CoreCorpusRevision).where(CoreCorpusRevision.id == 1)
                   .values(revision=CoreCorpusRevision.revision + 1))


def authorize_chat_session(db, request, user_id):
    supplied = request.session_id
    access = db.get(ChatSessionAccess, supplied) if supplied else None
    if access:
        if access.user_id != user_id:
            raise ApiError("该对话不属于当前用户，请创建新对话", "CHAT_SESSION_FORBIDDEN", 403)
        return request
    # Never adopt a client-chosen ID or an unowned historical session.
    session_id = "s_" + uuid4().hex
    db.add(ChatSessionAccess(session_id=session_id, user_id=user_id))
    db.flush()
    return request.model_copy(update={"session_id": session_id})


def resolve_scope(db, request, classification) -> Scope:
    entity_ids = [item.get("entity_id") for item in classification.get("entities", [])]
    if request.spot_id:
        entity_ids = [request.spot_id]
    map_ids = set(db.scalars(select(MapPoint.map_id).where(MapPoint.spot_id.in_(entity_ids)))) if entity_ids else set()
    if len(map_ids) > 1:
        raise ApiError("请明确本次咨询的是灵山胜境还是拈花湾", "SCENIC_SCOPE_AMBIGUOUS", 422)
    profile = request.profile or {}
    context = profile.get("route_context") or profile.get("routeContext") or {}
    preference = profile.get("route_preference") or {}
    if not isinstance(context, dict) or not isinstance(preference, dict):
        raise ApiError("景区上下文格式不正确", "SCENIC_CONTEXT_INVALID", 422)
    requested = context.get("map_id") or preference.get("map_id")
    if requested and requested not in MAP_IDS:
        raise ApiError("景区范围无效", "SCENIC_SCOPE_INVALID", 422)
    if requested and map_ids and requested not in map_ids:
        raise ApiError("景点与当前景区不匹配", "SCENIC_SCOPE_MISMATCH", 422)
    if request.spot_id and not map_ids:
        raise ApiError("景点不存在", "SCENIC_SPOT_UNKNOWN", 404)
    return Scope(map_id=next(iter(map_ids)) if map_ids else requested or "ling-shan", spot_id=request.spot_id)


class GuideCoreRuntime:
    def __init__(self, settings, session_factory):
        self.settings, self.session_factory = settings, session_factory
        self._lock, self._capacity = Lock(), BoundedSemaphore(1)
        self._agent = None
        self._fingerprint = None
        self._memory = None

    def config(self) -> CoreSettings:
        path = Path(self.settings.guide_core_config)
        if not path.is_file():
            raise ApiError("请先配置 configs/core.local.toml", "CORE_NOT_CONFIGURED", 503)
        return CoreSettings.load(str(path))

    def memory(self) -> MemoryStore:
        with self._lock:
            if self._memory is None:
                config = self.config()
                if not config.allow_network and not config.memory.url.startswith("sqlite:///"):
                    raise ApiError("记忆数据库连接尚未启用", "CORE_NETWORK_DISABLED", 503)
                self._memory = MemoryStore(config.memory)
                self._memory.initialize()
            return self._memory

    def _manifest(self, db, config) -> dict:
        path = Path(config.corpus_path).with_suffix(".release.jsonl")
        if not path.is_file():
            raise ApiError("知识索引尚未构建，请执行 python -m app.core_cli rebuild", "CORE_INDEX_MISSING", 503)
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest["database_revision"] != current_revision(db):
            raise ApiError("知识已更新，请重建索引后再咨询", "CORE_INDEX_STALE", 503)
        return manifest

    def status(self, db) -> dict:
        try:
            config = self.config()
            manifest = self._manifest(db, config)
            return {"engine": "agentic", "index": "published", "corpus_id": manifest["corpus_id"],
                    "network_enabled": config.allow_network, "model_loaded": self._agent is not None}
        except ApiError as exc:
            return {"engine": "agentic", "index": "not_ready", "reason": exc.code}

    def agent(self, db) -> GuideAgent:
        config = self.config()
        if not config.allow_network:
            raise ApiError("核心模型服务尚未启用", "CORE_NETWORK_DISABLED", 503)
        manifest = self._manifest(db, config)
        fingerprint = digest([manifest, config.model_dump()])
        with self._lock:
            if self._agent is None or self._fingerprint != fingerprint:
                retriever = HybridRetriever.load(config)
                if retriever.corpus.id != manifest["corpus_id"]:
                    retriever.vectors.client.close()
                    raise ApiError("语料快照与发布记录不匹配", "CORE_SNAPSHOT_MISMATCH", 503)
                if self._agent:
                    self._agent.retriever.vectors.client.close()
                self._agent = GuideAgent(config, retriever, ChatClient(config))
                self._fingerprint = fingerprint
            return self._agent

    def handles(self, request, classification, chat_session) -> bool:
        from app.services.chat import (_is_route_guide_question, _is_scenic_spot_listing_question,
                                       _route_context_direct_result)

        return request.image is None and not (
            _is_route_guide_question(request.question, classification, chat_session)
            or _is_scenic_spot_listing_question(request.question)
            or _route_context_direct_result(request.question, request, classification) is not None
        )

    def answer(self, db, request, chat_session, classification, visitor_id, tts_jobs, *, persona=None):
        from app.schemas import ChatMetrics, ChatResponse
        from app.services.chat import _start_tts
        from app.services.digital_human_persona import persona_prompt

        if not self._capacity.acquire(blocking=False):
            raise ApiError("模型正在处理其他请求，请稍后重试", "CORE_BUSY", 429)
        try:
            started, received_at = perf_counter(), time()
            scope = resolve_scope(db, request, classification)
            consent = self.memory().consent(visitor_id) if visitor_id else {"enabled": False, "epoch": 0}
            enabled = consent["enabled"]
            # The original tour tables have no ownership column. Use a server-owned chat scope,
            # never a client-supplied tour_id, for transient constraints.
            trip_id = chat_session.id
            memories = self.memory().list(visitor_id, trip_id) if enabled else []
            rows = db.scalars(select(ChatMessage).where(ChatMessage.session_id == chat_session.id)
                              .order_by(ChatMessage.id.desc()).limit(6)).all()
            history = [message for row in reversed(rows) for message in [
                {"role": "user", "content": row.question}, {"role": "assistant", "content": row.answer}]]
            # End the bootstrap/read transaction before external inference.
            db.commit()
            agent = self.agent(db)
            result = asyncio.run(agent.answer(request.question, scope, history=history, memories=memories,
                                               visitor_style=persona_prompt(persona)))
            # Do not return evidence deleted/changed while inference was in flight.
            db.rollback()
            manifest = self._manifest(db, agent.settings)
            if manifest["corpus_id"] != result.corpus_id:
                raise ApiError("回答期间知识快照已切换，请重试", "CORE_SNAPSHOT_CHANGED", 409)
            tts_tick = perf_counter()
            audio_url, tts_status, tts_job_id = _start_tts(self.settings, result.answer.text, tts_jobs)
            tts_ms = (perf_counter() - tts_tick) * 1000
            sources = [to_legacy_source(hit) for hit in result.sources]
            metrics = ChatMetrics(retrieval_ms=result.timings_ms["retrieval"], llm_ms=result.timings_ms["llm"],
                                  tts_ms=tts_ms, total_ms=(perf_counter() - started) * 1000, cache_hit=False,
                                  degraded=result.answer.status == "budget_exhausted", classification=classification,
                                  retrieval_mode="qwen3_bm25_milvus_rrf_crossencoder", context_count=len(result.retrieved_contexts),
                                  vector_status="milvus_ready", guide_intent=classification.get("intent", ""),
                                  evidence_profile="approved_corpus", llm_model=agent.settings.models.chat_model,
                                  embedding_model="Qwen3-Embedding")
            recorded_metrics = {**metrics.model_dump(), "core_trace": result.trace,
                                "core_corpus_id": result.corpus_id}
            log = ChatMessage(session_id=chat_session.id, question=request.question, answer=result.answer.text,
                              sources_json=[source.model_dump() for source in sources], metrics_json=recorded_metrics)
            db.add(log)
            db.commit()
            if enabled:
                try:
                    self.memory().enqueue(visitor_id, f"chat-message:{log.id}", [UserTurn(
                        id=str(log.id), text=request.question, observed_at=received_at)], trip_id,
                        consent=True, expected_epoch=consent["epoch"])
                except PermissionError:
                    pass
                except Exception:
                    logger.exception("Memory enqueue failed for persisted message %s", log.id)
            return ChatResponse(answer=result.answer.text, sources=sources, session_id=chat_session.id,
                                audio_url=audio_url, tts_status=tts_status, tts_job_id=tts_job_id,
                                mode="agentic_rag", degraded=metrics.degraded, metrics=metrics,
                                emotion_cue="success" if sources else "idle")
        except ApiError:
            raise
        except Exception as exc:
            logger.exception("Agentic guide failed (%s)", type(exc).__name__)
            raise ApiError("智能问答暂不可用，请检查模型和索引配置", "CORE_UNAVAILABLE", 503) from exc
        finally:
            self._capacity.release()

    def rebuild(self, db) -> dict:
        if not self._capacity.acquire(blocking=False):
            raise ApiError("核心正在使用，请稍后重建", "CORE_BUSY", 409)
        build_lock = None
        try:
            config = self.config()
            if not config.allow_network:
                raise ApiError("请显式允许 Milvus 连接后重建", "CORE_NETWORK_DISABLED", 503)
            base = Path(config.corpus_path)
            base.parent.mkdir(parents=True, exist_ok=True)
            build_lock = FileLock(str(base) + ".build.lock", timeout=0)
            try:
                build_lock.acquire()
            except Timeout as exc:
                raise ApiError("知识索引正在构建", "CORE_BUSY", 409) from exc
            revision = current_revision(db)
            chunks = []
            for map_id in sorted(MAP_IDS):
                chunks.extend(export_legacy_database(db, map_id, approved=True, include_documents=False))
            document_chunks, published_docs = self._document_chunks(db)
            chunks.extend(document_chunks)
            corpus = Corpus(chunks)
            db.commit()
            snapshot = base.with_name(f"{base.stem}.{corpus.id}.jsonl")
            if snapshot.exists():
                if Corpus.load(snapshot).id != corpus.id:
                    raise ValueError("Stored corpus snapshot has a different fingerprint")
            else:
                corpus.save(snapshot)
            embedding = QwenEmbedder(config.models)
            index = MilvusIndex(config, corpus, embedding)
            try:
                index.build()
            finally:
                index.client.close()
            db.rollback()
            if current_revision(db) != revision:
                raise ApiError("构建期间知识发生变化，请重新构建", "CORE_BUILD_SUPERSEDED", 409)
            manifest = {"database_revision": revision, "corpus_id": corpus.id,
                        "corpus_file": snapshot.name, "collection": index.name,
                        "chunk_count": len(corpus.chunks), "published_at": time()}
            for doc in db.scalars(select(KnowledgeDoc)):
                doc.indexed_at = utc_now() if doc.id in published_docs else None
            db.commit()
            write_jsonl(base.with_suffix(".release.jsonl"), [manifest])
            if self._agent:
                self._agent.retriever.vectors.client.close()
            self._agent, self._fingerprint = None, None
            return {"status": "rebuilt", "doc_count": len({chunk.document_id for chunk in corpus.chunks}),
                    "chunk_count": len(corpus.chunks), "corpus_id": corpus.id}
        finally:
            if build_lock is not None:
                build_lock.release()
            self._capacity.release()

    def _document_chunks(self, db):
        # Parse source files, not the original application's flattened preview chunks.
        roots = [Path(self.settings.source_package_path).resolve(),
                 Path(self.settings.derived_knowledge_path).resolve(),
                 (BACKEND_ROOT / "data" / "knowledge_uploads").resolve()]
        chunks, published = [], set()
        for doc in db.scalars(select(KnowledgeDoc).order_by(KnowledgeDoc.id)):
            explicit = db.scalars(select(CoreDocumentScope.map_id)
                                  .where(CoreDocumentScope.document_id == doc.id)).all()
            bindings = {(map_id, "") for map_id in explicit} if explicit else set(db.execute(
                select(MapPoint.map_id, KnowledgeChunk.spot_id)
                .join(KnowledgeChunk, KnowledgeChunk.spot_id == MapPoint.spot_id)
                .where(KnowledgeChunk.doc_id == doc.id).distinct()).all())
            if not bindings:
                continue
            path = Path(doc.path)
            path = (path if path.is_absolute() else BACKEND_ROOT / path).resolve()
            if not any(path.is_relative_to(root) for root in roots) or not path.is_file():
                raise ApiError("知识文件不存在或不在允许目录中", "CORE_SOURCE_UNAVAILABLE", 409)
            if hashlib.sha256(path.read_bytes()).hexdigest() != doc.content_hash:
                raise ApiError("原始文档已更改，请先重新导入知识数据", "CORE_SOURCE_CHANGED", 409)
            anchor_path = path.with_suffix(path.suffix + ".tables.json")
            anchors = json.loads(anchor_path.read_text(encoding="utf-8")) if anchor_path.is_file() else {}
            if not isinstance(anchors, dict) or not all(isinstance(k, str) and isinstance(v, str)
                                                      for k, v in anchors.items()):
                raise ValueError("Table anchors must map page:table identifiers to names")
            for map_id, spot_id in sorted(bindings):
                if map_id not in MAP_IDS:
                    raise ValueError("Document refers to an unknown scenic-area scope")
                created = chunk_blocks(parse_document(path, anchors),
                                       document_id=f"legacy:{map_id}:{spot_id}:{doc.id}",
                                       title=doc.title, map_id=map_id, spot_id=spot_id or "",
                                       source_type=doc.source_type, approved=True)
                for chunk in created:
                    chunk.metadata["legacy_doc_id"] = doc.id
                chunks.extend(created)
                if created:
                    published.add(doc.id)
        return chunks, published

    def close(self) -> None:
        if self._memory:
            self._memory.engine.dispose()
        if self._agent:
            self._agent.retriever.vectors.client.close()
