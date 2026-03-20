# CLI Contract: 028-rem-create-move-page-portal-flow

## 目标

在不新增 workflow noun 的前提下，扩展 `rem create` / `rem move`，并让它们统一编译到 canonical internal write plan surface。

## `rem create`

### 新增参数

- `--markdown <input-spec>`
- `--target <ref>` 可重复
- `--from-selection`
- `--title <text>`
- `--standalone`
- `--before <ref>`
- `--after <ref>`
- `--portal-parent <ref>`
- `--portal-before <ref>`
- `--portal-after <ref>`
- `--leave-portal-in-place`

### 内容来源规则

四选一：

- `--text`
- `--markdown`
- repeated `--target`
- `--from-selection`

错误：

- 同时出现多个内容来源 -> `INVALID_ARGS`
- `--markdown` 且缺 `--title` -> `INVALID_ARGS`
- 多个 `--target` 且缺 `--title` -> `INVALID_ARGS`
- `--from-selection` 解析成多 root 且缺 `--title` -> `INVALID_ARGS`
- `--from-selection` 与 explicit `--target` 同时出现 -> `INVALID_ARGS`

补充：

- 单个 `--target` 允许缺省 `--title`
- `--from-selection` 且选择结果为单 root，允许缺省 `--title`
- 缺省时 destination title 默认取该 source root Rem 文本
- `--markdown` 不要求 single-root
- `--from-selection` 是 `targets[]` source 的 sugar，不是独立执行路径

### 内容位置规则

四选一：

- `--parent`
- `--before`
- `--after`
- `--standalone`

错误：

- 同时出现多个内容位置 -> `INVALID_ARGS`
- 四者都缺失 -> `INVALID_ARGS`

### portal 位置规则

最多一组：

- `--portal-parent`
- `--portal-before`
- `--portal-after`
- `--leave-portal-in-place`

错误：

- 同时出现多组 portal 位置 -> `INVALID_ARGS`
- `--leave-portal-in-place` 只对 `--from-selection` 有效 -> `INVALID_ARGS`

### 语义

- `--standalone`：destination 创建为无 parent 的 Rem
- `--is-document`：显式设置 destination 为 document/page，默认 `false`
- `--target`：表示已有 Rem 作为 source，将被移动到新 destination 下
- `--from-selection`：把当前连续 sibling selection 解析为 source targets，再进入同一路径
- `--portal-*`：destination 创建成功后，额外插入一个 portal 指向 destination
- `--leave-portal-in-place`：仅对 `--from-selection` 有效，表示用 portal 替换原 selection range

## `rem move`

### 新增参数

- `--standalone`
- `--before <ref>`
- `--after <ref>`
- `--is-document`
- `--leave-portal`

### 内容位置规则

四选一：

- `--parent`
- `--before`
- `--after`
- `--standalone`

错误：

- 同时出现多个内容位置 -> `INVALID_ARGS`
- 四者都缺失 -> `INVALID_ARGS`

### portal 规则

- `--leave-portal` 只在单 Rem move promotion 里有效
- 语义：destination move 成功后，在原位置留下 portal

## 位置解析规则

### parent

- 内容或 portal 追加到指定 parent 的 direct children

### before / after

- anchor 必须能解析到一个真实 Rem
- 内部归约为：
  - anchor.parent
  - anchor.sibling_position

### standalone

- destination parent = `null`

## receipt 要求

JSON 输出至少包含：

- `txn_id`
- `op_ids`
- `durable_target`
- `portal`
- `warnings`
- `nextActions`

当 durable target 已成功创建或移动但 portal 失败时：

- `ok` 仍可为 true 或 partial-success 兼容 envelope
- 但必须明确 `portal.created=false`
- 必须返回 durable target id

## Canonical Internal Surface

- `rem create` / `rem move` 不是各自独立的 runtime path
- 两者都必须先 normalize 成 intent
- 再编译到 one canonical internal write plan surface
- 该 plan surface 必须与 `apply` 兼容
