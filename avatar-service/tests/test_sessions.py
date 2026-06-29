from fastapi.testclient import TestClient

from avatar_service.app import create_app
from avatar_service.runtime import RuntimeStatus


class ReadyRuntime:
    def status(self) -> RuntimeStatus:
        return RuntimeStatus(ready=True, detail="OpenAvatarChat is ready")


def test_guide_can_create_one_avatar_session() -> None:
    client = TestClient(create_app(runtime=ReadyRuntime()))

    response = client.post("/api/avatar/sessions")

    assert response.status_code == 201
    body = response.json()
    assert body["session_id"]
    assert body["status"] == "ready"
    assert body["openavatar_url"] == "http://127.0.0.1:8282"


def test_guide_can_destroy_its_avatar_session() -> None:
    client = TestClient(create_app(runtime=ReadyRuntime()))
    session_id = client.post("/api/avatar/sessions").json()["session_id"]

    response = client.delete(f"/api/avatar/sessions/{session_id}")

    assert response.status_code == 204
    assert client.get(f"/api/avatar/sessions/{session_id}").status_code == 404
