# 实施计划：024-agent-first-composite-writes

日期：2026-03-19  
Spec：`specs/024-agent-first-composite-writes/spec.md`

## 摘要

本特性不是要给 CLI 增加一条“组合写入工作流命令”，而是要**给 `apply` 补齐一个缺失的原子 portal action**。

目标只有一个：

- 把现有 `create_portal` primitive 暴露为 `apply` action vocabulary 的一部分

更高层的页面装配、周报整理、笔记归档等场景继续交给 Skill 和 action 组合。

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: `effect`, `@effect/cli`, existing write-plan compiler, existing queue / WS / plugin write pipeline
- **Storage**: No new persistent storage
- **Testing**: Vitest contract tests around `apply` and `writeApply`
- **Target Platform**: Local CLI and remote Host API `writeApply`
- **Project Type**: Monorepo with `packages/agent-remnote` and `packages/plugin`
- **Performance Goals**: 补齐原子能力，不增加新的 coarse workflow surface
- **Constraints**:
  - No direct writes to `remnote.db`
  - No workflow-specific top-level command
  - No second portal action alias
  - Scenario composition remains in Skill layer
- **Scale/Scope**: action-layer parity only

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | All writes stay on queue -> WS -> plugin SDK. |
| Forward-only evolution | PASS | We extend `apply` rather than invent a second surface. |
| SSoT priority | PASS | Docs and skill sync are part of scope. |
| User-visible English output | PASS | CLI output and diagnostics stay English. |
| Agent-first minimal surface | PASS | The feature adds one missing atomic action and nothing higher-level. |

## Perf Evidence Plan

N/A

原因：本特性不改变 runtime 性能边界，重点是 public action surface 的完备性。

## 项目结构

### Documentation

```text
specs/024-agent-first-composite-writes/
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
packages/agent-remnote/src/commands/
├── apply.ts
├── _applyEnvelope.ts
└── write/
    └── portal/
        └── create.ts

packages/agent-remnote/src/kernel/write-plan/
└── compile.ts

packages/agent-remnote/src/lib/
└── hostApiUseCases.ts

packages/agent-remnote/src/services/
└── HostApiClient.ts

packages/agent-remnote/tests/contract/
├── write-plan.contract.test.ts
└── api-write-apply.contract.test.ts
```

## Phase 0：Research & Decisions

目标：确认这次只补“一个缺失原子 action”，不顺手引入 workflow abstraction。

交付：

- `research.md`

## Phase 1：Contract & Data Model

目标：把 portal atomic action 的输入、alias 规则、remote parity 写成单一事实源。

交付：

- `data-model.md`
- `contracts/cli.md`
- `quickstart.md`

核心裁决：

- action 名只保留 `portal.create`
- alias 只是原子 action 的参数组合能力
- 不新增 workflow noun 或 scenario parameter

## Phase 2：Implementation Workstreams

### Workstream A：Atomic Action Exposure

目标：把 `portal.create` 加进 action compiler。

交付：

- `packages/agent-remnote/src/kernel/write-plan/compile.ts`

### Workstream B：Apply Transport Parity

目标：保证 local / remote `writeApply` 都接受同一 atomic action shape。

交付：

- `packages/agent-remnote/src/commands/apply.ts`
- `packages/agent-remnote/src/commands/_applyEnvelope.ts`
- `packages/agent-remnote/src/lib/hostApiUseCases.ts`
- `packages/agent-remnote/src/services/HostApiClient.ts`

### Workstream C：Docs & Skill Discipline

目标：明确 CLI 提供 primitive，Skill 负责 scene composition。

交付：

- `docs/ssot/agent-remnote/tools-write.md`
- `docs/ssot/agent-remnote/cli-contract.md`
- README surfaces
- RemNote skill

## 实施顺序

1. Phase 0 研究与裁决落盘
2. Phase 1 写清 atomic action contract
3. 落地 compiler + apply parity
4. 同步 docs / skill

## 风险与缓解

### 风险 1：atomic action 又被包装成 workflow 概念

缓解：

- spec 明确禁止 workflow-specific CLI surface

### 风险 2：action 名称出现同义词扩张

缓解：

- 只保留一个 canonical action name
