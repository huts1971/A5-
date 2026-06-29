from pathlib import Path
import json
import sqlite3

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)
DERIVED_KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "knowledge"


def create_test_client(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="openai_compatible",
            llm_provider="mimo",
            llm_base_url="https://api.xiaomimimo.com/v1",
            llm_api_key="",
            llm_model="mimo-v2.5",
            tts_mode="disabled",
        )
    )
    return TestClient(app)


def test_chat_logs_question_answer_and_sources(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_api_key="",
            tts_mode="disabled",
        )
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={
                "question": "九龙灌浴适合亲子游吗？",
                "spot_id": "spot_nine_dragons",
            },
        )

    assert response.status_code == 200
    with sqlite3.connect(db_path) as connection:
        session_count = connection.execute(
            "select count(*) from chat_session"
        ).fetchone()[0]
        message = connection.execute(
            "select question, answer, sources_json from chat_message"
        ).fetchone()

    assert session_count == 1
    assert message[0] == "九龙灌浴适合亲子游吗？"
    assert "九龙灌浴" in message[1]
    assert "spot_name" in message[2]


def test_chat_without_session_uses_fallback_and_returns_sources(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={
                "question": "灵山大佛适合拍照吗？",
                "spot_id": "spot_ling_shan_buddha",
                "profile": {"visitor_type": "摄影游"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"]
    assert body["mode"] == "fallback"
    assert body["degraded"] is True
    assert body["audio_url"] is None
    assert body["tts_status"] == "disabled"
    assert "灵山大佛" in body["answer"]
    assert body["sources"][0]["spot_name"] == "灵山大佛"
    assert body["sources"][0]["section"] == "结构化标签"
    assert body["sources"][0]["snippet"]
    assert body["sources"][0]["score"] > 0
    assert body["metrics"]["retrieval_ms"] >= 0
    assert body["metrics"]["llm_ms"] >= 0
    assert body["metrics"]["tts_ms"] >= 0
    assert body["metrics"]["total_ms"] >= body["metrics"]["retrieval_ms"]
    assert body["metrics"]["cache_hit"] is False
    assert body["metrics"]["degraded"] is True


def test_chat_does_not_enqueue_legacy_tts_when_avatar_service_owns_speech(tmp_path):
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'app.db'}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_api_key="",
            tts_mode="provider",
            tts_api_key="legacy-key-must-not-be-used",
        )
    )
    with TestClient(app) as client:
        app.state.tts_jobs.enqueue = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("legacy TTS must not be enqueued")
        )
        response = client.post("/api/chat", json={"question": "灵山大佛有多高？"})

    assert response.status_code == 200
    assert response.json()["tts_status"] == "disabled"


def test_chat_reports_structured_classification_for_scenic_fact_question(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "无锡灵山大佛多高？"},
        )

    assert response.status_code == 200
    classification = response.json()["metrics"]["classification"]
    assert classification["intent"] == "scenic_fact"
    assert classification["fact_keys"] == ["height_meters"]
    assert classification["entities"][0]["entity_id"] == "spot_ling_shan_buddha"
    assert classification["entities"][0]["matched_text"] == "无锡灵山大佛"
    assert classification["needs_llm_classification"] is False


def test_chat_uses_structured_fact_before_document_chunks(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "灵山大佛有多高？"},
        )

    assert response.status_code == 200
    body = response.json()
    assert "高度：88米" in body["answer"]
    assert body["sources"][0]["section"] == "结构化事实"
    assert body["sources"][0]["snippet"] == "高度：88米"
    assert body["sources"][0]["source_type"] == "database"


def test_chat_combines_structured_entity_and_document_chunks(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "梵宫有什么特色？"},
        )

    assert response.status_code == 200
    body = response.json()
    sections = [source["section"] for source in body["sources"]]
    assert body["metrics"]["classification"]["intent"] == "scenic_explanation"
    assert "景点简介" in sections
    assert "资料片段" in sections


def test_chat_sources_do_not_repeat_same_snippet_for_spot_overview(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "灵山大佛有什么看点？"},
        )

    assert response.status_code == 200
    sources = response.json()["sources"]
    source_keys = {
        (
            source["spot_name"],
            " ".join(source["snippet"].split()),
            source.get("source_url", ""),
        )
        for source in sources
    }
    assert len(source_keys) == len(sources)


def test_chat_uses_structured_tags_for_suitability_questions(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "灵山大佛适合拍照吗？"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["classification"]["fact_keys"] == ["suitability"]
    assert body["sources"][0]["section"] == "结构化标签"
    assert body["sources"][0]["source_type"] == "database"
    assert "佛教文化" in body["sources"][0]["snippet"]


def test_chat_reports_question_intent_categories(tmp_path):
    cases = [
        ("带老人两个小时怎么逛？", "route"),
        ("附近有厕所和游客中心吗？", "service"),
        ("你好呀，你是谁？", "casual"),
        ("灵山大佛真的有88米吗？我第一次来有点紧张。", "mixed_emotional_fact"),
        ("梵宫今天开放时间变了吗？", "high_risk_realtime"),
        ("这个地方会让我想到什么？", "unknown"),
    ]
    with create_test_client(tmp_path) as client:
        classifications = [
            client.post("/api/chat", json={"question": question})
            .json()["metrics"]["classification"]
            for question, _ in cases
        ]

    assert [item["intent"] for item in classifications] == [
        expected for _, expected in cases
    ]
    assert classifications[3]["emotional"] is True
    assert classifications[-1]["needs_llm_classification"] is True


def test_unknown_question_can_use_mimo_for_structured_classification(tmp_path, monkeypatch):
    captured = {}

    def fake_chat_completion(self, model, system_prompt, user_prompt):
        captured["api_key"] = self.api_key
        captured["base_url"] = self.base_url
        captured["model"] = model
        if "问题分类器" in system_prompt:
            return json.dumps(
                {
                    "intent": "scenic_fact",
                    "entities": [
                        {
                            "entity_type": "spot",
                            "entity_id": "spot_ling_shan_buddha",
                            "name": "灵山大佛",
                            "matched_text": "这座佛像",
                        }
                    ],
                    "fact_keys": ["height_meters"],
                    "tags": [],
                    "emotional": False,
                },
                ensure_ascii=False,
            )
        return "这是一段由 MIMO 组织语言的回答。"

    monkeypatch.setattr(
        "app.services.question_classifier.MimoClient.chat_completion",
        fake_chat_completion,
    )
    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion",
        fake_chat_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="openai_compatible",
            llm_api_key="fake-mimo-key",
            llm_base_url="https://api.xiaomimimo.com/v1",
            llm_model="mimo-v2.5",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={"question": "这座佛像高度是多少？"},
        )

    assert response.status_code == 200
    classification = response.json()["metrics"]["classification"]
    assert classification["intent"] == "scenic_fact"
    assert classification["classification_method"] == "llm"
    assert classification["needs_llm_classification"] is False
    assert captured == {
        "api_key": "fake-mimo-key",
        "base_url": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2.5",
    }


def test_llm_synthesis_prompt_separates_evidence_and_source_rules(tmp_path, monkeypatch):
    captured = {}

    def fake_chat_completion(self, model, system_prompt, user_prompt):
        captured["system_prompt"] = system_prompt
        captured["user_prompt"] = user_prompt
        return "根据景区资料库，灵山大佛高度为 88 米。"

    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion",
        fake_chat_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="openai_compatible",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={"question": "无锡灵山大佛多高？"},
        )

    assert response.status_code == 200
    assert "只允许基于提供的事实证据回答" in captured["system_prompt"]
    assert "数据库证据优先" in captured["system_prompt"]
    assert "冲突" in captured["system_prompt"]
    assert "【事实证据】" in captured["user_prompt"]
    assert "source_type=database" in captured["user_prompt"]
    assert "结构化事实" in captured["user_prompt"]
    assert "高度：88米" in captured["user_prompt"]


def test_mixed_emotional_fact_prompt_keeps_emotion_separate_from_facts(tmp_path, monkeypatch):
    captured = {}

    def fake_chat_completion(self, model, system_prompt, user_prompt):
        captured["system_prompt"] = system_prompt
        captured["user_prompt"] = user_prompt
        return "灵山大佛高度为 88 米。第一次来紧张很正常，可以先远望再慢慢靠近。"

    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion",
        fake_chat_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="openai_compatible",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={"question": "灵山大佛真的有88米吗？我第一次来有点紧张。"},
        )

    assert response.status_code == 200
    assert "【游客情绪】" in captured["user_prompt"]
    assert "允许亲切安抚" in captured["system_prompt"]
    assert "不能改变或补充事实证据之外的景区事实" in captured["system_prompt"]


def test_missing_structured_fact_marks_web_supplement_needed_in_fallback(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "梵宫门票多少钱？"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_required"] is True
    assert "联网补充" in body["answer"]
    assert "知识库" not in body["answer"]


def test_missing_fact_uses_realtime_web_supplement_with_source_url(tmp_path, monkeypatch):
    captured = {"queries": []}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            captured["queries"].append(query)
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
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={"question": "梵宫门票多少钱？"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_required"] is True
    assert body["metrics"]["web_supplement_status"] == "success"
    assert "基于联网搜索" in body["answer"]
    assert "https://www.lingshan.com/tickets" in body["answer"]
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert body["sources"][0]["section"] == "基于联网搜索"
    assert body["sources"][0]["source_url"] == "https://www.lingshan.com/tickets"
    assert captured["queries"] == ["灵山胜境 灵山梵宫 门票 官方 票价"]


def test_missing_fact_retries_focused_web_queries_until_trusted_source(tmp_path, monkeypatch):
    captured = {"queries": []}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            captured["queries"].append(query)
            if query == "灵山胜境 灵山梵宫 门票 官方 票价":
                raise TimeoutError("slow broad search")
            return [
                {
                    "title": "无锡灵山胜境门票",
                    "snippet": "灵山胜境门票信息请以景区官方票务页面为准。",
                    "url": "https://m.wx.bendibao.com/tour/69684.shtm",
                    "source_level": "authoritative",
                }
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "success"
    assert captured["queries"] == [
        "灵山胜境 灵山梵宫 门票 官方 票价",
        "无锡 灵山大佛景区 灵山梵宫 门票 官方 票价",
    ]
    assert body["sources"][0]["source_type"] == "realtime_web"


def test_mimo_web_search_provider_uses_existing_llm_settings(tmp_path, monkeypatch):
    captured = {}

    def fake_web_search_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        max_results,
        timeout_seconds,
    ):
        captured["api_key"] = self.api_key
        captured["base_url"] = self.base_url
        captured["model"] = model
        captured["max_results"] = max_results
        captured["timeout_seconds"] = timeout_seconds
        return {
            "content": "梵宫门票信息请以景区官方票务页面为准。",
            "annotations": [
                {
                    "type": "url_citation",
                    "title": "灵山胜境官方票务",
                    "summary": "梵宫门票信息请以景区官方票务页面为准。",
                    "url": "https://www.lingshan.com/tickets",
                    "site_name": "灵山胜境",
                }
            ],
        }

    monkeypatch.setattr(
        "app.services.web_search.MimoClient.web_search_completion",
        fake_web_search_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="mimo",
            web_search_max_results=2,
            web_search_timeout_seconds=1.5,
            llm_api_key="fake-mimo-key",
            llm_base_url="https://api.xiaomimimo.com/v1",
            llm_model="mimo-v2.5",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})

    assert response.status_code == 200
    body = response.json()
    assert captured == {
        "api_key": "fake-mimo-key",
        "base_url": "https://api.xiaomimimo.com/v1",
        "model": "mimo-v2.5",
        "max_results": 2,
        "timeout_seconds": 1.5,
    }
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert body["sources"][0]["source_url"] == "https://www.lingshan.com/tickets"


def test_mimo_web_search_provider_accepts_nested_url_citation(tmp_path, monkeypatch):
    def fake_web_search_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        max_results,
        timeout_seconds,
    ):
        return {
            "content": "无锡今天多云，适合关注实时天气预报安排游览。",
            "annotations": [
                {
                    "type": "url_citation",
                    "url_citation": {
                        "title": "无锡天气预报",
                        "summary": "无锡今天多云，适合关注实时天气预报安排游览。",
                        "url": "https://www.weather.com.cn/weather/101190201.shtml",
                    },
                }
            ],
        }

    monkeypatch.setattr(
        "app.services.web_search.MimoClient.web_search_completion",
        fake_web_search_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="mimo",
            llm_api_key="fake-mimo-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "今天无锡天气如何？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert body["sources"][0]["source_url"] == "https://www.weather.com.cn/weather/101190201.shtml"


def test_mimo_web_search_provider_accepts_content_url_when_annotations_missing(tmp_path, monkeypatch):
    def fake_web_search_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        max_results,
        timeout_seconds,
    ):
        return {
            "content": (
                "根据联网搜索结果，无锡今天多云，最高气温30°C，适合关注实时天气安排游览。\n\n"
                "来源：中国天气网（无锡）：https://www.weather.com.cn/weather/101190201.shtml"
            ),
            "annotations": [],
        }

    monkeypatch.setattr(
        "app.services.web_search.MimoClient.web_search_completion",
        fake_web_search_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="mimo",
            llm_api_key="fake-mimo-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "今天无锡天气如何？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert body["sources"][0]["source_url"] == "https://www.weather.com.cn/weather/101190201.shtml"


def test_mimo_weather_search_maps_named_sources_when_urls_missing(tmp_path, monkeypatch):
    def fake_web_search_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        max_results,
        timeout_seconds,
    ):
        return {
            "content": (
                "根据联网搜索结果，无锡今天多云，最高气温30°C。"
                "来源：中国天气网、无锡市气象局。"
            ),
            "annotations": [],
        }

    monkeypatch.setattr(
        "app.services.web_search.MimoClient.web_search_completion",
        fake_web_search_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="mimo",
            llm_api_key="fake-mimo-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "今天无锡天气如何？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert body["sources"][0]["source_url"] == "http://www.weather.com.cn/weather/101190201.shtml"


def test_realtime_web_answer_removes_inline_source_tail(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "无锡市气象台预报",
                    "snippet": "无锡今天晴到多云，白天最高气温31°C。",
                    "url": "https://www.wuxi.gov.cn/weather",
                    "source_level": "authoritative",
                }
            ]

    def fake_chat_completion(self, model, system_prompt, user_prompt):
        return (
            "今天无锡晴到多云，白天比较适合户外游览。建议做好防晒并及时补水。"
            "（注：天气信息基于联网搜索，来源：无锡市气象台及天气预报网站，请以现场实时天气为准。）"
        )

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion",
        fake_chat_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "今天无锡天气如何？"})

    assert response.status_code == 200
    body = response.json()
    assert "联网搜索" not in body["answer"]
    assert "来源：" not in body["answer"]
    assert "https://" not in body["answer"]
    assert body["sources"][0]["source_url"] == "https://www.wuxi.gov.cn/weather"


def test_stream_realtime_web_final_answer_removes_inline_source_tail(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "北京市气象台预报",
                    "snippet": "北京今天晴转多云，傍晚可能有雷阵雨。",
                    "url": "https://news.qq.com/rain/a/20260602A023YA00",
                    "source_level": "authoritative",
                }
            ]

    def fake_chat_completion_stream(self, model, system_prompt, user_prompt):
        yield "北京今天晴转多云，傍晚可能有雷阵雨。"
        yield "建议傍晚出门带好雨具。"
        yield "（来源：[北京市气象台预报](https://news.qq.com/rain/a/20260602A023YA00)）"

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion_stream",
        fake_chat_completion_stream,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat/stream", json={"question": "北京的天气如何"})

    assert response.status_code == 200
    events = _sse_events(response.text)
    final = next(event["data"] for event in events if event["event"] == "final")
    assert "来源" not in final["answer"]
    assert "https://" not in final["answer"]
    assert final["sources"][0]["source_url"] == "https://news.qq.com/rain/a/20260602A023YA00"


def test_external_factual_question_uses_llm_web_instead_of_fallback(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "NVIDIA GeForce RTX 5090 官方信息",
                    "snippet": "GeForce RTX 5090 官方建议售价为 1999 美元起。",
                    "url": "https://www.nvidia.com/geforce/graphics-cards/50-series/rtx-5090/",
                    "source_level": "official",
                }
            ]

    def fake_chat_completion_stream(self, model, system_prompt, user_prompt):
        yield "英伟达 GeForce RTX 5090 的官方建议售价为 1999 美元起。"

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion_stream",
        fake_chat_completion_stream,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat/stream",
            json={"question": "英伟达5090系列显卡官方售价是多少"},
        )

    assert response.status_code == 200
    final = next(event["data"] for event in _sse_events(response.text) if event["event"] == "final")
    assert final["mode"] == "openai_compatible"
    assert final["degraded"] is False
    assert final["metrics"]["classification"]["intent"] == "external_factual"
    assert final["metrics"]["web_supplement_required"] is True
    assert final["metrics"]["web_supplement_status"] == "success"
    assert final["sources"][0]["source_type"] == "realtime_web"
    assert "兜底" not in final["answer"]
    assert "1999" in final["answer"]


def test_mimo_weather_search_accepts_common_weather_sources(tmp_path, monkeypatch):
    def fake_web_search_completion(
        self,
        model,
        system_prompt,
        user_prompt,
        max_results,
        timeout_seconds,
    ):
        return {
            "content": "无锡今天多云，最高气温 25℃，建议出行前关注实时预报。",
            "annotations": [
                {
                    "type": "url_citation",
                    "url": "https://news.qq.com/rain/a/20260601A0000000",
                    "title": "无锡今日天气预报_腾讯新闻",
                    "summary": "无锡今天多云，最高气温 25℃。",
                    "site_name": "腾讯网",
                },
                {
                    "type": "url_citation",
                    "url": "https://bocha.cn/share/wuxi-weather",
                    "title": "无锡天气预报",
                    "summary": "无锡今日天气以多云为主。",
                    "site_name": "博查",
                },
            ],
        }

    monkeypatch.setattr(
        "app.services.web_search.MimoClient.web_search_completion",
        fake_web_search_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="mimo",
            llm_api_key="fake-mimo-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "那你帮我查询一下无锡今天的天气"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert body["sources"][0]["source_url"].startswith("https://")
    assert "当前景区资料库里没有找到" not in body["answer"]
    assert "基于联网搜索" in body["answer"]


def test_structured_fact_does_not_call_realtime_web_search(tmp_path, monkeypatch):
    calls = {"count": 0}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            calls["count"] += 1
            return []

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "灵山大佛多高？"})

    assert response.status_code == 200
    body = response.json()
    assert calls["count"] == 0
    assert body["metrics"]["web_supplement_required"] is False
    assert body["metrics"]["web_supplement_status"] == "not_required"
    assert body["sources"][0]["source_type"] == "database"


def test_document_fact_evidence_does_not_replace_missing_structured_fact(tmp_path, monkeypatch):
    calls = {"count": 0}

    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            calls["count"] += 1
            return []

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                "insert into knowledge_doc(id, title, source_type, path, content_hash, created_at) "
                "values ('ticket_doc', '票务资料', 'derived_markdown', 'ticket.md', 'hash', "
                "'2026-06-01 00:00:00')"
            )
            connection.execute(
                "insert into knowledge_chunk(doc_id, chunk_text, chunk_index, spot_id) "
                "values ('ticket_doc', '梵宫 门票 请以官方票务页面公布信息为准。', 0, 'spot_brahma_palace')"
            )
        response = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})

    assert response.status_code == 200
    body = response.json()
    assert calls["count"] == 3
    assert body["metrics"]["web_supplement_required"] is True
    assert body["metrics"]["web_supplement_status"] == "no_trusted_results"
    assert any(source["source_type"] == "document" for source in body["sources"])


def test_general_ticket_question_uses_imported_guide_document_evidence(tmp_path, monkeypatch):
    class FailingWebSearchProvider:
        def search(self, query, timeout_seconds):
            raise AssertionError("general ticket question should use imported guide evidence")

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FailingWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "我想咨询一下景区票价"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["classification"]["fact_keys"] == ["ticket"]
    assert body["metrics"]["web_supplement_required"] is False
    assert body["metrics"]["web_supplement_status"] == "not_required"
    assert "天气应用" not in body["answer"]
    assert any(
        source["source_type"] == "document" and "成人票" in source["snippet"] and "210元" in source["snippet"]
        for source in body["sources"]
    )


def test_realtime_web_search_timeout_fails_gracefully(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            raise TimeoutError("slow search")

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "timeout"
    assert all(source["source_type"] != "realtime_web" for source in body["sources"])
    assert "联网补充" in body["answer"]


def test_low_trust_source_is_ignored_for_high_risk_fact(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "游客博客",
                    "snippet": "梵宫今天开放时间可能有变化。",
                    "url": "https://example.com/blog",
                    "source_level": "ordinary",
                }
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "梵宫今天开放时间变了吗？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "no_trusted_results"
    assert all(source["source_type"] != "realtime_web" for source in body["sources"])


def test_realtime_web_results_prefer_official_sources_on_conflict(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "权威旅游资料",
                    "snippet": "梵宫门票价格以平台页面显示为准。",
                    "url": "https://example.com/travel",
                    "source_level": "authoritative",
                },
                {
                    "title": "灵山胜境官方资料",
                    "snippet": "梵宫门票信息以景区官方票务页面公布为准。",
                    "url": "https://www.lingshan.com/tickets",
                    "source_level": "official",
                },
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "梵宫门票多少钱？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"][0]["source_url"] == "https://www.lingshan.com/tickets"
    assert "不同联网来源可能存在差异" in body["answer"]


def test_weather_question_uses_realtime_web_without_scenic_entity(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "北京天气预报",
                    "snippet": "北京今天多云，建议关注实时天气预报安排出行。",
                    "url": "https://www.weather.com.cn/weather/101010100.shtml",
                    "source_level": "authoritative",
                }
            ]

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "今天北京的天气怎么样？"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["classification"]["intent"] == "high_risk_realtime"
    assert body["metrics"]["classification"]["fact_keys"] == ["weather"]
    assert body["metrics"]["web_supplement_required"] is True
    assert body["metrics"]["web_supplement_status"] == "success"
    assert body["sources"]
    assert body["sources"][0]["source_type"] == "realtime_web"
    assert {source["source_type"] for source in body["sources"]} == {"realtime_web"}
    assert "基于联网搜索" in body["answer"]


def test_weather_question_without_web_results_does_not_blame_scenic_database(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return []

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "那你帮我查询一下无锡今天的天气"})

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["web_supplement_required"] is True
    assert body["metrics"]["web_supplement_status"] == "no_trusted_results"
    assert "景区资料库" not in body["answer"]
    assert "联网" in body["answer"]


def test_realtime_web_answer_is_not_marked_degraded_when_llm_synthesis_fails(tmp_path, monkeypatch):
    class FakeWebSearchProvider:
        def search(self, query, timeout_seconds):
            return [
                {
                    "title": "无锡天气预报",
                    "snippet": "无锡今天多云，适合关注实时天气预报安排游览。",
                    "url": "https://www.weather.com.cn/weather/101190201.shtml",
                    "source_level": "authoritative",
                }
            ]

    def fail_chat_completion(self, model, system_prompt, user_prompt):
        raise RuntimeError("llm_synthesis_failed")

    monkeypatch.setattr(
        "app.services.chat.get_web_search_provider",
        lambda settings: FakeWebSearchProvider(),
    )
    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion",
        fail_chat_completion,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            web_search_mode="provider",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        response = client.post("/api/chat", json={"question": "今天无锡天气如何？"})

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "web_supplement"
    assert body["degraded"] is False
    assert body["metrics"]["degraded"] is False
    assert "基于联网搜索" in body["answer"]


def test_chat_retrieves_sources_from_chinese_question_without_spot_id(tmp_path):
    with create_test_client(tmp_path) as client:
        response = client.post(
            "/api/chat",
            json={"question": "灵山大佛有什么看点？"},
        )

    assert response.status_code == 200
    body = response.json()
    assert "灵山大佛" in body["answer"]
    assert body["sources"]
    assert body["sources"][0]["spot_name"] == "灵山大佛"
    assert body["sources"][0]["score"] > 0


def test_chat_stream_returns_delta_events_and_final_payload(tmp_path):
    with create_test_client(tmp_path) as client:
        with client.stream(
            "POST",
            "/api/chat/stream",
            json={
                "question": "灵山大佛有什么看点？",
                "spot_id": "spot_ling_shan_buddha",
            },
        ) as response:
            body = response.read().decode("utf-8")

    events = _sse_events(body)
    delta_text = "".join(event["data"]["text"] for event in events if event["event"] == "delta")
    final = next(event["data"] for event in events if event["event"] == "final")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "灵山大佛" in delta_text
    assert final["answer"] == delta_text
    assert final["sources"]
    assert final["tts_status"] == "disabled"
    assert final["metrics"]["llm_ms"] >= 0


def test_chat_stream_keeps_model_text_when_provider_raises_after_chunks(tmp_path, monkeypatch):
    def stream_then_raise(self, model, system_prompt, user_prompt):
        yield "真实回答"
        raise RuntimeError("provider_stream_tail_failed")

    monkeypatch.setattr(
        "app.services.chat.MimoClient.chat_completion_stream",
        stream_then_raise,
    )
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="openai_compatible",
            llm_api_key="fake-key",
            tts_mode="disabled",
        )
    )

    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/api/chat/stream",
            json={
                "question": "灵山大佛有什么看点？",
                "spot_id": "spot_ling_shan_buddha",
            },
        ) as response:
            body = response.read().decode("utf-8")

    events = _sse_events(body)
    final = next(event["data"] for event in events if event["event"] == "final")

    assert response.status_code == 200
    assert final["answer"] == "真实回答"
    assert final["mode"] == "openai_compatible"
    assert final["degraded"] is False


def test_chat_reuses_existing_session_id(tmp_path):
    with create_test_client(tmp_path) as client:
        first = client.post(
            "/api/chat",
            json={
                "question": "梵宫有什么特色？",
                "spot_id": "spot_brahma_palace",
            },
        ).json()
        second_response = client.post(
            "/api/chat",
            json={
                "question": "适合摄影游吗？",
                "spot_id": "spot_brahma_palace",
                "session_id": first["session_id"],
            },
        )

    assert second_response.status_code == 200
    second = second_response.json()
    assert second["session_id"] == first["session_id"]
    assert "梵宫" in second["answer"]
    assert second["sources"]


def _sse_events(body: str) -> list[dict]:
    events = []
    for raw_event in body.strip().split("\n\n"):
        lines = raw_event.splitlines()
        event_name = next(line.removeprefix("event: ") for line in lines if line.startswith("event: "))
        data = next(line.removeprefix("data: ") for line in lines if line.startswith("data: "))
        events.append({"event": event_name, "data": json.loads(data)})
    return events
