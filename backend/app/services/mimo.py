from __future__ import annotations

import base64
import json
from threading import Lock

import httpx


_CLIENTS: dict[tuple[str, float], httpx.Client] = {}
_CLIENTS_LOCK = Lock()


class MimoClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.transport = transport

    def chat_completion(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float | None = None,
        max_completion_tokens: int | None = None,
        timeout_seconds: float | None = None,
    ) -> str:
        payload = self._chat_payload(
            model,
            system_prompt,
            user_prompt,
            stream=False,
            temperature=temperature,
            max_completion_tokens=max_completion_tokens,
        )
        response = self._post_chat_completions(payload, timeout=timeout_seconds or 60)
        return response["choices"][0]["message"]["content"]

    def vision_chat_completion(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        image_data_url: str,
        temperature: float | None = None,
        max_completion_tokens: int | None = None,
        timeout_seconds: float | None = None,
    ) -> str:
        payload = self._chat_payload(
            model,
            system_prompt,
            user_prompt,
            stream=False,
            temperature=temperature,
            max_completion_tokens=max_completion_tokens,
        )
        payload["messages"] = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ]
        response = self._post_chat_completions(payload, timeout=timeout_seconds or 60)
        return _message_content_to_text(response["choices"][0]["message"].get("content", ""))

    def web_search_completion(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        max_results: int,
        timeout_seconds: float,
    ) -> dict:
        payload = self._chat_payload(model, system_prompt, user_prompt, stream=False)
        payload["tools"] = [
            {
                "type": "web_search",
                "max_keyword": 2,
                "forced_search": True,
                "force_search": True,
                "limit": max_results,
            }
        ]
        payload["tool_choice"] = "auto"
        payload["thinking"] = {"type": "disabled"}
        response = self._post_chat_completions(payload, timeout=timeout_seconds)
        message = response["choices"][0]["message"]
        return {
            "content": message.get("content", ""),
            "annotations": message.get("annotations") or [],
        }

    def chat_completion_stream(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float | None = None,
        max_completion_tokens: int | None = None,
    ):
        payload = self._chat_payload(
            model,
            system_prompt,
            user_prompt,
            stream=True,
            temperature=temperature,
            max_completion_tokens=max_completion_tokens,
        )
        client = self._ephemeral_client(60) if self.transport is not None else self._shared_client(60)
        try:
            with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={
                    "api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line.removeprefix("data: ").strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    content = chunk["choices"][0].get("delta", {}).get("content")
                    if content:
                        yield content
        finally:
            if self.transport is not None:
                client.close()

    def synthesize_speech(
        self,
        model: str,
        text: str,
        voice: str,
        audio_format: str,
        style_prompt: str = "温暖、清晰、自然的中文景区导游语气。",
    ) -> bytes:
        payload = {
            "model": model,
            "messages": [
                {"role": "user", "content": style_prompt},
                {"role": "assistant", "content": text},
            ],
            "audio": {
                "format": audio_format,
                "voice": voice,
            },
        }
        response = self._post_chat_completions(payload)
        audio_data = response["choices"][0]["message"]["audio"]["data"]
        return base64.b64decode(audio_data)

    def _post_chat_completions(self, payload: dict, timeout: float = 60) -> dict:
        client = self._ephemeral_client(timeout) if self.transport is not None else self._shared_client(timeout)
        try:
            response = client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "api-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            response.raise_for_status()
            return response.json()
        finally:
            if self.transport is not None:
                client.close()

    def _ephemeral_client(self, timeout: float) -> httpx.Client:
        return httpx.Client(transport=self.transport, timeout=timeout)

    def _shared_client(self, timeout: float) -> httpx.Client:
        key = (self.base_url, timeout)
        with _CLIENTS_LOCK:
            client = _CLIENTS.get(key)
            if client is None or client.is_closed:
                client = httpx.Client(timeout=timeout)
                _CLIENTS[key] = client
            return client

    def _chat_payload(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        stream: bool,
        temperature: float | None = None,
        max_completion_tokens: int | None = None,
    ) -> dict:
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_completion_tokens": max_completion_tokens or 1024,
            "temperature": 0.7 if temperature is None else temperature,
            "top_p": 0.95,
            "stream": stream,
        }


def _message_content_to_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        return "".join(parts)
    return str(content or "")
