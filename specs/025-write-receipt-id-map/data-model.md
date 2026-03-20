# 数据模型：025-write-receipt-id-map

## 1. Canonical Write Receipt

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `txn_id` | `string` | 事务 id |
| `status` | `string` | 终态 |
| `id_map` | `IdMapEntry[]` | canonical machine-readable mapping |

## 2. ID Map Entry

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `client_temp_id` | `string` | 客户端临时 id |
| `remote_id` | `string` | 真实 id |
| `remote_type` | `string?` | 远端实体类型 |

## 3. Convenience ID

说明：

- 可选
- 派生自 `id_map`
- 不是主机器契约
