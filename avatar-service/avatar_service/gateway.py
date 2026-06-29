from typing import Protocol

import httpx


class WebRtcGateway(Protocol):
    async def exchange(self, payload: dict[str, object]) -> dict[str, object]: ...

    async def speak(self, session_id: str, payload: dict[str, object]) -> None: ...

    async def interrupt(self, session_id: str) -> None: ...


class HttpOpenAvatarGateway:
    def __init__(self, base_url: str = "http://127.0.0.1:8282"):
        self.base_url = base_url.rstrip("/")

    async def exchange(self, payload: dict[str, object]) -> dict[str, object]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{self.base_url}/webrtc/offer", json=payload)
            response.raise_for_status()
            return response.json()

    async def speak(self, session_id: str, payload: dict[str, object]) -> None:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{self.base_url}/a5/sessions/{session_id}/speech",
                json=payload,
            )
            response.raise_for_status()

    async def interrupt(self, session_id: str) -> None:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{self.base_url}/a5/sessions/{session_id}/interrupt")
            response.raise_for_status()
