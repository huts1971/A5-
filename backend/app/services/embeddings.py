from __future__ import annotations

from math import sqrt
from threading import Lock

import httpx


_CLIENTS: dict[tuple[str, float], httpx.Client] = {}
_CLIENTS_LOCK = Lock()


class EmbeddingClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_seconds: float = 0.8,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    def embed_texts(self, model: str, texts: list[str]) -> list[list[float]]:
        payload = {"model": model, "input": texts}
        if self.transport is not None:
            with httpx.Client(transport=self.transport, timeout=self.timeout_seconds) as client:
                response = client.post(
                    f"{self.base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
        else:
            client = self._shared_client()
            response = client.post(
                f"{self.base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
        rows = sorted(body.get("data", []), key=lambda item: item.get("index", 0))
        return [
            [float(value) for value in row.get("embedding", [])]
            for row in rows
        ]

    def _shared_client(self) -> httpx.Client:
        key = (self.base_url, self.timeout_seconds)
        with _CLIENTS_LOCK:
            client = _CLIENTS.get(key)
            if client is None or client.is_closed:
                client = httpx.Client(timeout=self.timeout_seconds)
                _CLIENTS[key] = client
            return client


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = sqrt(sum(value * value for value in left))
    right_norm = sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)
