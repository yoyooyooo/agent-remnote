# Feature Specification: Table / Tag CRUD Alignment

**Feature Branch**: `006-table-tag-crud`  
**Created**: 2026-01-24  
**Status**: Accepted  
**Accepted**: 2026-01-26  
**Input**: User description: "支持 Table 记录新增/改/查/删（表=Tag，记录=被该 Tag 标记的 Rem），支持给 Rem 增删 Tag、设置 Tag property，并把后端命令与插件执行逻辑一一对应；全局禁止创建无 parent 的 Rem，未指定写入位置则兜底写入今日 Daily Notes（若当日 Daily Doc 不存在则报错提示先打开）；values 仅支持数组形态。"

全局概念与术语裁决见：`specs/CONCEPTS.md`（Op Catalog、write-first 诊断契约、幂等与映射稳定性等）。

## Dependencies

- **011-write-command-unification**（Accepted）：命令面收口与诊断契约统一；006 的写入入口与输出格式必须按 011 标准对齐（避免出现多套“table/tag 写入入口”）。
- **012-batch-write-plan**（Accepted，可选）：若希望把 table/tag 操作纳入 `write plan` action set，006 的 op/payload 需要作为 plan action 的裁决点（Op Catalog）。
- **013-multi-client-execution-safety**（Accepted）：多客户端切换下的回执一致性基线（attempt_id/CAS ack）；影响“写入可重试/回执可闭环”的可靠性边界。

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Table 记录 CRUD（表=Tag，行=Rem） (Priority: P1)

作为用户/AI Agent，我可以用“某个 Tag 作为 Table”来管理记录：行是被该 Tag 标记的 Rem；我可以新增/修改/删除记录，并读取该 Table 的结构与记录值。

**Why this priority**: 这是当前需求的主目标；其它 Tag/属性管理都服务于“把 Rem 当作结构化记录”这一核心闭环。

**Independent Test**: 仅实现 “table record add/update/delete + read table” 即可闭环验证：能创建一条记录、修改其字段、删除并确认不可再读到。

**Acceptance Scenarios**:

1. **Given** 一个已存在的 tableTag（Tag Rem ID）与明确的写入位置（parent 或 ref），**When** 新增一条 table record（可选 text + values），**Then** 创建的 Rem 出现在该位置且带上 tableTag，并在 read table 中可查到该行与其字段值。
2. **Given** 一个已存在的 tableTag 且用户未指定写入位置（无 parent/ref/UI page），**When** 新增一条 table record，**Then** 系统将其写入 `daily:today`；若当日 Daily Doc 不存在，则失败并提示“请先在 RemNote 打开今日 Daily Notes”。
3. **Given** 一条已存在的 table record（row Rem ID）与其所属 tableTag，**When** 更新该记录的 text 或 values，**Then** read table 返回的该行内容与字段值发生对应变化。
4. **Given** 一条已存在的 table record（row Rem ID）与其所属 tableTag，**When** 在 Table 视角删除记录，**Then** 该 Rem 被删除且后续 read table 不再返回该行。

---

### User Story 2 - 单 Rem 的 Tag 增删（与“删除记录”严格区分） (Priority: P2)

作为用户/AI Agent，我可以只针对“一个 Rem”新增/删除某个 Tag，并且这套 Tag 命令绝不承载“删除记录”的语义。

**Why this priority**: 如果 Tag 管理与 Table 记录语义混在一起，会让 Agent 误删/误改，造成不可逆的数据损失；必须用命令边界来约束。

**Independent Test**: 仅实现 “tag add/remove + rem inspect/read 验证” 即可：确认 add/remove 只改变 tag 关系，不删除 Rem 本体。

**Acceptance Scenarios**:

1. **Given** 一个已存在 Rem 与一个 Tag，**When** 执行 tag add，**Then** Rem 获得该 Tag，且 Rem 本体内容不发生非预期变化。
2. **Given** 一个已存在 Rem 已带某 Tag，**When** 执行 tag remove，**Then** 该 Tag 被移除，但 Rem 仍存在且可被 read/inspect。
3. **Given** “删除记录”的诉求，**When** 用户选择 Table 视角 delete record 或 Rem 视角 delete rem，**Then** 才会删除 Rem；tag remove 不应触发删除。

---

### User Story 3 - Table 属性/选项管理与读取（列定义 + 单元格值） (Priority: P3)

作为用户/AI Agent，我可以为某个 tableTag 增加/调整属性（列），并在 read table 中读取到列定义、选项（如 select/multi_select），以及每行的单元格值。

**Why this priority**: 没有列定义与可读的字段值，Table 只能当“打标签列表”，无法形成结构化记录能力。

**Independent Test**: 仅实现 “property add/set-type/option add/remove + read table” 即可：能在 read table 输出列定义，并通过 values 写入后在 read table 读回。

**Acceptance Scenarios**:

1. **Given** 一个 tableTag，**When** 新增一列并设置类型（含可选 options），**Then** read table 返回的 properties 中包含该列，且列类型/选项信息可见。
2. **Given** 一条记录与一列 property，**When** 通过 table record update 写入该列的值，**Then** read table 返回该行该列的值与写入一致。

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- 当用户未提供写入位置且 `daily:today` 不存在时，系统应如何失败并给出可执行提示？
- 当 `values[].propertyName` 在 table 中找不到，或同名列存在多个时，应如何报错并提示如何消歧义（改用 propertyId）？
- 当用户在 Table 视角 delete record 但该 row 实际不属于该 tableTag 时，是否需要阻止误删并给出解释？
- 当 select/multi_select 的 optionName 找不到匹配 option 时，系统应如何提示与回退（例如要求传 optionId）？
- 当读表数据量较大时，分页与排序是否稳定且可继续拉取？

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: 系统 MUST 提供语义化的“Table/Tag/Rem”命令集合，并与插件侧可执行能力一一对应（同一语义只对应一种写入路径）。
- **FR-002**: 系统 MUST 定义并遵守 “Table = Tag，Record = 被该 Tag 标记的 Rem” 的概念模型，并用于读写接口的输出/入参解释。
- **FR-003**: 系统 MUST 提供 Table 视角下的 record CRUD：add / update / delete，其中 delete 的语义 MUST 为“删除 Rem 本体”。
- **FR-004**: 系统 MUST 提供 Tag 视角下的 add/remove，且 Tag remove MUST 仅移除 Tag（可选移除该 Tag 相关属性槽），不得删除 Rem。
- **FR-005**: 系统 MUST 提供 Rem 视角下的 delete，用于直接删除指定 Rem。
- **FR-006**: 所有可能创建 Rem 的写入入口 MUST 遵守“禁止创建无 parent 的 Rem”的硬约束。
- **FR-007**: 当用户未指定写入位置时，创建类写入 MUST 兜底写入 `daily:today`；若当日 Daily Doc 不存在，系统 MUST 失败并提示用户先在 RemNote 打开今日 Daily Notes。
- **FR-008**: Table record add/update 的 `values` 入参 MUST 仅支持数组形态：`values: [{ propertyName?: string; propertyId?: string; value: any }]`。
- **FR-009**: 当 `propertyId` 与 `propertyName` 同时提供时，系统 MUST 以 `propertyId` 为准；若只提供 `propertyName`，系统 MUST 在同一 tableTag 作用域内解析；解析失败或歧义时 MUST 报错并引导改用 `propertyId`。
- **FR-010**: 对 select/multi_select 类型，`value` MUST 支持以 optionName（或 optionNames 数组）表达，并在必要时允许直接使用 optionId（或 optionIds 数组）以避免歧义。
- **FR-011**: 系统 MUST 提供 read table 能力，输出至少包含：tableTag 标识、列定义（properties）、分页信息（limit/offset/hasMore）、以及每行的字段值（cells）。
- **FR-012**: 系统 MUST 保证写入不直接修改 RemNote 官方数据库（只读访问允许），所有写入必须走安全写入链路并可观测。

### Non-Functional Requirements (Performance & Diagnosability)

<!--
  If this feature touches Logix runtime hot paths, treat performance and
  diagnosability as first-class requirements:
  - Define budgets (time/alloc/memory) and how they are measured
  - Define what diagnostic events/Devtools surfaces exist and their overhead
-->

- **NFR-001**: 所有命令 MUST 输出可机器解析的结构化结果（例如包含目标 RemId、变更类型、错误码/错误信息），以便 Agent 可靠编排与重试。
- **NFR-002**: 错误处理 MUST 具备可行动的提示，尤其是：缺少 parent、daily doc 不存在、列解析歧义、row 不属于 table 等高频错误。
- **NFR-003**: 写入请求 SHOULD 支持幂等（例如允许调用方提供幂等键），并在可重试场景下避免产生重复记录或不可预期副作用。
- **NFR-004**: read table 的分页与排序 MUST 稳定（相同输入下输出结构稳定、可继续分页）。
- **NFR-005**: 写入命令 MUST 采用 write-first：不要求单独的“事前检查命令”；命令内部完成必要校验与入队，并在成功时返回 `txn_id/op_ids` + `nextActions`（可复制执行的英文命令），失败时返回稳定 `error.code` + `hint`（英文命令），从而让 Agent 一次调用即可进入“执行→闭环验证/修复”的最短链路。

### Key Entities *(include if feature involves data)*

- **TableTag**: 用于定义“表”的 Tag（一个 Tag Rem）。
- **TableRecord**: 一条记录（一个 Rem），通过被 TableTag 标记进入表。
- **TableProperty**: 表的一列（Property Rem），归属于某个 TableTag。
- **TableOption**: select/multi_select 的选项（Option Rem），归属于某个 TableProperty。
- **RecordValues**: 一条记录的字段值集合（以 `values[]` 表达）。
- **WriteLocation**: 写入位置决策：显式 parent/ref 或兜底 `daily:today`。

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 用户/Agent 能用单条命令完成 table record add，并拿到创建出的 RemId，且该记录能被 read table 查询到。
- **SC-002**: 用户/Agent 能用单条命令完成 table record update，并在 read table 中读回更新后的字段值。
- **SC-003**: 用户/Agent 能用单条命令完成 table record delete，且该 Rem 不再能被 read/inspect 找到。
- **SC-004**: 当未指定写入位置时，系统按规则尝试写入 `daily:today`；若不可用，则错误提示可让用户在 1 次操作内修复（打开今日 Daily Notes 后重试）。
- **SC-005**: Tag 管理命令与 Table/Rem 删除命令边界清晰，避免误删：tag remove 永远不删除 Rem。
