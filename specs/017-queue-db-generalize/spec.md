# Feature Specification: 通用 Store DB（队列 DB 更名 + Schema 模块化 + 自动化任务/触发持久化基座）

**Feature Branch**: `[017-queue-db-generalize]`  
**Created**: 2026-01-27  
**Status**: Draft  
**Input**: User description: "我想现在的操作队列数据库是否可以改的更通用的名字，表结构看看也要不要调整 我想未来可能要存更多东西，比如插件端打标签，自动触发背后的某个任务，任务结束后会写到打标签的 rem 的子级下"

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

### User Story 1 - 统一“持久化存储”命名与默认路径 (Priority: P1)

作为仓库维护者/操作者，我希望当前“写入队列数据库（queue.sqlite）”升级为“通用持久化存储（Store DB）”，默认文件名与配置入口不再绑定 queue 语义，从而为未来在同一份数据库里沉淀更多信息（例如任务/触发/审计记录）留出清晰位置。

**Why this priority**：这是后续自动化能力（由插件端事件触发任务、任务结束写回 Rem 子级）的数据基座；若不先统一命名与入口，未来会出现多份本地 DB 并存、心智负担与运维复杂度上升。

**Independent Test**：在一个全新的本地目录（或临时目录）中运行任一需要持久化的命令（例如入队一个写入意图），验证系统只创建并使用一个默认 DB 文件 `~/.agent-remnote/store.sqlite`，且所有诊断信息里的 DB 路径与配置键都使用 “store” 语义。

**Acceptance Scenarios**：

1. **Given** 用户未显式指定任何 DB 路径，且 `~/.agent-remnote/` 可写，**When** 运行任一需要持久化存储的命令，**Then** 系统 MUST 使用 `~/.agent-remnote/store.sqlite` 作为默认 DB 文件（而不是 `queue.sqlite`）。
2. **Given** 用户通过 CLI 参数或环境变量显式指定 store DB 路径，**When** 运行任一需要持久化存储的命令，**Then** 系统 MUST 使用该路径，且输出/诊断中回显的路径与配置键均以 “store” 命名。
3. **Given** 仅存在 legacy DB `~/.agent-remnote/queue.sqlite`，且默认 store DB 不存在，**When** 运行任一需要持久化存储的命令，**Then** 系统 MUST 以“非破坏性方式”完成迁移（见 FR-003），并继续工作；legacy 文件 MUST 保持不变（不删除、不覆盖、不原地改写）。
4. **Given** store DB 与 legacy DB 同时存在且用户未显式指定路径，**When** 运行任一需要持久化存储的命令，**Then** 系统 MUST 使用 `store.sqlite`，且 MUST NOT 静默合并两者的数据；如检测到不一致风险，应 fail-fast 并给出可执行的 next actions（英文）。

---

### User Story 2 - Schema 按模块前缀组织，避免未来表名冲突 (Priority: P2)

作为未来特性开发者，我希望 Store DB 的表结构具备“模块化命名空间”（例如 `queue_*`、`task_*`、`event_*`），从而能在同一份 DB 里并存写入队列与自动化相关数据，同时保持可读性与可演进性（forward-only）。

**Why this priority**：目前队列表名（如 `txns/ops`）对 Store DB 来说过于通用；当未来引入“任务/触发/事件”等概念后，会产生命名冲突与语义歧义，降低可维护性与排障效率。

**Independent Test**：初始化一份全新的 store DB 后，用任意 SQLite 客户端检查 `sqlite_master`（或等价元数据视图），验证：
1) 队列相关表均以 `queue_` 为前缀；2) 任务/触发/事件相关表均以各自前缀分组；3) schema 版本信息可被读取并用于 fail-fast。

**Acceptance Scenarios**：

1. **Given** 一份新建的 store DB，**When** 检查其表结构，**Then** 所有“写入队列”表 MUST 使用 `queue_` 前缀（至少覆盖：事务、操作、依赖、回执、尝试历史、id 映射、consumer 记录、元信息）。
2. **Given** 一份新建的 store DB，**When** 检查其表结构，**Then** 自动化相关表 MUST 使用清晰且稳定的前缀分组（例如 `task_*`、`trigger_*`、`event_*`），并且字段命名不得与 queue 模块产生歧义。
3. **Given** store DB 的 schema 版本不匹配当前程序期望（旧版本或未知新版本），**When** 运行任一需要持久化存储的命令，**Then** 系统 MUST fail-fast，并输出可行动的诊断信息（包含：db_path、detected_version、expected_version、next_actions）。

---

### User Story 3 - 为“标签触发任务 → 写回子级 Rem”建立可追溯持久化模型 (Priority: P3)

作为系统设计者，我希望 Store DB 能持久化表达以下事实链路：

- 插件端观测到“某个 Rem 被打了某个 Tag”（事件）
- 该事件命中了某条“触发规则”（trigger）
- 系统创建并执行一个“任务实例”（task run）
- 任务运行产生的写入通过队列落库，并最终把结果写到“被打标签的 Rem”的子级下
- 全链路可追溯：能从 task run 追到触发事件、目标 Rem、以及结果 Rem（子级）的位置

**Why this priority**：这能避免未来自动化落地时出现“只写入但不可追溯/不可恢复”的黑盒行为；同时为幂等去重、失败重试、以及审计提供事实基础。

**Independent Test**：在 store DB 中创建一条 trigger 与 task 定义，然后写入一个模拟的 task run（pending→succeeded），并验证：
1) task run 可关联到 target rem 与 result rem；2) 同一触发事件不会生成重复的 task run（幂等）。

**Acceptance Scenarios**：

1. **Given** 一个启用的“标签触发”规则（例如 tag X），**When** 插件端上报一次“Rem R 添加了 tag X”的事件，**Then** 系统 MUST 以幂等方式创建一个 task run 记录，并保存 `trigger_id/task_id/target_rem_id` 等关键字段。
2. **Given** 一个 task run 已进入终态（succeeded/failed），**When** 用户或维护者查询该 task run，**Then** 系统 MUST 能返回其触发来源（事件/trigger）、目标 Rem、以及（若成功写回）结果 Rem（子级）标识。
3. **Given** 同一事件被重复上报（断线重连/重复投递），**When** 系统处理该事件，**Then** 系统 MUST 不创建重复的 task run（以确定性去重键为准），并能解释“为何去重命中”（可诊断字段）。

---

### Edge Cases

- store DB 路径指向目录、只读文件、或不可写目录时，系统必须 fail-fast，并输出可行动的错误信息（包含 db_path 与 next actions）。
- 迁移过程中遇到 legacy DB 损坏/不完整时，系统必须停止并提示用户先备份；不得覆盖 legacy 文件。
- 并发启动（多个进程同时首次触发迁移/初始化）时，系统必须避免生成半迁移状态（允许其中一个失败并提示重试）。
- store DB 已存在但 schema 版本不匹配时，系统必须 fail-fast，并给出升级/迁移路径；不得自动“猜测性修复”。
- 自动化相关数据写入不得影响写入队列的可靠性（例如错误的 task 表写入不应破坏 queue 表的完整性）。

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: 系统 MUST 将默认持久化 DB 文件名从 `queue.sqlite` 改为 `store.sqlite`，默认路径为 `~/.agent-remnote/store.sqlite`。
- **FR-002**: 系统 MUST 将所有用户可见的配置入口统一为 “store DB” 语义（例如 `--store-db` / `REMNOTE_STORE_DB` / `STORE_DB`），并在帮助文档与诊断输出中不再把它称为 “queue DB”。
- **FR-003**: 系统 MUST 提供 non-destructive 的迁移策略：当检测到 legacy `queue.sqlite` 且 `store.sqlite` 不存在时，系统必须在不改写 legacy 文件的前提下生成可用的 store DB（可通过“复制 + 迁移”或“导出/导入”等等价方式实现），且不得覆盖已存在的 `store.sqlite`。
- **FR-004**: 系统 MUST 对 store schema 进行模块化命名空间：所有写入队列相关表必须以 `queue_` 为前缀；自动化相关表必须以清晰前缀分组（例如 `task_*`、`trigger_*`、`event_*`）。
- **FR-005**: 系统 MUST 在 store DB 内支持 forward-only schema 版本管理：版本不匹配时必须 fail-fast，并提供可执行的 next actions（英文），避免长期兼容层或隐式降级。
- **FR-010**: 系统 MUST 将 schema migrations 作为程序内置能力随发布分发，并在打开 store DB 时自动执行；不得要求用户手工运行 SQL 脚本完成迁移。
- **FR-006**: 系统 MUST 在 store DB 内提供自动化持久化最小模型：任务定义（task）、触发规则（trigger）、任务运行（task run）与事件（event）的基本字段与关联关系，至少能够表达“tag 触发任务 → 写回到目标 Rem 子级”的追溯链路。
- **FR-007**: 系统 MUST 继续遵守写入红线：不得直接改写 RemNote 官方数据库；所有写入仍必须通过“入队 → 插件执行器（官方 SDK）→ 回执写回 store”的链路完成。
- **FR-008**: 任何由自动化触发产生的写入，系统 MUST 在队列事务/操作的可观测字段中保留可追溯引用（例如 task_run_id / trigger_id），以支持排障与审计。
- **FR-009**: 系统 MUST 对“事件 → task run”创建提供确定性去重，防止重复上报导致重复执行。

### Non-Functional Requirements (Performance & Diagnosability)

<!--
  If this feature touches Logix runtime hot paths, treat performance and
  diagnosability as first-class requirements:
  - Define budgets (time/alloc/memory) and how they are measured
  - Define what diagnostic events/Devtools surfaces exist and their overhead
-->

- **NFR-001**: 迁移必须可预期且低风险：默认情况下不得覆盖任何已存在的 DB 文件；迁移失败不得留下“半迁移但看似可用”的状态。
- **NFR-002**: 诊断必须可行动：任何与 store DB 相关的错误（打不开/不可写/版本不匹配/迁移失败）都必须包含 `db_path` 与可复制执行的 next actions（英文）。
- **NFR-003**: 自动化相关主键（task_id/trigger_id/run_id/event_id）必须是确定性的或可稳定复现的（用于幂等与审计）。
- **NFR-004**: 不得引入新的“写入逃生舱”：所有写入副作用必须仍受队列事务边界与幂等策略约束。
- **NFR-005**: 本特性落地时必须同步更新用户可见文档与 SSoT（例如默认路径、术语、配置入口），避免 “queue DB / store DB” 双语义长期并存。

### Assumptions

- Store DB 是本地单机文件（每个开发机/环境一份），主要服务于个人工作流与本地自动化；不考虑多机共享同一 DB 文件。
- 自动化“任务执行本体”不在本特性范围内：本特性只负责提供可追溯的持久化模型与 schema 基座。

### Key Entities *(include if feature involves data)*

- **Store Database**: 本地持久化的单一事实源，承载写入队列、映射/回执、以及未来自动化相关记录。
- **Queue Transaction**: 一组写入操作的聚合单元，用于追踪、顺序控制与终态归集（属于 `queue_*` 模块）。
- **Queue Operation**: 最小写入执行单元（属于 `queue_*` 模块），可被重试并记录回执与错误。
- **Event**: 插件/系统观测到的触发信号（例如“Rem 被添加某个 Tag”），可用于审计与去重。
- **Trigger**: 将某类事件（如 tag）映射到某个 task 的规则，可启用/禁用并可审计变更。
- **Task**: 可复用的任务定义（描述“要做什么”），由 trigger 命中后实例化为 task run。
- **Task Run**: 某次具体执行实例（pending/in_progress/succeeded/failed），关联 event/trigger/task/target Rem，并在成功时关联 result Rem（写回目标 Rem 的子级）。

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 在默认配置下，系统创建并使用的持久化 DB 文件路径为 `~/.agent-remnote/store.sqlite`，且文档/帮助/诊断不再出现 “queue.sqlite 作为默认 DB” 的表述。
- **SC-002**: 对于已有 legacy `queue.sqlite` 的环境，首次运行后可以获得可用的 `store.sqlite`，并且 legacy 文件保持不变；队列中已有事务/操作/回执等信息可继续被查询与消费（无数据丢失）。
- **SC-003**: Store DB 的 schema 中存在清晰的模块前缀分组（`queue_*` 与自动化相关前缀），且新增模块不会与现有队列表命名冲突。
- **SC-004**: 当 store DB 不可用或版本不匹配时，系统在一次命令执行内 fail-fast，并输出包含 db_path 与 next actions 的可行动诊断信息。
- **SC-005**: 能在 store DB 内表达并查询“事件 → trigger → task run → 目标 Rem → 结果 Rem”的全链路关系，至少覆盖“tag 触发任务并写回目标 Rem 子级”的用例。
