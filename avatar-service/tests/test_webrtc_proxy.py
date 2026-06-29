from fastapi.testclient import TestClient

from avatar_service.app import create_app
from avatar_service.runtime import RuntimeStatus


class ReadyRuntime:
    def status(self) -> RuntimeStatus:
        return RuntimeStatus(ready=True, detail="OpenAvatarChat is ready")


class RecordingGateway:
    def __init__(self):
        self.offers: list[dict[str, object]] = []

    async def exchange(self, payload: dict[str, object]) -> dict[str, object]:
        self.offers.append(payload)
        return {"sdp": "server-answer", "type": "answer"}


def test_bridge_forwards_webrtc_negotiation_to_openavatar() -> None:
    gateway = RecordingGateway()
    client = TestClient(create_app(runtime=ReadyRuntime(), webrtc_gateway=gateway))
    offer = {
        "sdp": "local-offer",
        "type": "offer",
        "webrtc_id": "a5-guide-123",
    }

    response = client.post("/api/avatar/webrtc/offer", json=offer)

    assert response.status_code == 200
    assert response.json() == {"sdp": "server-answer", "type": "answer"}
    assert gateway.offers == [offer]
