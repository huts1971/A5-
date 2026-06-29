from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .gateway import WebRtcGateway
from .runtime import AvatarRuntime
from .sessions import SessionRegistry


def create_app(
    runtime: AvatarRuntime,
    webrtc_gateway: WebRtcGateway | None = None,
    openavatar_url: str = "http://127.0.0.1:8282",
) -> FastAPI:
    sessions = SessionRegistry()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        runtime.start()
        try:
            yield
        finally:
            runtime.stop()

    app = FastAPI(title="A5 Avatar Service", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.get("/health")
    def health() -> dict[str, object]:
        runtime_status = runtime.status()
        return {
            "status": "ok",
            "ready": runtime_status.ready,
            "detail": runtime_status.detail,
        }

    @app.get("/readiness")
    def readiness():
        runtime_status = runtime.status()
        if not runtime_status.ready:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "detail": runtime_status.detail,
                },
            )
        return {"status": "ready", "detail": runtime_status.detail}

    @app.post("/api/avatar/sessions", status_code=201)
    def create_session() -> dict[str, str]:
        session = sessions.create()
        runtime_status = runtime.status()
        return {
            "session_id": session.session_id,
            "status": "ready" if runtime_status.ready else "preparing",
            "openavatar_url": openavatar_url,
        }

    @app.get("/api/avatar/sessions/{session_id}")
    def get_session(session_id: str) -> dict[str, str]:
        if sessions.get(session_id) is None:
            raise HTTPException(status_code=404, detail="Avatar session not found")
        runtime_status = runtime.status()
        return {
            "session_id": session_id,
            "status": "ready" if runtime_status.ready else "preparing",
            "openavatar_url": openavatar_url,
        }

    @app.delete("/api/avatar/sessions/{session_id}", status_code=204)
    def delete_session(session_id: str) -> Response:
        sessions.remove(session_id)
        return Response(status_code=204)

    @app.post("/api/avatar/webrtc/offer")
    async def exchange_webrtc_offer(payload: dict[str, object]) -> dict[str, object]:
        if webrtc_gateway is None:
            raise HTTPException(status_code=503, detail="OpenAvatarChat gateway is unavailable")
        return await webrtc_gateway.exchange(payload)

    @app.post("/api/avatar/sessions/{session_id}/speech", status_code=202)
    async def submit_speech(
        session_id: str,
        payload: dict[str, object],
    ) -> dict[str, bool]:
        if sessions.get(session_id) is None:
            raise HTTPException(status_code=404, detail="Avatar session not found")
        if not runtime.status().ready:
            raise HTTPException(status_code=409, detail="Avatar session is not ready")
        if webrtc_gateway is None:
            raise HTTPException(status_code=503, detail="OpenAvatarChat gateway is unavailable")
        await webrtc_gateway.speak(session_id, payload)
        return {"accepted": True}

    @app.post("/api/avatar/sessions/{session_id}/interrupt", status_code=202)
    async def interrupt_session(session_id: str) -> dict[str, bool]:
        if sessions.get(session_id) is None:
            raise HTTPException(status_code=404, detail="Avatar session not found")
        if webrtc_gateway is None:
            raise HTTPException(status_code=503, detail="OpenAvatarChat gateway is unavailable")
        await webrtc_gateway.interrupt(session_id)
        return {"accepted": True}

    return app
