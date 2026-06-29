# Frontend Agent Guidelines

This file defines the working rules for Codex and human contributors on the
A5 Scenic Area AI Digital Human P0 frontend.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context project: read `CONTEXT.md` first, then relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## Project Scope

- Product: scenic area AI guide digital human system.
- Version target: P0 minimum viable competition demo.
- Owner area: visitor frontend, admin frontend, AI guide chat experience, lightweight digital human presentation.
- Tech stack: React + Vite + Ant Design.
- Primary goal: a stable, clear, demo-ready web experience.

Do not change the frontend framework, build tool, UI library, route strategy, or
state management approach without explicit human approval.

## Directory Structure

Use this structure under `frontend/src`:

```text
src/
  api/                    # Unified API clients and mock/real mode switch
  assets/                 # Static images, digital human avatar assets, icons
  components/             # Reusable business and UI components
    guide/                # LiteAvatarStage, AvatarGuide, ChatBox, SourceCard
    scenic/               # SpotCard, RouteCard, PreferenceForm
    common/               # Loading, EmptyState, ErrorState, PageHeader, etc.
  layouts/                # VisitorLayout and AdminLayout
  pages/
    visitor/              # Home, spots, routes, AI guide pages
    admin/                # Spot, route, knowledge, chat log management pages
  routes/                 # React Router route definitions
  styles/                 # Global theme, tokens, shared style utilities
  types/                  # Shared TypeScript types and DTOs
  utils/                  # Small pure helpers
```

Recommended P0 pages:

- `pages/visitor/HomePage.tsx`
- `pages/visitor/SpotListPage.tsx`
- `pages/visitor/SpotDetailPage.tsx`
- `pages/visitor/RouteRecommendPage.tsx`
- `pages/visitor/AiGuidePage.tsx`
- `pages/admin/AdminSpotPage.tsx`
- `pages/admin/AdminRoutePage.tsx`
- `pages/admin/AdminKnowledgePage.tsx`
- `pages/admin/AdminChatLogPage.tsx`

Keep page files responsible for composition and data loading. Put reusable UI and
interaction behavior in components.

## Component Naming

- Use PascalCase for React components: `SpotCard`, `RouteCard`, `AvatarGuide`.
- Use camelCase for hooks and utilities: `useChatSession`, `formatVisitTime`.
- Use `Page` suffix for route-level screens: `AiGuidePage`.
- Use `Modal`, `Drawer`, `Form`, `Table`, or `Panel` suffixes for specific UI roles.
- Keep component names domain-specific when possible. Prefer `SourceCard` over
  generic names like `InfoCard` when it represents retrieved knowledge sources.

Core P0 components:

- `ChatBox`: AI guide conversation, input, message list, loading and error state.
- `AvatarGuide`: lightweight 2D digital human with `idle`, `thinking`, and
  `speaking` states.
- `SourceCard`: retrieved knowledge source display.
- `/guide` speech is automatic through the local OpenAvatarChat TTS + LiteAvatar service.
  and browser `SpeechSynthesis` as fallback.
- `SpotCard`: scenic spot summary.
- `RouteCard`: recommended route summary and spot sequence.
- `PreferenceForm`: visitor preference and duration input.

## API Encapsulation

Pages and components must not call `fetch` or `axios` directly.

All remote access belongs in `src/api`:

```text
api/
  client.ts               # Base request client and error normalization
  config.ts               # API base URL and mock mode flag
  spots.ts                # getSpots, getSpotDetail, create/update/delete spots
  routes.ts               # recommendRoutes, route management APIs
  chat.ts                 # chatWithGuide
  knowledge.ts            # knowledge docs and rebuild index APIs
  logs.ts                 # chat log APIs
  mock/                   # P0 mock data and fallback responses
```

Required API behavior:

- Keep a mock mode switch so the demo can run without a backend.
- Normalize request errors into a shared shape such as:

```ts
export type ApiError = {
  message: string;
  status?: number;
  code?: string;
};
```

- Preserve stable response types in `src/types`.
- Keep endpoint changes local to `src/api`; do not spread raw endpoint strings
  across pages.
- Add graceful fallback behavior for `/api/chat`, TTS, knowledge rebuild, and log
  loading failures.

## UI Style

The frontend should feel like a practical scenic area guide product, not a
marketing landing page.

- Use Ant Design components as the base UI system.
- Keep visitor pages warm, clear, and guide-oriented.
- Keep admin pages dense, predictable, and efficient for repeated use.
- Use one consistent visual language across visitor and admin pages.
- Make the first screen clearly communicate "scenic area AI guide digital human".
- From the home page, users should reach AI guide chat within two clicks.
- Route recommendations must show the reason for recommendation.
- AI answers must show 1-3 knowledge sources when available.
- Avoid heavy 3D, complex lip sync, large decorative gradients, and unrelated
  visual flourishes in P0.
- Ensure desktop and mobile layouts do not overlap, clip text, or create
  horizontal scrolling.

Use icons in buttons where Ant Design icons are available. Use text buttons only
when the command is clearer as text.

## Loading, Empty, and Error States

Every data-driven page and component must handle all four states:

- `idle`: initial ready state before user action.
- `loading`: visible progress indicator while requests are pending.
- `empty`: meaningful empty result, such as no spots, no routes, or no logs.
- `error`: friendly recovery message and retry path where possible.

Minimum expectations:

- No white screens.
- No raw stack traces or raw API error objects in the UI.
- No silent failures for chat, route recommendation, TTS, or admin CRUD.
- Disable repeated submit actions while a request is in flight.
- Keep previous useful content visible when refreshing data if that improves the
  demo flow.

Recommended shared components:

- `PageLoading`
- `EmptyState`
- `ErrorState`
- `RetryButton`

## Digital Human Experience

P0 uses a lightweight digital human strategy:

- Static 2D guide avatar or two to three avatar states.
- Required states: `idle`, `thinking`, `speaking`.
- Speaking state can be CSS animation, image switch, or subtle motion.
- TTS can use browser `SpeechSynthesis` first, then backend audio when available.
- Do not implement 3D modeling, motion capture, real-time lip sync, or complex
  animation systems in P0 unless explicitly approved.

The digital human must support the demo story:

- It should look like the user is interacting with a guide, not a generic chatbot.
- It should keep working when the model API or TTS API fails.
- It should avoid blocking the conversation if audio playback is unavailable.

## Change Discipline

For every Codex task:

1. Keep the task smaller than half a day of human work.
2. Modify only files related to the requested feature or fix.
3. Do not rewrite working pages or shared components without a clear reason.
4. Do not introduce new dependencies without approval.
5. Do not store API keys, secrets, private accounts, or real visitor data in the
   repository.
6. Preserve mock data and demo fallback paths.
7. Prefer simple, stable implementation over clever abstractions.

## Required Handoff After Each Change

Every completed change must report:

- Files changed.
- What behavior changed.
- How it was verified.
- Commands run, such as `npm run dev`, `npm run build`, `npm run lint`, or tests.
- Any known limitations or follow-up tasks.

If verification could not be run, state the reason clearly.

## P0 Acceptance Checklist

Before considering frontend P0 complete:

- Visitor home page links to spots, route recommendation, and AI guide.
- Spot list and detail pages display seed or backend data.
- Route recommendation supports at least three visitor preferences.
- AI guide chat supports question input, loading, answer display, source display,
  error fallback, and TTS playback.
- `AvatarGuide` changes state during thinking and speaking.
- Admin pages cover spots, routes, knowledge, and chat logs.
- All important pages have loading, empty, and error states.
- Mock mode can support the full demo without real AI or TTS services.
- The main demo flow can be completed three times without white screen or crash.
