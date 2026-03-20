# 数据模型：024-agent-first-composite-writes

## 1. Portal Action

用途：在 `apply` action envelope 中表达 portal 插入。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `action` | `"portal.create"` | canonical action 名 |
| `input.parent_id` | `string` | 显式 id 或 alias |
| `input.target_rem_id` | `string` | 显式 id 或 alias |
| `input.position` | `number?` | 可选插入位置 |

## 2. Action Alias

用途：让 later action 引用 earlier action 的结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `as` | `string` | earlier action 暴露的别名 |
| `@alias` | `string` | later action 的引用形式 |

规则：

- alias 必须先定义后引用
- alias 只在当前 envelope 内有效

## 3. Atomic Composition

用途：说明 CLI 层允许的组合方式。

规则：

- CLI 只暴露 atomic actions
- 场景组合通过 actions 顺序和参数完成
- 本特性不引入 workflow-specific noun 或 parameter
