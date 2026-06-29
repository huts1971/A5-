# Architecture

## System Layers

The project is a single scenic-area AI guide product with four practical layers:

- Visitor frontend: browsing, route recommendation, AI guide chat, source cards,
  microphone interaction, and LiteAvatar digital human presentation.
- Admin frontend: dashboard, scenic spot management, route management, knowledge
  status, web-fact review, and chat logs.
- Backend API: FastAPI routers for spots, routes, chat, admin, knowledge, logs,
  and health checks.
- Avatar service: OpenAvatarChat runs SenseVoice, Qwen3-TTS Realtime, and
  LiteAvatar independently from the A5 backend.
- Data and knowledge: SQLite demo database, raw scenic source files, curated JSON
  facts, Markdown knowledge docs, aliases, tags, and local/static assets.

## Runtime Data Flow

Visitor flow:

1. Browser loads the React app from Vite preview or dev server.
2. Pages call typed clients under `frontend/src/api`.
3. API clients call the FastAPI backend, defaulting to `http://127.0.0.1:8001`.
4. Backend reads SQLite and derived knowledge data.
5. Chat answers combine structured facts, knowledge chunks, optional MiMo LLM,
   and optional MiMo web search.
6. Answer text is streamed to OpenAvatarChat; Qwen3-TTS Realtime produces
   24 kHz PCM that drives LiteAvatar.
7. Frontend renders answer text, sources, mode/degraded state, and Avatar status.

Admin flow:

1. Admin pages call backend admin, knowledge, dashboard, and log APIs.
2. Admin writes update SQLite records, not the raw Word/Excel package.
3. Knowledge rebuild/import uses the raw package and `knowledge/` as inputs.
4. Reviewed web facts can become approved supplemental facts.

## Backend Boundaries

- `backend/app/api`: HTTP routing and request/response boundary only.
- `backend/app/services`: business behavior, retrieval, chat orchestration,
  route scoring, bootstrap, TTS, web search, and evaluation logic.
- `backend/app/models`: SQLAlchemy database models.
- `backend/app/schemas`: Pydantic DTOs shared by API handlers and services.
- `backend/app/core`: configuration and error handling.
- `backend/scripts`: data derivation and evaluation entrypoints.
- `backend/tests`: behavioral safety net. Keep tests credential-free.

Do not put large business logic directly in API route handlers.

## Frontend Boundaries

- `frontend/src/pages`: route-level composition and data loading.
- `frontend/src/components`: reusable UI and interaction pieces.
- `frontend/src/api`: all HTTP calls, endpoint strings, response normalization,
  and mock/real API switching.
- `frontend/src/types`: API and domain DTOs.
- `frontend/src/styles`: global CSS and Ant Design theme tokens.
- `frontend/src/components/guide/LiteAvatarStage.tsx`: browser-side WebRTC
  presentation and Avatar interaction state.

Pages and components must not call `fetch` directly. Add or adjust clients under
`frontend/src/api` instead.

## State Strategy

The current frontend does not use a global state library. Keep state local unless
there is a repeated, proven need for shared state.

- Page-level server data belongs in page state or small hooks local to that page.
- Shared request behavior belongs in API clients.
- Visitor profile helpers belong under `frontend/src/utils`.
- Avatar speech state should remain coordinated through the guide session so a
  new question interrupts the previous answer.

Do not introduce Redux, Zustand, MobX, or another state library without explicit
approval.

## Reliability Strategy

Demo stability is part of the architecture:

- Missing LLM key falls back to local retrieval answers.
- Avatar/TTS failure should not block chat answers.
- Retrieval is structured/keyword-first and does not require a separate vector
  service for the current demo.
- Web search is supplemental and source-aware, not the primary truth source.
- Frontend mock and fallback paths must remain available.
- The raw scenic source package is read-only; admin edits belong in SQLite.

## Interfaces To Preserve

Do not change these casually:

- Visitor routes: `/`, `/spots`, `/spots/:spotId`, `/routes`, `/guide`.
- Admin routes: `/admin/dashboard`, `/admin/spots`, `/admin/routes`,
  `/admin/knowledge`, `/admin/logs`.
- Backend API groups: `/api/spots`, `/api/routes`, `/api/chat`, `/api/admin`,
  `/api/knowledge`, `/api/logs`, `/api/tts`, `/health`.
- Frontend default API base: `http://127.0.0.1:8001`.
- Demo frontend port: `5173`.
- Stable demo backend port: `8001`.
