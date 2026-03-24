# 任务：031 查询 / Scenario / 命令 taxonomy 归一化

**输入**: 设计文档位于 `/specs/031-query-scenario-package-and-command-taxonomy/`  
**前置工件**: `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/**`、`quickstart.md`

**测试**: 本特性最终需要 selector contract tests、scenario-package schema tests、builtin catalog drift tests、command taxonomy/help tests、remote parity tests，以及 selector/action compilation integration tests。

## 格式：`[ID] [P?] [Area] Description`

- **[P]**: 可并行
- **[Area]**: `A/B/C/D/E/F/G/H`，对应八条工作带

> 状态说明：以下勾选状态已按当前 worktree 截至 `2026-03-23` 的真实落地情况更新。

## Phase 1：Setup

- [x] T001 在 `specs/031-query-scenario-package-and-command-taxonomy/**` 下建立 031 工件脚手架
- [x] T002 [P] 为 Query AST V2 与 ScenarioPackage schema 建立 contract 脚手架
- [x] T003 [P] 为 command taxonomy、builtin catalog、verification matrix 建立任务桶
- [x] T004 [P] 为 scenario schema tooling 建立任务桶
- [x] T005 [P] 为性能调度与共享子包建立任务桶

## Phase 2：SSoT 与 taxonomy 冻结

- [x] T010 在 `spec.md`、`research.md`、`data-model.md` 中冻结 031 的术语与边界
- [x] T011 [P] 起草 `contracts/query-ast-v2.md`
- [x] T012 [P] 起草 `contracts/scenario-package-schema.md`
- [x] T013 [P] 起草 `contracts/command-tree-normalization.md`
- [x] T014 [P] 起草 `contracts/builtin-preset-catalog.md`
- [x] T015 在 031 规划工件中把 `master` 记录为仓库默认主线
- [x] T016 [P] 起草 scenario tooling 的 contract 与闭环说明
- [x] T017 [P] 起草 `contracts/scenario-execution-plan.md`
- [x] T018 [P] 起草 `contracts/scenario-schema-tooling.md`
- [x] T019 [P] 起草性能调度与共享子包的 contract

## Phase 3：Query Kernel V2

- [x] T020 [A] 盘点 `query`、`todo list`、powerup/table reads 当前 selector 缺口
- [x] T021 [A] 定义 Query AST / DSL V2 contract
- [x] T022 [A] 定义 `query` 的 CLI 参数模型
- [x] T023 [A] 定义 selector result-set contract 与 `SelectionSet`
- [x] T024 [A] 规划 selector 语义的 local / remote parity 验证
- [x] T025 [A] 冻结 Query V2 canonical body、adapter boundary、runtime-ready `scope.kind` 与 `powerup.by`
- [x] T026 [A] 裁决 `query --powerup <name>` 是否作为 authoring sugar 存在，并定义其 authoritative metadata normalization 规则

## Phase 4：Powerup Metadata Parity

- [x] T030 [B] 定义 `powerup list/resolve/schema` 的 host-authoritative metadata 模型
- [x] T031 [B] 定义 metadata parity 需要扩展的 Host API 面
- [x] T032 [B] 定义 `--powerup` 语义如何在 local / remote 路径间共享
- [x] T033 [B] 定义依赖 powerup metadata 的命令迁移影响面
- [x] T034 [B] 定义 powerup metadata internal capability 与 future public route 的 promotion 边界
- [x] T035 [B] 若支持 `query --powerup <name>`，定义其 local / remote 共用的 authoritative metadata resolution 路径与稳定失败契约

## Phase 5：ScenarioPackage 与 Builtin Presets

- [x] T040 [C] 定义 `ScenarioPackage` schema 与校验规则
- [x] T041 [C] 定义受约束 DAG 与结构化引用节点 contract
- [x] T042 [C] 定义 `selector -> SelectionSet -> action -> apply` 编译 contract
- [x] T043 [D] 定义 builtin preset catalog 的 layout、ownership 与 source 语义
- [x] T044 [D] 预留 provider / 插件扩展接口，不实现市场机制
- [x] T049 [D] 定义首批内置场景 `dn_recent_todos_to_today` 的 canonical package，支持 `move` / `portal` 两种 delivery mode

## Phase 5A：Scenario Execution Model

- [x] T046 [C] 定义 `ScenarioExecutionPlanV1`
- [x] T047 [C] 明确 `SelectionSet`、`transform`、`action plan` 的边界
- [x] T048 [C] 定义 canonical JSON 与 TS optional authoring 的边界
- [x] T045 [C] 在执行模型冻结后定义 scenario execution 的验证矩阵

## Phase 6：Scenario Schema Tooling

- [x] T050 [F] 定义 scenario/package schema tooling 子命令组
- [x] T051 [F] 定义 validate / normalize / explain / scaffold/generate 的稳定输出 contract
- [x] T052 [F] 定义 skill 如何调用 tooling 子命令形成创建闭环
- [x] T053 [F] 定义 schema tooling 的 drift / lint / integration 测试要求
- [x] T054 [F] 裁决 `generate` 是否仅接受结构化 hint，并写清输入边界
- [x] T055 [F] 冻结 `scenario schema` 命令树、参数面与 machine-readable 输出
- [x] T056 [F] 定义 `apiBaseUrl` 存在时 `scenario schema *` 的 local-tooling 行为与 gate
- [x] T057 [F] 定义 `ScenarioGenerateHintV1` 与统一的 `ScenarioSchemaToolResult` envelope

## Phase 7：Command Surface Normalization

- [x] T062 [E] 冻结 `query/scenario/todo/powerup/tag/apply` 的 canonical family 与 alias 规则
- [x] T063 [E] 把 `powerup.todo.*` 记录为 current canonical todo write surface，并定义顶层 `todo.*` alias 规则
- [x] T064 [E] 定义 `todo list -> query preset` 的参数映射、alias 生命周期与 remote parity 切换条件
- [x] T065 [E] 定义 `scenario` namespace 的 public promotion preconditions
- [x] T066 [E] 定义归一化命令树的 help/docs drift 要求
- [x] T067 [E] 定义 public promotion 发生时 authoritative inventory、CLI contract、derived mirror 的同步任务，并写清 `todos.list` 的退场条件

## Phase 7A：Performance And Scheduling

- [x] T068 [G] 盘点当前 queue -> plugin 消费链路的串行/并行现状
- [x] T069 [G] 定义 operation batching、smart merge、lock-aware parallelism 的策略
- [x] T070 [G] 定义哪些操作必须保守串行，哪些可并行
- [x] T071 [G] 把性能目标回写到 schema / execution plan 契约

## Phase 7B：Shared Subpackage

- [x] T072 [H] 定义新的共享子包边界与命名
- [x] T073 [H] 定义共享子包导出的 types/contracts/纯逻辑范围
- [x] T074 [H] 定义允许与禁止的依赖方向
- [x] T075 [H] 定义共享子包与宿主 authoritative 逻辑的边界

## Phase 8：Verification Planning

- [x] T080 定义 selector parity contract tests
- [x] T081 [P] 定义 scenario schema 与 builtin catalog drift tests
- [x] T082 [P] 定义 command help / taxonomy contract tests
- [x] T083 [P] 定义 selector/action compilation 在 local 与 remote 下的 integration tests
- [x] T084 [P] 定义 schema tooling 的 contract / lint / integration tests
- [x] T085 [P] 定义性能调度相关的 contract / integration / benchmark tests，并冻结 fixture、baseline、threshold
- [x] T086 [P] 定义共享子包 contract / drift / boundary tests
- [x] T087 定义 031 工件与 SSoT 传播的 docs drift coverage
- [x] T088 [P] 定义 catalog governance、id stability、namespace collision tests
- [x] T089 [P] 定义 `ScenarioExecutionPlanV1` 与 `SelectionSet` 的 contract / integration tests
- [x] T090 [P] 定义 authoritative inventory / commandInventory mirror / verification-case registry 的 drift coverage
- [x] T091 [P] 定义 `todo list` compatibility alias 与 `query --preset` 参数映射 tests
- [x] T092 [P] 定义 `scenario` public promotion precondition checks
- [x] T093 [P] 定义 `skills/remnote/SKILL.md` 的 scenario guidance drift checks，确保 authoring 命令、user-store 路径、install helper 与 promotion 标注和 contracts 同步

## Phase 9：Polish

- [x] T094 审查 031 spec set 是否有 scope leak 或 second-command-system 风险
- [x] T095 审查 query/scenario/apply 是否存在新的 duplicate truth source
- [x] T096 审查 schema tooling 是否引入新的隐式真相源
- [x] T097 审查性能优化是否破坏顺序语义或宿主边界
- [x] T098 审查共享子包是否引入跨层耦合
- [x] T099 在相关 scenario/command 实施完成后，统一补充 `skills/remnote/SKILL.md` 的常见场景 guidance、user-store 路径与命令使用方式
- [x] T100 为 scenario builtin install / user-store 路径补充 guidance，避免把 branch-local builtin id 直接固化进 repo-local skill
- [x] T101 审查 `skills/remnote/SKILL.md` 是否与 current public inventory / planned namespace 完全一致，避免提前宣传未 promotion 的 scenario surface
- [x] T102 完成 quickstart、checklist 与 skill sync，供后续实现会话使用

## Phase 10：Follow-up Performance Uplift

- [x] T103 [C] 把 `ScenarioExecutionPlanV1.scheduling` 的实现级载体、silent batching 边界与 internal bulk family 分层补到 contracts / data model / shared types
- [x] T104 [G] 明确 caller-neutral optimization 原则，规定性能收益优先通过 lowering/runtime 静默生效，不要求 agent 改写 command surface
- [x] T105 [C] 设计并实现 `rem.moveMany -> move_rem_bulk` 的 action/op family、输入约束、ordering 与 fallback 语义
- [x] T106 [C] 设计并实现 `portal.createMany -> create_portal_bulk` 的 action/op family、partial failure 语义与 scalar fallback
- [x] T107 [F] 设计并实现 `apply kind=actions` 与 `scenario run` 的 silent coalescing 规则，覆盖 alias 依赖、heterogeneous position、leave_portal 等禁用条件
- [x] T108 [G] 定义并实现 bulk op 的 conflict class / lock class / idempotency / retry 契约，并与现有 scalar op 建立 parity gate
- [x] T109 [G] 规划并实现 plugin bulk handlers、固定节流移除、默认并发提升与 old_parent_id 前推边界
- [x] T110 [G] 规划并实现 `claimEligibleOpsBatch()`、eligibility 热路径索引与有限 lookahead packing
- [x] T111 [P] [G] 增加 silent batching / scalar-to-bulk lowering / ordering parity / partial failure 的 contract 与 integration 测试清单
- [x] T112 [P] [G] 增加 bulk-first throughput smoke、queue hot path regression 与 live verification 验收清单
