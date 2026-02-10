# 特性规格：CLI 命令归属重构（read/write 一致性 + 实体子命令 + ops 降级为 advanced）

**特性分支**: `[016-cli-entity-surface]`  
**创建日期**: 2026-01-26  
**状态**: Draft  
**输入**: 用户描述：“Agent（安全/一致性）优先：不希望 Agent 默认走 `write advanced ops`（原 `write ops`）这种底层命令；希望按明确边界与概念实体重新归类 CLI，并提供可直接使用的 Portal/Rem/Tag/Table 高层语义命令。”

全局概念与术语裁决见：`specs/CONCEPTS.md`（Control/Data/UX planes、write-first、queue/WS/插件执行链路、幂等与回执）。

## 背景与动机

当前 CLI 入口同时存在：

- 顶层按“领域/实体”拆分（`daily/topic/todos/wechat/db/...`）
- 写入语义入口（`write md/bullet/tag/table/...`）
- 以及底层 raw 入队（`write advanced ops`）

这会导致 Agent 在“同一意图”下有多条可行路径，容易选到：

1) **更底层但更脆弱**的路径（手写 ops payload，或者用错误的富文本 token 伪造 Portal）；  
2) **读写边界不清**的路径（读写命令散落，容易误用）；  
3) **诊断/默认策略不一致**的路径（notify/ensure-daemon/wait 行为分散）。

本 spec 的目标是：把“副作用边界”作为一级归属，确保 Agent 的默认选择稳定、短链路、低歧义。

## Scope

### In Scope

- 定义并实现 **canonical CLI tree**：一级按副作用边界与系统域拆分：
  - `read` / `write` / `daemon` / `queue` / `config` / `doctor`
- 把“概念实体”作为二级子命令，形成稳定映射：
  - `write rem ...` / `write portal ...` / `write table ...` / `write tag ...`
  - `read rem ...` / `read portal ...` / `read ui-context ...` / `read selection ...`
  - `read powerup list`：列出本地 DB 中的 Powerup/内置类型入口（用于 discoverability；只读）
- Portal 与 Rem 相关高层写入命令（避免 Agent 走 `write advanced ops`）：
  - `write portal create`（`parent + targetRemId -> portalRemId`）
  - `write portal include/exclude`（`targetRemId + portalRemId`）
  - `write rem create/move/text/delete`（与现有 op 语义对齐）
- Tag/Table 子集（补齐“实体视角”与“载体视角”，但保持 Agent 的默认推荐路径唯一）：
  - Tag 关系写入（Tag 视角 + Rem 视角）
    - `write tag add/remove`：以 Tag 视角表达“给某个 Rem 增删某个 Tag”（底层为 `add_tag/remove_tag`）
    - `write rem tag add/remove`：以 Rem 视角表达同一件事（语义等价；底层仍为 `add_tag/remove_tag`）
    - 裁决：两条命令都存在，但必须共享同一套参数/默认值/输出契约；文档明确 Agent 只推荐其中一条 canonical 路径（避免高熵）。
  - Table（Table = Tag）写入（Table 视角）
    - `write table create`：创建 Table（底层为 `create_table`），避免 Agent 为“建表”退回 `write advanced ops`
    - 现有语义入口保持：`write table property ...` / `write table option ...` / `write table record add/update/delete`
    - 读侧：`read table`（只读 DB 工具）用于 values 编译/校验与可诊断性（不得变成 write 前置必需步骤）
- 明确 `write advanced ops` 的定位：作为 advanced/debug 入口，并在文档/skill 中标注为“调试/逃生舱”，非默认推荐。
- 文档同步（SSoT + README）：
  - 更新 `docs/ssot/agent-remnote/cli-contract.md`（命令树与全局选项位置规则如需补充）
  - 更新 `docs/ssot/agent-remnote/tools-write.md`（若新增/调整语义入口）
  - 更新仓库 `README.md` 与 `README.zh-CN.md`（按仓库约定：命令变更必须同步）

## Canonical CLI Tree（裁决，最终）

> 一级按副作用边界与系统域拆分；旧顶层 `daily/db/todos/topic/wechat/replace` 已移除（forward-only）。

- `doctor`
- `config`
  - `config print`
- `daemon`
  - `daemon health`
  - `daemon serve`
  - `daemon start/stop/restart/ensure/status/logs/sync`
- `queue`
  - `queue stats/conflicts/inspect/progress/wait`
- `ops`
  - `ops list`
  - `ops schema`
- `read`
  - `read db backups/recent`
  - `read daily summary`
  - `read todos list`
  - `read topic summary`
  - `read powerup list`
  - `read ui-context snapshot/page/focused-rem/describe`
  - `read selection snapshot/roots/outline`
  - `read search/search-plugin/query`
  - `read page-id/outline/inspect/resolve-ref/connections/references/by-reference/table`
- `write`
  - `write md/bullet/daily/plan`
  - `write rem create/move/text/delete`
  - `write portal create`
  - `write tag add/remove`（canonical）
  - `write rem tag add/remove`（dual surface）
  - `write table create/property/option/record`
  - `write replace block/text`
  - `write wechat outline`
  - `write advanced ops`（debug/escape hatch）

### Out of Scope（v1）

- 引入新的底层写入能力（新增 op 类型）——除非为满足高层命令必须。
- 为旧命令提供长期兼容层（forward-only：允许 breaking，但必须 fail-fast + 可诊断）。

## 依赖

- **011-write-command-unification（Accepted）**：write-first 与 `write advanced ops` 收口、`--wait` 与诊断契约是本 spec 的基线；本 spec 在其基础上提供“更高层语义入口”，降低 Agent 直接用 ops 的概率。
- **012-batch-write-plan（Accepted）**：当存在跨步骤依赖时，高层命令可编译为 `write plan`（或复用其能力）以保证原子性与可诊断性。
- **013-multi-client-execution-safety（Accepted）**：多客户端切换与回执一致性基线，避免高层命令在重试/断线时放大副作用。

## 用户场景与测试（必填）

### 用户故事 1：Agent 默认不使用 `write advanced ops`（P0）

作为 AI Agent，我在表达“创建 Portal/创建 Rem/移动 Rem/改文本”时，有清晰且稳定的高层命令入口；`write advanced ops` 仅在 debug/兜底时使用。

**Independent Test**：为 `write portal create` 与 `write rem text/delete` 添加 contract tests，覆盖：

- `--json` 输出纯净（stdout 单行 envelope，stderr 为空）
- `--wait` 可闭环确认 txn 终态
- 参数校验 fail-fast（缺 parent/缺 target 时 exit code=2）

### 用户故事 2：命令归属低歧义（P0）

作为维护者，我希望命令树能直接反映副作用边界：读命令都在 `read` 下，写命令都在 `write` 下；系统域操作在 `daemon/queue/config/doctor` 下。

**Independent Test**：help contract 固化顶层命令集合与关键子命令（避免回归/漂移）。

### 用户故事 3：Portal 概念不再混淆（P1）

作为用户，我希望系统明确区分 “Portal（RemType.PORTAL=6 的容器）” 与 “Reference（((id)) 的引用 token）”，避免错误写入导致空 Rem 或错误链接。

**Independent Test**：在文档与 `$remnote` skill 中给出最短示例，并用本地只读 DB 验证 Portal 的 `doc.type=6` + `doc.pd` 结构（测试可放 integration/guides）。

### 用户故事 4：Tag 的双视角语义入口（P0）

作为 AI Agent，我既可以用 Tag 视角（`write tag ...`）也可以用 Rem 视角（`write rem tag ...`）表达“给某个 Rem 加/去 Tag”；但系统对 Agent 有唯一推荐的 canonical 路径，避免在同一意图下产生多条默认可行路径。

**Independent Test**：

- `write tag add/remove` 与 `write rem tag add/remove` 在 `--json` 输出、默认 notify/ensure-daemon、以及 `--wait` 行为上完全一致（同一类错误码/nextActions）。
- `--rem/--tag`（或等价参数）支持直接输入 `remnote://w/<kbId>/<remId>`（只取 remId），避免 Agent 误把 deep link 当纯文本。

### 用户故事 5：Table 子集不需要回退到 ops（P0）

作为 AI Agent，我可以在不手写 ops 的前提下完成 Table 的常见写入：建表、加列/改列类型、管理选项、增删改记录与单元格；对 record update，系统能在必要时做“行归属校验”与 values 编译，但不会要求 write 前强制 inspect。

**Independent Test**：

- `write table create` 以一次调用闭环（支持 `--wait`），成功时回显可定位的 `table_tag_id`/`rem_id`（或等价字段）。
- `write table record update` 在 `--values` 存在时对齐既有策略：values 必须是数组；propertyName 歧义 fail-fast；select optionName 歧义提示改用 optionId(s)。

## 需求（必须）

### 功能需求（FR）

- **FR-001**：CLI MUST 以 `read/write` 为主要用户入口，且所有“写入副作用”命令必须归属在 `write` 之下。
- **FR-002**：系统 MUST 为 Portal 提供高层写入命令，语义严格对应 RemNote SDK：`createPortal` + `moveRems` + `addToPortal`（不得用富文本 token 伪造）。
- **FR-003**：`write advanced ops` MUST 被降级为 advanced/调试入口；文档与 skill MUST 明确其非默认推荐定位。
- **FR-004**：所有新增高层写入命令 MUST 继承 011 的输出/诊断契约（`--json` 纯净、稳定错误码、`--wait` 闭环、nextActions 英文可执行）。
- **FR-005**：系统 MUST 为 Tag/Table 提供高层语义入口，覆盖常见写入且不需要回退到 `write advanced ops`（至少：Tag add/remove；Table create + property/option/record）。
- **FR-006**：当同一能力提供“双视角入口”（例如 Tag 的 Tag 视角与 Rem 视角）时，系统 MUST 明确一个 canonical 推荐路径供 Agent 选择；其它入口必须是语义等价、参数一致、输出一致的薄壳，避免默认路径高熵。
- **FR-007**：forward-only：当命令树裁决改变后，旧入口不得长期保留造成歧义；若短期保留 alias，必须是“不可误导 Agent 的薄壳”，并在下一次版本演进中移除。

### 非功能需求（NFR）

- **NFR-001**：命令选择应“低熵”：对同一意图，应存在唯一推荐路径；若为了视角差异保留多入口，必须在文档中标注 canonical，并确保非 canonical 入口不引入额外默认分叉。
- **NFR-002**：命令命名应可组合且一致（实体+动作），并在 `ops schema` 里可溯源到底层 op 类型（便于排障）。

## 成功标准（必填）

- **SC-001**：Portal/Rem/Tag/Table 的常见写入不再需要 `write advanced ops`；Agent 可稳定选择 `write portal ...` / `write rem ...` / `write tag ...` / `write table ...` 完成工作。
- **SC-002**：命令树满足“读写边界清晰”：读写不会混在同一层级，且 help/文档/skill 不漂移。
- **SC-003**：关键新命令具备 contract tests 基线（至少 portal create + rem text/delete + table create + tag 双视角一致性）。
