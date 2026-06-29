import base64
import sys
from pathlib import Path

import numpy as np
import yaml


OPENAVATAR_ROOT = Path(__file__).resolve().parents[2] / "vendor" / "OpenAvatarChat"
sys.path.insert(0, str(OPENAVATAR_ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chat_engine.data_models.runtime_data.data_bundle import (  # noqa: E402
    DataBundle,
    DataBundleDefinition,
    DataBundleEntry,
)
from chat_engine.data_models.chat_data.chat_data_model import ChatData  # noqa: E402
from chat_engine.data_models.chat_data_type import ChatDataType  # noqa: E402
from chat_engine.data_models.chat_stream import ChatStreamIdentity  # noqa: E402
from qwen_tts_realtime.tts_handler_qwen_tts_realtime import (  # noqa: E402
    HandlerTTS,
    TTSContext,
    TTSConfig,
    QwenTtsRealtimeCallback,
)


class FakeContext:
    def __init__(self) -> None:
        self.submissions = []

    def submit_data(self, data, finish_stream=False) -> None:
        self.submissions.append((data.get_main_data(), finish_stream))


class FakeSession:
    cancelled = False


def test_audio_delta_is_streamed_to_liteavatar_immediately() -> None:
    context = FakeContext()
    definition = DataBundleDefinition()
    definition.add_entry(DataBundleEntry.create_audio_entry("avatar_audio", 1, 24000))
    callback = QwenTtsRealtimeCallback(
        context=context,
        output_definition=definition,
        session=FakeSession(),
    )
    pcm = np.array([-32768, 0, 32767], dtype=np.int16).tobytes()

    callback.on_event(
        {
            "type": "response.audio.delta",
            "delta": base64.b64encode(pcm).decode("ascii"),
        }
    )

    audio, finished = context.submissions[0]
    assert finished is False
    assert audio.shape == (1, 3)
    np.testing.assert_allclose(audio[0], [-1.0, 0.0, 32767 / 32768], atol=1e-6)


def test_completion_finishes_the_liteavatar_stream_once() -> None:
    context = FakeContext()
    definition = DataBundleDefinition()
    definition.add_entry(DataBundleEntry.create_audio_entry("avatar_audio", 1, 24000))
    callback = QwenTtsRealtimeCallback(context, definition, FakeSession())

    callback.on_event({"type": "response.done"})
    callback.on_event({"type": "session.finished"})

    assert len(context.submissions) == 1
    audio, finished = context.submissions[0]
    assert finished is True
    assert audio.shape == (1, 240)


def test_service_error_finishes_the_liteavatar_stream() -> None:
    context = FakeContext()
    definition = DataBundleDefinition()
    definition.add_entry(DataBundleEntry.create_audio_entry("avatar_audio", 1, 24000))
    callback = QwenTtsRealtimeCallback(context, definition, FakeSession())

    callback.on_event({"type": "error", "error": {"message": "quota exceeded"}})

    assert len(context.submissions) == 1
    assert context.submissions[0][1] is True


def test_config_defaults_to_the_requested_qwen_snapshot() -> None:
    config = TTSConfig()

    assert config.model_name == "qwen3-tts-instruct-flash-realtime-2026-01-22"
    assert config.voice == "Cherry"
    assert config.sample_rate == 24000
    assert config.language_type == "Chinese"


def test_text_chunks_share_one_realtime_session_and_finish_it() -> None:
    events = []

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            events.append(("create", kwargs))

        def connect(self) -> None:
            events.append(("connect",))

        def update_session(self, **kwargs) -> None:
            events.append(("update", kwargs))

        def append_text(self, text) -> None:
            events.append(("append", text))

        def finish(self) -> None:
            events.append(("finish",))

    class FakeStreamer:
        data_definition = DataBundleDefinition()
        data_definition.add_entry(
            DataBundleEntry.create_audio_entry("avatar_audio", 1, 24000)
        )

        def new_stream(self, **_kwargs):
            return ChatStreamIdentity(ChatDataType.AVATAR_AUDIO, 2, 3)

    class FakeSubmitter:
        def get_streamer(self, _data_type):
            return FakeStreamer()

    handler = HandlerTTS()
    handler.load(None, TTSConfig(instructions="温暖自然"))
    handler.client_factory = FakeClient
    context = TTSContext("session")
    context.data_submitter = FakeSubmitter()
    stream = ChatStreamIdentity(ChatDataType.AVATAR_TEXT, 1, 1)

    def text_data(text: str, is_last: bool = False) -> ChatData:
        definition = DataBundleDefinition()
        definition.add_entry(DataBundleEntry.create_text_entry("avatar_text"))
        bundle = DataBundle(definition)
        bundle.set_main_data(text)
        return ChatData(
            stream_id=stream,
            type=ChatDataType.AVATAR_TEXT,
            data=bundle,
            is_last_data=is_last,
        )

    context.handle_text_stream(text_data("欢迎来到"), handler)
    context.handle_text_stream(text_data("灵山胜境。", is_last=True), handler)

    assert [event[0] for event in events] == [
        "create",
        "connect",
        "update",
        "append",
        "append",
        "finish",
    ]
    assert events[0][1]["model"] == TTSConfig().model_name
    assert events[2][1]["instructions"] == "温暖自然"
    assert stream.key in context.api_links


def test_a5_config_and_setup_install_the_qwen_handler() -> None:
    service_root = Path(__file__).resolve().parents[2]
    config = yaml.safe_load(
        (service_root / "openavatar" / "a5_liteavatar.yaml").read_text(
            encoding="utf-8"
        )
    )
    handlers = config["default"]["chat_engine"]["handler_configs"]
    tts = handlers["QwenTTS"]

    assert tts["module"] == (
        "tts/qwen_tts_realtime/tts_handler_qwen_tts_realtime"
    )
    assert tts["model_name"] == TTSConfig().model_name

    setup_script = (service_root / "setup-avatar.ps1").read_text(encoding="utf-8")
    assert "qwen_tts_realtime" in setup_script
