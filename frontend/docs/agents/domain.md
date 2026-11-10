# Domain Docs

How engineering skills should consume this project's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the project root.
- Relevant ADRs under `docs/adr/`, if any exist.
- `AGENTS.md` for frontend implementation rules, UI boundaries, verification expectations, and P0 acceptance checklist.

If a file does not exist yet, proceed silently. Do not invent architecture decisions; capture durable decisions as ADRs only after they are explicit.

## File structure

This is a single-context project:

```text
frontend/
  AGENTS.md
  CONTEXT.md
  docs/
    agents/
    adr/
  src/
```

The business context comes from `D:\ws01\A5_景区导览服务AI数字人_P0第一版落地实施手册.docx`. The current codebase is frontend-first, but the domain model includes the intended backend, RAG, data, and deployment boundaries from that manual.

## Use the glossary's vocabulary

When naming issues, tests, components, refactors, or hypotheses, prefer the vocabulary in `CONTEXT.md`: 灵诗音, 景区 AI 数字人导览系统, 游客端, 管理后台, AI 导游问答, 路线推荐, 知识库, RAG, 数字人轻量展示, Mock 模式, 演示链路.

Do not drift into broader platform language such as multi-scenic SaaS, real GPS navigation, real 3D digital human, or complex multi-agent orchestration unless the task explicitly moves beyond P0.

## Flag ADR conflicts

If a proposed change contradicts an ADR, surface the conflict directly and explain why reopening the decision may be worthwhile.
