# 计划：查询 / Scenario / 命令 taxonomy 归一化

> 目标：在 030 之后，建立一套宿主权威 selector 内核、一套 canonical ScenarioPackage 模型、一套 builtin preset catalog，以及一套 Agent First 的命令 taxonomy。

日期：2026-03-22  
Spec：`specs/031-query-scenario-package-and-command-taxonomy/spec.md`

## 摘要

031 不是“再补几条命令”，而是一次把三层统一收口：

- selector 内核
- ScenarioPackage 工件
- command taxonomy

执行面继续继承 030 的硬约束：

- `apiBaseUrl` 只切 transport
- Host API 是统一远端执行面
- 写路径继续走 `apply envelope -> actions -> WritePlanV1 -> ops`

031 新增的核心是：

- 把 `query` 升级为唯一 universal selector
- 先冻结 Query V2 canonical body、adapter boundary、powerup metadata authoritative path
- 把 `ScenarioPackage` 定义为 graph-shaped canonical package，统一承载 selector / transform / action nodes、vars、policy
- 把 `ScenarioPackage` 扩展为受约束 DAG
- 增加 `ScenarioExecutionPlanV1` 作为统一中间态
- 把 builtin preset catalog 纳入仓库正式交付
- 把 schema tooling 子命令纳入正式设计，让 agent 和 skill 能围绕同一份 contract 形成闭环
- 把常见场景的 skill guidance 留到实施完成后的统一同步阶段
- 把 `scenario` 子树先冻结为 feature-local planned namespace，并把 public promotion 条件写清
- 把 powerup metadata 先收口为 host-internal authoritative capability，再为 future public route 预留升级位
- 把性能目标正式化，覆盖少往返、批处理、智能合并、锁感知并行
- 定义新的共享子包，承接前后端共用 contract 与纯逻辑

## 工作带

### 工作带 A：Query Kernel V2

目标：

- 定义 Query AST / DSL V2
- 扩展 `query` 参数面
- 明确哪些 `query` flags 只是 authoring sugar
- 明确 selector 与 result-set contract

输出：

- `contracts/query-ast-v2.md`
- selector runtime / Host API contract 设计

### 工作带 B：Powerup Metadata Runtime + Host API

目标：

- 先冻结 powerup metadata 的 host-authoritative internal capability
- 写清 `powerup list/resolve/schema` 的 deferred public route promotion 条件
- 把 `--powerup` 语义变成 local / remote 共享同一解释路径

输出：

- `contracts/host-api-query-surface.md`
- metadata parity 设计

### 工作带 C：ScenarioPackage Schema + Compiler

目标：

- 定义 `ScenarioPackage`
- 定义受约束 DAG
- 定义结构化引用节点
- 定义 `selector -> SelectionSet -> action -> apply` 编译模型

输出：

- `contracts/scenario-package-schema.md`
- `contracts/scenario-execution-plan.md`
- `contracts/selector-action-compilation.md`
- `contracts/performance-and-scheduling.md`

### 工作带 D：Builtin Preset Catalog

目标：

- 定义仓库内置 preset 集合
- 区分 builtin 与 user-private sources
- 为未来 provider / 插件机制预留接口
- 规划首批可显式注入用户目录的 builtin scenarios

输出：

- `contracts/builtin-preset-catalog.md`
- builtin scenario candidates

### 工作带 E：Command Surface Normalization

目标：

- 重审 `query / scenario / todo / powerup / tag / apply`
- 定义 canonical family、current owner、alias 与 promotion preconditions
- 对齐 help、docs、routing 规则

输出：

- `contracts/command-tree-normalization.md`
- taxonomy migration rules

### 工作带 F：Scenario Schema Tooling

目标：

- 定义 scenario/package schema 的命令面
- 明确 validate、normalize、explain、scaffold/generate 的职责
- 让 skill 与 agent 能借统一子命令形成创建闭环
- 明确 `generate` 只接受 `ScenarioGenerateHintV1`
- 明确 `apiBaseUrl` 存在时 `scenario schema *` 仍走本地 tooling
- 规划 repo-local `skills/remnote/SKILL.md` 的 post-implementation 同步要求与 user-store 路径说明
- 覆盖首个内置场景 `dn_recent_todos_to_today` 的两种 delivery mode
- 明确 JSON canonical / TS optional authoring 的双层模型

输出：

- scenario tooling command contract
- skill integration 规划
- `scenario schema` 命令树 contract

### 工作带 G：Performance And Scheduling

目标：

- 缩短 Agent 到 queue 到 plugin 的调用链
- 定义 operation batching、smart merge、lock-aware parallelism
- 明确哪些操作必须保守串行
- 明确 hint lowering、冲突模型一致性与 benchmark gate

输出：

- performance/scheduling design notes
- merge/batch/parallel policy
- implementation approach
- technical feasibility assessment

### 工作带 H：Shared Subpackage

目标：

- 定义新的共享子包边界
- 把 schema、execution plan、tooling I/O types 与 host-independent planning canonicalization 收口到共享层
- 保持宿主机 authoritative 逻辑不泄漏到共享子包

输出：

- shared subpackage contract
- 包边界与依赖方向规则
- `contracts/shared-subpackage.md`

## 实施策略

1. 先冻结 authority chain 相关裁决：
   - current canonical owner
   - feature-local planned namespace
   - public promotion preconditions
   - adapter boundary
2. 再冻结 selector / scenario / builtin catalog 的 canonical contract
3. 再冻结 scenario tooling 的输入输出 contract 与 local-tooling 行为
4. 再冻结 `ScenarioExecutionPlanV1` phase invariants 与 shared boundary
5. 再规划 runtime、Host API、query、todo、powerup 的迁移顺序
6. 再规划性能、冲突模型一致性与 benchmark gate
7. 最后建立验证矩阵、docs drift 与 promotion gate

## 基本排序

### P0

- current canonical owner、alias、promotion preconditions
- Query Kernel V2 的术语与 contract
- Powerup metadata parity 的术语与 contract
- ScenarioPackage schema
- ScenarioExecutionPlanV1
- Command taxonomy 裁决
- Scenario schema tooling 命令面
- Query V2 canonical body / adapter boundary
- Scenario tooling 的稳定 envelope 与 `ScenarioGenerateHintV1`
- 性能优化策略
- 共享子包边界

### P1

- `todo list -> query preset`
- selector/action 编译链
- builtin preset catalog
- schema tooling 与 skill 闭环
- remnote skill 内置场景与命令使用方式
- `scenario` public promotion gate 载体
- conflict class parity 与 benchmark gate

### P2

- command help / docs / examples 统一
- provider abstraction 预留
- command-level parity / integration matrix
- 辅助式生成与 authoring 体验细化
- TS optional authoring 与 canonical JSON 的边界细化
- catalog / tooling / execution 的完整验证矩阵
- plugin consumer batching/parallelism 策略细化
- shared package 的模块化边界细化

## 主要风险

- Query / Scenario / Apply 三套结构形成双真相
- `scenario` 演化为第二套命令体系
- feature-local planned namespace 被误当成 current public inventory
- schema tooling 若直接生成私有内部格式，会形成第三套真相源
- `generate` hint 若没有独立 contract，会形成 skill 私有真相源
- 自由字符串 DSL 与现有 `@alias` 语义冲突
- TS authoring 若直接进入执行面，会破坏 remote parity 与审计
- Query V1 / V2 adapter 若不收口，会形成双 selector 真相
- 过度并行会破坏顺序语义或 UI 一致性
- server conflict class 与 plugin lock class 若漂移，会让 scheduling hint 失真
- 共享子包若带入宿主依赖，会重新制造跨层耦合
- `tag / powerup / todo` 重分层造成表面震荡
- powerup metadata 若未先收口，todo preset 会继续漂移

## 031 后续实施入口

- 性能与消费效率的后续优化路线，统一收口在：
  - `follow-up-performance-roadmap.md`

## 产物清单

- `spec.md`
- `plan.md`
- `follow-up-performance-roadmap.md`
- `research.md`
- `data-model.md`
- `tasks.md`
- `quickstart.md`
- `contracts/**`
- `checklists/requirements.md`
