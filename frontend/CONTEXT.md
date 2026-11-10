# A5 景区导览服务 AI 数字人 P0 Context

## Source

This context is initialized from `D:\ws01\A5_景区导览服务AI数字人_P0第一版落地实施手册.docx` and the existing frontend project under `D:\ws01\v1\frontend`.

## Project Snapshot

- Digital human guide name: 灵诗音, for a scenic area AI digital human guide system.
- P0 goal: complete a stable, runnable, demo-ready first version in 10-14 days.
- Team shape: three lanes, AI/product, frontend/experience, backend/engineering.
- Current codebase: frontend-first React + Vite + Ant Design project.
- P0 success standard: not feature count, but a reliable end-to-end demo loop.

The P0 demo must show that the system serves both visitors and scenic-area administrators: guided browsing, preference-based route recommendation, AI guide Q&A grounded in local knowledge, lightweight digital human presentation, and admin maintenance of scenic data and knowledge documents.

## Demo Flow

Every P0 feature should support this 5-7 minute path:

1. Visitor enters the home page and sees scenic-area introduction, popular spots, route recommendation, and AI guide entry points.
2. Visitor chooses a preference such as parent-child, history, photography, or relaxed trip, plus available time.
3. System returns 1-3 explainable routes with spot order, estimated duration, and recommendation reasons.
4. Visitor opens a scenic spot detail page with image/text content and AI explanation entry.
5. Visitor asks the AI guide a question such as "这里有什么历史故事？"
6. AI answers from the local knowledge base and shows 1-3 sources or snippets.
7. The answer can be spoken by TTS or browser `SpeechSynthesis`; the guide avatar changes state.
8. Admin maintains spots, routes, knowledge docs, rebuilds the knowledge index, and reviews chat logs.

## P0 Scope

Must have:

- Visitor pages: home, spot list, spot detail, route recommendation, AI guide chat.
- Admin pages: spot management, route management, knowledge management, chat log management.
- AI: RAG-based question answering, spot explanation generation, basic refusal when data is missing.
- Route recommendation: rule-based route selection by preference, duration, physical level, and tags.
- Digital human: lightweight 2D guide avatar with `idle`, `thinking`, and `speaking` states.
- Engineering: mock mode, clear API encapsulation, stable demo fallback behavior, README/deploy notes when backend exists.

Do not do in P0 unless explicitly approved:

- Real 3D digital human, motion capture, or real-time lip sync.
- Real GPS navigation, live congestion prediction, queue prediction, ticketing, orders, membership.
- Multi-scenic-area SaaS, multi-tenant permissions, Kubernetes, microservice governance.
- Large framework changes, new UI library, or unnecessary frontend dependencies.

## Domain Glossary

- 灵诗音: the named digital human guide persona for the scenic-area AI guide experience.
- 游客端: visitor-facing web experience for browsing spots, route recommendations, and AI guide chat.
- 管理后台: admin-facing pages for maintaining scenic spots, routes, knowledge docs, and chat logs.
- 景点: a scenic spot or service point with name, summary, story, tags, recommended visit time, crowd types, image URL, and ordering.
- 路线: an ordered sequence of spots with estimated duration, suitable crowd, and reasons per stop.
- 偏好: visitor intent such as parent-child, history/culture, photography, relaxed trip, plus duration and physical level.
- AI 导游问答: chat flow where the visitor asks questions and receives guide-like answers grounded in retrieved scenic knowledge.
- 知识库: Markdown/PDF-style scenic documents split into chunks and indexed for retrieval.
- RAG: retrieve relevant knowledge chunks, build a prompt, call the model or mock fallback, and return answer plus sources.
- 资料来源: the source title, spot name, section, short snippet, and optional score shown with AI answers to prove grounding at the knowledge-chunk level.
  _Avoid_: generic "from knowledge base" labels, full raw document dumps.
- 数字人轻量展示: 2D avatar or small state animation representing guide status, not a 3D character system.
- Mock 模式: demo fallback path for AI, TTS, vector search, and seed data when real services fail.
- 演示链路: the complete visitor/admin path that must run repeatedly without white screens or crashes.
- 后端 P0 闭环: the minimum backend scope that supports the demo chain from scenic data to route recommendation, RAG answer with sources, chat logging, admin maintenance, and mock/degraded operation.
  _Avoid_: production platform backend, multi-scenic SaaS backend, personalized feature backend.
- 景区公开资料包: the source material directory for the first scenic-area knowledge base, located at `D:\ws01\v1\Scenic Area Public Information Package`.
  _Avoid_: crawler data, third-party live data, invented scenic content.
- 灵山胜境: the first P0 scenic-area scope for seeded spots, route recommendations, and RAG answers.
  _Avoid_: abstract multi-scenic-area platform, generic sample scenic area.
- 轻量问答会话: a short AI guide chat session used for chat logs and limited follow-up context, not a persistent user memory system.
  _Avoid_: long-term personalization memory, account-level profile, cross-day preference memory.
- 后端 TTS: backend-generated speech audio for AI guide answers, returned to the frontend as an `audio_url`.
  _Avoid_: frontend-only speech as the primary P0 voice path.
- API 错误: the unified backend error response shape with `message`, `code`, and `status`.
  _Avoid_: raw stack traces, inconsistent error strings, success-response envelopes for normal resource payloads.
- 后端 P0 测试底线: the minimum automated checks covering seeded spots, route recommendation, chat degradation, knowledge rebuild status, TTS failure behavior, and admin CRUD happy paths.
  _Avoid_: tests that require real LLM/TTS credentials, coverage targets that delay the demo loop.
- 后端第一阶段: the initial backend delivery slice: project skeleton, health check, SQLite bootstrap, seeded Ling Shan spots/routes, rule route recommendation, keyword retrieval, chat fallback response, Swagger, tests, and README.
  _Avoid_: full real-model integration as a prerequisite, production hardening, personalized feature work.

## Roles And Ownership

- AI/product owner: scenic-area scope, knowledge docs, prompt design, 50-question test set, demo script.
- Frontend/experience owner: visitor pages, admin pages, chat UI, avatar states, TTS interaction, consistent UI.
- Backend/engineering owner: APIs, database, RAG pipeline, model/TTS adapters, deployment, logs, tests.

Daily work should answer: what was completed, what blocks the demo flow, which interfaces changed, and which features should be cut or deferred.

## Frontend Shape

The existing project is `a5-ai-guide-frontend` with:

- React 18, Vite 6, TypeScript, React Router, Ant Design, Ant Design icons.
- Scripts: `npm run dev`, `npm run build`, `npm run preview`, `npm run verify:visitor`, `npm run verify:admin`.
- Source directories: `src/api`, `src/components`, `src/layouts`, `src/pages`, `src/styles`, `src/types`, plus `src/App.tsx` and `src/main.tsx`.

Frontend rules:

- Pages compose and load data; reusable behavior belongs in components and API clients.
- Pages/components must not call `fetch` directly; use `src/api`.
- Preserve mock data and demo fallback paths.
- Visitor screens should feel warm and guide-oriented; admin screens should be dense, predictable, and efficient.
- Every data-driven view needs loading, empty, error, and retry behavior where applicable.
- AI answers must show sources when available; routes must show why they were recommended.

## Expected API Surface

The implementation manual defines these P0 endpoints:

- `GET /api/spots`: list spots with `id`, `name`, `tags`, `summary`, `visit_minutes`, `image_url`.
- `GET /api/spots/{id}`: spot details, story, notes, recommended questions.
- `POST/PUT/DELETE /api/admin/spots`: admin spot maintenance.
- `POST /api/routes/recommend`: input preference, duration, physical level; return routes and reasons.
- `GET /api/routes`: route list for visitor/admin reuse.
- `POST /api/chat`: input `question`, optional `spot_id`, profile; return answer, sources, optional `audio_url`.
- `POST /api/guide/explain`: generate a spot explanation for a visitor type.
- `GET/POST /api/knowledge/docs`: knowledge document list/upload/edit.
- `POST /api/knowledge/rebuild`: rebuild the vector index.
- `GET /api/logs/chats`: admin chat logs.

Keep endpoint strings and response normalization local to `src/api`.

## Data Concepts

Likely backend tables and frontend DTOs should align with:

- `scenic_spot`: spot content and metadata.
- `route`: route name, theme, duration, suitable crowd, description.
- `route_spot`: route-to-spot sequence, stay minutes, reason.
- `knowledge_doc`: uploaded or seeded knowledge document metadata.
- `knowledge_chunk`: indexed chunks with spot metadata and vector IDs.
- `chat_session`: visitor session metadata.
- `chat_message`: question, answer, sources JSON, created time.
- `tts_cache`: cached audio by text hash, if backend TTS exists.

## RAG Rules

P0 RAG should be simple and reliable:

- Use structured scenic docs, preferably Markdown.
- Chunk size target: 500-800 Chinese characters, with 80-120 character overlap.
- Metadata should include `spot_id`, `spot_name`, `section`, and `source_file`.
- Retrieve top 4 chunks, then answer only from retrieved context.
- If similarity is too low or information is missing, say the current material lacks exact information.
- Normal answers should be 150-300 Chinese characters; explanation scripts can be 300-600.
- Returned answers should include direct answer, practical visitor suggestion, and 1-3 source titles/snippets.

The AI guide voice should be natural and visitor-friendly, not academic. It must not invent prices, opening hours, history, safety information, or service locations absent from the knowledge base.

## Route Recommendation Rules

P0 route recommendation should be rule-based, with optional LLM polishing for copy:

- Inputs: `visitor_type`, `duration_minutes`, `physical_level`, `interest_tags`, optional `start_point`.
- Score by tag match, crowd match, popularity, and distance/order penalty.
- Filter routes/spots that exceed duration or do not fit the crowd.
- Keep total route time within about 110% of the requested duration.
- Return 1-3 routes with `route_name`, `total_minutes`, ordered spots, stay minutes, and recommendation reason.

Do not let the model freely invent route plans in P0.

## Reliability And Mock Mode

The demo must survive service failures:

- LLM timeout: return preset local answer or a summary from retrieved snippets.
- TTS failure: use browser `SpeechSynthesis` or hide/disable playback gracefully.
- Vector DB unavailable: use keyword search over local docs or seeded mock answers.
- Database unavailable during frontend demo: use seed JSON/mock data.
- API failure: show friendly errors and retries; never white screen or expose raw stack traces.

Main demo flow should complete three times without crash, white screen, unhandled exception, or horizontal layout break.

## Acceptance Criteria

P0 is acceptable when:

- Visitor home links to spots, route recommendation, and AI guide.
- Spot list/detail show at least seed data and useful guide content.
- Route recommendation supports at least three preferences and always explains recommendations.
- AI guide chat supports input, loading, answer, sources, error fallback, and TTS path.
- Avatar guide visibly changes state during thinking/speaking.
- Admin covers spots, routes, knowledge, and chat logs.
- Mock mode can run the full demo without real AI/TTS services.
- README or handoff explains how to run and verify the app.

Quality bar:

- 50-question AI test set should have at least 35 usable answers.
- Sources appear for grounded answers.
- Missing information is admitted rather than fabricated.
- Visitor and admin UI share one visual language.
- Fixed demo questions, cached audio or fallback speech, and backup answers are ready for presentation.

## Current Assumptions

- The current checked-in code is frontend-only; backend/data/deploy context is captured here as intended system context from the manual.
- Local Markdown issue tracking is used because no git remote is configured in this workspace.
- The frontend project is treated as the active project root because it contains the existing `AGENTS.md`, `package.json`, and source tree.
- The backend project root is `D:\ws01\v1\backend`, sibling to `D:\ws01\v1\frontend`.
- The first P0 knowledge source is `D:\ws01\v1\Scenic Area Public Information Package`, currently containing two Ling Shan scenic-area Word documents and one tourism behavior analysis spreadsheet.
- Backend first-stage completion means a runnable FastAPI service with `/health`, spots, route recommendation, chat fallback, knowledge rebuild status, Swagger docs, pytest coverage for the main path, and README startup instructions.
