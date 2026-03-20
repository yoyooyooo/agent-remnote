# CLI Contract：026-recent-activity-summaries

## Canonical Entry

```bash
agent-remnote --json db recent --days <n>
```

## Generic Query Dimensions

示例：

```bash
agent-remnote --json db recent --days 7 --kind all --aggregate day --aggregate parent --timezone Asia/Shanghai --item-limit 20 --aggregate-limit 10
```

## Expected JSON Sections

```json
{
  "days": 7,
  "timezone": "Asia/Shanghai",
  "counts": {},
  "items": [],
  "aggregates": []
}
```

## Item Contract

每个 item 至少包含：

- `id`
- `created_at`
- `updated_at`
- `activity_kind`
- `preview`

## Aggregate Contract

每个 aggregate 至少包含：

- `dimension`
- `key`
- `counts`

## Surface Discipline

- CLI 暴露的是 normalized recent-activity query primitive
- `kind`、`aggregate`、`timezone`、limits 都是通用参数
- 不引入 summary-specific flags
- 不引入场景化 top-level result sections

## Fail-Fast Expectations

- 如果当前 execution mode 无法满足所请求的 query dimensions，命令必须 fail-fast
- 不允许静默降级成缺字段或旧 schema
