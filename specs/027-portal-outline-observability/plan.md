# 实施计划：027-portal-outline-observability

日期：2026-03-19  
Spec：`specs/027-portal-outline-observability/spec.md`

## 摘要

本特性不是给 outline 补 portal 专用特例字段，也不是扩 selector surface，而是要**把 outline output 升级成 typed node schema，并统一提供 `target` 元数据字段（非 target-bearing node 也需输出 `target: null`）**。

目标：

- typed nodes
- nullable `target` metadata (always present; `null` when not target-bearing)
- existing outline surface

更高层的 portal verification flow 继续由 Skill 和文档组合。

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: existing outline read use case, internal Rem DB traversal helpers, Host API read routing
- **Storage**: Read-only only
- **Testing**: Vitest contract tests for outline and remote outline surfaces
- **Target Platform**: Local CLI and remote-capable outline reads
- **Project Type**: Monorepo with `packages/agent-remnote`
- **Performance Goals**: 提升 node schema 表达力，不扩张 selector 或 command surface
- **Constraints**:
  - no selector alias
  - no new verification command family
  - no raw DB fallback in canonical path
- **Scale/Scope**: typed node schema only

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | Feature is read-only. |
| User-visible English output | PASS | Output and diagnostics stay English. |
| Agent-first minimal surface | PASS | The feature upgrades node schema instead of command surface area. |

## Perf Evidence Plan

N/A

原因：本特性主要补齐 node schema 表达力，不改变 runtime 性能边界。

## 项目结构

### Documentation

```text
specs/027-portal-outline-observability/
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
packages/agent-remnote/src/commands/read/
└── outline.ts

packages/agent-remnote/src/internal/remdb-tools/
└── outlineRemSubtree.ts

packages/agent-remnote/src/lib/
└── hostApiUseCases.ts

packages/agent-remnote/src/services/
└── HostApiClient.ts

packages/agent-remnote/tests/contract/
├── outline-portal.contract.test.ts
└── outline-remote-api.contract.test.ts
```

## Phase 0：Research & Decisions

目标：确认这次升级围绕 typed node schema，而不是 portal-only 特例字段或 selector 扩张。

## Phase 1：Contract & Data Model

目标：写清 typed node 与 nullable `target` metadata（字段不省略）。

## Phase 2：Implementation Workstreams

### Workstream A：Typed Node Schema

目标：让 outline output 明确暴露 node kind。

### Workstream B：Nullable Target Metadata

目标：统一 `target` 字段语义；target-bearing node 填充对象，非 target-bearing node 输出 `target: null`。

### Workstream C：Docs & Verification

目标：让文档与 Skill 基于 typed nodes 组合 CLI-only verification。
