# Folder Structure

This document limits where new files should go. Prefer extending existing
directories over creating new top-level folders.

## Root

```text
A5--main/
  AGENTS.md
  FIRST-TIME-SETUP.md
  ARCHITECTURE.md
  FOLDER_STRUCTURE.md
  UI_GUIDELINES.md
  README-local-run.md
  avatar-service/
  backend/
  frontend/
  Issues/
  knowledge/
  PRD/
  summary/
  docs/
  scripts/
  Scenic Area Public Information Package/
```

Root docs are for cross-project handoff and norms only. Feature-specific docs
should live near their subsystem or under `docs/`.

## Backend

```text
backend/
  app/
    api/
    core/
    db/
    models/
    schemas/
    services/
  data/
  evaluations/
  scripts/
  tests/
```

Rules:

- API endpoints go in `app/api`.
- Business logic goes in `app/services`.
- Database models go in `app/models`.
- Pydantic schemas go in `app/schemas`.
- Tests go in `tests`.
- Generated runtime files belong under `backend/data` and should not be treated
  as source unless explicitly documented.

## Frontend

```text
frontend/
  src/
    api/
    components/
      common/
      guide/
      scenic/
    config/
    layouts/
    pages/
      admin/
      visitor/
    styles/
    types/
    utils/
  public/
  dist/
  docs/
  scripts/
```

Rules:

- New HTTP clients go in `src/api`.
- Visitor pages go in `src/pages/visitor`.
- Admin pages go in `src/pages/admin`.
- Reusable UI goes in `src/components`.
- Shared domain types go in `src/types`.
- LiteAvatar WebRTC UI belongs under `src/components/guide`; Avatar inference
  code does not belong in the frontend.
- Static browser assets go in `public`.
- `dist` is a stable demo build output included for packaging. Do not edit it by
  hand; rebuild it with `npm run build` or `BUILD-FRONTEND.bat`.

## Knowledge And Source Data

```text
Scenic Area Public Information Package/
  *.docx
  *.xlsx

knowledge/
  curated/
  docs/
  tabular/
```

Rules:

- Treat `Scenic Area Public Information Package/` as read-only raw input.
- Curated structured facts, aliases, tags, and approved web sources belong in
  `knowledge/curated`.
- Markdown knowledge documents belong in `knowledge/docs`.
- Tabular summaries belong in `knowledge/tabular`.
- Do not invent scenic facts. Use reviewed source data and keep provenance.

## Scripts And Docs

- Root `.bat` files are stable Windows demo entrypoints.
- `scripts/` contains stable startup and packaging helpers.
- `backend/scripts` contains backend data/evaluation scripts.
- `frontend/scripts` contains frontend verification scripts.
- `docs/` is for cross-system documentation.
- `summary/` contains current development handoffs.
- `PRD/` and `Issues/` contain approved requirements and task breakdowns.
- `frontend/docs/adr` contains frontend/backend decision records already used by
  the project.

## Do Not Create Without Approval

- A second frontend app.
- A second backend app.
- A new global `src/` outside `frontend`.
- A new database or vector-store top-level folder.
- A replacement UI framework directory.
- Large asset folders outside `frontend/public`, `frontend/src/vendor`, or
  documented knowledge/source-data paths.
