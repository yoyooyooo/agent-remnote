# Powerup / Property / Table 用法食谱

## TL;DR

- Tag 是最基础的“语义标记”；Powerup 是“标签 + 属性”的业务模型（插件可注册 schema）。
- 表格（Table）本质上建立在 Tag/Property 之上：行是被标记的 Rem，列是属性 Rem（Property）。
- 本仓库写入链路对表格/属性提供了一组 op.type（由插件执行器通过 SDK 实现），用于安全批量写入。

## 1) 三个概念如何对应

- Tag：给 Rem 打标（筛选、聚合、做表的基础）。
- Powerup：把某个 Tag 提升为“模型”（定义 properties），用于结构化数据治理。
- Property：字段定义（通常是某个 Tag/Powerup Rem 的子 Rem，并被标记为 property）。

## 2) 插件侧常用 API（概念级）

- 注册 Powerup schema：`plugin.app.registerPowerup(...)`
- 获取 Powerup：`plugin.powerup.getPowerupByCode(code)`
- 标记 Rem：`rem.addTag(powerupRem._id)` 或 `rem.addTag(tagId)`
- 读写属性：
  - Powerup 属性：`rem.setPowerupProperty(powerupCode, propertyCode, value)` / `getPowerupProperty(...)`
  - Tag 属性（表格单元格）：`rem.setTagPropertyValue(propertyId, value)`

## 3) 本仓库：表格/属性写入 op（与 SDK 对应）

本仓库的写入建议优先走队列 op（由插件端执行），避免外部直接操控 UI：

- 表与属性
  - `create_table`（`plugin.rem.createTable`）
  - `add_property`（创建属性 Rem，`setIsProperty(true)`，可设置类型与 options）
  - `set_property_type`
  - `add_option` / `remove_option`
  - `set_table_filter`（内部构造 `Query.tableColumn(...)`）
- 行与单元格
  - `table_add_row` / `table_remove_row`
  - `table_cell_write` / `set_attribute`（本质都是 `setTagPropertyValue`）
  - `set_cell_select` / `set_cell_checkbox` / `set_cell_number` / `set_cell_date`（按类型做便捷封装）

代码锚点：

- 插件执行器：`packages/plugin/src/widgets/index.tsx`（`executeOp` 的 `create_table`/`add_property`/`table_add_row`/`set_table_filter` 等分支）
- 工具语义与 payload 约定：`docs/ssot/agent-remnote/tools-write.md`

## 4) 数据库只读侧的对应（用于理解，而非写入）

深入结构与“为什么不要直接写 DB”：`docs/remnote/database-notes.md`

## 5) 本机参考（若存在）

- Powerup 与属性：`guides/powerups-and-properties.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
