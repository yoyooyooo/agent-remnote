# 实施计划：026-recent-activity-summaries

日期：2026-03-19  
Spec：`specs/026-recent-activity-summaries/spec.md`

## 摘要

本特性不是补更多“视图字段”，而是要**把 `db recent` 升级成 normalized recent-activity query primitive**。

目标：

- `items[]`
- `aggregates[]`
- generic filters
- generic aggregate dimensions
- generic limits

更高层的 recap、周报、复盘都交给 Skill 去做投影和重组。

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: existing `RemDb` service, local DB read path, CLI output helpers
- **Storage**: Read-only only
- **Testing**: Vitest contract coverage around `db recent`
- **Target Platform**: Local CLI read surface
- **Project Type**: Monorepo with `packages/agent-remnote`
- **Performance Goals**: 补齐 normalized query dimensions，不长 scene-specific output
- **Constraints**:
  - no summary-specific flags
  - no dedicated scene-shaped top-level result fields
  - no silent schema downgrade
- **Scale/Scope**: normalized query primitive only

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | Feature is read-only. |
| User-visible English output | PASS | Output and diagnostics stay English. |
| Agent-first minimal surface | PASS | The feature adds generic query dimensions and a normalized schema, not a scene abstraction. |

## Perf Evidence Plan

N/A

原因：本特性主要补齐 query completeness 和 schema normalization，不改变 runtime 性能边界。

## 项目结构

### Documentation

```text
specs/026-recent-activity-summaries/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── cli.md
└── tasks.md
```

### Source Code

```text
packages/agent-remnote/src/commands/read/db/
└── recent.ts

packages/agent-remnote/src/internal/remdb-tools/
└── summarizeRecentActivity.ts

packages/agent-remnote/tests/contract/
└── db-recent.contract.test.ts
```

## Phase 0：Research & Decisions

目标：确认这次升级围绕 normalized schema，而不是围绕某个具体 summary view。

## Phase 1：Contract & Data Model

目标：写清 `items[]`、`aggregates[]`、generic dimensions、generic limits。

## Phase 2：Implementation Workstreams

### Workstream A：Normalized Item Schema

目标：把 recent activity 收敛成 typed `items[]`。

### Workstream B：Normalized Aggregate Schema

目标：把 day、parent 等 aggregate dimensions 收敛进同一个 `aggregates[]`。

### Workstream C：Generic Query Controls

目标：让 filters、aggregate dimensions、limits 都保持通用、细颗粒、可组合。

### Workstream D：Docs & Verification

目标：把文档口径统一成 query primitive，而不是 summary view。
