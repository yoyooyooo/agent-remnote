# Feature Specification: Write Command Unification（write-first + 命令收口）

**Feature Branch**: `011-write-command-unification`  
**Created**: 2026-01-25  
**Status**: Accepted  
**Accepted**: 2026-01-26  
**Input**: User description: "从 Agent 视角缩短写入链路：尽可能 write-first，把检查逻辑内化到写入命令；收口/归一化批量与单条写入入口，避免 Agent 选到低效路径；写入命令需要提供完备的诊断与引导信息。"

全局概念与术语裁决见：`specs/CONCEPTS.md`（UX Plane：诊断输出契约；Data Plane：回执基线与重试边界）。

## Context & Motivation

当前写入链路存在三个典型“变长点”：

1. **write 前置 inspect**：Agent 容易先做“事前检查”（inspect/resolve/id 验证）再写入；链路更长、token 更高、也更容易在中间步骤丢失上下文。
2. **入口分叉与默认值不一致**：存在语义写入（`write/*`、`write daily`、`write replace/*`）与 raw 入队（`apply` / `queue enqueue`）两套入口，且 raw 入队的默认策略不一致（是否 notify/ensure-daemon），这会增加 Agent “选错路”的概率。011 将把 raw 入队统一收口为 `write advanced ops`。
3. **写入后无法“一次调用闭环确认落库”**：当前写入成功通常仅表示“已入队/已触发 sync”，但 Agent 仍需额外 `queue progress/inspect` 才能确认 op 是否已被 active worker 消费并 ack 成功；当 worker 不可用/桥接卡住时，Agent 很容易误判为“没写进去”从而重复写入。

本 spec 的核心是：**让“直接尝试写入”成为默认路径，并把必要诊断与引导放进写入命令的响应里**；同时把命令面“收口到更少的入口 + 更清晰的场景映射”。

## Scope

### In Scope

- 明确并实现 “write-first” 的 Agent 工作流：**默认直接调用写入命令**；失败时由写入命令返回可行动的诊断与引导（next actions / hint）。
- 补齐“写入后闭环确认”的最短路径：写入命令可选 `--wait/--timeout-ms`，在同一次调用内等待 txn 进入终态（succeeded/failed/aborted），避免 Agent 通过重复写入来“重试确认”。
- 梳理并收口写入相关命令入口，减少重复能力与不一致默认值。
- 统一写入命令的**输出契约**与**错误诊断字段**（JSON envelope、错误码稳定、`nextActions`）。
- 为关键契约补齐 contract/unit tests（与 009 的测试分层策略对齐）。

### Out of Scope (v1)

- 新增/修改 RemNote 写入语义本身（例如引入全新的 op 类型）——属于其它 spec（例如 006/012）或未来扩展。
- 为了兼容旧命令而保留“长期 alias/兼容层”——本仓采用 forward-only evolution。

## Dependencies

- **009-effect-native-upgrade**：已提供 write-first 的基础设施（`nextActions` / `hint`、`--json`/`--ids` 输出纯度、测试目录结构与部分 gates）。
- **013-multi-client-execution-safety**（accepted）：多客户端切换下的回执一致性（attempt_id + CAS ack + ack 重试）；本 spec 的 write-first 默认行为必须建立在其可靠性基线之上（否则重试/断线会放大风险）。
- **012-batch-write-plan**：将引入 `write plan`（批量计划语义）；本 spec 负责把它纳入统一入口/映射与诊断契约（实现可拆分为“先收口 write advanced ops → 再接入 plan”两阶段）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent 默认 write-first（一次调用闭环） (Priority: P1)

作为 AI Agent，我可以在上下文足够时直接调用写入命令完成写入；若输入不合法/上下文不足，写入命令会返回结构化错误与明确的修复建议，而不是要求我预先跑一轮 inspect。

**Independent Test**: 对每个核心写入命令（至少 `write md` / `write bullet` / `write replace text` / raw 入队）验证：支持 `--wait` 以单次调用闭环确认 txn 终态；成功时返回可闭环信息（txn/op ids 或 rem ids）；失败时包含稳定错误码 + `hint` + `nextActions`。

### User Story 2 - 命令入口收口（降低选错概率） (Priority: P1)

作为 AI Agent，我面对常见写入意图时，有明确的“场景→命令”映射；对于 raw 入队能力只有一个推荐入口，且默认行为一致（notify/ensure-daemon）。

**Independent Test**: contract tests 覆盖 CLI help/契约（或静态门禁）确保只暴露一个 raw 入队入口，或至少确保重复入口的默认值一致且输出契约一致。

### User Story 3 - 失败可诊断 + 可执行 next actions（降低人工介入） (Priority: P2)

作为用户/运维者，当写入失败时我能在一次输出中获得：错误码、错误原因、关键上下文（例如目标引用）、以及下一步可执行的英文命令（next actions）。

**Independent Test**: 构造典型失败（无效 rem id、缺少 parent、daemon 不可达、payload shape 错误）并断言：错误码稳定、`nextActions[]` 为可执行命令、`--json` 输出 envelope 不被污染。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 定义并实现 write-first：写入命令默认尝试执行（入队/发送），内部完成必要的静态校验与最小诊断；不得强制要求调用方先 inspect。
- **FR-002**: 系统 MUST 以“场景→命令”的方式给出规范映射（供 Agent 选择），并在实现上尽量减少入口数量（减少重复能力）。
- **FR-003**: 对 raw 入队能力，系统 MUST 只保留一个推荐入口（或将其它入口移除/变为内部不可见），并统一默认行为（notify/ensure-daemon）。
- **FR-004**: 所有写入命令 MUST 返回稳定的结构化输出：成功时提供闭环所需的 ids；失败时提供稳定错误码、可修复的 `hint`，以及可执行的英文 `nextActions[]`。
- **FR-005**: `--json`/`--ids` 输出契约 MUST 保持纯净（stdout 只输出约定格式；不得混入日志/进度文本）。
- **FR-006**: 所有写入命令 SHOULD 支持 `--wait`（以及 `--timeout-ms`）用于“同一次调用闭环确认 txn 终态”；超时/失败必须返回稳定错误码与可执行的 `nextActions[]`（例如 daemon status/sync/restart + queue inspect）。

### Non-Functional Requirements (Diagnosability & UX)

- **NFR-001**: 错误信息 MUST 面向“下一步行动”：避免仅给出抽象原因；必须给出可执行指令或明确的输入修复建议。
- **NFR-002**: forward-only evolution：允许 breaking change（重命名/删除命令）；一旦裁决收口方式，旧入口不得长期保留以制造歧义。

## Success Criteria *(mandatory)*

- **SC-001**: 对至少 3 个高频写入命令，Agent 在“无预检”的一次调用路径中：成功率与可诊断性达到可接受水平（失败时能从输出直接得到下一步命令）。
- **SC-002**: raw 入队入口不再重复且默认行为一致；Agent 不会因为入口分叉而走到更长链路。
- **SC-003**: 对关键失败场景，错误码稳定且具备可行动 `nextActions[]`，并由 tests 固化为新基线。
- **SC-004**: `write ... --wait` 在插件不可用/daemon 卡住等场景下不会诱导 Agent 走“重复写入”路径；它要么成功闭环确认，要么以稳定错误码+next actions 引导排障。
