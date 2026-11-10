from __future__ import annotations

import json
import math
import os
import statistics
from pathlib import Path

from .config import Settings
from .contracts import Scope, digest
from .ingestion import write_jsonl
from .models import ChatClient, QwenEmbedder
from .retrieval import HybridRetriever, in_scope


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


async def generate_predictions(agent, dataset: Path, output: Path, max_samples: int = 20) -> dict:
    rows = read_jsonl(dataset)
    if not 1 <= len(rows) <= max_samples or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Use a nonempty, uniquely identified evaluation set within the sample budget")
    predictions = []
    for row in rows:
        try:
            response = await agent.answer(row["question"], Scope.model_validate(row["scope"]))
            prediction = {"id": row["id"], "user_input": row["question"], "response": response.answer.text,
                          "retrieved_contexts": response.retrieved_contexts, "status": response.answer.status,
                          "corpus_id": response.corpus_id, "timings_ms": response.timings_ms,
                          "trace": response.trace, "error": None}
        except Exception as exc:
            prediction = {"id": row["id"], "user_input": row["question"], "response": "",
                          "retrieved_contexts": [], "status": "failed", "error": type(exc).__name__}
        predictions.append(prediction)
        write_jsonl(output, predictions)
    return {"n": len(rows), "failed": sum(p["error"] is not None for p in predictions),
            "max_model_calls": len(rows) * agent.settings.max_agent_rounds}


def retrieval_eval(retriever: HybridRetriever, dataset: Path, output: Path) -> dict:
    samples = read_jsonl(dataset)
    if not samples:
        raise ValueError("Empty evaluation set")
    if len({row["id"] for row in samples}) != len(samples):
        raise ValueError("Duplicate evaluation IDs")
    modes = ["bm25", "vector", "hybrid", "hybrid_rerank"]
    details = []
    for sample in samples:
        scope = Scope.model_validate(sample["scope"])
        gold = set(sample["relevant_chunk_ids"])
        if not gold:
            raise ValueError("Recall requires labeled positives; evaluate refusals separately")
        if sample["corpus_id"] != retriever.corpus.id:
            raise ValueError("Evaluation labels refer to a different corpus")
        if any(cid not in retriever.corpus.by_id or not in_scope(retriever.corpus.by_id[cid], scope) for cid in gold):
            raise ValueError("Gold labels outside the indexed scope")
        for mode in modes:
            try:
                result = retriever.search(sample["question"], scope, top_k=5, mode=mode)
                ids = [hit.chunk.id for hit in result.hits]
                match = [int(cid in gold) for cid in ids]
                dcg = sum(value / math.log2(rank + 2) for rank, value in enumerate(match))
                ideal = sum(1 / math.log2(rank + 2) for rank in range(min(5, len(gold))))
                row = {"id": sample["id"], "mode": mode, "retrieved_ids": ids,
                       "recall_at_5": len(set(ids) & gold) / len(gold), "hit_at_5": int(any(match)),
                       "mrr_at_5": next((1 / (i + 1) for i, x in enumerate(match) if x), 0),
                       "ndcg_at_5": dcg / ideal, "timings_ms": result.timings_ms, "error": None}
            except Exception as exc:
                row = {"id": sample["id"], "mode": mode, "recall_at_5": 0.0, "hit_at_5": 0,
                       "mrr_at_5": 0.0, "ndcg_at_5": 0.0, "error": type(exc).__name__}
            details.append(row)
    summary = {}
    for mode in modes:
        rows = [row for row in details if row["mode"] == mode]
        summary[mode] = {key: statistics.mean(row[key] for row in rows)
                         for key in ["recall_at_5", "hit_at_5", "mrr_at_5", "ndcg_at_5"]}
        summary[mode]["errors"] = sum(row["error"] is not None for row in rows)
    report = {"dataset_hash": digest(samples), "corpus_id": retriever.corpus.id, "n": len(samples),
              "unit": "ratio_0_to_1", "results": summary,
              "delta_vector_to_hybrid_rerank": summary["hybrid_rerank"]["recall_at_5"] - summary["vector"]["recall_at_5"]}
    write_jsonl(output, details)
    write_jsonl(output.with_suffix(".summary.jsonl"), [report])
    return report


def ragas_eval(settings: Settings, predictions: Path, output: Path, *, max_samples: int = 100) -> dict:
    ChatClient(settings)
    from langchain_core.embeddings import Embeddings
    from langchain_openai import ChatOpenAI
    from ragas import EvaluationDataset, evaluate
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import Faithfulness, ResponseRelevancy
    from ragas.run_config import RunConfig

    rows = read_jsonl(predictions)
    if not 1 <= len(rows) <= max_samples:
        raise ValueError("Evaluation exceeds the explicit sample budget or is empty")
    for row in rows:
        if any(key not in row for key in ["id", "user_input", "response", "retrieved_contexts"]):
            raise ValueError("Missing RAGAS input fields")
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate evaluation IDs")
    encoder = QwenEmbedder(settings.models)

    class LocalEmbeddings(Embeddings):
        def embed_documents(self, texts: list[str]) -> list[list[float]]:
            return encoder.documents(texts)

        def embed_query(self, text: str) -> list[float]:
            return encoder.documents([text])[0]

    judge = ChatOpenAI(model=settings.models.chat_model, base_url=settings.models.chat_base_url,
                       api_key=os.environ.get(settings.models.api_key_env, "local-no-key"),
                       temperature=0, max_tokens=settings.models.max_output_tokens,
                       timeout=settings.models.chat_timeout_seconds, max_retries=0,
                       extra_body={"chat_template_kwargs": settings.models.chat_template_kwargs}
                       if settings.models.chat_template_kwargs else {})
    data = EvaluationDataset.from_list([{k: row[k] for k in ["user_input", "response", "retrieved_contexts"]}
                                       for row in rows])
    llm = LangchainLLMWrapper(judge)
    result = evaluate(data, metrics=[Faithfulness(llm=llm),
                                      ResponseRelevancy(llm=llm, embeddings=LangchainEmbeddingsWrapper(LocalEmbeddings()))],
                      run_config=RunConfig(max_workers=1, max_retries=1, timeout=settings.models.chat_timeout_seconds),
                      raise_exceptions=False, show_progress=False)
    scored = result.to_pandas().to_dict(orient="records")
    details, summary = [], {}
    def finite_score(value):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number if math.isfinite(number) else None

    for original, score in zip(rows, scored, strict=True):
        details.append({"id": original["id"], **{key: finite_score(score[key])
                                                 for key in ["faithfulness", "answer_relevancy"]}})
    for key in ["faithfulness", "answer_relevancy"]:
        values = [row[key] for row in details if row[key] is not None]
        summary[key] = {"mean_on_valid": statistics.mean(values) if values else None,
                        "valid": len(values), "failed": len(rows) - len(values), "total": len(rows)}
    report = {"dataset_hash": digest(rows), "judge_model": settings.models.chat_model,
              "embedding_revision": settings.models.embedding_revision, "cost": None,
              "upstream_generation_failures": sum(row.get("error") is not None for row in rows), "results": summary}
    write_jsonl(output, details)
    write_jsonl(output.with_suffix(".summary.jsonl"), [report])
    return report
