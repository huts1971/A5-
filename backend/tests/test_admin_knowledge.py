from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)
DERIVED_KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "knowledge"


def expected_knowledge_doc_count() -> int:
    raw_docx_count = len(
        [
            file_path
            for file_path in SOURCE_PACKAGE_PATH.glob("*.docx")
            if not file_path.name.startswith("~$")
        ]
    )
    derived_md_count = len(list((DERIVED_KNOWLEDGE_PATH / "docs").glob("*.md")))
    return raw_docx_count + derived_md_count


def create_test_client(tmp_path, **overrides):
    db_path = tmp_path / "app.db"
    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        source_package_path=str(SOURCE_PACKAGE_PATH),
        **overrides,
    )
    return TestClient(create_app(settings))


def test_admin_spot_crud_happy_path(tmp_path):
    spot_payload = {
        "id": "spot_demo_gate",
        "name": "游客中心",
        "summary": "灵山胜境游客服务入口。",
        "story": "这里适合作为游览前的信息集合点。",
        "tags": ["服务", "入口"],
        "visit_minutes": 10,
        "crowd_types": ["亲子游", "轻松游"],
        "image_url": "",
        "sort_order": 5,
    }
    with create_test_client(tmp_path) as client:
        created = client.post("/api/admin/spots", json=spot_payload)
        updated = client.put(
            "/api/admin/spots/spot_demo_gate",
            json={**spot_payload, "summary": "更新后的游客服务入口。"},
        )
        visible = client.get("/api/spots/spot_demo_gate")
        deleted = client.delete("/api/admin/spots/spot_demo_gate")
        missing = client.get("/api/spots/spot_demo_gate")

    assert created.status_code == 200
    assert created.json()["name"] == "游客中心"
    assert updated.status_code == 200
    assert updated.json()["summary"] == "更新后的游客服务入口。"
    assert visible.status_code == 200
    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted"}
    assert missing.status_code == 404


def test_admin_route_crud_happy_path(tmp_path):
    route_payload = {
        "id": "route_family_demo",
        "name": "亲子轻松路线",
        "theme": "亲子游",
        "duration_minutes": 80,
        "suitable_crowd": ["亲子游"],
        "description": "适合带孩子的轻松体验。",
        "spots": [
            {
                "spot_id": "spot_nine_dragons",
                "sequence": 1,
                "stay_minutes": 25,
                "reason": "动态演艺更容易吸引孩子注意。",
            },
            {
                "spot_id": "spot_brahma_palace",
                "sequence": 2,
                "stay_minutes": 30,
                "reason": "室内空间适合休息和参观。",
            },
        ],
    }
    with create_test_client(tmp_path) as client:
        created = client.post("/api/admin/routes", json=route_payload)
        updated = client.put(
            "/api/admin/routes/route_family_demo",
            json={**route_payload, "description": "更新后的亲子路线。"},
        )
        recommended = client.post(
            "/api/routes/recommend",
            json={
                "visitor_type": "亲子游",
                "duration_minutes": 90,
                "physical_level": "低",
                "interest_tags": ["亲子"],
            },
        )
        deleted = client.delete("/api/admin/routes/route_family_demo")

    assert created.status_code == 200
    assert created.json()["name"] == "亲子轻松路线"
    assert updated.status_code == 200
    assert updated.json()["description"] == "更新后的亲子路线。"
    assert recommended.status_code == 200
    assert recommended.json()["items"][0]["generation_mode"] == "dynamic"
    assert recommended.json()["items"][0]["map_id"] == "ling-shan"
    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted"}


def test_knowledge_docs_and_rebuild_status(tmp_path):
    with create_test_client(tmp_path) as client:
        before = client.get("/api/knowledge/docs")
        rebuild = client.post("/api/knowledge/rebuild")
        after = client.get("/api/knowledge/docs")

    assert before.status_code == 200
    before_body = before.json()
    expected_doc_count = expected_knowledge_doc_count()
    chunk_count = sum(item["chunk_count"] for item in before_body["items"])
    assert before_body["total"] == expected_doc_count
    assert before_body["items"][0]["chunk_count"] >= 1
    assert before_body["items"][0]["indexed"] is False
    assert rebuild.status_code == 200
    assert rebuild.json() == {
        "status": "rebuilt",
        "doc_count": expected_doc_count,
        "chunk_count": chunk_count,
    }
    assert after.json()["items"][0]["indexed"] is True


def test_chat_logs_are_readable(tmp_path):
    with create_test_client(tmp_path, llm_mode="fallback", tts_mode="disabled") as client:
        chat = client.post(
            "/api/chat",
            json={
                "question": "灵山大佛适合拍照吗？",
                "spot_id": "spot_ling_shan_buddha",
            },
        )
        logs = client.get("/api/logs/chats")

    assert chat.status_code == 200
    assert logs.status_code == 200
    body = logs.json()
    assert body["total"] == 1
    assert body["items"][0]["question"] == "灵山大佛适合拍照吗？"
    assert "灵山大佛" in body["items"][0]["answer"]
    assert body["items"][0]["source_count"] >= 1
    assert body["items"][0]["metrics"]["retrieval_ms"] >= 0
    assert body["items"][0]["metrics"]["llm_ms"] >= 0
    assert body["items"][0]["metrics"]["tts_ms"] >= 0
    assert body["items"][0]["metrics"]["total_ms"] >= 0
    assert body["items"][0]["metrics"]["cache_hit"] is False
    assert body["items"][0]["metrics"]["degraded"] is False
    assert body["items"][0]["metrics"]["classification"]["intent"] == "scenic_fact"
    assert body["items"][0]["metrics"]["classification"]["entities"][0]["entity_id"] == "spot_ling_shan_buddha"


def test_admin_can_delete_chat_logs(tmp_path):
    with create_test_client(tmp_path, llm_mode="fallback", tts_mode="disabled") as client:
        for question in ["灵山大佛适合拍照吗？", "梵宫有什么特色？", "九龙灌浴适合亲子游吗？"]:
            response = client.post("/api/chat", json={"question": question})
            assert response.status_code == 200

        before = client.get("/api/logs/chats").json()["items"]
        deleted_one = client.delete(f"/api/logs/chats/{before[0]['id']}")
        after_one = client.get("/api/logs/chats").json()
        remaining_ids = [item["id"] for item in after_one["items"]]
        deleted_many = client.post(
            "/api/logs/chats/delete",
            json={"ids": remaining_ids},
        )
        after_many = client.get("/api/logs/chats").json()

    assert deleted_one.status_code == 200
    assert deleted_one.json() == {"status": "deleted", "deleted_count": 1}
    assert after_one["total"] == 2
    assert before[0]["id"] not in remaining_ids
    assert deleted_many.status_code == 200
    assert deleted_many.json() == {"status": "deleted", "deleted_count": 2}
    assert after_many["total"] == 0


def test_admin_can_clear_all_chat_logs(tmp_path):
    with create_test_client(tmp_path, llm_mode="fallback", tts_mode="disabled") as client:
        for question in ["你好", "今天无锡天气如何？"]:
            response = client.post("/api/chat", json={"question": question})
            assert response.status_code == 200

        deleted = client.post("/api/logs/chats/delete", json={"delete_all": True})
        after = client.get("/api/logs/chats").json()

    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted", "deleted_count": 2}
    assert after["total"] == 0


def test_realtime_web_answer_creates_pending_fact_candidate(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "灵山胜境官方票务",
                    "snippet": "梵宫门票信息请以景区官方票务页面为准。",
                    "url": "https://www.lingshan.com/tickets",
                    "source_level": "official",
                }
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )

    with create_test_client(
        tmp_path,
        web_search_mode="provider",
        llm_api_key="",
        tts_mode="disabled",
    ) as client:
        chat = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})
        candidates = client.get("/api/admin/web-fact-candidates")

    assert chat.status_code == 200
    assert candidates.status_code == 200
    body = candidates.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["status"] == "pending_review"
    assert item["entity_id"] == "spot_brahma_palace"
    assert item["entity_name"] == "灵山梵宫"
    assert item["fact_key"] == "ticket"
    assert item["fact_value"] == "梵宫门票信息请以景区官方票务页面为准。"
    assert item["source_url"] == "https://www.lingshan.com/tickets"
    assert item["source_level"] == "official"
    assert item["question"] == "梵宫门票多少钱？"
    assert "基于联网搜索" in item["answer_excerpt"]


def test_admin_can_approve_candidate_as_supplemental_fact(tmp_path, monkeypatch):
    calls = {"count": 0}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            calls["count"] += 1
            return [
                {
                    "title": "灵山胜境官方票务",
                    "snippet": "梵宫门票信息请以景区官方票务页面为准。",
                    "url": "https://www.lingshan.com/tickets",
                    "source_level": "official",
                }
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )

    with create_test_client(
        tmp_path,
        web_search_mode="provider",
        llm_api_key="",
        tts_mode="disabled",
    ) as client:
        client.post("/api/chat", json={"question": "梵宫门票多少钱？"})
        candidate = client.get("/api/admin/web-fact-candidates").json()["items"][0]
        reviewed = client.post(
            f"/api/admin/web-fact-candidates/{candidate['id']}/review",
            json={"action": "approve_supplemental"},
        )
        second_chat = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})
        approved = client.get(
            "/api/admin/web-fact-candidates",
            params={"status": "approved_supplemental"},
        )

    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "approved_supplemental"
    assert approved.json()["total"] == 1
    assert calls["count"] == 1
    body = second_chat.json()
    assert body["metrics"]["web_supplement_required"] is False
    assert body["sources"][0]["source_type"] == "approved_web"
    assert body["sources"][0]["source_url"] == "https://www.lingshan.com/tickets"


def test_admin_can_approve_candidate_as_official_structured_fact(tmp_path, monkeypatch):
    calls = {"count": 0}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            calls["count"] += 1
            return [
                {
                    "title": "灵山胜境官方票务",
                    "snippet": "梵宫门票信息请以景区官方票务页面为准。",
                    "url": "https://www.lingshan.com/tickets",
                    "source_level": "official",
                }
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )

    with create_test_client(
        tmp_path,
        web_search_mode="provider",
        llm_api_key="",
        tts_mode="disabled",
    ) as client:
        client.post("/api/chat", json={"question": "梵宫门票多少钱？"})
        candidate = client.get("/api/admin/web-fact-candidates").json()["items"][0]
        reviewed = client.post(
            f"/api/admin/web-fact-candidates/{candidate['id']}/review",
            json={"action": "approve_official"},
        )
        second_chat = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})

    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "approved_official"
    assert calls["count"] == 1
    body = second_chat.json()
    assert body["metrics"]["web_supplement_required"] is False
    assert body["sources"][0]["source_type"] == "database"
    assert body["sources"][0]["source_url"] == "https://www.lingshan.com/tickets"


def test_admin_can_reject_or_ignore_candidate_without_trusting_it(tmp_path, monkeypatch):
    calls = {"count": 0}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            calls["count"] += 1
            if calls["count"] == 1:
                return [
                    {
                        "title": "灵山胜境官方票务",
                        "snippet": "梵宫门票信息请以景区官方票务页面为准。",
                        "url": "https://www.lingshan.com/tickets",
                        "source_level": "official",
                    }
                ]
            return []

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )

    with create_test_client(
        tmp_path,
        web_search_mode="provider",
        llm_api_key="",
        tts_mode="disabled",
    ) as client:
        client.post("/api/chat", json={"question": "梵宫门票多少钱？"})
        candidate = client.get("/api/admin/web-fact-candidates").json()["items"][0]
        rejected = client.post(
            f"/api/admin/web-fact-candidates/{candidate['id']}/review",
            json={"action": "reject"},
        )
        second_chat = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})
        rejected_list = client.get(
            "/api/admin/web-fact-candidates",
            params={"status": "rejected"},
        )
        ignored = client.post(
            f"/api/admin/web-fact-candidates/{candidate['id']}/review",
            json={"action": "ignore"},
        )

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert rejected_list.json()["total"] == 1
    assert ignored.status_code == 200
    assert ignored.json()["status"] == "ignored"
    body = second_chat.json()
    assert body["metrics"]["web_supplement_required"] is True
    assert all(
        not (
            source["section"] == "结构化事实"
            and source["source_type"] in {"approved_web", "database"}
        )
        for source in body["sources"]
    )


def test_admin_token_can_protect_admin_endpoints(tmp_path):
    with create_test_client(
        tmp_path,
        enable_admin_token="true",
        admin_token="secret-token",
    ) as client:
        denied = client.get("/api/knowledge/docs")
        allowed = client.get(
            "/api/knowledge/docs",
            headers={"x-admin-token": "secret-token"},
        )

    assert denied.status_code == 401
    assert denied.json() == {
        "message": "管理员令牌无效",
        "code": "ADMIN_TOKEN_INVALID",
        "status": 401,
    }
    assert allowed.status_code == 200
