# Implementation Plan: Write Command Unification（write-first + 命令收口）

**Branch**: `011-write-command-unification` | **Date**: 2026-01-25 | **Spec**: `specs/011-write-command-unification/spec.md`  
**Input**: Feature specification from `specs/011-write-command-unification/spec.md`

## Summary

本计划聚焦“写入链路最短化”：

- **write-first**：默认直接写入（入队/发送）；检查逻辑内化在写入命令里；失败时返回可行动诊断（next actions）。
- **入口收口**：减少 raw 入队的重复入口与默认值分叉；对 Agent 给出明确的“场景→命令”选择标准。
- **契约固化**：以 tests 固化 `--json`/`--ids` 输出纯度、错误码稳定与 `nextActions[]`。

> 由于 009 已落地一部分基础设施（nextActions/hint、输出纯度、测试分层），本 spec 的实现应尽量复用 009 既有模式，而不是重新发明一套。

## Phase Plan（落地顺序）

### Phase 0（Planning Artifacts）

- 完成本 spec 的 spec/plan/tasks/contract/research 产物（本目录）。

### Phase 1（Unify raw enqueue under `write`）

- 新增 `agent-remnote write advanced ops` 作为唯一 raw 入队入口（默认即 apply-now：notify/ensure-daemon 为 true；需要只入队时显式 `--no-notify`）。
- 删除 `agent-remnote apply` 与 `agent-remnote queue enqueue`（forward-only：不保留长期歧义入口；仅允许 fail-fast + 指引）。
- 统一 raw 入队 flags（notify/ensure-daemon、dry-run、meta/idempotency/priority）与输出契约（nextActions/hint）。

### Phase 2（Write-first diagnostics consistency）

- 把 `nextActions[]`、`hint`、错误码稳定性推广到所有写入命令（至少覆盖 `write md` / `write bullet` / `write replace text` / raw 入队）。
- 把“建议的 inspect/read 命令”作为失败后的 next actions（而不是前置流程）。
- 为写入命令补齐“一次调用闭环确认落库”：增加 `--wait/--timeout-ms`（内部等待 txn 终态；实现可复用 `queue wait` 的语义/逻辑），避免 Agent 因 pending/卡住而误判并重复写入。

### Phase 3（Doc Sync）

- 同步更新脚本、README 与后续 SSOT（按你的节奏：实现落地后再同步到 SSoT）。

### Phase 4（Tests & Gates）

- contract tests：CLI surface（确保 raw 入队只有一个入口或行为一致）、输出纯度、错误 envelope。
- unit tests：错误码映射、nextActions 生成逻辑、默认值策略（notify/ensure-daemon）。
