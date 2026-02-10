# Ops Contract (Plugin Executor Aligned)

本文件以插件端 handler 为裁决点，列出本 feature 直接依赖的 op.type 与 payload 字段（snake_case），用于避免 CLI/SSoT/实现漂移。

## Role: Op Catalog Seed

本文件是 **Op Catalog** 的最小裁决点（只覆盖：op.type + payload 字段形状），并被以下规划直接复用：

- 010（batch pull / scheduler）：`WriteFootprint(op)` / `ConflictKey[]` 的推导规则（保守优先）
- 012（write plan）：ID 语义字段白名单（哪些 payload 字段允许出现 `@alias`/temp id）
- 011（命令收口）：对外写入语义与诊断输出契约（SSoT 同步）

后续可扩展：在不破坏本文件“插件裁决点”属性的前提下，为每个 op 补齐 `id_fields`/`footprint`/`result_shape` 等元信息，并逐步沉淀为可机读的 TS/JSON catalog（由实现消费，避免重复 hardcode）。

## Naming

- op.type（队列表 `ops.type`）：标准下划线形式（例如 `create_rem`）
- op_type（WS 派发字段）：同 op.type
- 点式别名：插件端支持（见 `packages/plugin/src/bridge/ops/mapOpType.ts`），例如 `table.addRow` → `table_add_row`
- payload keys：允许输入 camelCase，但入队/派发后必须统一 snake_case

## Core Ops Used by 006

### Rem CRUD

- `create_rem`
  - payload: `{ parent_id: string, text?: any, tags?: string[], is_document?: boolean, client_temp_id?: string }`
  - id_fields: `parent_id`, `tags[]`
  - temp_id_fields: `client_temp_id`
- `delete_rem`
  - payload: `{ rem_id: string }`
  - id_fields: `rem_id`
- `update_text`
  - payload: `{ rem_id: string, text: any }`
  - id_fields: `rem_id`

### Markdown Ops

- `create_single_rem_with_markdown`
  - payload: `{ parent_id: string, markdown: string, client_temp_id?: string }`
  - id_fields: `parent_id`
  - temp_id_fields: `client_temp_id`
- `create_tree_with_markdown`
  - payload: `{ parent_id: string, markdown: string, position?: number, indent_mode?: boolean, indent_size?: number, parse_mode?: 'raw'|'ast'|'prepared', prepared?: any, client_temp_ids?: string[], bundle?: { enabled: boolean, title?: string, summary?: string } }`
  - id_fields: `parent_id`
  - temp_id_fields: `client_temp_ids[]`
- `replace_selection_with_markdown`
  - payload: `{ markdown: string, target: { mode: 'current'|'expected'|'explicit', rem_ids?: string[] }, require_same_parent?: boolean, require_contiguous?: boolean, portal_id?: string }`
  - id_fields: `target.rem_ids[]`, `portal_id`

### Daily Note Ops

- `daily_note_write`
  - payload: `{ text?: string, markdown?: string, date?: string|number, offset_days?: number, prepend?: boolean, position?: number, bundle?: { enabled: boolean, title?: string, summary?: string } }`
  - id_fields: *(none)*

### Tags / Attributes

- `add_tag`
  - payload: `{ rem_id: string, tag_id: string }`
  - id_fields: `rem_id`, `tag_id`
- `remove_tag`
  - payload: `{ rem_id: string, tag_id: string, remove_properties?: boolean }`
  - id_fields: `rem_id`, `tag_id`
- `set_attribute` / `table_cell_write`
  - handler 复用：`packages/plugin/src/bridge/ops/handlers/metaOps.ts`
  - payload: `{ rem_id: string, property_id: string, value?: any }`
  - id_fields: `rem_id`, `property_id`

### Table / Properties / Options

- `create_table`（本 feature 可选使用）
  - payload: `{ parent_id: string, tag_id?: string, client_temp_id?: string }`
- `add_property`
  - payload: `{ tag_id: string, name?: string, property_id?: string, type?: string, options?: string[] }`
- `set_property_type`
  - payload: `{ property_id: string, type: string }`
- `add_option`
  - payload: `{ property_id: string, text: string, option_id?: string }`
- `remove_option`
  - payload: `{ option_id: string }`

### Table Records / Cells

- `table_add_row`
  - payload: `{ table_tag_id: string, parent_id?: string, rem_id?: string, text?: any, client_temp_id?: string, values?: { property_id: string, value: any }[], extra_tags?: string[] }`
  - 语义：若 `rem_id` 存在则对现有 Rem 打 Tag；否则创建新 Rem（此时必须提供 `parent_id`）
- `table_remove_row`（本 feature 不作为“删除记录”使用）
  - payload: `{ table_tag_id: string, rem_id: string, remove_properties?: boolean }`
- `set_cell_select`
  - payload: `{ rem_id: string, property_id: string, option_ids: string | string[] }`
- `set_cell_checkbox`
  - payload: `{ rem_id: string, property_id: string, value: boolean }`
- `set_cell_number`
  - payload: `{ rem_id: string, property_id: string, value: number | string | null }`
- `set_cell_date`
  - payload: `{ rem_id: string, property_id: string, value: string | number | { year: number, month: number, day: number } }`

## Known Drift (Must Fix in 006 Implementation)

- `packages/agent-remnote/src/internal/remdb-tools/listSupportedOps.ts` 当前以 camelCase 声明字段，且部分字段名与插件 handler 不一致（例如 `rowId/columnId` vs `rem_id/property_id`；`add_option` 的 `name` vs 插件的 `text`）。
- 006 实施应以本文件为准对齐（并同步更新 `docs/ssot/agent-remnote/tools-write.md`）。
