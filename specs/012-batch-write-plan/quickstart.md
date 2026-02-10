# Quickstart: Batch Write Plan（验收清单草案）

## Acceptance Checklist

- [x] `agent-remnote write plan --payload ...` 可直接入队（write-first），无需前置 inspect。
- [x] alias/ref 静态校验 fail-fast：alias 重复、引用不存在、引用字段非法都返回稳定错误码 + 可行动 `hint`（英文）。
- [x] 成功入队返回 `txn_id/op_ids/alias_map` 且包含英文 `nextActions[]`。
- [x] dispatch 前会使用 `id_map` 把 temp id 替换为 remote id（后续步骤无需手工传真实 ID）。
- [x] 重复提交同 `idempotency_key` 不会重复创建（返回已有 txn 或等价回执）。
- [x] `--json`/`--ids` 输出纯净（stdout 仅约定格式；stderr 为空）。

> Evidence: `specs/012-batch-write-plan/acceptance.md`
