from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)


def test_chat_does_not_create_legacy_tts_job_when_avatar_service_owns_speech(tmp_path):
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'app.db'}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="fallback",
            tts_mode="provider",
            tts_provider="fake",
            tts_api_key="fake-key",
            tts_audio_format="mp3",
            tts_output_dir=str(tmp_path / "tts"),
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={
                "question": "灵山大佛适合拍照吗？",
                "spot_id": "spot_ling_shan_buddha",
            },
        )
        body = response.json()

    assert response.status_code == 200
    assert "灵山大佛" in body["answer"]
    assert body["tts_status"] == "disabled"
    assert body["audio_url"] is None
    assert body["tts_job_id"] is None
    assert body["metrics"]["tts_ms"] == 0


def test_chat_returns_text_when_tts_provider_has_no_key(tmp_path):
    app = create_app(
        Settings(
            database_url=f"sqlite:///{tmp_path / 'app.db'}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            llm_mode="fallback",
            tts_mode="provider",
            tts_provider="mimo",
            tts_api_key="",
            tts_output_dir=str(tmp_path / "tts"),
        )
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/chat",
            json={
                "question": "梵宫有什么特色？",
                "spot_id": "spot_brahma_palace",
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert "梵宫" in body["answer"]
    assert body["sources"]
    assert body["audio_url"] is None
    assert body["tts_status"] == "disabled"
    assert body["tts_job_id"] is None
