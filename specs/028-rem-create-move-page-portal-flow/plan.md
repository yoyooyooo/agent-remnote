# 实施计划：028-rem-create-move-page-portal-flow

日期：2026-03-20  
Spec：`specs/028-rem-create-move-page-portal-flow/spec.md`

## 摘要

本特性不是新增 `page` / `elevate` 这类 workflow command，而是把“沉淀成 standalone destination + 可选 portal 关联”收进 `rem create` / `rem move`。

目标：

- `rem create` 支持 `text | markdown | targets[]`
- `--from-selection` 只作为 `targets[]` 的 sugar
- `rem move` 保持单 Rem promotion / relocation
- `rem create` / `rem move` 共享一致的位置模型
- 所有高层命令统一编译到 canonical internal plan surface
- partial success 可诊断

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: `effect`, `@effect/cli`, existing queue / WS / plugin write pipeline, existing `apply` envelope helpers
- **Storage**: No new persistent tables required
- **Testing**: Vitest contract tests for CLI shape, wait receipts, source normalization, and selection/target promotion rules
- **Target Platform**: Local CLI first, with remote parity where write/apply composition already exists
- **Project Type**: Monorepo with `packages/agent-remnote` and `packages/plugin`
- **Performance Goals**: add agent-friendly atomic flows without expanding the top-level command taxonomy
- **Constraints**:
  - No direct writes to `remnote.db`
  - No new workflow noun
  - `--is-document` stays explicit and defaults false
  - Missing location semantics fail fast
- **Scale/Scope**: `rem create` / `rem move` only

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | All writes remain queue -> WS -> plugin SDK. |
| Forward-only evolution | PASS | We extend existing `rem` verbs instead of adding compatibility surfaces. |
| SSoT priority | PASS | CLI contract and tools-write docs are part of scope. |
| User-visible English output | PASS | CLI diagnostics and receipts stay English. |
| Agent-first minimal surface | PASS | The feature uses semantic façades over one planner, not new workflow nouns. |

## Perf Evidence Plan

N/A

原因：本特性主要扩展 command contract 与 planner composition，不引入新的 storage 或 scanning path。

## 项目结构

### Documentation

```text
specs/028-rem-create-move-page-portal-flow/
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
packages/agent-remnote/src/commands/write/rem/
├── create.ts
├── move.ts
├── index.ts
├── children/common.ts
└── _promotion.ts                # shared intent normalization / validation

packages/agent-remnote/src/commands/
├── _applyEnvelope.ts
└── _shared.ts

packages/agent-remnote/src/kernel/op-catalog/
└── catalog.ts

packages/agent-remnote/src/lib/
└── hostApiUseCases.ts

packages/agent-remnote/src/services/
└── HostApiClient.ts

packages/plugin/src/bridge/ops/handlers/
├── remCrudOps.ts
├── portalOps.ts
└── remPromotionOps.ts           # new composite helper if needed

packages/agent-remnote/tests/contract/
├── rem-create-promotion.contract.test.ts
├── rem-move-promotion.contract.test.ts
├── rem-create-selection.contract.test.ts
├── rem-create-targets.contract.test.ts
└── rem-location-validation.contract.test.ts
```

## Phase 0：Research & Contract Lock

目标：把 CLI 语义与用户工作流锁定为单一事实源。

交付：

- `research.md`
- `data-model.md`
- `contracts/cli.md`
- `quickstart.md`

核心裁决：

- `rem create` 新增 `--markdown`
- `rem create` 新增 repeated `--from`
- `text | markdown | from[]` 是真正的 source model
- `--from-selection` 只是 `from[]` 的 sugar
- `rem create --markdown` 强制 `--title`，但不强制 single-root markdown
- 多 `--from` 强制 `--title`，单 `--from` 可默认沿用 source 文本
- `--from-selection` 仅在多 root 时强制 `--title`；单 root 可默认沿用源文本
- 内容位置统一走 `--at <placement-spec>`
- portal 行为统一走 `--portal in-place | at:<placement-spec>`
- shorthand：
- `rem move --portal in-place`
- `rem create --from-selection --portal in-place`
- 所有高层命令最终编译到 canonical internal plan surface

## Phase 1：Shared Intent Normalization

目标：把 create/move 的组合参数校验集中到专用模块，而不是继续散在 handler 中。

交付：

- `packages/agent-remnote/src/commands/write/rem/_promotion.ts`

职责：

- parse `text | markdown | from[]`
- resolve `--from-selection` -> `from[]`
- parse `--at <placement-spec>`
- parse `--portal in-place | at:<placement-spec>`
- fail-fast on invalid combinations
- produce one normalized internal intent for create/move execution

## Phase 2：Canonical Internal Plan Surface

目标：把高层业务命令统一编译到 one canonical plan surface，而不是各自持有分叉 runtime 逻辑。

交付：

- shared plan builder module(s)
- `apply`-compatible canonical action plan shape

关键点：

- `rem create` / `rem move` 只负责 façade 语义
- planner 负责 source normalization + placement + portal composition
- executor 继续复用 queue -> WS -> plugin SDK

## Phase 3：`rem create` Composite Flow

### Workstream A：Direct Standalone Create

目标：支持 markdown/text 创建 standalone destination，并可选 portal placement。

### Workstream B：Existing Rem Sources

目标：支持 repeated `--from` 创建新 destination，并把已有 Rem 移进去。

### Workstream C：Selection Source Sugar

目标：支持 `--from-selection` 解析成 `targets[]`，再进入同一 planner 路径。

## Phase 4：`rem move` Promotion Flow

目标：支持已有单个 Rem promotion 到 standalone destination，并可选原地留 portal。

关键点：

- `move_rem` 需要支持 standalone destination semantics
- `--is-document` 仍然显式，默认 false
- `--portal in-place` 需要记录 source parent / source position

## Phase 5：Runtime Composition & Receipts

目标：让 composite create/move flow 返回稳定 receipt，并正确处理 partial success。

关键点：

- receipt 必须暴露 durable target
- portal 失败不能抹掉 durable target 诊断
- wait-mode 必须能拿到最终 ids / warnings / nextActions

## Phase 6：Docs & Skill Sync

目标：同步所有用户面与 agent 面文档。

交付：

- `docs/ssot/agent-remnote/tools-write.md`
- `docs/ssot/agent-remnote/cli-contract.md`
- `README.md`
- `README.zh-CN.md`
- `README.local.md`
- `skills/remnote/SKILL.md`

Skill 侧额外要求：

- 明确 `--is-document` 默认保持 `false`
- 明确 `rem create` / `rem move` 的新参数组合与默认策略
- 明确 `rem create --from` 与 `--from-selection` 的区别与默认标题策略
- 明确 DN playground -> standalone destination + portal 的推荐路由
- 避免 Skill 继续沿用旧的“先写 DN，再手工拼 portal / move”路径

## Phase 7：Effect Practice Alignment

目标：在功能实现完成后，回头检查这次实现是否真正符合仓库希望推进的 Effect 分层与建模习惯，而不是只是“功能能跑”。

交付：

- 对本特性实现做一轮 Effect best-practices 对齐复盘
- 明确哪些部分已经收敛到：
  - CLI parsing
  - intent normalization / validation
  - runtime context resolution
  - canonical planner
  - receipt builder
- 明确哪些部分仍然残留 imperative branching 或双真相风险
- 把结论回写到本 spec 目录下的补充文档，供后续同类命令复用

建议文档：

- `specs/028-rem-create-move-page-portal-flow/effect-alignment.md`

## 实施顺序

1. Phase 0 锁 contract 与 data model
2. Phase 1 建立 shared normalization / validation
3. Phase 2 建立 canonical internal plan surface
4. 先做 `rem create` direct markdown flow
5. 再做 `rem create --target` flow
6. 再做 `rem move` promotion flow
7. 再补 `--from-selection` sugar
8. 收 receipt、docs、remote parity
9. 最后做 Effect practice alignment 收口

## 风险与缓解

### 风险 1：参数组合继续散落在多个 handler

缓解：

- 引入单一 `_promotion.ts` 作为 normalize + validate 入口

### 风险 2：create 流程过度膨胀，变成不可维护的大命令

缓解：

- 拆分：
  - option parsing in command file
  - intent normalization in shared helper
  - canonical planner
  - composite execution

### 风险 3：高层命令各自持有一套 planner

缓解：

- 明确 `apply`-compatible canonical plan 是唯一内部编排面

### 风险 4：partial success 语义模糊

缓解：

- 在 contract 里先固定 receipt shape
- 所有 composite flows 以 durable target 为第一事实源

### 风险 5：selection shape 不稳定

缓解：

- 第一版只支持 contiguous sibling selection under one parent
- 其它 shape 直接 fail-fast
