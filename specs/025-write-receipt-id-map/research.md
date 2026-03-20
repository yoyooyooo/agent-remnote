# 研究记录：025-write-receipt-id-map

日期：2026-03-19

## Decision 1：`id_map` is the canonical machine contract

### Decision

agent continuation 的主契约收敛到 `id_map`。

### Rationale

- 这是最通用、最少分支的 parser 入口

## Decision 2：Convenience ids become secondary

### Decision

`rem_id`、`portal_rem_id` 等字段如果保留，只作为兼容性 sugar。

### Rationale

- 可以保留易用性
- 又不把 parser 拉回 wrapper-specific 分支
