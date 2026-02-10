# CLI Contract: Table / Tag / Rem (Write)

目标：提供与插件执行器 1:1 对齐的“语义化写入命令”，便于 AI Agent 可靠生成与编排。

> 用户可见输出（错误信息/提示）必须英文；本合同中的示例消息也用英文。

## Common Flags（all write commands）

所有写入命令与现有 `write md/bullet` 保持一致的通用参数（语义相同）：

- `--notify`：入队后通过 WS 触发插件同步
- `--ensure-daemon`：必要时拉起/确保 WS bridge daemon
- `--dry-run`：不入队，仅输出将要入队的 ops（机器可解析）
- `--priority <int>`
- `--client-id <string>`
- `--idempotency-key <string>`
- `--meta <json|@file|->`：附加到 txn 的 meta（会被 normalize 为 snake_case）

## Command Set

### 1) Tag（仅针对单 Rem 的 Tag 增删）

#### `agent-remnote write tag add`

- Required
  - `--rem <remId>`
  - `--tag <tagId>`
- Enqueue
  - `op.type = add_tag`
  - `payload = { rem_id, tag_id }`

#### `agent-remnote write tag remove`

- Required
  - `--rem <remId>`
  - `--tag <tagId>`
- Optional
  - `--remove-properties`（默认 false）：是否同时移除该 Tag 相关的属性值（与插件 SDK `removeTag(tagId, removeProperties)` 对齐）
- Enqueue
  - `op.type = remove_tag`
  - `payload = { rem_id, tag_id, remove_properties? }`

Safety rule：
- `tag remove` 永远不删除 Rem 本体。

### 2) Rem（直接删除 Rem）

#### `agent-remnote write rem delete`

- Required
  - `--rem <remId>`
- Enqueue
  - `op.type = delete_rem`
  - `payload = { rem_id }`

### 3) Table = Tag（表/列/记录）

#### 3.1 Table Record（行）

##### `agent-remnote write table record add`

语义：创建一条记录（一个 Rem），并打上 `tableTag`；可选写入标题与字段值。

- Required
  - `--table-tag <tagId>`（TableTag Rem ID）
- Location（写入位置）
  - 可选其一：`--parent <parentRemId>` 或 `--ref <ref>`
  - 若两者都缺失：自动兜底 `--ref daily:today`
  - 若 daily doc 不存在：失败并提示（英文）：
    - `Daily document not found for that date. Please open it in RemNote first.`
- Optional
  - `--text <string>`
  - `--values <json|@file|->`：只支持数组形态：
    - `[{ propertyId?: string; propertyName?: string; value: any }]`
    - 若传对象映射：报错并提示改用数组（英文）
- Enqueue（概念）
  - 主 op：`op.type = table_add_row`，`payload = { table_tag_id, parent_id, text?, values? }`
  - values 的解析规则见下文（PropertyValue Encoding）

##### `agent-remnote write table record update`

语义：修改一条记录（row Rem）：

- Required
  - `--table-tag <tagId>`（用于 propertyName 解析与安全校验）
  - `--row <rowRemId>`
- Optional
  - `--text <string>`（更新 row 标题）
  - `--values <json|@file|->`（同 add）
- Enqueue（概念）
  - 若 `--text`：入队 `update_text`（`payload: { rem_id, text }`）
  - 若 `--values`：按 property kind 生成对应写入 op（见 PropertyValue Encoding）

##### `agent-remnote write table record delete`

语义：删除记录 = 删除该行 Rem 本体（不可逆）。

- Required
  - `--table-tag <tagId>`（用于安全校验：确认 row 属于该 table）
  - `--row <rowRemId>`
- Enqueue
  - `op.type = delete_rem`
  - `payload = { rem_id }`

#### 3.2 Table Property（列定义）

##### `agent-remnote write table property add`

- Required
  - `--table-tag <tagId>`
  - `--name <string>`
- Optional
  - `--type <string>`（与插件 SDK `PropertyType` 对齐）
  - `--options <json|@file|->`：`string[]`（用于 select/multi_select 初始选项）
- Enqueue
  - `op.type = add_property`
  - `payload = { tag_id, name, type?, options? }`

##### `agent-remnote write table property set-type`

- Required
  - `--property <propertyId>`
  - `--type <string>`
- Enqueue
  - `op.type = set_property_type`
  - `payload = { property_id, type }`

#### 3.3 Table Option（选项）

##### `agent-remnote write table option add`

- Required
  - `--property <propertyId>`
  - `--text <string>`
- Enqueue
  - `op.type = add_option`
  - `payload = { property_id, text }`

##### `agent-remnote write table option remove`

- Required
  - `--option <optionId>`
- Enqueue
  - `op.type = remove_option`
  - `payload = { option_id }`

## PropertyValue Encoding（values 解析规则）

目标：让 Agent 用“语义值”表达字段写入，而不是手写 RichText token。

输入：`values[]` 的每一项：

- `propertyId` 优先；仅提供 `propertyName` 时，在同一 `tableTag` 内解析；歧义/不存在必须报错（英文提示改用 propertyId）。
- 根据 property kind（由本地 DB 读取 tableTag 的 property 定义判断）决定写入方式：
  - `text`：写入字符串（底层可用 `set_attribute` 或 `table_cell_write`）
  - `number`：写入 number（底层可用 `set_cell_number`）
  - `checkbox`：写入 boolean（底层可用 `set_cell_checkbox`）
  - `select`：支持 `optionId` 或 `optionName`；底层写入 optionIds（`set_cell_select`）
  - `multi_select`：支持 `optionIds[]` 或 `optionNames[]`；底层写入 optionIds（`set_cell_select`）
  - `date`：支持 ISO string / timestamp / `{year,month,day}`；底层写入 date（`set_cell_date`）

约束：
- 若 optionName 解析失败或歧义：报错并提示改用 optionId(s)。
- 所有用户可见错误信息必须英文（遵守 Constitution）。

