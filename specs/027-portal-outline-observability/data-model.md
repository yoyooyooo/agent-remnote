# 数据模型：027-portal-outline-observability

## 1. Outline Node

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 当前节点 id |
| `depth` | `number` | 当前深度 |
| `kind` | `string` | generic node kind |
| `text` | `string` | 可见文本 |
| `target` | `TargetMetadata?` | 可选 target metadata |

## 2. Target Metadata

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | target Rem id |
| `text` | `string?` | target 标题 |
| `resolved` | `boolean` | target 标题是否成功解析 |

## 3. Surface Discipline

规则：

- selector surface 不扩张
- verification primitive 继续是 outline
- node schema 统一为 typed node + optional target
