# Research: Table / Tag CRUD Alignment

## Ground Truth（实现裁决点）

- 写入执行器（插件端）：`packages/plugin/src/bridge/ops/executeOp.ts`
  - op type 映射：`packages/plugin/src/bridge/ops/mapOpType.ts`
  - Table/Property/Cell handlers：`packages/plugin/src/bridge/ops/handlers/tableOps.ts`
  - Tag/Attribute handlers：`packages/plugin/src/bridge/ops/handlers/metaOps.ts`
  - Rem CRUD handlers：`packages/plugin/src/bridge/ops/handlers/remCrudOps.ts`
- WS bridge 协议/派发：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（009+）+ `docs/ssot/agent-remnote/ws-bridge-protocol.md`（SSoT；legacy bridge 若仍在用见 `packages/agent-remnote/src/internal/ws-bridge/bridge.ts`）
- 队列 schema：`packages/agent-remnote/src/internal/queue/db.ts` + `docs/ssot/agent-remnote/queue-schema.md`
- 写入语义（SSoT）：`docs/ssot/agent-remnote/tools-write.md`

结论：本 feature 的“后端侧语义”以插件 handler 可执行能力为准，CLI 只负责提供语义化入口并入队。

## Decision 1: 概念模型与删除边界

- Table = Tag（表头 Tag Rem）
- Record(Row) = 被该 Tag 标记的 Rem
- 删除语义必须分离：
  - `write tag remove`：移除 Tag（不删除 Rem，本体保留）
  - `write table record delete`：删除记录 = 删除该行 Rem 本体（`delete_rem`）
  - `write rem delete`：直接删除 Rem 本体（`delete_rem`）

Rationale：防止 Agent 误删；命令边界即安全边界。

## Decision 2: 新增 Rem 的 parent 规则 + daily:today 兜底

事实：
- 插件端 `create_rem` / `create_table` / `table_add_row`（创建新行）都显式拒绝无 `parent_id`：`Missing parent_id (refusing to create a Rem without a parent)`。

规则：
- 所有创建类写入入口必须保证最终有 parent。
- 若用户未指定写入位置，则默认写入 `daily:today`。
- 若当日 Daily Doc 不存在：直接失败，并提示用户先在 RemNote 打开今日 Daily Notes（用户可见提示必须英文）。

Rationale：避免“孤儿 Rem”导致无法定位/清理；兜底行为可预测且可修复。

## Decision 3: `values` 入参仅支持数组

- `values` 仅支持：`[{ propertyId?: string; propertyName?: string; value: any }][]`
- 不支持 `{ [propertyId]: value }`：
  - CLI 会对 JSON object 的 key 做 `camelCase -> snake_case` 归一化（`packages/agent-remnote/src/services/Payload.ts`），会破坏“ID 作为 key”的稳定性与可预测性。

Rationale：保证输入稳定、可诊断，并避免隐式改写造成的 silent data corruption。

## Decision 4: op.type 与 payload 命名风格

事实：
- 队列中 op 字段：`ops.type`（下划线标准 type），派发到插件侧字段名为 `op_type`（WS bridge 会映射 type→op_type）。
- 插件端支持点式别名（`rem.create`、`table.addRow` 等），并统一映射为标准 type：见 `mapOpType.ts`。
- payload 允许 camelCase / snake_case；CLI 入队前会归一化为 snake_case（`Payload.normalizeKeys` + `normalizeOp`）。

结论：
- CLI 对外提供语义化命令与参数（更易被 Agent 生成/理解），内部统一入队标准 op.type + snake_case payload。
- `packages/agent-remnote/src/internal/remdb-tools/listSupportedOps.ts` 当前声明的是 camelCase 字段名且与插件实际 payload（snake_case）不一致；006 实施时需要对齐（或至少在文档中明确“输入可 camelCase，但落库/派发为 snake_case”并修正字段语义漂移）。

## Decision 5: read_table_rem 必须补齐 cells（从 DB 读回）

现状：
- `packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts` 目前主要基于 “Property/Option Rem + option.doc.pd(rowIds)” 还原 select/multi_select 的命中，不足以读回 text/number/date/checkbox 等单元格值。

RemNote DB 事实（可执行的解析路径）：
- 详见 `docs/remnote/database-notes.md` 的“属性值 Rem 的共同特征”：
  - 行 Rem 的 `h`（children）里包含多个 `type:2` 的“属性值 Rem”
  - 属性值 Rem 的 `key[0]` 恒为 `{"i":"q","_id":"<propertyId>"}`，`parent` 指向所属行
  - 属性值 Rem 的 `value` 字段存储 RichText token 数组，不同列类型有稳定模式（select/multi/date/checkbox/number/text）

结论：
- read_table_rem 的实现应以“属性值 Rem（type:2）”为主数据源，输出稳定的 `cells`（按 propertyId 归档），并保留 select/multi 的 option 信息（必要时用于 name 反查与统计）。
