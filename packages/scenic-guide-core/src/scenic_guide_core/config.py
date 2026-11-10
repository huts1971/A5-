from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import Field

from .contracts import StrictModel


class Models(StrictModel):
    embedding_path: str = "models/Qwen3-Embedding-0.6B"
    reranker_path: str = "models/bge-reranker-v2-m3"
    device: str = "cpu"
    embedding_revision: str = "SET_LOCAL_MODEL_REVISION"
    reranker_revision: str = "SET_LOCAL_MODEL_REVISION"
    embedding_max_tokens: int = Field(default=2048, ge=128)
    query_instruction: str = "Given a tourist question, retrieve relevant scenic-area evidence."
    chat_base_url: str = "http://127.0.0.1:8002/v1"
    chat_model: str = "Qwen3-8B"
    api_key_env: str = "SCENIC_LLM_API_KEY"
    chat_timeout_seconds: float = Field(default=60, gt=0)
    max_output_tokens: int = Field(default=1536, ge=128)
    chat_template_kwargs: dict = Field(default_factory=dict)


class Retrieval(StrictModel):
    milvus_uri: str = "http://127.0.0.1:19530"
    milvus_token_env: str = "SCENIC_MILVUS_TOKEN"
    collection_prefix: str = "scenic"
    candidates_per_route: int = Field(default=24, ge=5, le=200)
    rerank_candidates: int = Field(default=20, ge=5, le=200)
    top_k: int = Field(default=5, ge=1, le=20)
    rrf_k: int = Field(default=60, ge=1)
    bm25_weight: float = Field(default=1, gt=0)
    vector_weight: float = Field(default=1, gt=0)
    max_context_chars: int = Field(default=12000, ge=1000, le=100000)


class Memory(StrictModel):
    url: str = "sqlite:///artifacts/memory.sqlite3"
    dynamic_ttl_days: int = Field(default=7, ge=1, le=90)
    max_items: int = Field(default=8, ge=1, le=30)
    lease_seconds: int = Field(default=180, ge=30)
    max_job_attempts: int = Field(default=3, ge=1, le=5)


class Settings(StrictModel):
    allow_network: bool = False
    corpus_path: str = "artifacts/corpus.jsonl"
    max_agent_rounds: int = Field(default=6, ge=1, le=12)
    max_tool_calls: int = Field(default=8, ge=1, le=24)
    max_prompt_chars: int = Field(default=28000, ge=4000, le=100000)
    models: Models = Field(default_factory=Models)
    retrieval: Retrieval = Field(default_factory=Retrieval)
    memory: Memory = Field(default_factory=Memory)

    @classmethod
    def load(cls, path: str) -> Settings:
        root = Path(path).resolve().parent
        with open(path, "rb") as stream:
            config = cls.model_validate(tomllib.load(stream))
        # File paths are relative to the TOML location, not the shell's cwd.
        for obj, attr in [(config, "corpus_path"), (config.models, "embedding_path"),
                          (config.models, "reranker_path")]:
            candidate = Path(getattr(obj, attr))
            setattr(obj, attr, str(candidate if candidate.is_absolute() else root / candidate))
        if config.memory.url.startswith("sqlite:///"):
            value = config.memory.url.removeprefix("sqlite:///")
            p = Path(value)
            if not p.is_absolute():
                config.memory.url = "sqlite:///" + (root / p).as_posix()
        return config
