# Data Model: Table / Tag CRUD Alignment

本文件描述“Table=Tag”视角下的核心实体、字段与关系，用于约束 CLI 合同与读写实现。

## Entities

### TableTag（表头 Tag Rem）

- `id: string`（Rem ID）
- `name: string`（由 `doc.key` 汇总得到）
- `properties: TableProperty[]`（表列定义：Tag 的子 Rem，带 `rcrs`）

关系：
- `TableTag (1) -> (N) TableProperty`
- `TableTag (1) -> (N) TableRecord`（通过“被 Tag 标记”关系）

### TableProperty（列 / Property Rem）

- `id: string`（Rem ID）
- `tableTagId: string`（parent 指向表头 Tag）
- `name: string`
- `rawType: string | null`（来自 `doc.rcrs`，例如 `property.s`）
- `kind: 'select' | 'multi_select' | 'text' | 'number' | 'date' | 'checkbox' | 'unknown(...)'`
- `options: TableOption[]`（仅 select/multi_select 有意义；children 带 `rcre`）

关系：
- `TableProperty (1) -> (N) TableOption`

### TableOption（选项 / Option Rem）

- `id: string`（Rem ID）
- `propertyId: string`（parent 指向 property）
- `name: string`
- `rowIds: Set<string>`（可选：来自 `doc.pd` 的反向索引；用于统计/快速命中）

### TableRecord（行 / 被 Tag 标记的 Rem）

- `id: string`（Rem ID）
- `tableTagId: string`
- `title: string`（由 `doc.key` 汇总得到）
- `cells: Record<string, CellValue>`（按 propertyId 索引）

关系：
- `TableRecord (1) -> (N) PropertyValueRem`（行的 children 中的 type:2 Rem）

### PropertyValueRem（属性值 Rem，type:2）

来源：`docs/remnote/database-notes.md`（“属性值 Rem 的共同特征”）。

- `id: string`（Rem ID）
- `rowId: string`（parent 指向 TableRecord）
- `propertyId: string`（`doc.key[0]._id`）
- `valueTokens: any[]`（`doc.value`，RichText tokens）

用途：
- read_table_rem 读回 cells 的主来源（覆盖所有 property kind）。

## Invariants（硬约束）

1. Table 视角下的 Record 存在性由“row Rem 是否带 tableTagId”决定（Tag 关系）。
2. `write tag remove` 只移除 Tag，不删除 row Rem。
3. `write table record delete` 与 `write rem delete` 都会删除 Rem 本体（不可逆）。
4. 任何创建 Rem 的写入入口必须最终有 parent；否则拒绝（或兜底 daily:today；daily doc 不存在则报错提示先打开）。

