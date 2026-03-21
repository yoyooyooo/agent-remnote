# Data Model: 029-write-command-surface-reset

日期：2026-03-21  
Spec：`specs/029-write-command-surface-reset/spec.md`

## 目标

把 `029` 的 CLI reset 明确成少数几个稳定概念，避免实现阶段重新退回“参数名即语义”的状态。

## 统一概念轴

### 1. Ref Value

写命令不再通过 `--ref` 单独建模 ref。  
所有对象定位统一回到值语法。

```ts
type RefValue =
  | `id:${string}`
  | `page:${string}`
  | `title:${string}`
  | `daily:${string}`
  | `remnote://${string}`
```

说明：

- `subject`
- repeated `from`
- `to`
- `at`

里凡是需要指向 Rem 的位置，都消费 `RefValue`。

### 2. Subject

```ts
type SubjectRef = {
  kind: 'subject'
  ref: RefValue
}
```

适用：

- `rem move`
- `rem set-text`
- `rem delete`
- 其它单主体 Rem write commands

### 3. Create Source

```ts
type CreateSource =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'refs'; refs: ReadonlyArray<RefValue> }
  | { kind: 'selection' }
```

CLI 对应：

- `--text`
- `--markdown`
- repeated `--from`
- `--from-selection`

规则：

- 四选一
- `refs` 可重复
- `selection` 是特殊 source，不携带显式 ref 列表

### 4. Placement Spec

```ts
type PlacementSpec =
  | { kind: 'standalone' }
  | { kind: 'parent'; parent_ref: RefValue; position?: number }
  | { kind: 'before'; anchor_ref: RefValue }
  | { kind: 'after'; anchor_ref: RefValue }
```

CLI 文本语法：

```ts
type PlacementSpecText =
  | 'standalone'
  | `parent:${RefValue}`
  | `parent[${number}]:${RefValue}`
  | `before:${RefValue}`
  | `after:${RefValue}`
```

### 5. Portal Strategy

```ts
type PortalStrategy =
  | { kind: 'none' }
  | { kind: 'in_place' }
  | { kind: 'at'; placement: PlacementSpec }
```

CLI 文本语法：

```ts
type PortalStrategyText =
  | 'in-place'
  | `at:${PlacementSpecText}`
```

规则：

- `in-place` 表示“放回原位置”
- `in-place` 只对存在稳定原位置的 flows 合法：
  - `rem move`
  - `rem create --from-selection`
  - `rem create` with repeated explicit `--from` when the refs resolve to one contiguous sibling range under one parent
- `at:standalone` 非法，因为 portal 自身不能 standalone

### 6. Relation Target

```ts
type RelationTarget = {
  kind: 'to'
  ref: RefValue
}
```

适用：

- `portal create`
- `tag add/remove`
- 未来其它 relation-oriented commands

### 7. Command Intent

#### `rem create`

```ts
type RemCreateIntent = {
  command: 'rem.create'
  source: CreateSource
  at: PlacementSpec
  portal: PortalStrategy
  title?: string
  is_document: boolean
  tags: ReadonlyArray<RefValue>
}
```

#### `rem move`

```ts
type RemMoveIntent = {
  command: 'rem.move'
  subject: SubjectRef
  at: PlacementSpec
  portal: PortalStrategy
  is_document: boolean
}
```

#### `portal create`

```ts
type PortalCreateIntent = {
  command: 'portal.create'
  to: RelationTarget
  at: Exclude<PlacementSpec, { kind: 'standalone' }>
}
```

#### `tag add` / `tag remove`

```ts
type TagRelationIntent = {
  command: 'tag.add' | 'tag.remove'
  tags: ReadonlyArray<RefValue>
  to: ReadonlyArray<RefValue>
  remove_properties?: boolean
}
```

语义：

- `tags × to` 展开为多条关系边
- 不再存在 `subject` 这一侧的单主体建模

### 8. Single-Subject Write Commands

```ts
type SingleSubjectWriteIntent = {
  command:
    | 'rem.set_text'
    | 'rem.delete'
    | 'rem.children.append'
    | 'rem.children.prepend'
    | 'rem.children.clear'
    | 'rem.children.replace'
    | 'rem.replace'
  subject: SubjectRef
}
```

## 统一命令语法矩阵

| Family | Subject | From | To | At | Portal |
| --- | --- | --- | --- | --- | --- |
| `rem create` | implicit new durable subject | required | none | required | optional |
| `rem move` | required | none | none | required | optional |
| `portal create` | none | none | required | required | none |
| `tag add/remove` | none | none | required relation targets | none | none |
| `rem set-text/delete` | required | none | none | none | none |
| `rem children *` | required | markdown / clear semantics only | none | none | none |

## 合法组合

### `rem create`

- `--text ... --at ...`
- `--markdown ... --title ... --at ...`
- repeated `--from ... --title? --at ...`
- `--from-selection --title? --at ...`
- 上述任意一种再加：
  - `--portal at:parent:...`
  - `--portal at:parent[2]:...`
  - `--portal at:before:...`
  - `--portal at:after:...`
- `--from-selection` 与符合条件的 repeated `--from` 允许：
  - `--portal in-place`

### `rem move`

- `--subject <ref> --at ...`
- 可再加：
  - `--portal at:parent:...`
  - `--portal at:parent[2]:...`
  - `--portal at:before:...`
  - `--portal at:after:...`
  - `--portal in-place`

### `portal create`

- `--to <ref> --at parent:...`
- `--to <ref> --at parent[2]:...`
- `--to <ref> --at before:...`
- `--to <ref> --at after:...`

### `tag add` / `tag remove`

- repeated `--tag <ref>`
- repeated `--to <ref>`
- 任一侧允许单个或多个值
- 实际执行为 `tags × to`

## 非法组合

- `rem create --portal in-place` 与 `--text`
- `rem create --portal in-place` 与 `--markdown`
- `rem create --portal in-place` 与 repeated `--from` that are not same-parent contiguous
- 任意命令的 `--portal at:standalone`
- `portal create --at standalone`
- 任意命令同时出现多种 source mode
- `rem move` 缺少 `--subject`
- `portal create` 缺少 `--to`

## 标题与正文规则

### `--markdown`

- 必须显式 `--title`
- markdown 内容写入为 destination children

### repeated `--from`

- 单个 `--from` 可沿用 source Rem 文本作为 destination title
- 多个 `--from` 必须显式 `--title`
- source Rem 会被 move 到新 destination 下，不是 copy
- 若与 `--portal in-place` 组合：
  - 必须解析到同一个 parent 下的一个 contiguous sibling range
  - contiguous 判定基于本地 hierarchy metadata 的 direct-sibling order
  - 最终 move 顺序与 destination child 顺序按原 sibling order 归一化，而不是按 CLI 传参顺序

### `--from-selection`

- 单 root 可沿用选中 root 文本作为 destination title
- 多 root 必须显式 `--title`
- selection 只是一条把当前 UI 选择解析成 repeated `--from` 候选的 sugar

### `--text`

- 无 `--title`：text 本身就是 destination title
- 有 `--title`：`title` 是 destination title，`text` 写成 destination 的第一条 body child

## 与 028 模型的关系

`029` 不推翻 `028` 的内部语义，只重命名和重排 CLI contract：

- `--leave-portal` -> `--portal in-place` on `rem move`
- `--leave-portal-in-place` -> `--portal in-place` on `rem create --from-selection`
- `--portal-parent/before/after` -> `--portal at:parent:... / before:... / after:...`
- `--parent/--ref/--before/--after/--standalone` -> `--at <placement-spec>`
- repeated `--target` on `rem create` -> repeated `--from`
- `portal create --target` -> `portal create --to`

内部 canonical plan 继续是：

- `create_rem`
- `move_rem`
- `create_portal`

public contract 只是不再直接暴露旧 flag 分类。
