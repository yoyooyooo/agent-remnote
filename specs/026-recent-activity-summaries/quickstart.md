# Quickstart：026-recent-activity-summaries

## 目标

验证 `db recent` 已经具备归一化 query schema，足以让 Skill 在外层组合 recap。

## Base Query

```bash
agent-remnote --json db recent --days 7
```

验收点：

- 返回 `items`
- 每个 item 有 `activity_kind`

## Query With Generic Aggregates

```bash
agent-remnote --json db recent --days 7 --kind all --aggregate day --aggregate parent --timezone Asia/Shanghai --item-limit 20 --aggregate-limit 10
```

验收点：

- 返回 `aggregates`
- 不因为 aggregate 维度变化而切换顶层 schema
