# 研究记录：026-recent-activity-summaries

日期：2026-03-19

## Decision 1：Normalize around `items[]` and `aggregates[]`

### Decision

结果 schema 收敛到：

- `items[]`
- `aggregates[]`

### Rationale

- 这样比一组场景化顶层字段更可组合

## Decision 2：Use generic query dimensions only

### Decision

CLI 只暴露 `kind`、`aggregate`、`timezone`、limits 这类通用维度。

### Rationale

- 这些维度能跨多个场景复用
- 不把 recap / summary 语义写死进 CLI

## Decision 3：Keep one schema under different projections

### Decision

不同过滤和 limits 只影响数据量，不影响顶层 schema。

### Rationale

- parser 更稳
- Skill 组合更容易
