# Feature Specification: Batch Write Plan（按 011 标准重规划）

**Feature Branch**: `012-batch-write-plan`  
**Created**: 2026-01-25  
**Status**: Accepted  
**Accepted**: 2026-01-26  
**Input**: User description: "批量写入：尽可能让 Agent 一步到位；write-first；把检查逻辑内化到写入命令；输出提供完备诊断与引导；与 011 的命令收口标准一致。"

全局概念与术语裁决见：`specs/CONCEPTS.md`（id_map 不漂移、幂等层次、WS Protocol v2 回执基线、Op Catalog 等）。

## Context & Motivation

日常写入里，Agent 经常为了“怕写错”而先跑 inspect/resolve/id 校验，再执行写入，导致链路变长且更容易在中间步骤丢上下文。

本 spec 的目标是提供一个**标准化的批量写入入口**：一次提交表达多步写入意图，内部完成静态校验与必要诊断；若失败，返回可行动提示与下一步命令；若成功，返回足够的闭环信息。

## Scope

### In Scope

- 提供 `agent-remnote write plan`（批量计划写入）作为**多步依赖写入**的标准入口（与 `specs/011-write-command-unification/` 的“场景→命令映射”一致）。
- 支持 `as`（别名）与 `@alias`（引用）以表达步骤依赖，并在写入链路内部完成校验与解析（write-first）。
- 输出必须具备可机器解析的结构化结果，并提供可执行的英文 `nextActions[]` 与可行动 `hint`。
- 规划并固化测试：contract/unit/integration-ish（与 009 的测试分层对齐）。

### Out of Scope (v1)

- 为历史版本提供兼容层（forward-only evolution）。
- 引入全新 RemNote 写入语义/协议（如需要新增 op type，应另开 spec 或在 006/插件侧能力到位后再扩展）。

## Dependencies

- **011-write-command-unification**：定义“写入命令收口/诊断契约/场景映射”的全局标准；本 spec 需要按其标准设计 CLI 与错误输出。
- **006-table-tag-crud**（可选分阶段）：若 batch plan 需要覆盖 table/tag 写入步骤，则依赖 006 提供原子写入能力；否则 v1 可先覆盖现有 `write/*`、`replace/*` 等能力。
- **009-effect-native-upgrade**：复用 write-first 基础设施（`nextActions`/`hint`、`--json`/`--ids` 输出纯度、测试目录结构）。
- **013-multi-client-execution-safety**（accepted）：多客户端切换下的回执一致性（attempt_id + CAS ack + ack 重试）与 `id_map` 不漂移语义；否则 alias/@ref 的延迟解析会被重放/迟到回执破坏。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 一次提交完成多步依赖写入（write-first） (Priority: P1)

作为 AI Agent，我可以用一次 `write plan` 提交表达多个写入步骤；命令内部完成静态校验并直接入队；不需要我先 inspect。

**Independent Test**: 仅实现 “plan 解析 + 校验 + 编译 + 入队回执” 即可独立验证：输出包含 `txn_id/op_ids` 与 `alias_map`。

### User Story 2 - 引用解析与顺序语义可预测（不靠人肉传 ID） (Priority: P1)

作为 AI Agent，我可以在后续步骤用 `@alias` 引用前序步骤产物（例如前一步创建的 Rem ID），系统在执行链路中自动解析引用，避免中间手工传递真实 ID。

**Independent Test**: 构造 3 步 plan（create → update/append → tag），验证后续步骤不需要显式提供真实 ID 也能正确执行（通过 alias→id 映射与队列结果闭环）。

### User Story 3 - 失败可诊断且可继续（next actions） (Priority: P2)

当 plan 静态校验失败或入队/通知失败时，命令返回稳定错误码、可行动 `hint`，以及可执行的英文 `nextActions[]`（例如如何 inspect/progress/ensure daemon）。

**Independent Test**: 覆盖典型错误（alias 重复、引用不存在、payload 超限、daemon 不可达）并断言输出字段与错误码稳定。

### User Story 4 - 可安全重试（批次级幂等） (Priority: P3)

作为 AI Agent，我可以为一次批量写入提供 `idempotency_key`，重复提交不会造成重复创建，并返回与第一次一致/可证明一致的回执。

**Independent Test**: 重复提交同 `idempotency_key`，第二次返回同一 `txn_id`（或稳定地指向已存在 txn），且不再插入新的 txn/op。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 提供 `agent-remnote write plan` 作为批量写入入口，并遵守 011 的写入命令诊断契约。
- **FR-002**: 命令 MUST write-first：调用方默认直接提交；命令内部完成静态校验并在失败时返回可行动诊断（不要求调用方预检）。
- **FR-003**: plan MUST 支持 `as` 与 `@alias` 引用；系统 MUST 在入队前做静态校验（别名唯一性/合法性、引用存在性、引用仅允许出现在 ID 语义字段、类型一致性）。
- **FR-004**: 系统 MUST 定义确定性顺序语义：同一 txn 内按 `op_seq` 串行执行；后续步骤在前序未成功前不得被 dispatch（避免乱序副作用）。
- **FR-005**: 系统 MUST 在 dispatch 前解析引用：当某个字段携带 temp id（由 alias 编译产生）且队列 `id_map` 已有映射时，必须替换为 remote id。
- **FR-006**: 编译后的总 ops 数 MUST ≤ 500；超限必须 fail-fast（错误码稳定，提示拆分）。
- **FR-007**: 成功入队时输出 MUST 至少包含：`txn_id`、`op_ids[]`、`alias_map`（alias → temp id）、`nextActions[]`（英文命令）。
- **FR-008**: 失败时输出 MUST 至少包含：稳定 `error.code`、英文 `error.message`、可行动 `hint`，并保持 `--json`/`--ids` 输出纯度。
- **FR-009**: 系统 SHOULD 支持批次级幂等：相同 `idempotency_key` 的重复提交不得产生重复 txn/op，并返回可用回执。
- **FR-010**: 系统 MUST 定义并实现 `id_map` 的不可漂移语义：同 `client_temp_id` 一旦映射到 `remote_id`，后续不得覆盖；若发现冲突必须 fail-fast（稳定错误码 + nextActions）。
- **FR-011**: 系统 MUST 确保“重放/重试”不会导致映射缺失：同一 op 的重复执行/重复确认必须返回一致的 `created/id_map`（依赖 013 的 ack/attempt 语义与插件侧一致性策略）。

### Non-Functional Requirements (Diagnosability & Safety)

- **NFR-001**: 输出 MUST 可机器解析且结构稳定，便于 Agent 自动化编排与错误恢复。
- **NFR-002**: forward-only evolution：允许 breaking change；不得为了兼容旧 plan 形态保留长期兼容层（只允许 fail-fast + 诊断）。

## Success Criteria *(mandatory)*

- **SC-001**: 一个包含 ≥3 步的批量写入意图可通过一次 `write plan` 提交完成入队，并返回可闭环的 `txn_id/op_ids` 与 `alias_map`。
- **SC-002**: 对典型静态校验失败，调用方无需额外 inspect 即可从输出获得修复建议与下一步命令。
- **SC-003**: 对相同 `idempotency_key` 的重复提交不会产生重复创建，并返回稳定回执（由 tests 固化为基线）。
