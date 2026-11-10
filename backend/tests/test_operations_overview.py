from pathlib import Path
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import ChatMessage, ChatSession


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path):
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'app.db'}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_api_key="",
            tts_mode="disabled",
        )
    )
    return TestClient(app)


def admin_headers(client):
    response = client.post(
        "/api/auth/admin/login",
        json={"username": "admin", "password": "test-admin-password-123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def visitor_headers(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "visitor_001", "password": "secret123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_operations_overview_requires_admin_and_returns_empty_state(tmp_path):
    with create_test_client(tmp_path) as client:
        missing = client.get("/api/admin/operations/overview")
        visitor = client.get(
            "/api/admin/operations/overview",
            headers=visitor_headers(client),
        )
        admin = client.get(
            "/api/admin/operations/overview",
            headers=admin_headers(client),
        )

    assert missing.status_code == 401
    assert visitor.status_code == 403
    assert admin.status_code == 200
    body = admin.json()
    assert body["range"] == "week"
    assert body["summary"] == {
        "today_service_sessions": 0,
        "week_service_sessions": 0,
        "today_questions": 0,
        "week_questions": 0,
        "range_service_sessions": 0,
        "range_questions": 0,
        "avg_satisfaction_score": None,
    }
    assert body["sentiment_trend"]
    assert body["consultation_topic_trend"]
    assert body["satisfaction_trend"]
    assert all(
        item["ticket_opening"]
        + item["route_planning"]
        + item["location_traffic"]
        + item["spot_explanation"]
        + item["facilities"]
        == 0
        for item in body["consultation_topic_trend"]
    )
    assert all(item["avg_satisfaction_score"] is None for item in body["satisfaction_trend"])


def test_operations_overview_counts_sessions_questions_and_rule_trends(tmp_path):
    with create_test_client(tmp_path) as client:
        now = datetime.now(UTC)
        yesterday = now - timedelta(days=1)
        _seed_message(
            client,
            session_id="session-a",
            question="这条路线很满意，讲解清楚吗？",
            answer="游客表示满意。",
            created_at=now,
        )
        _seed_message(
            client,
            session_id="session-a",
            question="排队太久，停车也找不到。",
            answer="建议优化现场引导。",
            created_at=now,
        )
        _seed_message(
            client,
            session_id="session-b",
            question="灵山大佛多高？",
            answer="灵山大佛高 88 米。",
            created_at=yesterday,
        )

        response = client.get(
            "/api/admin/operations/overview?range=7d",
            headers=admin_headers(client),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["range"] == "7d"
    assert body["summary"]["today_service_sessions"] == 1
    assert body["summary"]["today_questions"] == 2
    assert body["summary"]["range_service_sessions"] == 2
    assert body["summary"]["range_questions"] == 3
    assert body["summary"]["avg_satisfaction_score"] == 65.0

    today_trend = body["sentiment_trend"][-1]
    assert today_trend["praise"] == 1
    assert today_trend["risk"] == 1
    assert today_trend["consultation"] == 0
    assert today_trend["uncertain"] == 0
    assert today_trend["positive"] == 1
    assert today_trend["negative"] == 1
    assert today_trend["neutral"] == 0
    yesterday_consultation = body["consultation_topic_trend"][-2]
    assert yesterday_consultation["spot_explanation"] == 1
    assert yesterday_consultation["ticket_opening"] == 0
    assert yesterday_consultation["route_planning"] == 0
    assert yesterday_consultation["location_traffic"] == 0
    assert yesterday_consultation["facilities"] == 0
    assert body["satisfaction_trend"][-1]["avg_satisfaction_score"] == 65.0


def test_operations_overview_rejects_invalid_range(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get(
            "/api/admin/operations/overview?range=year",
            headers=admin_headers(client),
        )

    assert response.status_code == 400
    assert response.json()["code"] == "OPERATIONS_RANGE_INVALID"


def _seed_message(
    client,
    session_id: str,
    question: str,
    answer: str,
    created_at: datetime,
) -> None:
    with client.app.state.SessionLocal() as session:
        if session.get(ChatSession, session_id) is None:
            session.add(ChatSession(id=session_id, visitor_type="family", preference=""))
        session.add(
            ChatMessage(
                session_id=session_id,
                question=question,
                answer=answer,
                sources_json=[],
                metrics_json={},
                created_at=created_at,
            )
        )
        session.commit()
