# Implementation Plan: Batch Write Plan（按 011 标准重规划）

**Branch**: `012-batch-write-plan` | **Date**: 2026-01-25 | **Spec**: `specs/012-batch-write-plan/spec.md`  
**Input**: Feature specification from `specs/012-batch-write-plan/spec.md`

## Summary

实现 `agent-remnote write plan`：

- write-first：直接提交 plan；内部做静态校验、编译与入队
- 引用解析：通过 temp id + `id_map` 完成延迟解析（dispatch 前替换）
- 诊断：失败时给出稳定错误码、`hint` 与可执行 `nextActions[]`（英文）
- 命令面：遵守 011 的“场景→命令”映射；raw 入队细节由 011 收口后作为内部依赖

## Phase Plan（落地顺序）

### Phase 0（Artifacts）

- 完成本目录的 contracts/data-model/research/quickstart/tasks 作为实现基线。

### Phase 1（Kernel: Plan parse/validate/compile）

- 新增纯逻辑模块（建议放 `packages/agent-remnote/src/kernel/write-plan/**` 或 `src/kernel/batch-plan/**`）：
  - parse payload（WritePlanV1）
  - static validation（alias/ref/field constraints）
  - compile → `{ ops[], alias_map }`

### Phase 2（CLI: `write plan` 命令）

- 新增命令：`packages/agent-remnote/src/commands/write/plan.ts`
- wiring：`packages/agent-remnote/src/commands/write/index.ts`
- 复用 009 的 FileInput/Payload 读取、输出纯度与 `nextActions` 风格

### Phase 3（Queue: idempotency & id_map query）

- enqueue 路径处理 `idempotency_key` 冲突：返回已有 txn 的结构化结果（而不是抛裸 UNIQUE 错误）
- 补齐 `id_map` 查询 helpers（当前只 upsert）：`packages/agent-remnote/src/internal/queue/dao.ts`

### Phase 4（Bridge/Daemon: dispatch-time substitution）

- 在 dispatch 前读取/缓存 `id_map` 并替换 payload 中的 temp id（仅限 ID 语义字段）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（依赖 009 的 runtime Actor 架构）
- 利用队列已有的串行门禁：前序 op 未成功时后续不 dispatch（无需额外 op_dependencies 即可保证顺序）

### Phase 5（Tests）

- unit：plan parser/validator/compiler（alias/ref/field constraints）
- contract：`write plan --json/--ids` 输出纯度、错误码稳定、`nextActions` 存在
- integration-ish：模拟 ack 回填 `id_map` 后，后续 op dispatch payload 被正确替换（可用 fake bridge handler）
