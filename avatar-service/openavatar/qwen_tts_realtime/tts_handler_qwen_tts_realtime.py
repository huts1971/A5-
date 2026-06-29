import base64
import os
import re
from abc import ABC
from dataclasses import dataclass
from typing import Dict, Optional, cast

import dashscope
import numpy as np
from dashscope.audio.qwen_tts_realtime import (
    AudioFormat,
    QwenTtsRealtime,
    QwenTtsRealtimeCallback as DashScopeQwenTtsRealtimeCallback,
)
from pydantic import BaseModel, Field

from chat_engine.common.handler_base import (
    HandlerBase,
    HandlerBaseInfo,
    HandlerDataInfo,
    HandlerDetail,
)
from chat_engine.contexts.handler_context import HandlerContext
from chat_engine.contexts.session_context import SessionContext
from chat_engine.data_models.chat_data.chat_data_model import ChatData
from chat_engine.data_models.chat_data_type import ChatDataType
from chat_engine.data_models.chat_engine_config_data import (
    ChatEngineConfigModel,
    HandlerBaseConfigModel,
)
from chat_engine.data_models.chat_signal import ChatSignal, SignalFilterRule
from chat_engine.data_models.chat_signal_type import ChatSignalType
from chat_engine.data_models.chat_stream import ChatStreamIdentity, StreamKey
from chat_engine.data_models.chat_stream_config import ChatStreamConfig
from chat_engine.data_models.runtime_data.data_bundle import (
    DataBundle,
    DataBundleDefinition,
    DataBundleEntry,
)


class TTSConfig(HandlerBaseConfigModel, BaseModel):
    voice: str = Field(default="Cherry")
    sample_rate: int = Field(default=24000)
    api_key: str | None = Field(default_factory=lambda: os.getenv("DASHSCOPE_API_KEY"))
    model_name: str = Field(
        default="qwen3-tts-instruct-flash-realtime-2026-01-22"
    )
    language_type: str = Field(default="Chinese")
    instructions: str | None = Field(default=None)
    optimize_instructions: bool = Field(default=True)


@dataclass
class QwenTtsSession:
    input_stream_id: ChatStreamIdentity
    output_stream_key: Optional[StreamKey] = None
    client: Optional[QwenTtsRealtime] = None
    cancelled: bool = False

    def reset(self) -> None:
        self.cancelled = True
        if self.client is None:
            return
        try:
            self.client.cancel_response()
            self.client.clear_appended_text()
            self.client.close()
        except Exception:
            pass
        self.client = None


class QwenTtsRealtimeCallback(DashScopeQwenTtsRealtimeCallback):
    def __init__(self, context, output_definition, session):
        self.context = context
        self.output_definition = output_definition
        self.session = session
        self.finished = False

    def on_event(self, message) -> None:
        if self.session.cancelled:
            return
        event_type = message.get("type")
        if event_type in {"response.done", "session.finished", "error"}:
            self._finish_stream()
            return
        if event_type != "response.audio.delta":
            return
        pcm = base64.b64decode(message["delta"])
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        output = DataBundle(self.output_definition)
        output.set_main_data(audio[np.newaxis, ...])
        self.context.submit_data(output)

    def _finish_stream(self) -> None:
        if self.finished:
            return
        self.finished = True
        output = DataBundle(self.output_definition)
        output.set_main_data(np.zeros((1, 240), dtype=np.float32))
        self.context.submit_data(output, finish_stream=True)
        if hasattr(self.context, "complete_session"):
            self.context.complete_session(self.session)


class TTSContext(HandlerContext):
    def __init__(self, session_id: str):
        super().__init__(session_id)
        self.api_links: Dict[StreamKey, QwenTtsSession] = {}

    def complete_session(self, session: QwenTtsSession) -> None:
        self.api_links.pop(session.input_stream_id.key, None)

    def handle_text_stream(self, data: ChatData, handler: "HandlerTTS") -> None:
        input_stream = data.stream_id
        input_stream_key = input_stream.key
        session = self.api_links.get(input_stream_key)
        if session is None:
            for old_session in self.api_links.values():
                old_session.reset()
            self.api_links.clear()
            session = QwenTtsSession(input_stream_id=input_stream)
            self.api_links[input_stream_key] = session
            streamer = self.data_submitter.get_streamer(ChatDataType.AVATAR_AUDIO)
            output_stream = streamer.new_stream(
                sources=[input_stream],
                name="qwen_tts_realtime",
                config=ChatStreamConfig(cancelable=True),
            )
            session.output_stream_key = output_stream.key
            callback = QwenTtsRealtimeCallback(
                self, streamer.data_definition, session
            )
            session.client = handler.client_factory(
                model=handler.model_name,
                callback=callback,
                url=handler.url,
                workspace=handler.workspace,
            )
            session.client.connect()
            session.client.update_session(
                voice=handler.voice,
                response_format=AudioFormat.PCM_24000HZ_MONO_16BIT,
                mode="server_commit",
                language_type=handler.language_type,
                instructions=handler.instructions,
                optimize_instructions=handler.optimize_instructions,
            )

        text = data.data.get_main_data()
        if text:
            text = re.sub(r"<\|.*?\|>", "", text)
            if text:
                session.client.append_text(text)
        if data.is_last_data:
            session.client.finish()


class HandlerTTS(HandlerBase, ABC):
    def __init__(self):
        super().__init__()
        self.client_factory = QwenTtsRealtime
        self.voice = "Cherry"
        self.sample_rate = 24000
        self.model_name = TTSConfig().model_name
        self.language_type = "Chinese"
        self.instructions = None
        self.optimize_instructions = True
        self.url = None
        self.workspace = None

    def get_handler_info(self) -> HandlerBaseInfo:
        return HandlerBaseInfo(config_model=TTSConfig)

    def get_handler_detail(
        self, session_context: SessionContext, context: HandlerContext
    ) -> HandlerDetail:
        definition = DataBundleDefinition()
        definition.add_entry(
            DataBundleEntry.create_audio_entry(
                "avatar_audio", 1, self.sample_rate
            )
        )
        return HandlerDetail(
            inputs=[HandlerDataInfo(type=ChatDataType.AVATAR_TEXT)],
            outputs=[
                HandlerDataInfo(
                    type=ChatDataType.AVATAR_AUDIO,
                    definition=definition,
                )
            ],
            signal_filters=[
                SignalFilterRule(ChatSignalType.STREAM_CANCEL, None, None)
            ],
        )

    def load(
        self,
        engine_config: ChatEngineConfigModel,
        handler_config: Optional[BaseModel] = None,
    ) -> None:
        config = cast(TTSConfig, handler_config or TTSConfig())
        self.voice = config.voice
        self.sample_rate = config.sample_rate
        self.model_name = config.model_name
        self.language_type = config.language_type
        self.instructions = config.instructions
        self.optimize_instructions = config.optimize_instructions
        self.url = getattr(config, "url", None)
        self.workspace = getattr(config, "workspace", None)
        dashscope.api_key = os.getenv("DASHSCOPE_API_KEY") or config.api_key

    def create_context(self, session_context, handler_config=None):
        return TTSContext(session_context.session_info.session_id)

    def start_context(
        self, session_context: SessionContext, context: HandlerContext
    ) -> None:
        pass

    def handle(
        self,
        context: HandlerContext,
        inputs: ChatData,
        output_definitions: Dict[ChatDataType, HandlerDataInfo],
    ) -> None:
        if inputs.type == ChatDataType.AVATAR_TEXT:
            cast(TTSContext, context).handle_text_stream(inputs, self)

    def on_signal(self, context: HandlerContext, signal: ChatSignal) -> None:
        if signal.type != ChatSignalType.STREAM_CANCEL or not signal.related_stream:
            return
        stream_key = signal.related_stream.key
        tts_context = cast(TTSContext, context)
        session = tts_context.api_links.pop(stream_key, None)
        if session:
            session.reset()
            return
        for key, active_session in list(tts_context.api_links.items()):
            if active_session.output_stream_key == stream_key:
                active_session.reset()
                tts_context.api_links.pop(key, None)
                return

    def destroy_context(self, context: HandlerContext) -> None:
        tts_context = cast(TTSContext, context)
        for session in tts_context.api_links.values():
            session.reset()
        tts_context.api_links.clear()
