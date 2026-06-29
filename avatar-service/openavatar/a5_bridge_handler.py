from typing import Dict, Optional, cast

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from chat_engine.contexts.handler_context import HandlerContext
from chat_engine.contexts.session_context import SessionContext
from chat_engine.data_models.chat_data.chat_data_model import ChatData
from chat_engine.data_models.chat_data_type import ChatDataType
from chat_engine.data_models.chat_engine_config_data import (
    ChatEngineConfigModel,
    HandlerBaseConfigModel,
)
from chat_engine.data_models.chat_stream_config import ChatStreamConfig
from chat_engine.data_models.chat_signal import ChatSignal
from chat_engine.data_models.chat_signal_type import ChatSignalSourceType, ChatSignalType
from chat_engine.data_models.internal.handler_definition_data import (
    HandlerBaseInfo,
    HandlerDataInfo,
    HandlerDetail,
)
from chat_engine.data_models.runtime_data.data_bundle import (
    DataBundle,
    DataBundleDefinition,
    DataBundleEntry,
)
from handlers.manager.manager_handler_base import ManagerHandlerBase


class SpeechChunk(BaseModel):
    stream_id: str = Field(min_length=1)
    text: str
    end: bool = False


class A5BridgeContext(HandlerContext):
    def __init__(self, session_id: str):
        super().__init__(session_id)
        self.stream_id: Optional[str] = None


class A5BridgeHandler(ManagerHandlerBase):
    def __init__(self):
        super().__init__()
        self.contexts: Dict[str, A5BridgeContext] = {}
        self.text_definition = DataBundleDefinition()
        self.text_definition.add_entry(DataBundleEntry.create_text_entry("avatar_text"))
        self.text_definition.lockdown()

    def get_handler_info(self) -> HandlerBaseInfo:
        return HandlerBaseInfo(config_model=HandlerBaseConfigModel)

    def load(
        self,
        engine_config: ChatEngineConfigModel,
        handler_config: Optional[HandlerBaseConfigModel] = None,
    ):
        pass

    def create_context(
        self,
        session_context: SessionContext,
        handler_config: Optional[HandlerBaseConfigModel] = None,
    ) -> HandlerContext:
        return A5BridgeContext(session_context.session_info.session_id)

    def start_context(self, session_context: SessionContext, handler_context: HandlerContext):
        context = cast(A5BridgeContext, handler_context)
        self.contexts[context.session_id] = context

    def get_handler_detail(
        self,
        session_context: SessionContext,
        context: HandlerContext,
    ) -> HandlerDetail:
        return HandlerDetail(
            inputs={},
            outputs={
                ChatDataType.AVATAR_TEXT: HandlerDataInfo(
                    type=ChatDataType.AVATAR_TEXT,
                    definition=self.text_definition,
                    output_stream_config=ChatStreamConfig(
                        cancelable=True,
                        auto_link_input=False,
                    ),
                )
            },
        )

    def handle(
        self,
        context: HandlerContext,
        inputs: ChatData,
        output_definitions: Dict[ChatDataType, HandlerDataInfo],
    ):
        pass

    def destroy_context(self, context: HandlerContext):
        self.contexts.pop(context.session_id, None)

    def on_setup_app(self, app: FastAPI, ui, parent_block=None):
        @app.post("/a5/sessions/{session_id}/speech", status_code=202)
        async def submit_speech(session_id: str, chunk: SpeechChunk):
            context = self.contexts.get(session_id)
            if context is None or context.data_submitter is None:
                raise HTTPException(status_code=409, detail="Avatar session is not connected")
            streamer = context.data_submitter.get_streamer(ChatDataType.AVATAR_TEXT)
            if streamer is None:
                raise HTTPException(status_code=503, detail="Avatar text stream is unavailable")
            if context.stream_id != chunk.stream_id:
                streamer.new_stream(
                    sources=[],
                    name=chunk.stream_id,
                    config=ChatStreamConfig(cancelable=True, auto_link_input=False),
                )
                context.stream_id = chunk.stream_id
            bundle = DataBundle(self.text_definition)
            bundle.set_main_data(chunk.text)
            streamer.stream_data(bundle, finish_stream=chunk.end)
            if chunk.end:
                context.stream_id = None
            return {"accepted": True}

        @app.post("/a5/sessions/{session_id}/interrupt", status_code=202)
        async def interrupt(session_id: str):
            context = self.contexts.get(session_id)
            if context is None or context.signal_emitter is None:
                raise HTTPException(status_code=409, detail="Avatar session is not connected")
            context.signal_emitter.emit(
                ChatSignal(
                    type=ChatSignalType.INTERRUPT,
                    source_type=ChatSignalSourceType.CLIENT,
                    source_name="A5Bridge",
                    signal_data={"reason": "new_question"},
                )
            )
            context.stream_id = None
            return {"accepted": True}
