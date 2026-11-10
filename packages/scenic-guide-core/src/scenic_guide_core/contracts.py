from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def digest(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scope(StrictModel):
    map_id: str = Field(min_length=1, max_length=100)
    spot_id: str | None = None


class Chunk(StrictModel):
    id: str
    document_id: str
    parent_id: str
    title: str
    section: str = ""
    text: str = Field(min_length=1, max_length=12000)
    map_id: str = Field(min_length=1, max_length=100)
    spot_id: str = Field(default="", max_length=128)
    source_url: str = ""
    source_type: str = "document"
    pages: list[int] = Field(default_factory=list)
    approved: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class Hit(StrictModel):
    chunk: Chunk
    bm25_rank: int | None = None
    vector_rank: int | None = None
    fusion_score: float = 0.0
    rerank_score: float | None = None


class RetrievalResult(StrictModel):
    hits: list[Hit]
    timings_ms: dict[str, float]
    corpus_id: str
    mode: str


class Answer(StrictModel):
    text: str = Field(min_length=1, max_length=12000)
    kind: Literal["factual", "chat"] = "factual"
    citations: list[str] = Field(default_factory=list)
    status: Literal["answered", "refused", "clarification", "budget_exhausted"]


class GuideResult(StrictModel):
    question: str
    answer: Answer
    sources: list[Hit]
    retrieved_contexts: list[str]
    trace: list[dict[str, Any]]
    timings_ms: dict[str, float]
    corpus_id: str


class TrainingExample(StrictModel):
    id: str
    category: Literal["single_hop", "multi_hop", "refusal", "chat", "tool_use"]
    document_ids: list[str]
    chunk_ids: list[str]
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]] = Field(default_factory=list)
    approved: bool = False
    reviewer: str = ""
    split: Literal["train", "dev", "test"]
    provenance: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_approval(self) -> TrainingExample:
        if self.approved and not self.reviewer.strip():
            raise ValueError("Approved training data requires a reviewer")
        if not self.messages or self.messages[-1].get("role") != "assistant":
            raise ValueError("Training conversation must end in an assistant message")
        return self
