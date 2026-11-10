from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.models import ChatMessage, ChatSession


SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def create_test_client(tmp_path, **settings_overrides):
    settings_data = {
        "database_url": f"sqlite:///{tmp_path / 'app.db'}",
        "source_package_path": str(SOURCE_PACKAGE_PATH),
        "llm_api_key": "",
        "tts_mode": "disabled",
    }
    settings_data.update(settings_overrides)
    app = create_app(
        Settings(**settings_data)
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


def test_visitor_insights_report_requires_admin_and_returns_empty_rule_report(tmp_path):
    with create_test_client(tmp_path) as client:
        missing = client.get("/api/admin/visitor-insights/report")
        visitor = client.get(
            "/api/admin/visitor-insights/report",
            headers=visitor_headers(client),
        )
        admin = client.get(
            "/api/admin/visitor-insights/report",
            headers=admin_headers(client),
        )

    assert missing.status_code == 401
    assert visitor.status_code == 403
    assert admin.status_code == 200

    body = admin.json()
    assert body["range"] == "7d"
    assert body["total_questions"] == 0
    assert body["concern_topics"] == []
    assert body["service_suggestions"] == []
    assert body["report"] == {
        "generated_by": "rule_based",
        "llm_status": "skipped_no_key",
        "summary": "当前时间范围内暂无游客交互记录。",
        "rule_summary": "规则报告基于问答文本关键词、疑问句、否定词和程度词识别关注点、反馈倾向和服务建议。",
    }


def test_visitor_insights_report_classifies_topics_and_complaint_risk(tmp_path):
    with create_test_client(tmp_path) as client:
        now = datetime.now(UTC)
        _seed_message(client, "session-route", "带老人两小时怎么规划路线？", created_at=now)
        _seed_message(client, "session-spot", "灵山大佛有什么讲解重点？", created_at=now)
        _seed_message(client, "session-ticket", "门票多少钱，开放时间到几点？", created_at=now)
        _seed_message(client, "session-traffic", "停车场太远了，找不到入口我要投诉。", created_at=now)
        _seed_message(
            client,
            "session-old",
            "卫生间在哪里？",
            created_at=now - timedelta(days=12),
        )

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=admin_headers(client),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["range"] == "7d"
    assert body["total_questions"] == 4

    topics = {item["topic"]: item for item in body["concern_topics"]}
    assert set(topics) == {"路线规划", "景点讲解", "票务开放", "投诉风险"}
    assert topics["路线规划"]["count"] == 1
    assert topics["路线规划"]["share"] == 0.25
    assert topics["投诉风险"]["sentiment"] == {
        "positive": 0,
        "neutral": 0,
        "negative": 1,
    }
    assert topics["投诉风险"]["feedback_tendency"] == {
        "consultation": 0,
        "risk": 1,
        "praise": 0,
        "uncertain": 0,
    }
    assert topics["投诉风险"]["representative_questions"] == [
        "停车场太远了，找不到入口我要投诉。"
    ]


def test_visitor_insights_report_generates_rule_service_suggestions(tmp_path):
    with create_test_client(tmp_path) as client:
        now = datetime.now(UTC)
        _seed_message(client, "session-a", "半日路线怎么规划？", created_at=now)
        _seed_message(client, "session-b", "带老人怎么走路线不累？", created_at=now)
        _seed_message(client, "session-c", "停车场找不到，排队太久，我要投诉。", created_at=now)

        response = client.get(
            "/api/admin/visitor-insights/report?range=today",
            headers=admin_headers(client),
        )

    assert response.status_code == 200
    suggestions = response.json()["service_suggestions"]
    assert {
        "type": "high_frequency_topic",
        "topic": "路线规划",
        "message": "路线规划咨询较集中，建议在游客端和现场导览中前置半日、一日、老人亲子等路线说明。",
    } in suggestions
    assert {
        "type": "negative_topic",
        "topic": "投诉风险",
        "message": "投诉风险出现风险反馈，建议管理方复查现场服务、排队动线和指引信息，优先闭环代表问题。",
    } in suggestions


def test_visitor_insights_report_rejects_invalid_range(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.get(
            "/api/admin/visitor-insights/report?range=year",
            headers=admin_headers(client),
        )

    assert response.status_code == 400
    assert response.json()["code"] == "VISITOR_INSIGHTS_RANGE_INVALID"


def test_visitor_insights_report_returns_normalized_question_clusters_without_llm(tmp_path):
    with create_test_client(tmp_path) as client:
        now = datetime.now(UTC)
        _seed_message(client, "session-a", "灵山大佛有哪些看点？", created_at=now)
        _seed_message(client, "session-b", "灵山大佛有哪些看点", created_at=now)
        _seed_message(client, "session-c", "停车场找不到，我要投诉。", created_at=now)

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=admin_headers(client),
        )

    assert response.status_code == 200
    clusters = response.json()["popular_question_clusters"]
    assert clusters[0] == {
        "cluster_label": "灵山大佛有哪些看点",
        "representative_question": "灵山大佛有哪些看点？",
        "questions": ["灵山大佛有哪些看点？", "灵山大佛有哪些看点"],
        "count": 2,
        "intent_category": "景点讲解",
        "sentiment": "consultation",
    }
    assert clusters[1]["cluster_label"] == "停车场找不到我要投诉"
    assert clusters[1]["sentiment"] == "risk"


def test_visitor_insights_report_cache_invalidates_when_chat_logs_change(tmp_path):
    with create_test_client(tmp_path) as client:
        headers = admin_headers(client)
        now = datetime.now(UTC)
        _seed_message(client, "session-a", "半日路线怎么规划？", created_at=now)

        first = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )
        _seed_message(client, "session-b", "门票多少钱？", created_at=now)
        second = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["total_questions"] == 1
    assert second.json()["total_questions"] == 2


def test_visitor_insights_report_uses_mimo_question_clusters_when_valid(tmp_path, monkeypatch):
    def fake_chat_completion(self, model, system_prompt, user_prompt):
        if "热门问答语义聚类" in system_prompt:
            return """
            {
              "clusters": [
                {
                  "cluster_label": "灵山大佛看点咨询",
                  "representative_question": "灵山大佛有哪些看点？",
                  "questions": ["灵山大佛有哪些看点？", "灵山大佛有什么值得看？"],
                  "intent_category": "景点讲解"
                },
                {
                  "cluster_label": "停车投诉风险",
                  "representative_question": "停车场找不到，我要投诉。",
                  "questions": ["停车场找不到，我要投诉。"],
                  "intent_category": "投诉风险"
                }
              ]
            }
            """
        return "LLM 摘要。"

    monkeypatch.setattr(
        "app.services.operations.MimoClient.chat_completion",
        fake_chat_completion,
    )

    with create_test_client(
        tmp_path,
        llm_mode="openai_compatible",
        llm_api_key="fake-mimo-key",
    ) as client:
        headers = admin_headers(client)
        now = datetime.now(UTC)
        _seed_message(client, "session-a", "灵山大佛有哪些看点？", created_at=now)
        _seed_message(client, "session-b", "灵山大佛有什么值得看？", created_at=now)
        _seed_message(client, "session-c", "停车场找不到，我要投诉。", created_at=now)

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )
        enhanced_response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json()["report"]["llm_status"] == "pending"
    assert enhanced_response.status_code == 200
    clusters = enhanced_response.json()["popular_question_clusters"]
    assert clusters[0] == {
        "cluster_label": "灵山大佛看点咨询",
        "representative_question": "灵山大佛有哪些看点？",
        "questions": ["灵山大佛有哪些看点？", "灵山大佛有什么值得看？"],
        "count": 2,
        "intent_category": "景点讲解",
        "sentiment": "consultation",
    }
    assert clusters[1]["cluster_label"] == "停车投诉风险"
    assert clusters[1]["count"] == 1
    assert clusters[1]["sentiment"] == "risk"


def test_visitor_insights_report_falls_back_when_llm_cluster_json_is_invalid(tmp_path, monkeypatch):
    def fake_chat_completion(self, model, system_prompt, user_prompt):
        if "热门问答语义聚类" in system_prompt:
            return "not json"
        return "LLM 摘要。"

    monkeypatch.setattr(
        "app.services.operations.MimoClient.chat_completion",
        fake_chat_completion,
    )

    with create_test_client(
        tmp_path,
        llm_mode="openai_compatible",
        llm_api_key="fake-mimo-key",
    ) as client:
        now = datetime.now(UTC)
        _seed_message(client, "session-a", "灵山大佛有哪些看点？", created_at=now)
        _seed_message(client, "session-b", "灵山大佛有哪些看点", created_at=now)

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=admin_headers(client),
        )

    assert response.status_code == 200
    clusters = response.json()["popular_question_clusters"]
    assert clusters[0]["cluster_label"] == "灵山大佛有哪些看点"
    assert clusters[0]["count"] == 2


def test_visitor_insights_report_rejects_hallucinated_llm_cluster_questions(tmp_path, monkeypatch):
    def fake_chat_completion(self, model, system_prompt, user_prompt):
        if "热门问答语义聚类" in system_prompt:
            return """
            {
              "clusters": [
                {
                  "cluster_label": "编造问题",
                  "representative_question": "不存在的问题",
                  "questions": ["不存在的问题"],
                  "intent_category": "其他咨询"
                }
              ]
            }
            """
        return "LLM 摘要。"

    monkeypatch.setattr(
        "app.services.operations.MimoClient.chat_completion",
        fake_chat_completion,
    )

    with create_test_client(
        tmp_path,
        llm_mode="openai_compatible",
        llm_api_key="fake-mimo-key",
    ) as client:
        _seed_message(client, "session-a", "灵山大佛有哪些看点？")

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=admin_headers(client),
        )

    assert response.status_code == 200
    clusters = response.json()["popular_question_clusters"]
    assert clusters == [
        {
            "cluster_label": "灵山大佛有哪些看点",
            "representative_question": "灵山大佛有哪些看点？",
            "questions": ["灵山大佛有哪些看点？"],
            "count": 1,
            "intent_category": "景点讲解",
            "sentiment": "consultation",
        }
    ]


def test_visitor_insights_report_uses_mimo_to_enhance_rule_summary(tmp_path, monkeypatch):
    captured = {}

    def fake_chat_completion(self, model, system_prompt, user_prompt):
        captured["api_key"] = self.api_key
        captured["model"] = model
        captured["system_prompt"] = system_prompt
        captured["user_prompt"] = user_prompt
        return "LLM 增强摘要：路线规划咨询集中，投诉风险需要优先闭环。"

    monkeypatch.setattr(
        "app.services.operations.MimoClient.chat_completion",
        fake_chat_completion,
    )

    with create_test_client(
        tmp_path,
        llm_mode="openai_compatible",
        llm_api_key="fake-mimo-key",
        llm_model="mimo-v2.5",
    ) as client:
        headers = admin_headers(client)
        now = datetime.now(UTC)
        _seed_message(client, "session-a", "半日路线怎么规划？", created_at=now)
        _seed_message(client, "session-b", "停车场找不到，我要投诉。", created_at=now)

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )
        enhanced_response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json()["report"]["llm_status"] == "pending"
    assert enhanced_response.status_code == 200
    report = enhanced_response.json()["report"]
    assert report["generated_by"] == "llm_enhanced"
    assert report["llm_status"] == "success"
    assert report["summary"] == "LLM 增强摘要：路线规划咨询集中，投诉风险需要优先闭环。"
    assert "llm_error" not in report
    assert captured["api_key"] == "fake-mimo-key"
    assert captured["model"] == "mimo-v2.5"
    assert "fake-mimo-key" not in captured["user_prompt"]


def test_visitor_insights_report_falls_back_when_mimo_fails(tmp_path, monkeypatch):
    def fail_chat_completion(self, model, system_prompt, user_prompt):
        raise RuntimeError("provider stack trace with fake-mimo-key")

    monkeypatch.setattr(
        "app.services.operations.MimoClient.chat_completion",
        fail_chat_completion,
    )

    with create_test_client(
        tmp_path,
        llm_mode="openai_compatible",
        llm_api_key="fake-mimo-key",
    ) as client:
        headers = admin_headers(client)
        _seed_message(client, "session-a", "停车场找不到，我要投诉。")

        response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )
        failed_response = client.get(
            "/api/admin/visitor-insights/report?range=7d",
            headers=headers,
        )

    assert response.status_code == 200
    assert response.json()["report"]["llm_status"] == "pending"
    assert failed_response.status_code == 200
    report = failed_response.json()["report"]
    assert report["generated_by"] == "rule_based"
    assert report["llm_status"] == "failed"
    assert report["llm_error"] == "llm_summary_failed"
    assert "fake-mimo-key" not in str(report)
    assert "provider stack trace" not in str(report)
    assert report["summary"] == "当前时间范围内共分析 1 条游客问答记录，报告由本地规则生成。"


def _seed_message(
    client,
    session_id: str,
    question: str,
    answer: str = "已记录游客咨询。",
    created_at: datetime | None = None,
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
                created_at=created_at or datetime.now(UTC),
            )
        )
        session.commit()
