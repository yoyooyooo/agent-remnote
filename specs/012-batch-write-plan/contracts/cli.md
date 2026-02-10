# CLI Contract: Batch Write Plan (Write)

目标：为 AI Agent 提供“一次提交多步写入”的标准入口，并按 011 的写入命令标准提供诊断与 next actions（write-first）。

> 用户可见输出（错误信息/提示）必须英文；本合同中的示例消息也用英文。

## Command

### `agent-remnote write plan`

#### Flags

- `--payload <json|@file|->`（必填）：WritePlanV1（见 `contracts/plan-schema.md`）
- `--dry-run`：不入队，仅输出编译结果（ops + alias_map）
- `--wait`：等待 txn 进入终态（succeeded/failed/aborted）；用于一次调用闭环确认
- `--timeout-ms <int>` / `--poll-ms <int>`：仅在 `--wait` 时允许；不带 `--wait` 必须 fail-fast
- `--priority <int>`
- `--client-id <string>`
- `--idempotency-key <string>`：批次级幂等键（推荐）
- `--meta <json|@file|->`：附加到 txn 的 meta（会被 normalize 为 snake_case）；实现会额外写入 `write_plan.alias_map`，用于 idempotency dedupe 时回显稳定 alias_map
- `--no-notify`：入队后不触发 WS `StartSync`
- `--no-ensure-daemon`：notify 前不拉起/确保 daemon

> raw 入队的“唯一入口/默认值策略”由 011 统一裁决；`write plan` 应只依赖统一后的 enqueue 能力。

#### Static Validation (must happen before enqueue)

- alias unique + regex valid
- all `@alias` refs exist
- refs only in ID semantic fields
- compiled total ops ≤ 500

#### Output Contract

遵守 `docs/ssot/agent-remnote/cli-contract.md`（实现落地后再同步 SSOT，但输出规则以此为硬门禁）：

- `--json`：stdout 单行 JSON envelope；stderr 为空
- `--ids`：stdout 仅 ids（每行一个）；stderr 为空

成功（enqueue-only）必须至少包含：

- `txn_id`
- `op_ids`
- `alias_map`（alias → temp id）
- `nextActions`（英文命令；至少包含 queue progress/inspect，以及 ws ensure/health 的建议）

失败必须至少包含：

- `error.code`（稳定）
- `error.message`（英文短句）
- `hint`（英文，可行动）
- 可选 `nextActions`
