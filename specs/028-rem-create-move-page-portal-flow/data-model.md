# Data Model: 028-rem-create-move-page-portal-flow

日期：2026-03-20  
Spec：`specs/028-rem-create-move-page-portal-flow/spec.md`

## 目标

为 `rem create` / `rem move` 定义一个统一的内部 intent model，避免把动态组合校验散落在命令 handler 里，并让所有高层业务命令统一编译到 canonical internal write plan surface。

## 统一意图模型

### 1. 内容来源 `ContentSource`

```ts
type ContentSource =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; markdown: string }
  | {
      kind: 'targets'
      rem_ids: ReadonlyArray<string>
      source_origin: 'explicit_from' | 'selection'
    }
```

规则：

- `text` / `markdown` / `targets` 三选一
- `--from-selection` 只是一条把当前 UI 选择解析成 `targets` 的 sugar
- `targets` 中的 `rem_ids` 可以是单个，也可以是多个

### 2. 内容位置 `ContentPlacement`

```ts
type ContentPlacement =
  | { kind: 'parent'; parent_ref: string; position?: number }
  | { kind: 'before'; anchor_ref: string }
  | { kind: 'after'; anchor_ref: string }
  | { kind: 'standalone' }
```

规则：

- 对外 CLI 统一收口到 `--at <placement-spec>`
- `placement-spec` 允许 `standalone` / `parent:<ref>` / `parent[<position>]:<ref>` / `before:<ref>` / `after:<ref>`
- 缺省不允许，必须显式指定

### 3. portal 位置 `PortalPlacement`

```ts
type PortalPlacement =
  | { kind: 'none' }
  | { kind: 'parent'; parent_ref: string; position?: number }
  | { kind: 'before'; anchor_ref: string }
  | { kind: 'after'; anchor_ref: string }
  | { kind: 'in_place_single_rem' }
  | { kind: 'in_place_selection_range' }
```

规则：

- 对外 CLI 统一收口到 `--portal`
- 显式 portal 放置语义为 `--portal at:<placement-spec>`
- shorthand：
  - `rem move --portal in-place`
  - `rem create --from-selection --portal in-place`

### 4. 标题策略 `TitleStrategy`

```ts
type TitleStrategy =
  | { kind: 'explicit'; title: string }
  | { kind: 'infer_from_single_source' }
```

规则：

- `markdown` 只允许 `explicit`
- `targets` / selection 单 source 时可推导
- `targets` / selection 多 source 时必须显式 title

### 5. create intent

```ts
type RemCreateIntent = {
  command: 'rem.create'
  source: ContentSource
  content_placement: ContentPlacement
  portal_placement: PortalPlacement
  title_strategy: TitleStrategy
  is_document: boolean
  tags: ReadonlyArray<string>
}
```

### 6. move intent

```ts
type RemMoveIntent = {
  command: 'rem.move'
  rem_id: string
  content_placement: ContentPlacement
  portal_placement: PortalPlacement
  is_document: boolean
}
```

## Canonical Internal Plan Surface

高层命令不直接执行随机分支逻辑，而是先编译成统一 plan。

```ts
type CanonicalWritePlan = {
  version: 1
  kind: 'actions'
  actions: ReadonlyArray<{
    action: string
    input: Record<string, unknown>
    as?: string
  }>
}
```

要求：

- `rem create` / `rem move` 的复合流程都能表达为 canonical write plan
- 该 plan 必须与 `apply` 的 action surface 兼容

## 执行形态

### `rem create`

可能编译成：

- `write.bullet` / `create_rem` 作为 destination root
- optional `write.md` / `create_tree_with_markdown`
- optional `rem.children.append` or equivalent markdown import under destination
- optional `move_rem` or target-move ops when source=`targets[]`
- optional `portal.create`

### `rem move`

可能编译成：

- `move_rem`
- optional document mutation
- optional `portal.create`

## receipt 模型

### 成功 / 部分成功机器输出

```ts
type DurableWriteReceipt = {
  txn_id: string
  op_ids: string[]
  status?: string

  durable_target: {
    rem_id: string
    is_document: boolean
    placement_kind: 'parent' | 'before' | 'after' | 'standalone'
  } | null

  portal: {
    requested: boolean
    created: boolean
    rem_id?: string
    placement_kind?: 'parent' | 'before' | 'after' | 'in_place_single_rem' | 'in_place_selection_range'
  }

  source_context?: {
    source_kind: 'text' | 'markdown' | 'targets'
    source_origin?: 'explicit_targets' | 'selection'
    parent_id?: string
    anchor_rem_id?: string
    replaced_range_start_id?: string
    replaced_range_end_id?: string
  }

  moved_rem_ids?: string[]
  id_map?: Array<{
    client_temp_id: string
    remote_id: string
    remote_type: string
  }>

  warnings?: string[]
  nextActions?: string[]
}
```

## 关键约束

- `durable_target.rem_id` 一旦存在，就算 portal 失败也必须返回
- `portal.requested=true && portal.created=false` 时必须伴随 warning
- `targets[]` 来源必须能诊断 `moved_rem_ids`
- `leave-portal` / `leave-portal-in-place` 需要记录 source context 以便解释原位替换行为
- `apply` 兼容的 canonical plan 是高层命令的唯一内部编排面
