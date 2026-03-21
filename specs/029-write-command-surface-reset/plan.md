# Write Command Surface Reset Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current fragmented write CLI with one breaking command surface built around `subject / from / to / at / portal`, while preserving the existing planner and runtime semantics.

**Architecture:** Keep the `028` canonical plan surface and queue -> WS -> plugin execution model, but introduce shared parsers and validators for ref values, placement specs carried by `--at`, relation targets carried by `--to`, portal strategies carried by `--portal`, and single-subject command axes. Rewrite high-frequency Rem graph / portal write commands onto that shared surface, then sweep docs, SSOT, and skill guidance in the same release.

**Tech Stack:** TypeScript ESM, `effect`, `@effect/cli`, existing queue / WS / plugin SDK write pipeline, Vitest contract tests

---

## 实施计划：029-write-command-surface-reset

日期：2026-03-21  
Spec：`specs/029-write-command-surface-reset/spec.md`

## 摘要

`029` 是一次明确的 breaking CLI contract reset。

目标：

- 用 `subject / from / to / at / portal` 五轴重做 write surface
- 把空间 placement 收口到 `--at`
- 把关系目标收口到 `--to`
- 把 portal behavior 收口到 `--portal`
- 把单主体 Rem graph write commands 收口到 `--subject`
- 不保留旧参数兼容层

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: `effect`, `@effect/cli`, existing queue / WS / plugin SDK write pipeline
- **Storage**: No new persistent tables required
- **Testing**: Vitest contract tests, help output tests, integration tests for planner/runtime invariants
- **Target Platform**: Local CLI first, remote parity where existing write/apply composition already exists
- **Project Type**: Monorepo with `packages/agent-remnote` and `packages/plugin`
- **Constraints**:
  - No compatibility aliases
  - No direct writes to `remnote.db`
  - Canonical internal plan surface stays intact
  - Old flags must fail fast

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| Forward-only evolution | PASS | `029` is explicit breaking reset. |
| No direct writes to `remnote.db` | PASS | Runtime write path is unchanged. |
| SSoT priority | PASS | Contract, tools-write, and skill updates are part of scope. |
| User-visible English output | PASS | New diagnostics and help remain English. |
| Agent-first minimal surface | PASS | Fewer axis names, fewer command-specific exceptions. |

## Phase 0: Contract Lock

目标：先把命令面和心智模型锁死，再进入实现。

关键裁决：

- 五轴：`subject / from / to / at / portal`
- `in-place` 是 portal strategy 的取值
- write 命令里的 `--ref` 删除，ref 保留为值语法
- `portal create` 使用 `to + at`
- 整个 CLI surface 都按 Agent-facing primitives 描述

## Phase 1: Shared Surface Parsing

目标：把新的参数轴解析集中成共享工具，而不是散进每个命令文件。

建议新增：

- `packages/agent-remnote/src/commands/write/_refValue.ts`
- `packages/agent-remnote/src/commands/write/_placementSpec.ts`
- `packages/agent-remnote/src/commands/write/_portalStrategy.ts`
- `packages/agent-remnote/src/commands/write/_subjectOptions.ts`

职责：

- parse `--at`
- parse `--portal`
- parse `--to` relation target values where relevant
- validate `in-place` legality
- validate title policy
- normalize `--subject` / `--from` value syntax

## Phase 2: Core Command Family Reset

目标：先重构最关键的三条命令。

命令：

- `rem create`
- `rem move`
- `portal create`

关键点：

- help output 全面替换
- canonical plan semantics 不变
- receipts 保持 `028` 现有结构
- `portal create` 改成 `to + at`

## Phase 3: Single-Subject Write Sweep

目标：把 in-scope 单主体 Rem graph write commands 从 `--rem` 收口到 `--subject`。

命令：

- `rem set-text`
- `rem delete`
- `rem children append/prepend/clear/replace`
- `rem replace`
- `tag add/remove` 中直连 Rem 的 surface

## Phase 4: Legacy Surface Removal

目标：让 breaking change 在 help、validation、tests 上都是真的。

## Phase 5: Docs And Skill Reset

目标：让实现完成后，文档和 Agent 教学路径同步收口。

交付：

- `docs/ssot/agent-remnote/tools-write.md`
- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/write-input-surfaces.md`
- `README.md`
- `README.zh-CN.md`
- `packages/agent-remnote/README.md`
- `skills/remnote/SKILL.md`

额外交付：

- 一张正式的“参数输入面矩阵”，明确：
  - 哪些参数是标量
  - 哪些参数是富内容
  - 哪些参数支持 input-spec
  - 哪些参数支持 `@file`
  - 哪些参数支持 `-` 走 stdin
  - 哪些命令最多只能有一个 stdin-backed 参数
  - 多富内容输入何时应改走 `apply --payload`

## Phase 6: Validation

目标：证明 surface reset 保留了 runtime 语义。

最少验证：

- help / removed-write-surface contract tests
- create/move/portal create contract tests
- integration test covering planner/runtime invariants
- targeted manual verification on Daily Note
