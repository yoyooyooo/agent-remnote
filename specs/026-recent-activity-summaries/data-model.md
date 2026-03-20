# Data Model: 026-recent-activity-summaries

## 1. Recent Activity Query

| Field | Type | Description |
| --- | --- | --- |
| `days` | `number` | Time window in days |
| `kind` | `string?` | Generic activity-kind filter |
| `aggregate[]` | `string[]` | Generic aggregate dimensions |
| `timezone` | `string?` | Timezone used for day aggregates |
| `item_limit` | `number?` | Item result limit |
| `aggregate_limit` | `number?` | Aggregate result limit |

## 2. Activity Item

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Rem id |
| `created_at` | `number` | Creation timestamp |
| `updated_at` | `number` | Last update timestamp |
| `activity_kind` | `string` | For example `created` or `modified_existing` |
| `preview` | `string` | Text preview |
| `parent_id` | `string?` | Parent Rem id |
| `parent_preview` | `string?` | Parent title preview |

## 3. Aggregate Entry

| Field | Type | Description |
| --- | --- | --- |
| `dimension` | `string` | Aggregate dimension such as `day` or `parent` |
| `key` | `string` | Current bucket or group key |
| `counts` | `object` | Count summary for the aggregate |
| `samples` | `ActivityItem[]?` | Optional sample items |

## 4. Output Discipline

Rules:

- The top-level schema is fixed to `counts + items + aggregates`
- Filters, aggregates, and limits may change contents, but MUST NOT change the top-level schema
