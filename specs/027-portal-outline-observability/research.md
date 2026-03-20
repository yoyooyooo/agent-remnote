# 研究记录：027-portal-outline-observability

日期：2026-03-19

## Decision 1：Normalize around typed nodes

### Decision

输出模型收敛到 typed nodes，而不是 portal-only special case。

### Rationale

- 这样更通用
- 以后其它 target-bearing node 也能复用

## Decision 2：Use generic nullable target metadata

### Decision

target 相关信息统一进入始终存在、可为 `null` 的 `target` 字段。

### Rationale

- 比 `portal_node_id` / `target_text` 这种散字段更统一

## Decision 3：Keep the surface fixed, upgrade the schema

### Decision

不加 selector alias，不加新命令，只升级 node schema。

### Rationale

- 这最符合 agent-first 的最小表面积原则
