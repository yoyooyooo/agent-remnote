# 调研：031 查询 / Scenario / 命令 taxonomy 归一化

日期：2026-03-22

## 决策 1：`query` 是唯一 universal selector

### Decision

- `query` 作为唯一通用结果集选择器。
- `todo list`、future preset、scenario selector 都编译到同一 selector 内核。

### Rationale

- 当前 `todo list` 与 `powerup/table` 读取把“选集 + 启发式 + 动作前校验”揉在一起。
- 030 已经把 `query` 纳入 Wave 1 business command inventory。

## 决策 1A：`query --powerup <name>` 可以作为 authoring sugar

### Decision

- `query` 可以在 CLI authoring 层支持 `--powerup <name>` 这类便捷输入。
- 但该输入只允许停留在 adapter boundary。
- 进入 canonical Query V2 之前，必须先通过 authoritative metadata path 解析成：
  - `powerup.by=id`
  - 或 `powerup.by=rcrt`

### Rationale

- powerup 名称比普通 tag 文本更接近稳定业务名，适合做 agent-friendly authoring sugar。
- 当前 canonical Query V2 已明确不接受 title / fuzzy / free-text powerup lookup 直接入场。
- 因此最稳的做法是：人类与 agent 可以传名字，runtime 只消费规范化后的 canonical powerup identifier。

## 决策 2：`Query Package` 升级为 graph-shaped `ScenarioPackage`

### Decision

- 不定义 `Query Package`。
- 定义 graph-shaped `ScenarioPackage`，至少包含：
  - `meta`
  - `vars`
  - `nodes`
  - `entry`
  - `outputs`
  - `policy`
  - `capabilities`

### Rationale

- 用户高频场景通常是 `query + action`，而且常常不是单 selector + 单 action。
- 需要一个既能被 agent 直接复用，又能落到 builtin catalog 的正式工件。

## 决策 3：读写之间增加上层中间态，不把读路径塞进 `WritePlanV1`

### Decision

- 保留现有 `apply kind=actions -> WritePlanV1 -> ops`。
- 新增上层中间态：
  - `selector_plan`
  - `selection_sets`
  - `scheduling`
  - `action_plan`
  - `compiled_execution?`

### Rationale

- 030 已明确读路径不强制进入 `WritePlanV1`。
- 若把 selector 直接塞进 `apply`，会破坏执行面边界。

## 决策 4：builtin preset 先做，provider / 插件只留接口

### Decision

- 031 交付 builtin preset catalog。
- external provider / 插件机制只保留接口与来源模型，不实现安装 / 市场。

### Rationale

- schema、catalog、compile pipeline 可以一次定稳。
- 未来插件化只是增加来源，不应改 `ScenarioPackage` 本体。

## 决策 5：schema 表达力优先于表面简化

### Decision

- 031 不以“schema 尽量简单”为目标。
- 031 以“schema 表达力够强、无歧义、可静态校验”为目标。
- 若复杂场景需要更强结构，可以提升到受约束 DAG，而不是退回隐式脚本。

### Rationale

- 对 agent 来说，难点不在字段多少，而在语义是否稳定、是否可校验、是否容易编译。
- 简化到过度扁平，只会把复杂度藏进 skill 或运行时代码里，形成新漂移。

## 决策 6：必须提供 scenario schema tooling 子命令

### Decision

- 031 需要一组正式子命令承担 scenario/package schema 的校验、规范化、解释、脚手架生成。
- 这些子命令应成为 skill 与 agent 的共用工具面。

### Rationale

- 没有正式 tooling，skill 很容易沉淀出隐式规则，与 canonical schema 漂移。
- 有统一子命令，才能形成“创建 -> 校验 -> 解释 -> 执行准备”的闭环。

## 决策 7：031 的 canonical schema 采用受约束 DAG

### Decision

- 031 的 canonical schema 不再停留在平面 `selector + action`。
- 031 的 canonical schema 提升为受约束 DAG。
- 031 明确排除：
  - 循环
  - 任意条件分支
  - 任意代码节点
  - 任意外部副作用节点

### Rationale

- 单纯平面 JSON 无法稳定承载多 selector、汇聚、差集、再动作这类常见高频场景。
- 受约束 DAG 已足以覆盖大量知识库工作流，又不至于膨胀成 n8n 式 workflow runtime。

## 决策 8：正式引用语法必须使用结构化引用节点

### Decision

- canonical contract 禁止使用自由字符串 DSL。
- 正式 contract 不采用：
  - `@selected[*]`
  - `@item.id`
  - `{{var}}`
  - `{{a || b}}`
- 031 应采用结构化引用节点，例如：
  - `var`
  - `coalesce`
  - `node_output`
  - `selected_field`
  - `selected_path`
  - `literal`

### Rationale

- 现有 `WritePlanV1` 只稳定支持 `as` / `@alias`，不适合直接承接更自由的 selector/workflow 引用语法。
- 结构化节点更利于静态校验、类型校验、宿主机 authoritative 编译与 drift 检查。

## 决策 9：必须新增 `ScenarioExecutionPlanV1`

### Decision

- `ScenarioExecutionPlanV1` 是 031 的 P0 中间态。
- 它负责承接：
  - 变量绑定
  - selector 拓扑
  - `selection_sets`
  - transform
  - action graph
  - scheduling hints
  - 编译阶段产物

### Rationale

- 如果没有这一层，复杂度会散入 skill、CLI、runtime，形成新的隐式真相源。
- 现有 `WritePlanV1` 应继续只承担写动作内核，不承担 selector 执行。

## 决策 10：JSON 是 canonical execution format，TS/SDK 只做 optional authoring

### Decision

- canonical execution format 仍然是 JSON。
- TS/SDK 可以作为后续 authoring 层或 escape hatch，但不成为 031 的 canonical 执行输入。

### Rationale

- 直接执行 TS/SDK 会破坏 remote parity、可审计性、可重放性与宿主机信任边界。
- JSON 更适合作为 SSoT、drift 检查与跨端共享 contract。

## 决策 11：schema tooling 挂在 `scenario schema` 命令组下

### Decision

- 不新增独立顶层 `schema` 命令。
- 031 的 tooling 命令面统一挂在：
  - `scenario schema validate`
  - `scenario schema normalize`
  - `scenario schema explain`
  - `scenario schema scaffold`
  - `scenario schema generate`
- 其中 `generate` 只接受结构化 hint，不接受自由文本 prompt。

### Rationale

- `scenario schema` 的心智稳定，后续还能自然承接 `scenario catalog` 与 `scenario run`。
- 若单独做顶层 `schema`，很容易和 query/schema/contract 讨论混在一起，破坏 Agent First 路由。

## 决策 12：验证体系必须扩成四层

### Decision

- 031 的验证矩阵显式覆盖：
  - schema
  - tooling
  - catalog
  - execution/parity

### Rationale

- 031 新增的不是单一对象，而是 schema、tooling、builtin catalog、scenario execution 四类对象。
- 如果验证只盯执行，不盯 tooling 和 catalog，很容易形成新的隐式真相源。

## 决策 13：031 需要显式规划性能与调度

### Decision

- 031 不只定义 schema 与执行模型，还要把 end-to-end 性能优化纳入正式规划。
- 重点关注：
  - 更少命令往返
  - operation batching
  - smart merge
  - lock-aware parallelism

### Rationale

- 当前插件 runtime 已经具备 batch pull 与 lock-aware 执行的基础，但缺少一层更高层的、与 scenario/execution plan 对齐的规划。
- 如果不在 031 中提前考虑，schema 与 execution plan 可能会错失批量化和智能调度的机会。

## 决策 14：需要新增前后端共享子包

### Decision

- 031 需要定义新的共享子包，用于承载前后端共用的 contract、types 与纯逻辑。

建议边界：

- schema types
- structured reference nodes
- `SelectionSet`
- `ScenarioExecutionPlanV1`
- tooling I/O types
- 纯校验 / 纯规范化 / host-independent planning canonicalization

### Rationale

- 前后端共享同一套 contract 是 031 的自然要求。
- 如果没有共享子包，这些逻辑很容易在 CLI、宿主 runtime、插件端、skill tooling 中复制一份，形成 drift。

## 决策 15：`tag` 是 primitive，不是唯一对外 command core

### Decision

- `tag` 作为底层关系原语保留。
- `powerup` 作为 metadata / schema 面保留独立 family。
- `todo` 作为高频任务场景面保留独立 family。

### Rationale

- `tag` 无法独立承载 powerup schema、todo 状态映射、候选列词表等场景语义。

## 决策 16：canonical family 与 alias 的稳定部分

### Decision

- `query`：canonical selector / result-set / preset owner
- `scenario`：canonical package / schema tooling owner；package execution namespace 在 031 内先冻结为 planned namespace
- `powerup`：canonical metadata / schema owner
- `tag`：canonical primitive
- `apply`：canonical low-level structured write owner
- `todo list`：归一化为 `query` preset surface
- `powerup.todo.*`：031 内 current canonical todo write owner
- 顶层 `todo add/done/undone/remove`：031 内 current explicit alias
- current authoritative inventory 中的 `todos.list`：兼容期条目，兼容入口退场时同步退出 inventory
- `apply --scenario <id>`：排除
- `scenario run`：reserved 的 package execution 薄入口，promotion 完成前不进入 current public inventory

### Rationale

- Agent First 路由需要单一 owner。
- package execution 与 raw structured write 不能共用同一个顶层主意图。
- `todo` 与 `powerup.todo.*` 的写侧 canonical owner 会影响全局 inventory，031 先与当前 SSoT 对齐，再为 future flip 预留单独 breaking change 路径。
- `todo list` 的终局应收敛到 `query --preset`，不再保留 standalone inventory replacement。

## 决策 17：`scenario` 子树先冻结为 feature-local planned namespace

### Decision

- `scenario schema`、`scenario catalog`、`scenario run` 在 031 内先冻结 namespace、输入边界与 promotion preconditions。
- 在 authoritative inventory、CLI contract、derived mirror、help/docs drift、remote contract 链条未补齐前，不把它们当作 current public command family。

### Rationale

- 当前仓库的 gate 依赖唯一 authoritative inventory。
- 先冻结 namespace 与 promotion 条件，可以避免 031 规划阶段与现有 public inventory 直接冲突。

## 决策 18：powerup metadata 先冻结 internal capability，再规划 future public route

### Decision

- 031 先把 powerup metadata 冻结为 host-authoritative internal capability。
- current public `powerup list/resolve/schema` 继续遵守 deferred remote contract。
- 只有当 inventory、Host API、CLI、tests 一并升级时，才把 powerup metadata public route promotion 到 current public surface。

### Rationale

- 当前 remote contract 仍要求这些命令 fail-fast。
- 若直接在 031 中把 public route 提前翻转，会与现有 SSoT、tests、code mirror 同时冲突。

## 决策 19：`generate` 必须接受独立的结构化 hint contract

### Decision

- `scenario schema generate` 只接受 `ScenarioGenerateHintV1`。
- 不允许复用宽泛的 `source` / `options` 替代 canonical hint contract。

### Rationale

- 若 hint contract 不独立，skill、CLI、shared package 很容易各自演化出私有 generate 输入语义。

## 决策 20：`scenario schema *` 在 `apiBaseUrl` 存在时仍走本地 tooling

### Decision

- `scenario schema validate|normalize|explain|scaffold|generate` 在配置 `apiBaseUrl` 时继续本地执行。
- 它们不 fail-fast，不转发到 Host API，也不读取 host-bound runtime facts。

### Rationale

- schema tooling 属于 authoring / contract surface。
- remote mode 只切 execution transport，不应把 authoring surface 变成第二套 Host API authoring 系统。

## 决策 21：repo-local remnote skill 要内置常见场景 guidance

### Decision

- 在相关命令、contract、场景 package 实施完成后，再统一更新 `skills/remnote/SKILL.md`。
- guidance 的目标是帮助 agent 围绕 canonical 场景面完成：
  - 生成场景草稿
  - 校验 / normalize
  - explain / 预览
  - 在命令已 promotion 时运行
- skill 中的命令与示例必须区分：
  - current public surface
  - feature-local planned namespace

### Rationale

- 031 的目标本来就包含“让 agent 和 skill 围绕同一份 contract 闭环创建、校验、解释场景包”。
- 但在实现前就改 skill，会提前宣传尚未 promotion 的入口，反而制造错误心智。
- 更稳的路径是：先把 command / contract / package 落稳，再做一次全面的 skill 同步。

## 决策 22：首批 skill-embedded builtin scenario 候选包含 `dn_recent_todos_to_today`

### Decision

- 031 首批内置场景候选至少包含：
  - `dn_recent_todos_to_today`
- 该场景的目标是：
  - 查询最近若干天 DN 中命中 Todo selector 的条目
  - 将结果汇总到今日 DN
- 该场景至少支持两种 delivery mode：
  - `move`
  - `portal`
- repo-local `skills/remnote/SKILL.md` 需要在实施完成后的统一同步阶段沉淀：
  - 场景意图
  - 推荐 vars
  - generate / validate / normalize / explain / run 的命令用法
  - promotion 边界说明

### Rationale

- 这是高频、可复用、又足够代表 `query + action` 组合价值的一类场景。
- `move` 和 `portal` 两种 mode 可以覆盖“直接搬运内容”和“保留原位置、在今日 DN 建投影”两类不同用户意图。
- 先把这个场景写进 skill guidance，有助于后续 agent 在真实用户请求里围绕同一套 canonical package 收口。

## 决策 23：031 与 030 派生结论冲突时的 authority

### Decision

- 当 031 显式记录与 030 派生 taxonomy 或 contract 结论的冲突时，以 031 作为当前迭代 authority。
- 冲突点与迁移影响必须先记录在 031，再同步回全局 SSoT。

### Rationale

- 030 是历史波次，031 是当前归一化波次。
- 若不显式声明 authority 与迁移规则，inventory、docs、tests 会持续漂移。

## 决策 24：031 的仓库基线写成 `master`

### Decision

- 031 文档统一写：repository default branch is `master`。

### Rationale

- 当前本地主线和远端默认分支都指向 `master`。
- 文档继续写 `main` 会制造事实漂移。
