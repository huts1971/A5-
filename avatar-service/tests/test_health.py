from fastapi.testclient import TestClient

from avatar_service.app import create_app
from avatar_service.runtime import RuntimeStatus


class NotReadyRuntime:
    def status(self) -> RuntimeStatus:
        return RuntimeStatus(
            ready=False,
            detail="OpenAvatarChat model is still loading",
        )


def test_health_reports_alive_while_runtime_is_preparing() -> None:
    client = TestClient(create_app(runtime=NotReadyRuntime()))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ready": False,
        "detail": "OpenAvatarChat model is still loading",
    }


def test_readiness_rejects_requests_until_runtime_is_ready() -> None:
    client = TestClient(create_app(runtime=NotReadyRuntime()))

    response = client.get("/readiness")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "detail": "OpenAvatarChat model is still loading",
    }


def test_app_owns_openavatar_runtime_lifecycle() -> None:
    events: list[str] = []

    class ManagedRuntime(NotReadyRuntime):
        def start(self) -> None:
            events.append("started")

        def stop(self) -> None:
            events.append("stopped")

    with TestClient(create_app(runtime=ManagedRuntime())):
        assert events == ["started"]

    assert events == ["started", "stopped"]


def test_local_guide_origin_can_call_avatar_service() -> None:
    client = TestClient(create_app(runtime=NotReadyRuntime()))

    response = client.options(
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
