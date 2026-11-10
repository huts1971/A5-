import base64
import json

import httpx

from app.core.config import Settings
from app.services.mimo import MimoClient


def test_settings_use_mimo_api_key_alias_and_model_defaults(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("TTS_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("TTS_MODEL", raising=False)
    monkeypatch.delenv("TTS_AUDIO_FORMAT", raising=False)
    monkeypatch.setenv("MIMO_API_KEY", "test-key")

    settings = Settings()

    assert settings.llm_api_key == "test-key"
    assert settings.tts_api_key == "test-key"
    assert settings.llm_model == "mimo-v2.5"
    assert settings.tts_model == "mimo-v2.5-tts"
    assert settings.tts_audio_format == "mp3"


def test_mimo_chat_completion_uses_openai_compatible_request():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["api_key"] = request.headers["api-key"]
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "这是来自 MiMo 的回答。"
                        }
                    }
                ]
            },
        )

    client = MimoClient(
        "https://api.xiaomimimo.com/v1",
        "test-key",
        transport=httpx.MockTransport(handler),
    )

    answer = client.chat_completion(
        model="mimo-v2.5",
        system_prompt="system",
        user_prompt="user",
    )

    assert answer == "这是来自 MiMo 的回答。"
    assert captured["url"] == "https://api.xiaomimimo.com/v1/chat/completions"
    assert captured["api_key"] == "test-key"
    assert captured["body"]["model"] == "mimo-v2.5"
    assert captured["body"]["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "user"},
    ]


def test_mimo_vision_chat_completion_uses_multimodal_message():
    captured = {}
    image_data_url = "data:image/jpeg;base64,aW1hZ2U="

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "\u56fe\u7247\u91cc\u662f\u666f\u70b9"}}]},
        )

    client = MimoClient(
        "https://api.xiaomimimo.com/v1",
        "test-key",
        transport=httpx.MockTransport(handler),
    )

    answer = client.vision_chat_completion(
        model="mimo-v2.5",
        system_prompt="system",
        user_prompt="user",
        image_data_url=image_data_url,
    )

    assert answer == "\u56fe\u7247\u91cc\u662f\u666f\u70b9"
    assert captured["body"]["messages"] == [
        {"role": "system", "content": "system"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "user"},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        },
    ]
    assert captured["body"]["stream"] is False


def test_mimo_chat_completion_stream_reads_delta_chunks():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            text=(
                'data: {"choices":[{"delta":{"content":"灵山"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":"大佛"}}]}\n\n'
                "data: [DONE]\n\n"
            ),
            headers={"content-type": "text/event-stream"},
        )

    client = MimoClient(
        "https://api.xiaomimimo.com/v1",
        "test-key",
        transport=httpx.MockTransport(handler),
    )

    chunks = list(
        client.chat_completion_stream(
            model="mimo-v2.5",
            system_prompt="system",
            user_prompt="user",
        )
    )

    assert captured["body"]["stream"] is True
    assert chunks == ["灵山", "大佛"]


def test_mimo_web_search_completion_forces_search_and_returns_annotations():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "基于联网搜索的回答。",
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url": "https://www.lingshan.com/tickets",
                                    "title": "灵山胜境官方票务",
                                    "summary": "票务信息以官方页面为准。",
                                }
                            ],
                        }
                    }
                ]
            },
        )

    client = MimoClient(
        "https://api.xiaomimimo.com/v1",
        "test-key",
        transport=httpx.MockTransport(handler),
    )

    result = client.web_search_completion(
        model="mimo-v2.5",
        system_prompt="system",
        user_prompt="梵宫门票多少钱？",
        max_results=2,
        timeout_seconds=1.5,
    )

    tool = captured["body"]["tools"][0]
    assert tool["type"] == "web_search"
    assert tool["forced_search"] is True
    assert tool["force_search"] is True
    assert tool["limit"] == 2
    assert captured["body"]["tool_choice"] == "auto"
    assert captured["body"]["thinking"] == {"type": "disabled"}
    assert result["annotations"][0]["url"] == "https://www.lingshan.com/tickets"


def test_mimo_tts_uses_assistant_message_and_audio_options():
    captured = {}
    audio_bytes = b"fake-wav"

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "audio": {
                                "data": base64.b64encode(audio_bytes).decode("ascii")
                            }
                        }
                    }
                ]
            },
        )

    client = MimoClient(
        "https://api.xiaomimimo.com/v1",
        "test-key",
        transport=httpx.MockTransport(handler),
    )

    result = client.synthesize_speech(
        model="mimo-v2.5-tts",
        text="欢迎来到灵山胜境。",
        voice="mimo_default",
        audio_format="wav",
    )

    assert result == audio_bytes
    assert captured["body"]["model"] == "mimo-v2.5-tts"
    assert captured["body"]["messages"][1] == {
        "role": "assistant",
        "content": "欢迎来到灵山胜境。",
    }
    assert captured["body"]["audio"] == {
        "format": "wav",
        "voice": "mimo_default",
    }
