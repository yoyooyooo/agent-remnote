# Tasks: Batch Write Plan（按 011 标准重规划）

**Input**: Design documents from `specs/012-batch-write-plan/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/*`, `quickstart.md`

**Hard Dependency**: `specs/013-multi-client-execution-safety/`（attempt_id + CAS ack + ack 重试 + id_map 不漂移）应在落地 012 的“引用替换 + 批量写入”前对齐，否则重放/迟到回执会破坏 alias→id 的闭环。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件且无依赖）
- **[Story]**: `[US1]` / `[US2]` / `[US3]` / `[US4]`
- 每条任务描述必须包含明确文件路径

---

## Phase 0: Spec & Design Artifacts（仅文档）

- [x] T000 创建 012 规格骨架：`specs/012-batch-write-plan/**`
- [x] T001 [US1] 明确 v1 action set（先覆盖现有 write/replace，table/tag 延后到 006；action→op 映射引用 Op Catalog seed）：`specs/012-batch-write-plan/contracts/plan-schema.md` + `specs/006-table-tag-crud/contracts/ops.md`
- [x] T002 [US2] 明确“ID 语义字段白名单/可扩展点”（优先从 Op Catalog 的 `id_fields` 推导，避免重复 hardcode）：`specs/012-batch-write-plan/contracts/plan-schema.md` + `specs/006-table-tag-crud/contracts/ops.md`

---

## Phase 1: Kernel compile（parse/validate/compile）

- [x] T010 [US1] 新增 plan kernel：payload parse + alias/ref 校验：`packages/agent-remnote/src/kernel/write-plan/**`
- [x] T011 [US2] compile：生成 temp ids + alias_map + ops list：`packages/agent-remnote/src/kernel/write-plan/**`
- [x] T012 [US3] 单测：alias 重复/引用不存在/非法字段/超限：`packages/agent-remnote/tests/unit/write-plan.unit.test.ts`

---

## Phase 2: CLI 命令（write plan）

- [x] T020 [US1] 新增 `write plan` 命令与 wiring：`packages/agent-remnote/src/commands/write/plan.ts`、`packages/agent-remnote/src/commands/write/index.ts`
- [x] T021 [US3] dry-run 支持（输出 compiled ops + alias_map）：`packages/agent-remnote/src/commands/write/plan.ts`
- [x] T022 [US3] contract tests：`--json/--ids` 纯度、错误码稳定、nextActions：`packages/agent-remnote/tests/contract/write-plan.contract.test.ts`

---

## Phase 3: Queue / Bridge 支撑（idempotency + id_map 替换）

- [x] T030 [US4] enqueue 路径处理 txn `idempotency_key` 冲突：返回已有 txn（deduped=true）并输出稳定回执：`packages/agent-remnote/src/services/Queue.ts`、`packages/agent-remnote/src/commands/_enqueue.ts`、`packages/agent-remnote/src/commands/write/plan.ts`
- [x] T031 [US2] `id_map` query helpers：`packages/agent-remnote/src/internal/queue/dao.ts`、`packages/agent-remnote/src/internal/queue/index.ts`
- [x] T032 [US2] dispatch-time substitution（temp id → remote id）：`packages/agent-remnote/src/kernel/op-catalog/**`、`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T033 [US2] integration-ish test：ack 回填后后续 op payload 被替换：`packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts`
- [x] T034 [US2] `id_map` 不可漂移：检测并拒绝 `client_temp_id -> remote_id` 冲突（稳定错误码 + nextActions）：`packages/agent-remnote/src/internal/queue/dao.ts`、`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`、`packages/agent-remnote/tests/contract/queue-id-map-no-drift.contract.test.ts`

---

## Phase 4: 收口对齐（依赖 011）

- [x] T040 [US1] 对齐 011 的 raw enqueue 唯一入口裁决（确保 `write plan` 依赖的 enqueue 入口已收口）：`specs/011-write-command-unification/contracts/cli.md` + 对应实现任务

---

## Phase 5: Skill Sync（反哺 `$remnote`，实现收尾任务）

- [x] T050 [US1] 更新 `$remnote`：新增 `write plan` 的最短使用方式（含 `--payload @file` / `--dry-run` / 幂等键），并补充“失败后 next actions”规则与排障入口：`$CODEX_HOME/skills/remnote/SKILL.md`
- [x] T051 [US2] 更新 `$remnote`：解释 `as/@alias`、ID 语义字段限制、temp id → `id_map` → remote id 的延迟解析闭环，以及如何用 `queue inspect/progress` 做闭环验证（面向 Agent 编排）：`$CODEX_HOME/skills/remnote/SKILL.md`
