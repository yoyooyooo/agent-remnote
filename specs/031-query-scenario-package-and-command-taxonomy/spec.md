# 功能规格：宿主权威查询、ScenarioPackage 与命令面归一化

**分支**: `[031-query-scenario-package-and-command-taxonomy]`  
**创建时间**: 2026-03-22  
**更新时间**: 2026-03-22  
**状态**: Draft  
**输入**: 用户要求：在 030 之后，把 query / scenario / preset / command taxonomy 当作一个大需求整体规划，建立宿主权威 selector 内核，统一 Todo/PowerUp/Tag 语义，并交付 builtin preset 集合，同时禁止演化成第二套命令体系。

## 背景与动机

030 已经建立了：

- 一份 authoritative inventory
- 一条统一 runtime spine
- 一套 remote-first parity 治理模型

但 030 有意没有把下面几件事一次做完：

- 超出当前轻量 AST 的查询语义
- `powerup` 元数据的宿主权威化
- `todo list` 作为通用 selector preset 的归宿
- `query + action` 组合成的高频可复用场景
- `tag / powerup / todo / query / apply` 的统一命令分层

当前用户要求比 030 更进一步：

- 不再把这些点零碎推进
- 直接把 selector、scenario、preset、command taxonomy 一次想清楚
- remote mode 仍然只能是执行面切换
- 内置 preset 集合现在就要纳入设计
- 未来 provider / 插件机制只保留接口位
- schema 不需要为了简化而牺牲表达力，只要表达强、无歧义、可校验即可
- 仓库需要提供 command-level schema tooling，让 agent 和 skill 可以围绕同一条命令闭环地创建、校验、生成和解释场景包

因此 031 被定义为 **030 之后的归一化波次**：

- 一个宿主权威查询内核
- 一个 canonical `ScenarioPackage` 模型
- 一个 `ScenarioExecutionPlanV1` 中间执行态
- 一个 builtin preset catalog
- 一套稳定的命令面分层

## 范围

### In Scope

- 定义 Query Kernel V2，作为 RemNote 业务读取的 canonical selector 模型
- 把 `query` 升级为唯一 universal result-set selector surface
- 定义 `ScenarioPackage`，统一承载 selector、action、vars、policy
- 定义 `ScenarioExecutionPlanV1`，统一承接 DAG、`SelectionSet` / `selection_sets` registry 与 action 编译中间态
- 定义 builtin preset 集合及其来源/所有权语义
- 定义 scenario/package schema tooling 的命令面与闭环
- 把 powerup metadata 升级为 local / remote 一致的宿主权威能力
- 重新归一化 `todo`、`powerup`、`tag`、`query`、`apply` 的职责
- 定义 selector 执行如何衔接 action 编译，同时保持 remote mode 不变成第二套命令体系
- 定义从现有 `todo list`、`powerup resolve/schema`、本地 DB 启发式迁移到新模型的策略
- 定义 end-to-end 性能方向，包括更少命令往返、operation batching、smart merge、lock-aware parallelism
- 定义前后端共享 contract/plan/types 的子包边界
- 定义 selector parity、scenario parity、docs drift、taxonomy drift 的验证要求

### Out Of Scope

- preset marketplace / package registry
- 第三方 preset 发现与安装
- 外部 preset provider 的签名 / 信任 / 沙箱策略
- GUI preset 管理面
- 在本 feature 中重写所有历史 spec 以对齐新 taxonomy
- 直接在 031 中交付任意代码执行式 workflow runtime

## 假设与依赖

- 仓库默认主线分支是 `master`
- `apiBaseUrl` 仍然是唯一 remote mode 开关
- Host API 仍然是统一远端执行面
- forward-only evolution 仍然生效
- 写路径继续走 `apply envelope -> actions -> WritePlanV1 -> ops`
- 读路径可以新增 selector / runtime 层，但不强制进入 `WritePlanV1`
- builtin preset 与 repo 外的 user-private scenario 资产可以并存，但 builtin 语义必须受仓库治理

## 问题定义

当前仓库还有三类结构性缺口：

1. **Selector Gap**
   - 当前 `query` 只支持很窄的一套 AST，无法表达 `powerup`、`scope`、`roots-only`、`ids`、`reference`、ancestor/descendant 等常见 selector 语义
2. **Scenario Gap**
   - 高频用户流本质上经常是 `query + action`，但仓库还没有一个 durable artifact 来表达整条路径
3. **Taxonomy Gap**
   - `tag`、`powerup`、`todo` 当前暴露出的心智模型彼此重叠，削弱了 Agent First 路由，也让 remote parity 规划更难收口
4. **Authoring Gap**
   - 当前仓库缺少一条正式的 schema tooling 命令面，无法让 agent、skill、用户围绕同一份 contract 做创建、校验、解释、生成
5. **Execution Gap**
   - 当前仓库还没有一层正式的 scenario execution 中间态，来承接多 selector、selection 汇聚、action graph 与最终写计划的衔接
6. **Performance Gap**
   - 从 Agent 到 queue 到 plugin 的链路还没有把“少调用链路、高表达力、批量化、智能合并、锁感知并行”作为正式设计目标
7. **Shared Contract Gap**
   - 前后端与 skill 将共享同一套 schema、plan、tooling 输出，但仓库还没有一块明确的共享子包来承载这些契约与类型

## 目标

- 一个 universal selector kernel
- 一个 canonical scenario package schema
- 一个 builtin preset catalog
- 一套清晰、稳定、带 canonical family 与 alias 的命令 taxonomy
- 一个可在 local / remote 下保持一致的宿主权威 metadata/query 模型
- 一条可供 skill 与 agent 复用的 schema tooling 闭环
- 一套受约束 DAG 的 canonical 场景执行模型
- 一套明确的性能优化方向，覆盖 command surface、queue 调度、plugin 消费
- 一个明确的共享子包边界，用于前后端共用 contract、plan 类型与纯编译逻辑

## 用户场景与测试

### 用户故事 1：`query` 成为唯一 universal selector（优先级：P1）

作为一个 agent，我希望只有一套 selector surface 就能表达常见 RemNote 结果集语义，这样我不需要为 todo、powerup、或特定场景读取分别学习不同查询内核。

**独立验收**：当 `query` 可以表达 powerup、tag、slot/attribute、reference、scope、ancestor/descendant、roots-only、ids，并且在 local / remote 下语义一致时，本故事成立。

**验收场景**：

1. **Given** 一个同时要求 `powerup + status + daily:last-7d + roots-only` 的 selector  
   **When** 调用方分别在 local 与 remote mode 执行  
   **Then** 两条路径返回同一语义结果集
2. **Given** 一个使用 ids、ancestor/descendant scope 或 reference predicate 的 selector  
   **When** 调用方在任一模式执行  
   **Then** selector contract 保持一致

---

### 用户故事 2：`ScenarioPackage` 表达高频场景 DAG（优先级：P1）

作为一个 agent，我希望存在一个 durable 的场景工件，可以用受约束 DAG 表达 selector、transform、action、vars 与 policy，这样高频工作流可以复用，同时不会发明第二套命令体系。

**独立验收**：当一份 `ScenarioPackage` 可以被验证、绑定变量、执行 selector，并把 action 路径编译到既有 business command / apply 语义，而且 local / remote 下行为一致时，本故事成立。

**验收场景**：

1. **Given** 一个“筛出最近 DN 的 Todo，并把它们 append 或 portal 到今天”的 scenario
   **When** agent 在 local 和 remote 下运行
   **Then** 两条路径都保持同一业务语义
2. **Given** 一个包含用户输入 ref、scope、limit 的 scenario
   **When** 变量被注入
   **Then** 解析后的 scenario 仍然 machine-valid 且可执行

3. **Given** 一个包含多个 selector、selection 汇聚与后续 bulk action 的场景
   **When** 系统将 `ScenarioPackage` 编译为执行计划
   **Then** 结果必须保持为受约束 DAG，不引入循环、任意表达式或任意代码执行

---

### 用户故事 3：builtin preset 集合存在，但不演化成插件系统（优先级：P1）

作为维护者，我希望 builtin preset 现在就存在，同时对未来 provider 扩展只保留接口，这样仓库可以先交付可用的场景资产，又不必现在就承担市场机制。

**独立验收**：当 builtin preset 的所有权、catalog 格式、校验规则都明确，而 external provider 机制只保留接口并明确超出范围时，本故事成立。

**验收场景**：

1. **Given** 一条 builtin preset entry  
   **When** 维护者审核它  
   **Then** 它的 schema、owner、vars、action capability 都是显式的
2. **Given** 未来需要 provider / 插件扩展  
   **When** 回看 031 设计  
   **Then** 仓库已经为接口预留位置，但没有声称当前支持安装/发现
3. **Given** repo-local skill 内置了一条“最近若干天 DN 中的 Todo 汇总到今日 DN”的场景
   **When** 维护者审核它
   **Then** 场景 id、vars、两种 delivery mode、对应命令使用方式与 promotion 标注都是显式的

---

### 用户故事 4：命令 taxonomy 变成 Agent First（优先级：P1）

作为一个 agent，我希望 `query`、`todo`、`powerup`、`tag`、`scenario`、`apply` 的职责互不重叠，这样自然语言路由更稳定，高频工作流也能更自然地一步闭合。

**独立验收**：当 canonical family 与 alias 都是显式的，并且命令树不再让多个控制面竞争同一心智模型时，本故事成立。

**验收场景**：

1. **Given** 一个 task-like workflow  
   **When** agent 判断该用 `todo`、`query` 还是 `scenario`  
   **Then** 应存在一个明显的 canonical 路由
2. **Given** 一个低层关系编辑  
   **When** agent 判断该用 `tag` 还是 `powerup`  
   **Then** 应能明确区分 relation primitive 与 metadata 层

---

### 用户故事 5：Scenario Schema Tooling 形成创建闭环（优先级：P1）

作为一个 agent 或 skill，我希望存在一组正式子命令，负责 scenario/package schema 的校验、规范化、预览与生成，这样用户可以在同一条命令链上完成“想法 -> schema -> 校验 -> 解释 -> 执行准备”。

**独立验收**：当 agent 可以调用统一子命令完成 schema validate、normalize、explain、scaffold 或 generate，并把结果继续交给 skill/文档/执行面时，本故事成立。

**验收场景**：

1. **Given** 一份不完整或有歧义的 `ScenarioPackage` 草稿  
   **When** agent 调用 schema tooling  
   **Then** 系统返回稳定的校验错误、hint 与可继续修改的输出
2. **Given** 用户只提供自然语言场景描述  
   **When** agent 借助 schema tooling 生成草稿  
   **Then** 结果仍然落在 canonical schema 中，而不是变成第二套隐式 DSL

---

### 用户故事 6：Agent 到插件消费链路尽可能短且快（优先级：P1）

作为一个 agent，我希望用尽可能少的调用链路表达尽可能多的事情，同时让前端插件尽量批量化、智能合并、并行消费兼容操作，这样从命令到最终写入的路径更短、吞吐更高。

**独立验收**：当系统能用更少的命令轮次表达复杂场景，并且对可合并、可并行的操作给出明确的 batching/merge/lock-aware 规划时，本故事成立。

**安全原则**：在这个故事里，优化必须服从确定性、可审计性与宿主边界。若某项优化无法被证明安全，031 必须选择保守路径，允许错过优化，不允许用不可控行为换吞吐。

**验收场景**：

1. **Given** 一个多 selector 汇聚后的批量动作场景
   **When** agent 执行它
   **Then** 不应要求用户手写多轮命令往返才能闭合
2. **Given** 一批相互独立的操作
   **When** 插件消费队列
   **Then** 应允许在锁安全前提下并行处理，而不是机械串行

---

### 用户故事 7：前后端共享同一套契约与纯逻辑（优先级：P1）

作为维护者，我希望前端插件、后端运行时、CLI tooling 与 skill 共享同一套 contract 与纯编译逻辑，这样可以减少重复实现和漂移。

**独立验收**：当仓库明确新增一个共享子包，用于承载 schema、execution plan、`SelectionSet`、tooling 输出类型及纯编译/校验逻辑时，本故事成立。

**验收场景**：

1. **Given** 一个 schema 或 execution plan 结构变更
   **When** 前后端同时消费它
   **Then** 应有同一份共享类型与 contract 可复用
2. **Given** 一个纯校验或规范化逻辑
   **When** CLI tooling 与宿主 runtime 都需要它
   **Then** 应优先复用共享子包，而不是各自复制实现

## 功能性需求

### FR1：Query Kernel V2

1. 仓库必须定义 Query Kernel V2 作为 canonical selector 模型。
2. Query Kernel V2 至少必须支持：
   - tag
   - powerup
   - slot / attribute predicate
   - select / multi_select / date / text / number predicate
   - reference predicate
   - ids predicate
   - ancestor / descendant scope
   - daily-range scope
   - roots-only
   - typed sort strategy
3. `query` 必须继续保持为唯一 universal result-set selector command surface。
4. 031 必须冻结 Query V2 的最小 canonical 输入边界，至少明确：
   - `version=2`
   - runtime-ready `scope.kind`
   - `powerup.by`
   - `/v1/read/query` 的 canonical body
5. 旧的 `{ query: { root } }`、`queryObj`、`{ root }` 只允许停留在 adapter boundary，进入 parity、shared contract、selector execution 前必须 normalize 到 canonical Query V2。
6. 若 `query` 命令引入 `--powerup <name>` 这类 authoring sugar，它只能作为 adapter 输入存在，必须先通过 authoritative metadata path 解析为 canonical `id | rcrt`，再进入 Query V2。

### FR2：ScenarioPackage

1. 仓库必须定义一份 canonical `ScenarioPackage` schema。
2. 一份 `ScenarioPackage` 至少必须包含：
   - `meta`
   - `vars`
   - `nodes`
   - `entry`
   - `outputs`
   - `policy`
   - `capabilities`
3. `selector` 与 `action` 必须作为 canonical node kind 出现在 `nodes` DAG 中，而不是并列于 DAG 的第二套顶层结构。
4. Scenario execution 必须可以编译到现有 business command 或 `apply kind=actions` 语义。
5. Scenario execution 不得引入第二套命令体系。
6. `ScenarioPackage` schema 允许复杂，但必须保持强表达力、无歧义、可静态校验。
7. `ScenarioPackage` 的 canonical 形态必须支持受约束 DAG，而不是只支持单 selector + 单 action。
8. `ScenarioPackage` 的正式引用语法必须采用结构化引用节点，不得采用自由字符串 DSL 作为 canonical contract。

### FR3：Builtin Preset Catalog

1. 仓库必须定义 builtin preset catalog 的结构与所有权语义。
2. Builtin preset 必须可 drift-check、可文档化。
3. User-private scenario 资产可以留在 repo SSoT 之外，但 builtin preset 必须受仓库治理。
4. Builtin preset catalog entry 至少必须显式暴露：
   - owner
   - vars 摘要
   - action capability 摘要
   - remote parity 风险标记
   - canonical package 追溯信息
5. 031 至少要规划一条首批内置场景：
   - `dn_recent_todos_to_today`
   - 支持 `move` 与 `portal` 两种 delivery mode
   - 该场景必须可通过 builtin catalog 发现，并可通过显式 install helper 注入到 `~/.agent-remnote/scenarios/*.json`
6. user-private scenario 资产的默认存放路径可冻结为 `~/.agent-remnote/scenarios/*.json`，但 repo 内 canonical package 仍然是 builtin 的唯一权威源

### FR4：Powerup Metadata Parity

1. 031 必须把 powerup metadata 先冻结为 host-authoritative internal capability，供 query、scenario、runtime 共享。
2. `--powerup` 语义必须通过同一条 authoritative metadata path 解释，不能在 local / remote 各自启发式求值。
3. 当前 public `powerup list`、`powerup resolve`、`powerup schema` 的 remote 行为仍遵守 deferred contract，直到 inventory、Host API、CLI、tests 同步 promotion 完成。
4. 031 必须写清 internal capability 与 future public business route 的分层，避免两套 metadata 真相源并存。
5. 若 `query --powerup <name>` 存在，本质上属于 metadata-assisted authoring sugar，不得绕开 authoritative metadata path，也不得把名字直接写进 canonical Query V2。

### FR5：Command Taxonomy

1. 仓库必须为下列 family 明确定义 canonical surface 与 alias：
   - `query`
   - `scenario`
   - `todo`
   - `powerup`
   - `tag`
   - `apply`
2. 031 内 current todo 写侧 canonical owner 冻结为 `powerup.todo.*`，顶层 `todo add/done/undone/remove` 继续作为显式 alias。
3. `todo list` 必须被视为 `query` 上的 preset，而不是永久保留独立查询内核。
4. `todo list -> query --preset` 必须写清参数映射、alias 生命周期与 remote parity 切换条件。
5. `scenario` 子树进入 current public inventory 前，必须满足 authoritative inventory、CLI contract、derived mirror、help/docs drift、remote contract 的 promotion preconditions。
6. 任何 taxonomy 调整都必须显式写清 alias 策略和迁移规则。

### FR6：Scenario Schema Tooling

1. 仓库必须定义一组 scenario/package schema tooling 子命令。
2. 这组子命令至少必须覆盖：
   - validate
   - normalize
   - explain
   - scaffold
   - generate
3. 这组子命令必须消费 canonical schema，而不是私有内部形态。
4. 这组子命令必须可被 skill 与 agent 直接复用，形成“创建 -> 校验 -> 解释 -> 沉淀”的闭环。
5. `generate` 若在 031 中保留，只能接受 `ScenarioGenerateHintV1` 这类结构化 hint contract，不得直接把自然语言当作 canonical 命令输入。
6. `validate` 与 `normalize` 的职责必须分离：`validate` 负责校验和诊断，`normalize` 负责 canonicalization 结果。
7. `scenario schema *` 在配置 `apiBaseUrl` 时仍然走本地 shared tooling，不转发到 Host API，也不读取 host-bound runtime facts。
8. tooling 命令组必须挂在统一的 `scenario schema` 命令面下，而不是新增独立顶层 `schema` 命令。
9. schema tooling 输出 envelope 必须稳定，并与 data model / shared contract 对齐。
10. repo-local `skills/remnote/SKILL.md` 必须在相关实现完成后统一补充一组常见场景的 authoring / user-store guidance，指导 agent 围绕 canonical 场景面完成：
   - 场景草稿生成
   - schema 校验与规范化
   - explain / 预览
   - user-private store 路径与 builtin install helper
   - 条件满足时的运行入口
11. skill guidance 必须作为 post-implementation sync 统一收口，与 current public inventory / planned namespace 保持一致，不得提前把未 promotion 的入口描述成 current public command。

### FR7：Scenario Execution Model

1. 仓库必须定义 `ScenarioExecutionPlanV1` 作为 `ScenarioPackage` 到执行面的中间层。
2. `ScenarioExecutionPlanV1` 必须显式表达：
   - selector 节点
   - `selection_sets`
   - transform 节点
   - action graph
   - scheduling hints
   - 编译阶段产物
3. `SelectionSet` 必须成为一等模型，并保持无副作用、可序列化、可重放。
4. `WritePlanV1` 继续只承担写动作编译，不直接承担 selector 执行。
5. 031 必须冻结 `planned / resolved / compiled` 三个 phase 的最小不变量。
6. `compiled_execution` 的 canonical union 只允许：
   - `business_command`
   - `apply_actions`
7. shared contract 只允许构造 package normalization 与 `phase=planned` 的 host-independent planning canonicalization，不得构造 `resolved` 或 `compiled` 事实对象。

### FR8：Performance And Scheduling

1. 031 必须把“少调用链路表达强场景”定义为正式设计目标。
2. 031 必须明确 operation batching、smart merge、lock-aware parallelism 的适用范围与非适用范围。
3. 031 必须明确哪些操作需要保守串行，哪些操作可以在锁安全前提下并行。
4. 031 的 schema / execution plan 必须能够表达可批量、可合并、可并行的动作机会，而不把优化逻辑完全藏进运行时。
5. 031 只冻结声明式 scheduling hints，不冻结具体批大小、租约时长、锁键推导、回退重试与 worker 选主策略。
6. 031 必须把并行半径明确限制在当前架构可验证的范围内。当前 baseline 只承诺单 active worker 内部、受 lock model 约束的并发。
7. 031 必须定义 server conflict class 与 plugin lock class 的一致性 gate。
8. 031 的 performance claim 必须带 benchmark gate 或等价量化门槛，不能只停留在 smoke 描述。
9. 对 batching、merge、parallelism 的任何优化，若安全性、等价性、顺序语义或宿主边界无法被证明，必须回退到保守实现；031 明确允许错过优化，不允许错做优化。

### FR9：Shared Subpackage

1. 031 必须定义一个新的共享子包边界，用于前后端共用：
   - schema types
   - structured reference nodes
   - `SelectionSet`
   - `ScenarioExecutionPlanV1`
   - schema tooling I/O types
   - 纯校验 / 纯规范化 / host-independent planning canonicalization
2. 该共享子包不得直接依赖宿主机专有运行时或插件 SDK。
3. 宿主机 authoritative 逻辑仍留在宿主运行时，不下沉到共享子包。
4. `scenario schema` 这类 authoring / contract tooling 必须优先复用共享子包，不应为 remote mode 再发明一套 Host API authoring surface。
5. shared subpackage 不得构造 `SelectionSet` materialization、action lowering、`compiled_execution`、local/remote adapter 选择或 Effect runtime wiring。

## 非功能需求

- 任何被标记为 `business` 或 `business_deferred` 的命令，local / remote parity 仍然是硬约束
- `apiBaseUrl` 的语义必须继续保持为 transport switch only
- builtin preset 必须是确定性的、可版本化的、可审计的
- selector/action compilation 必须可诊断、可 drift-test
- schema tooling 输出必须稳定、机器可消费、可用于 drift 与 lint
- TS/SDK 若作为 authoring 层存在，也不得成为 canonical execution format
- 前后端共用 contract/plan/types 时，必须优先复用共享子包，避免复制实现
- 性能优化不得通过牺牲 remote parity、审计性和宿主边界来换取
- 性能优化遵循 safe-by-default：证据不足时默认保守，不把“可能正确”当成可发布优化
- feature-local planned namespace 在 promotion preconditions 完成前，不得被当成 current public inventory 或 parity gate 对象

## 成功标准

- 存在一套 spec-backed selector 模型，可在 todo / powerup 等场景间复用
- 存在一套 canonical scenario schema，可表达 end-to-end flow
- builtin preset catalog 的结构与来源规则明确
- 031 给出了 `query/todo/powerup/tag/scenario/apply` 的稳定 taxonomy contract，并写清 current owner、alias、promotion preconditions
- 已定义 selector parity、scenario parity、docs drift、taxonomy drift 的验证要求
- 已定义 scenario schema tooling 的命令面、校验输出和 skill 闭环
- 已定义 `skills/remnote/SKILL.md` 在实施完成后需要统一补充的内置场景与命令使用方式
- 已定义 `ScenarioPackage -> ScenarioExecutionPlanV1 -> WritePlanV1` 的分层关系
- 已定义 Query V2 canonical body、adapter boundary、powerup metadata internal/public split
- 已定义性能与调度优化方向、冲突模型一致性约束与 benchmark gate
- 已定义共享子包边界，并把 planning canonicalization 与 runtime lowering 分开
