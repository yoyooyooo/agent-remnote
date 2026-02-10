# Data Model: Batch Write Plan（v1）

## Core Types

### `WritePlanV1`

```ts
type WritePlanV1 = {
  version: 1
  steps: WritePlanStepV1[]
}
```

### `WritePlanStepV1`

```ts
type Alias = string // validated by CLI (e.g. ^[A-Za-z][A-Za-z0-9_-]{0,63}$)
type AliasRef = `@${string}` // "@alias"

type WritePlanStepV1 = {
  as?: Alias
  action: string
  input: Record<string, unknown>
}
```

> `input` 中允许出现 `@alias`，但必须限定在“ID 语义字段”中（详见 `contracts/plan-schema.md` 与 `contracts/cli.md`）。

## Compilation Outputs

### `CompiledWritePlan`

```ts
type CompiledWritePlan = {
  alias_map: Record<Alias, string> // alias -> client_temp_id ("tmp:...")
  ops: Array<{
    type: string
    payload: Record<string, unknown>
  }>
}
```

## Queue Integration

### `id_map`

`id_map` 表维护：

- `client_temp_id`：由 plan 编译阶段生成并注入到“创建类 op”的 payload 中
- `remote_id`：plugin ack 后回填（例如 RemId）

### Dispatch-time substitution

dispatch 前必须对 op payload 做替换：

- 若 payload 中出现 `tmp:*`（或其它 temp id 形式）且 `id_map` 有对应 `remote_id`，则替换为 `remote_id`
- 替换应当只作用于 ID 语义字段，避免误改正文/Markdown

