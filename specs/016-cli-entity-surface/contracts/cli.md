# CLI Contract: Entity-first surfaces under write/read (016)

目标：在保持 `read/write` 副作用边界清晰的前提下，为 Agent 提供低歧义的实体语义命令；`write advanced ops` 仅作为 advanced/debug 入口。

> 用户可见输出（错误信息/提示/nextActions）必须英文；本合同中的示例消息也用英文。

## Common Flags (all write commands)

与现有 `write md/bullet/tag/table` 保持一致：

- `--no-notify` / `--no-ensure-daemon`
- `--wait` / `--timeout-ms` / `--poll-ms`
- `--dry-run`
- `--priority` / `--client-id` / `--idempotency-key` / `--meta`

输出契约：

- `--json`：stdout 单行 envelope；stderr 为空；exit code `0/2/1`（见 `docs/ssot/agent-remnote/cli-contract.md`）

ID 输入契约（统一）：

- 任何 “RemId” 参数 SHOULD 支持输入 `remnote://w/<kbId>/<remId>`（仅提取 remId），避免 Agent/用户误把 deep link 当纯文本。

## Portal

### `agent-remnote write portal create`

语义：在 `parent` 下创建 Portal 容器并投影目标 Rem（真正的 Portal：`RemType.PORTAL=6`）。

- Required
  - `--parent <remId|ref|remnote://...>`（插入位置的父 Rem）
  - `--target <remId|ref|remnote://...>`（投影目标 Rem）
- Optional
  - `--position <int>`（0-based；缺省为 0）
- Enqueue (conceptual)
  - `op.type = create_portal`
  - `payload = { parent_id, target_rem_id, position? }`
- Success output (suggested fields)
  - `portal_id` / `target_rem_id` / `parent_id`

### `agent-remnote write portal include/exclude` *(optional, if implemented)*

语义：把某个 Rem 加入/移出某个 Portal（对应 SDK `addToPortal/removeFromPortal`）。

- Required
  - `--portal <PoRID>`
  - `--target <TRID>`
- Enqueue
  - TBD（需要插件侧对应 op handler）

## Tag (Tag relationship; Tag is a Rem)

Tag 本体是一个 Rem（`tag_id`），本命令只操作“关系”，不创建/删除 Tag Rem。

### `agent-remnote write tag add`

- Required
  - `--rem <RID|remnote://...>`
  - `--tag <TagId|remnote://...>`
- Enqueue
  - `op.type = add_tag`
  - `payload = { rem_id, tag_id }`

### `agent-remnote write tag remove`

- Required
  - `--rem <RID|remnote://...>`
  - `--tag <TagId|remnote://...>`
- Optional
  - `--remove-properties <bool>`（是否清理该 tag 的属性值；不删除 tag rem）
- Enqueue
  - `op.type = remove_tag`
  - `payload = { rem_id, tag_id, remove_properties? }`

### `agent-remnote write rem tag add/remove` (dual surface)

语义与 `write tag add/remove` 完全等价；必须共享同一套参数默认值、错误码与输出字段。

裁决：文档必须明确 Agent 的 canonical 推荐路径（避免高熵），另一条仅作为“视角入口”薄壳保留。

## Table (Table = Tag)

Table 以 Tag Rem（`tableTagId`）表示；record 为 Rem；property/option 都围绕 tableTag 组织。

### `agent-remnote read table`

只读 DB 工具，用于 values 编译/诊断（不能成为 write 的强制前置步骤）。

- Required: `--id <tableTagId>`
- Optional: `--include-options`, `--limit`, `--offset`

### `agent-remnote write table create`

语义：创建一个 Table（对应插件侧 `create_table` / SDK `createTable(tag_id)`）。

- Required
  - `--table-tag <tableTagId|remnote://...>`（TableTag Rem ID）
  - one of:
    - `--parent <remId|remnote://...>`
    - `--ref <id:/page:/title:/daily:...>`
- Optional
  - `--position <int>`（0-based；缺省为 0）
- Enqueue
  - `op.type = create_table`
  - `payload = { tag_id, parent_id, position? }`
- Success output (suggested)
  - `table_rem_id`（若支持 `client_temp_id` + `--wait`，可从 `id_map` 回显）

### `agent-remnote write table record add/update/delete` *(existing)*

- record add:
  - required: `--table-tag <tagId>`
  - location: `--parent <remId>` or `--ref <ref>`（都缺失则 fallback `daily:today`）
  - optional: `--text`, `--values <json|@file|->`（数组形态）
- record update:
  - required: `--table-tag`, `--row`
  - must provide at least one of `--text`/`--values`
  - should validate row belongs to tableTag (DB check)

### `agent-remnote write table property ... / option ...` *(existing)*

- property: `add`, `set-type`
- option: `add`, `remove`
