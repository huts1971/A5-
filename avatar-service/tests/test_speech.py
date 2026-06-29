from fastapi.testclient import TestClient

from avatar_service.app import create_app
from avatar_service.runtime import RuntimeStatus


class ReadyRuntime:
    def status(self) -> RuntimeStatus:
        return RuntimeStatus(ready=True, detail="OpenAvatarChat is ready")


class PreparingRuntime:
    def status(self) -> RuntimeStatus:
        return RuntimeStatus(ready=False, detail="OpenAvatarChat model is loading")


class RecordingGateway:
    def __init__(self):
        self.chunks: list[tuple[str, dict[str, object]]] = []

    async def speak(self, session_id: str, payload: dict[str, object]) -> None:
        self.chunks.append((session_id, payload))


def test_bridge_forwards_one_streaming_answer_chunk_to_openavatar() -> None:
    gateway = RecordingGateway()
    client = TestClient(create_app(runtime=ReadyRuntime(), webrtc_gateway=gateway))
    session_id = client.post("/api/avatar/sessions").json()["session_id"]
    chunk = {
        "stream_id": "answer-123",
        "text": "灵山大佛高八十八米，",
        "end": False,
    }

    response = client.post(f"/api/avatar/sessions/{session_id}/speech", json=chunk)

    assert response.status_code == 202
    assert gateway.chunks == [(session_id, chunk)]


def test_bridge_drops_speech_while_avatar_is_not_ready() -> None:
    gateway = RecordingGateway()
    client = TestClient(create_app(runtime=PreparingRuntime(), webrtc_gateway=gateway))
    session_id = client.post("/api/avatar/sessions").json()["session_id"]

    response = client.post(
        f"/api/avatar/sessions/{session_id}/speech",
        json={"stream_id": "answer-123", "text": "不会补播", "end": True},
    )

    assert response.status_code == 409
    assert gateway.chunks == []
