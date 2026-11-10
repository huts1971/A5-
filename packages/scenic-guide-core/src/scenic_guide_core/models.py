from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .config import Models, Settings


def local_model(path: str) -> str:
    candidate = Path(path).resolve()
    if not candidate.is_dir():
        raise FileNotFoundError(f"Supply a downloaded local model directory: {candidate}")
    return str(candidate)


class QwenEmbedder:
    def __init__(self, config: Models):
        from sentence_transformers import SentenceTransformer

        if config.embedding_revision.startswith("SET_"):
            raise ValueError("Set embedding_revision to the local weights' revision/hash")
        self.model = SentenceTransformer(local_model(config.embedding_path), device=config.device,
                                         local_files_only=True, trust_remote_code=False)
        self.model.max_seq_length = config.embedding_max_tokens
        self.dimension = self.model.get_sentence_embedding_dimension()
        self.config = config

    def documents(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts, normalize_embeddings=True, batch_size=8,
                                 show_progress_bar=False).tolist()

    def query(self, text: str) -> list[float]:
        prompt = f"Instruct: {self.config.query_instruction}\nQuery: "
        return self.model.encode([text], prompt=prompt, normalize_embeddings=True,
                                 show_progress_bar=False)[0].tolist()


class LocalCrossEncoder:
    def __init__(self, config: Models):
        from sentence_transformers import CrossEncoder

        if config.reranker_revision.startswith("SET_"):
            raise ValueError("Set reranker_revision to the local weights' revision/hash")
        self.model = CrossEncoder(local_model(config.reranker_path), device=config.device,
                                  max_length=1024, local_files_only=True, trust_remote_code=False)

    def scores(self, question: str, documents: list[str]) -> list[float]:
        if not documents:
            return []
        values = self.model.predict([(question, document) for document in documents],
                                    batch_size=8, show_progress_bar=False)
        if getattr(values, "ndim", 1) != 1:
            raise ValueError("Reranker must emit one relevance score per pair")
        return [float(value) for value in values]


class ChatClient:
    """OpenAI-compatible protocol; no model-provider SDK defaults or hidden retry."""

    def __init__(self, settings: Settings):
        if not settings.allow_network:
            raise PermissionError("Model calls require allow_network=true, including local servers")
        self.config = settings.models
        url = urlsplit(self.config.chat_base_url)
        if url.scheme not in {"http", "https"} or not url.hostname:
            raise ValueError("Invalid model base URL")
        if url.scheme == "http" and url.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Remote model endpoints must use HTTPS")
        key = os.environ.get(self.config.api_key_env, "")
        if not key and url.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError(f"Missing credential: {self.config.api_key_env}")
        self.headers = {"Authorization": f"Bearer {key}"} if key else {}

    async def complete(self, messages: list[dict], *, tools: list[dict] | None = None,
                       json_schema: dict | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"model": self.config.chat_model, "messages": messages,
                                "temperature": 0.1, "max_tokens": self.config.max_output_tokens}
        if self.config.chat_template_kwargs:
            body["chat_template_kwargs"] = self.config.chat_template_kwargs
        if tools:
            body.update(tools=tools, tool_choice="auto")
        if json_schema:
            body["response_format"] = {"type": "json_schema", "json_schema": {
                "name": "structured_result", "strict": True, "schema": json_schema}}
        async with httpx.AsyncClient(timeout=self.config.chat_timeout_seconds, trust_env=False) as client:
            response = await client.post(self.config.chat_base_url.rstrip("/") + "/chat/completions",
                                         headers=self.headers, json=body)
            response.raise_for_status()
            value = response.json()
        choice = value["choices"][0]
        if choice.get("message", {}).get("role") != "assistant":
            raise ValueError("Model endpoint returned a non-assistant message")
        if choice.get("finish_reason") in {"length", "content_filter"}:
            raise ValueError(f"Incomplete model response: {choice.get('finish_reason')}")
        return {"message": choice["message"], "usage": value.get("usage"),
                "model": value.get("model", self.config.chat_model), "cost": None}

    async def structured(self, messages: list[dict], schema: type) -> tuple[Any, dict]:
        result = await self.complete(messages, json_schema=schema.model_json_schema())
        content = result["message"].get("content")
        if not isinstance(content, str):
            raise ValueError("Expected JSON text, not a tool call or missing response")
        return schema.model_validate(json.loads(content)), result
