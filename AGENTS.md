# A5 Agent Handoff

This is the first file to read when a new Codex session starts in this
repository.

## Project Snapshot

- Project: A5 scenic area AI digital human guide system.
- Current product direction: "Ling Shan Scenic Area AI digital human guide".
- Source commit from GitHub ZIP: `fef3da011d9178d918b9b0b4290ac0577f20c28c`.
- Local project directory: `A5--main`.
- Primary demo ports:
  - Frontend: `http://127.0.0.1:5173`
  - AI guide: `http://127.0.0.1:5173/guide`
  - Admin: `http://127.0.0.1:5174/`
  - Backend stable demo: `http://127.0.0.1:8001`
  - Backend docs: `http://127.0.0.1:8001/docs`

The project is no longer just a mock prototype. It contains a real React
frontend, a FastAPI backend, SQLite bootstrap data, Ling Shan and Nianhua Bay
knowledge assets, chat logs, admin views, OpenAvatarChat with Qwen3-TTS and
LiteAvatar, and source-aware AI guide answers.

## Current Architecture

- `frontend/`: React 18 + Vite 6 + TypeScript + Ant Design visitor and admin UI.
- `backend/`: FastAPI service with SQLite, SQLAlchemy, RAG-style retrieval,
  MiMo-compatible LLM/TTS adapters, admin APIs, and tests.
- `knowledge/`: derived curated data, Markdown docs, aliases, facts, tags, and
  tabular behavior summaries.
- `Scenic Area Public Information Package/`: raw Word and Excel source package.
  Treat it as read-only input.
- `scripts/`: Windows-oriented stable startup and packaging helpers.
- `docs/`: backend and project documentation.

Read these project-specific docs next:

1. `FIRST-TIME-SETUP.md`
2. `README-local-run.md`
3. `frontend/AGENTS.md`
4. `frontend/CONTEXT.md`
5. `ARCHITECTURE.md`
6. `FOLDER_STRUCTURE.md`
7. `UI_GUIDELINES.md`

## Technical Rules

- Frontend framework is React. Do not mix in Vue or replace the UI stack.
- Frontend build tool is Vite. Keep TypeScript mandatory for source code.
- UI system is Ant Design plus existing custom CSS and LiteAvatar components.
- Backend framework is FastAPI. Do not replace it with another backend stack.
- Persistence is currently SQLite for demo stability. Do not introduce a new
  database without explicit approval.
- API clients live under `frontend/src/api`. Pages and components must not call
  `fetch` directly.
- Backend API routers live under `backend/app/api`; business behavior belongs
  under `backend/app/services`.
- Preserve mock, fallback, and degraded paths. They are part of the demo safety
  strategy, not temporary clutter.
- Never write real API keys, GitHub tokens, admin tokens, or visitor private data
  into repository files.

## AI, RAG, Web Search, And TTS

The current answer path is structure-first and demo-stable:

1. Frontend `/guide` sends chat requests to `/api/chat`.
2. Backend classifies the question.
3. Retrieval prioritizes structured database facts, approved web facts, scenic
   spot records, tags, aliases, and knowledge chunks.
4. If trusted local evidence is insufficient, the backend may use MiMo web search
   as a supplemental source.
5. The model generates visitor-friendly guide text.
6. Backend returns answer, sources, metrics, mode/degraded status, and optional
   TTS job/audio state.
7. Frontend displays answer cards, source cards, and audio controls.

Do not assume a heavy vector database is required. The current retrieval mode is
keyword/structured-first and has tests around the intended behavior.

## Startup And Verification

Stable demo mode on Windows:

```bat
START-HERE.bat
```

Stop services:

```bat
stop-local.bat
```

After frontend or LiteAvatar UI code changes:

```bat
BUILD-FRONTEND.bat
START-HERE.bat
```

Manual developer commands:

```powershell
cd backend
python -m pytest -q
```

```powershell
cd frontend
npm run build
```

Frontend verification scripts:

```powershell
cd frontend
npm run verify:visitor
npm run verify:visitor-auth
npm run verify:dual-entrypoints
npm run verify:admin
npm run verify:admin-login
npm run verify:admin-api-auth
npm run verify:haru
npm run verify:source-provenance
```

## Current Norm Gaps

- Root-level agent entry was missing before this file; older guidance lived under
  `frontend/AGENTS.md` and scattered handoff docs.
- The project came from a GitHub ZIP archive, so this local copy has no `.git`
  history until one is initialized or cloned again.
- Current development handoffs live under `summary/`; product requirements and
  task breakdowns live under `PRD/` and `Issues/`.
- `frontend/dist` is included for stable demo packaging. Do not treat it as the
  normal development source of truth.
- Startup scripts are Windows-first. macOS/Linux manual startup may need direct
  `uvicorn` and `npm` commands.
- Real model/TTS credentials must stay in local `.env` files or environment
  variables, never in docs or committed files.

## Next Work Priorities

1. Keep the visitor demo flow stable: home, spots, routes, guide, sources, audio.
2. Improve visitor-facing visual polish with existing spot photos and
   LiteAvatar.
3. Keep admin pages practical: spots, routes, knowledge, logs, dashboard.
4. Expand structured knowledge only through curated data and reviewed sources.
5. Add tests before changing chat retrieval, web supplement, TTS, or admin CRUD.

## Change Discipline

- For small doc or UI fixes, keep edits narrow.
- For API, schema, routing, retrieval, or startup changes, write the intended
  behavior first and run the relevant tests.
- Do not move large asset directories without explicit approval.
- Do not change public API paths, frontend routes, environment variable names, or
  startup script behavior unless the user asks for that specific change.
