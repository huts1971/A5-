from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.api.admin import router as admin_router
from app.api.chat import router as chat_router
from app.api.health import router as health_router
from app.api.knowledge import router as knowledge_router
from app.api.logs import router as logs_router
from app.api.maps import router as maps_router
from app.api.route_drafts import router as route_drafts_router
from app.api.routes import router as routes_router
from app.api.spots import router as spots_router
from app.api.tours import router as tours_router
from app.api.tts import router as tts_router
from app.core.config import Settings, settings
from app.core.errors import ApiError, api_error_handler
from app.db.session import (
    create_database_engine,
    create_session_factory,
    initialize_database,
)
from app.services.bootstrap import bootstrap_ling_shan_data
from app.services.tts_jobs import TtsJobStore


def create_app(app_settings: Settings | None = None) -> FastAPI:
    active_settings = app_settings or settings
    cors_origins = [
        origin.strip()
        for origin in active_settings.cors_origins.split(",")
        if origin.strip()
    ]

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_database_engine(active_settings.database_url)
        initialize_database(engine)
        session_factory = create_session_factory(engine)
        with session_factory() as session:
            bootstrap_ling_shan_data(
                session,
                active_settings.source_package_path,
                active_settings.derived_knowledge_path,
            )
        app.state.settings = active_settings
        app.state.engine = engine
        app.state.SessionLocal = session_factory
        app.state.tts_jobs = TtsJobStore()
        try:
            yield
        finally:
            app.state.tts_jobs.shutdown()
            engine.dispose()

    app = FastAPI(title=active_settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(health_router)
    app.include_router(spots_router)
    app.include_router(routes_router)
    app.include_router(chat_router)
    app.include_router(admin_router)
    app.include_router(knowledge_router)
    app.include_router(logs_router)
    app.include_router(maps_router)
    app.include_router(route_drafts_router)
    app.include_router(tours_router)
    app.include_router(tts_router)
    Path(active_settings.tts_output_dir).mkdir(parents=True, exist_ok=True)
    app.mount(
        "/static/tts",
        StaticFiles(directory=active_settings.tts_output_dir),
        name="tts",
    )
    return app


app = create_app()
