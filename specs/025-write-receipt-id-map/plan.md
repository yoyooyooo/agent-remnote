# 实施计划：025-write-receipt-id-map

日期：2026-03-19  
Spec：`specs/025-write-receipt-id-map/spec.md`

## 摘要

本特性的核心不是保留多少 wrapper-specific 字段，而是要**把 `id_map` 收敛成 canonical machine-readable receipt**。

目标：

- agent 始终先读 `id_map`
- convenience ids 如果保留，只是 secondary sugar

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: `effect`, `@effect/cli`, wait helpers, Host API write surfaces
- **Storage**: Queue DB / store DB 仍是事实源
- **Testing**: wait-mode and remote receipt contract tests
- **Target Platform**: Local CLI and remote Host API write surfaces
- **Project Type**: Monorepo with `packages/agent-remnote`
- **Performance Goals**: 统一机器契约，减少 wrapper-specific parser 分支

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | Feature touches result shaping only. |
| Agent-first minimal parser contract | PASS | `id_map` becomes the canonical machine contract. |
| User-visible English output | PASS | Output and diagnostics stay English. |

## Phase 0：Research & Decisions

目标：确认 `id_map` 是主契约，convenience ids 只是附带字段。

## Phase 1：Contract & Data Model

目标：把 canonical receipt contract 写清楚。

交付：

- `data-model.md`
- `contracts/cli.md`
- `quickstart.md`

## Phase 2：Implementation Workstreams

### Workstream A：Canonical Receipt Assembly

目标：所有 wait-mode 写入都返回 canonical `id_map`。

### Workstream B：Convenience Field Demotion

目标：如果保留 wrapper-specific ids，也明确它们是 secondary sugar。

### Workstream C：Remote Parity

目标：local / remote 共享同一 `id_map` 语义。

### Workstream D：Docs & Skill Sync

目标：同步更新 SSoT 与 Skill，明确 `id_map` 是 canonical receipt。

交付：

- `docs/ssot/agent-remnote/http-api-contract.md`
- `docs/ssot/agent-remnote/tools-write.md`
- `skills/remnote/SKILL.md`
