from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import jieba
from filelock import FileLock
from rank_bm25 import BM25Okapi

from .config import Settings
from .contracts import Hit, RetrievalResult, Scope, digest
from .ingestion import Corpus, write_jsonl
from .models import LocalCrossEncoder, QwenEmbedder


def tokenize(text: str) -> list[str]:
    return [part.lower() for part in jieba.cut(text) if re.search(r"[\w\u4e00-\u9fff]", part)]


def in_scope(chunk, scope: Scope) -> bool:
    return chunk.map_id == scope.map_id and (not scope.spot_id or chunk.spot_id in {"", scope.spot_id})


class LexicalIndex:
    def __init__(self, corpus: Corpus):
        self.corpus = corpus
        self.index = BM25Okapi([tokenize(c.title + " " + c.section + " " + c.text) or ["__empty__"]
                               for c in corpus.chunks])

    def search(self, question: str, scope: Scope, limit: int) -> list[str]:
        query = tokenize(question)
        if not query:
            return []
        scores = self.index.get_scores(query)
        # Filter before top-k; negative/zero BM25 scores can still be valid in small corpora.
        eligible = [(float(scores[i]), c.id) for i, c in enumerate(self.corpus.chunks)
                    if in_scope(c, scope) and any(t in self.index.doc_freqs[i] for t in query)]
        return [cid for _, cid in sorted(eligible, key=lambda pair: (-pair[0], pair[1]))[:limit]]


class MilvusIndex:
    def __init__(self, settings: Settings, corpus: Corpus, embedder: QwenEmbedder):
        from pymilvus import MilvusClient

        if not settings.allow_network:
            raise PermissionError("Milvus connection requires allow_network=true")
        prefix = settings.retrieval.collection_prefix
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,30}", prefix):
            raise ValueError("Invalid collection prefix")
        self.corpus, self.embedder = corpus, embedder
        self.fingerprint = digest([corpus.id, settings.models.embedding_revision, embedder.dimension,
                                   settings.models.embedding_max_tokens, settings.models.query_instruction])
        self.name = prefix + "_" + self.fingerprint[:24]
        self.client = MilvusClient(uri=settings.retrieval.milvus_uri,
                                   token=os.environ.get(settings.retrieval.milvus_token_env, ""), timeout=30)
        self.manifest = Path(settings.corpus_path).parent / (self.name + ".index.jsonl")

    def build(self) -> None:
        self.manifest.parent.mkdir(parents=True, exist_ok=True)
        with FileLock(str(self.manifest) + ".build.lock", timeout=0):
            self._build_locked()

    def _build_locked(self) -> None:
        from pymilvus import DataType

        exists = self.client.has_collection(self.name)
        if exists and self.manifest.is_file():
            self.verify()
            return
        schema = self.client.create_schema(auto_id=False, enable_dynamic_field=False)
        schema.add_field("id", DataType.VARCHAR, is_primary=True, max_length=64)
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=self.embedder.dimension)
        schema.add_field("map_id", DataType.VARCHAR, max_length=100)
        schema.add_field("spot_id", DataType.VARCHAR, max_length=128)
        schema.add_field("corpus_id", DataType.VARCHAR, max_length=64)
        params = self.client.prepare_index_params()
        params.add_index(field_name="vector", index_type="HNSW", metric_type="COSINE",
                         params={"M": 16, "efConstruction": 128})
        if not exists:
            self.client.create_collection(collection_name=self.name, schema=schema, index_params=params,
                                          consistency_level="Strong")
        for start in range(0, len(self.corpus.chunks), 32):
            batch = self.corpus.chunks[start:start + 32]
            vectors = self.embedder.documents([c.title + "\n" + c.section + "\n" + c.text for c in batch])
            self.client.upsert(collection_name=self.name, data=[{
                "id": chunk.id, "vector": vector, "map_id": chunk.map_id,
                "spot_id": chunk.spot_id, "corpus_id": self.corpus.id,
            } for chunk, vector in zip(batch, vectors, strict=True)])
        self.client.flush(collection_name=self.name)
        self.client.load_collection(collection_name=self.name)
        count = self.client.query(collection_name=self.name, filter="", output_fields=["count(*)"],
                                  consistency_level="Strong")[0]["count(*)"]
        if int(count) != len(self.corpus.chunks):
            raise RuntimeError("Milvus entity count differs from corpus chunk count")
        write_jsonl(self.manifest, [{"fingerprint": self.fingerprint, "count": count, "state": "ready"}])

    def verify(self) -> None:
        if not self.manifest.exists() or not self.client.has_collection(self.name):
            raise RuntimeError("Index manifest missing; run the index build command")
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        if (manifest.get("state") != "ready" or manifest.get("fingerprint") != self.fingerprint
                or manifest.get("count") != len(self.corpus.chunks)):
            raise ValueError("Corpus/index mismatch")
        self.client.load_collection(collection_name=self.name)
        count = self.client.query(collection_name=self.name, filter="", output_fields=["count(*)"],
                                  consistency_level="Strong")[0]["count(*)"]
        if int(count) != len(self.corpus.chunks):
            raise ValueError("Remote collection count differs from immutable corpus snapshot")

    def search(self, vector: list[float], scope: Scope, limit: int) -> list[str]:
        clauses = ["map_id == " + json.dumps(scope.map_id),
                   "corpus_id == " + json.dumps(self.corpus.id)]
        if scope.spot_id:
            clauses.append('(spot_id == "" or spot_id == ' + json.dumps(scope.spot_id) + ")")
        result = self.client.search(collection_name=self.name, data=[vector], anns_field="vector",
                                    filter=" and ".join(clauses), limit=limit,
                                    search_params={"metric_type": "COSINE", "params": {"ef": max(128, limit)}})
        ids = [str(item["id"]) for item in result[0]]
        if any(cid not in self.corpus.by_id or not in_scope(self.corpus.by_id[cid], scope) for cid in ids):
            raise RuntimeError("Vector search returned an out-of-snapshot or out-of-scope record")
        return ids


class HybridRetriever:
    def __init__(self, settings: Settings, corpus: Corpus, vectors: MilvusIndex,
                 embedder: QwenEmbedder, reranker: LocalCrossEncoder):
        self.settings, self.corpus = settings, corpus
        self.lexical, self.vectors = LexicalIndex(corpus), vectors
        self.embedder, self.reranker = embedder, reranker

    @classmethod
    def load(cls, settings: Settings) -> HybridRetriever:
        corpus = Corpus.load(settings.corpus_path)
        embedder = QwenEmbedder(settings.models)
        vectors = MilvusIndex(settings, corpus, embedder)
        try:
            vectors.verify()
            return cls(settings, corpus, vectors, embedder, LocalCrossEncoder(settings.models))
        except Exception:
            vectors.client.close()
            raise

    def search(self, question: str, scope: Scope, top_k: int | None = None,
               mode: str = "hybrid_rerank") -> RetrievalResult:
        if mode not in {"bm25", "vector", "hybrid", "hybrid_rerank"}:
            raise ValueError("Unknown retrieval mode")
        if not question.strip() or len(question) > 4000:
            raise ValueError("Question must contain 1..4000 characters")
        config = self.settings.retrieval
        count = top_k if top_k is not None else config.top_k
        if not 1 <= count <= config.rerank_candidates:
            raise ValueError("top_k must not exceed rerank_candidates")
        timings: dict[str, float] = {}
        started = time.perf_counter()
        lexical, semantic = [], []
        if mode != "vector":
            tick = time.perf_counter()
            lexical = self.lexical.search(question, scope, config.candidates_per_route)
            timings["bm25"] = (time.perf_counter() - tick) * 1000
        if mode != "bm25":
            tick = time.perf_counter()
            vector = self.embedder.query(question)
            timings["embedding"] = (time.perf_counter() - tick) * 1000
            tick = time.perf_counter()
            semantic = self.vectors.search(vector, scope, config.candidates_per_route)
            timings["vector"] = (time.perf_counter() - tick) * 1000
        merged: dict[str, Hit] = {}
        for route, ids, weight in [("bm25", lexical, config.bm25_weight),
                                    ("vector", semantic, config.vector_weight)]:
            for rank, cid in enumerate(dict.fromkeys(ids), 1):
                hit = merged.setdefault(cid, Hit(chunk=self.corpus.by_id[cid]))
                setattr(hit, route + "_rank", rank)
                hit.fusion_score += weight / (config.rrf_k + rank)
        hits = sorted(merged.values(), key=lambda h: (-h.fusion_score, h.chunk.id))[:config.rerank_candidates]
        if mode == "hybrid_rerank" and hits:
            tick = time.perf_counter()
            scores = self.reranker.scores(question, [h.chunk.title + "\n" + h.chunk.text for h in hits])
            for hit, score in zip(hits, scores, strict=True):
                hit.rerank_score = score
            hits.sort(key=lambda h: (-float(h.rerank_score), -h.fusion_score, h.chunk.id))
            timings["rerank"] = (time.perf_counter() - tick) * 1000
        timings["total"] = (time.perf_counter() - started) * 1000
        return RetrievalResult(hits=hits[:count], timings_ms=timings, corpus_id=self.corpus.id, mode=mode)
