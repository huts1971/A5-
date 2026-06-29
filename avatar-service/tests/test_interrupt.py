from fastapi.testclient import TestClient

from avatar_service.app import create_app
from avatar_service.runtime import RuntimeStatus


class ReadyRuntime:
    def status(self) -> RuntimeStatus:
        return RuntimeStatus(ready=True, detail="OpenAvatarChat is ready")


class RecordingGateway:
    def __init__(self):
        self.interrupted: list[str] = []

    async def interrupt(self, session_id: str) -> None:
        self.interrupted.append(session_id)


def test_bridge_interrupts_current_avatar_playback() -> None:
    gateway = RecordingGateway()
    client = TestClient(create_app(runtime=ReadyRuntime(), webrtc_gateway=gateway))
    session_id = client.post("/api/avatar/sessions").json()["session_id"]

    response = client.post(f"/api/avatar/sessions/{session_id}/interrupt")

    assert response.status_code == 202
    assert gateway.interrupted == [session_id]
