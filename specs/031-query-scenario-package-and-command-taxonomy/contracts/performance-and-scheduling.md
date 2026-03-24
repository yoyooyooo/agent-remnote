# 契约：Performance And Scheduling

日期：2026-03-22

## 目的

把“高表达、低往返”收敛成 031 的正式契约边界，同时把真正依赖 live runtime 的优化保留在宿主机。

## 安全优先原则

- 031 在性能与调度上采用 safe-by-default。
- 若某项 batching、merge、parallelism 优化无法证明：
  - 语义等价
  - 顺序语义不破坏
  - 宿主边界不越界
  - local / remote parity 不漂移
  则必须选择保守路径。
- 允许错过优化，不允许错做优化。
- “看起来大概率没问题”不构成 contract 级放行依据。

## 031 可以冻结成 contract 的部分

- 调用方可以用一份 canonical `ScenarioPackage` 加一组 vars 表达多 selector / transform / action 流程
- `ScenarioExecutionPlanV1` 可以显式暴露 `scheduling` hints
- `SelectionSet` 是 action planning 的显式输入，不再要求调用方手写多轮命令往返
- runtime 可以基于 plan 暴露 batch / merge / parallel opportunity，但机会本身要可诊断
- hint lowering 的规则、适用半径、验证要求必须明确写进 contract
- caller 不应为性能优化承担额外 discipline；性能 uplift 应优先通过 lowering/runtime 静默生效

## 031 只保留为 runtime 优化方向的部分

- batch size
- ws `RequestOps` budget
- lease duration / extend strategy
- active worker election
- queue scan window
- retry / backoff
- plugin-side exact concurrency value

## 当前技术基线

031 的性能设计不是从零开始，当前仓库已经具备这些可复用基线：

- queue 层已经支持 `serial | conflict_parallel` 两档 dispatch mode
- queue 层已经支持 `queue_op_dependencies`
- queue 层已经支持临时 ID 替换与 `queue_id_map` gating
- WS bridge 已支持 `RequestOps` / `OpDispatchBatch`
- WS bridge 已支持 `maxOps` / `maxBytes` / `maxOpBytes` 预算控制
- WS bridge 已支持 oversize fail-fast
- server 侧已经有 conflict-aware 预选逻辑
- plugin 侧已经有 lock-aware parallel execution
- plugin 侧已经有 per-op idempotency 与 in-flight guard
- 当前执行模型仍是单 active worker 消费，吞吐收益主要来自单 worker 内部并发

结论：

- `batching` 属于“已有 transport 能力 + 上层编译未收口”
- `parallelism` 属于“已有 queue / scheduler / plugin 基础设施 + 上层计划提示未收口”
- `merge` 目前只适合先做 conservative dedupe / coalescing，不适合承诺通用语义 merge 引擎
- `parallelism` 的 contract 半径必须限定为“单 active worker 内部、受 lock model 约束的并发”
- 任何超出上述安全半径的优化提案，默认不纳入 031

## Caller Surface Principle

- 高层 caller 继续围绕 canonical business command family 表达意图
- agent 不应被要求为性能专门改写 command selection、prompt 模式或 action 形状
- `*Many` action family 与 `*_bulk` op family 可以存在，但默认属于 internal lowering/runtime family
- 若 runtime 能从连续、同质、可证明等价的 scalar action 静默 coalesce 为 bulk family，应优先采用这条路径
- 若 silent batching 证据不足，必须自动回退到 scalar lowering，不把优化责任推回 caller

## 实施思路

### G1：先在 compiler 层暴露机会

目标：

- 让 `ScenarioPackage -> ScenarioExecutionPlanV1` 显式表达 batch / merge / parallel opportunity
- 不直接改 runtime 语义

实现方式：

- 在 `action_plan` 上生成同类动作分组信息
- 在 `scheduling` 上写入 advisory hints
- 对需要顺序的动作保留显式 ordering

结果：

- 先把“哪些动作可以一起做”从 runtime 隐式经验提升为可诊断 contract

### G2：再做 enqueue 前的安全收口

目标：

- 在不破坏现有执行脊柱的前提下减少无意义 op 数量

实现方式：

- 对完全重复、幂等、同目标、同效果的动作做 conservative dedupe
- 对可 fan-out 的 homogeneous action 统一编译为同一执行波次
- 对高频 fan-out 场景引入 internal bulk action / bulk op family
- 不改变最终写入出口，仍然走 `business_command` 或 `apply kind=actions`

结果：

- 减少 queue 长度
- 降低 WS 往返和 plugin handler 次数

### G3：复用 queue / WS 的并行基础设施

目标：

- 让计划级 `dispatch_mode` 真正映射到现有 queue / WS 调度行为

实现方式：

- `serial` 继续映射到 txn 内 `op_seq` 串行
- `conflict_parallel` 映射到现有 conflict-aware 预选与派发
- 继续复用 temp id gating、lease、CAS ack、oversize fail-fast

结果：

- 不需要重写 queue 协议
- 重点工作变成“上层何时允许 conflict_parallel”

### G4：最后复用 plugin 侧 lock-aware parallelism

目标：

- 在宿主安全前提下吃到真正的吞吐收益

实现方式：

- 沿用现有 `OpLockManager`
- 沿用现有 per-op lock key 计算
- 对 `daily_note_write`、`replace_*_with_markdown`、结构位点共享的 `move/delete/create` 继续保守串行

结果：

- 031 不需要发明第二套 plugin scheduler
- 重点工作变成“哪些动作允许进入并行波次”

### G5：把 merge 控制在保守范围

目标：

- 只做证据充分的 merge，不追求通用 merge engine

实现方式：

- phase 1 仅允许：
  - 完全重复动作去重
  - 同一目标上的幂等去重型动作合并
- phase 2 才考虑更强的 coalescing
- 不在 031 承诺 last-write-wins 通用属性合并

结果：

- 可行性高
- 风险可控
- 不会把“智能合并”写成不可验证的黑盒
- 证据不足时宁可不合并，也不做错误合并

## Scheduling Hints 语义

- `dispatch_mode`
  - 表达默认按串行还是 conflict-aware parallel 方式调度
- `batching`
  - 表达是否允许把同类动作聚合到同一执行波次
- `merge_strategy`
  - 表达是否允许宿主对幂等动作做安全合并
- `parallelism`
  - 表达是否允许在 lock-safe 前提下并行
- `ordering`
  - 表达是否必须保留 selector 拓扑顺序或输入顺序

补充说明：

- safe parallelism boundary 由 host runtime 的 conflict analysis / lock model 最终裁决
- canonical scheduling policy 不暴露 raw lock key 或 lock scope
- server conflict class 与 plugin lock class 必须满足“server 允许并行”的集合不宽于 plugin 最终允许并行的集合

## Hint lowering 规则

### `ordering`

- 映射对象：
  - txn 边界
  - `queue_op_dependencies`
  - `op_seq`
- contract 要求：
  - 若动作依赖前序 host fact，必须显式产生依赖边
  - 不允许只靠 runtime 启发式补顺序

### `batching`

- 映射对象：
  - action grouping
  - silent scalar-to-bulk coalescing
  - 同 wave 编译
  - WS `OpDispatchBatch` 组织方式
- contract 要求：
  - batching 只改变“同波次多少动作”
  - batching 不得改变动作语义与 targeting
  - batching 优先通过 lowering/runtime 静默生效，不要求 caller 选择 performance-aware surface

### `merge_strategy`

- 映射对象：
  - compile 前 dedupe
  - enqueue 前 canonical 合并
  - idempotency key 域
- contract 要求：
  - merge 必须先经过可证明的等价类判定
  - 非交换动作、依赖 live host fact 的动作禁止合并

### `dispatch_mode`

- 映射对象：
  - txn `dispatch_mode`
  - queue 预选策略
- contract 要求：
  - `serial` 与 `conflict_parallel` 的 lowering 必须稳定
  - 不允许 runtime 悄悄改写 caller 已冻结的 dispatch class

### `parallelism`

- 映射对象：
  - plugin lock-safe concurrency
  - 单 active worker 内部并发上限
- contract 要求：
  - 031 只覆盖单 active worker 内部并发
  - 不承诺多 worker 横向消费

## 冲突模型一致性

- server conflict class 与 plugin lock class 必须形成可验证关系
- 最低要求：
  - server 可保守，允许少并行
  - server 不得乐观到放行 plugin 必须串行的组合
- 若无法证明 server/plugin 对某类动作给出一致的安全边界，contract 必须要求回退到更保守的一侧
- 必须补一类专门 gate：
  - `conflict-class-parity-contract`
  - 覆盖至少 `move_rem`、`delete_rem`、`replace_children_with_markdown`、`daily_note_write`

## 技术实现方式

### 1. Compiler 到 plan

- 输入：`ScenarioPackageV1`
- 输出：`ScenarioExecutionPlanV1`
- 关键新增：
  - 动作分组
  - caller-neutral batching opportunity
  - scheduling hints
  - 是否允许 `dispatch_mode=conflict_parallel`

### 2. Plan 到 compiled execution

- 单步场景优先编译到 `business_command`
- 多步依赖或 bulk action 编译到 `apply kind=actions`
- `compiled_execution` 仍只保留：
  - `business_command`
  - `apply_actions`

### 3. Queue / WS 映射

- `dispatch_mode=serial`
  - 继续走 txn 内串行 gate
- `dispatch_mode=conflict_parallel`
  - 继续走现有 conflict-aware 预选
- `batching`
  - 主要影响“同一波次编译多少动作”，不改变 WS 协议结构

### 4. Plugin 执行

- 沿用现有 per-op handler
- 沿用现有 lock manager
- 不在 031 引入跨 handler 的通用 merge executor

## 技术可行性

### 已可行

- 计划级 batch / parallel hint 暴露
- enqueue 前 conservative dedupe
- txn 级 `serial | conflict_parallel` 映射
- WS batch pull 复用
- plugin lock-aware parallel execution 复用

原因：

- 这些能力在当前代码里已有基础设施，只缺上层编译与门禁收口

### 部分可行

- smart merge
- conflict class 跨层一致性验证
- benchmark gate

原因：

- 当前适合做“重复动作去重”和“同目标幂等去重型动作合并”
- 还缺 server/plugin 冲突模型对齐与量化基线

### 当前不应承诺

- 基于 runtime 内部状态的通用自动 merge engine
- 对所有动作一视同仁的并行化
- 多 active worker 横向消费
- 把 queue / WS / plugin 的内部预算和锁算法写成对外契约

原因：

- 证据不足
- drift 风险高
- 会过早把实现细节提升成 SSoT

## 推荐实施顺序

1. 先补 `ScenarioExecutionPlanV1.scheduling`、action grouping 与 lowering map 的 schema
2. 再补 compiler 的 conservative dedupe / grouping
3. 再补 `dispatch_mode` 到 queue / WS 的稳定 lowering
4. 再补 conflict class parity gate
5. 再补 plugin 侧 smoke / ordering / parity 验证
6. 最后再评估是否扩大 merge 范围与建立 benchmark gate

## Benchmark Gate

- benchmark gate 必须冻结：
  - fixture 名称
  - fixture 数据规模
  - 采样轮次
  - 统计口径
  - 阈值
- 031 推荐至少跟踪：
  - `compiled_action_count`
  - `queue_ops_enqueued`
  - `wall_clock_ms`
- benchmark gate 只能在 baseline 与允许波动范围已冻结后启用
- 在此之前，只能保留 smoke benchmark，不得把其结果作为 release gate

## 验证要求

- contract test：
  - scheduling policy schema drift
  - action grouping normalization drift
  - hint lowering contract drift
  - conflict class parity contract
- integration test：
  - `serial` vs `conflict_parallel` ordering parity
  - batch compile smoke
  - duplicate action dedupe smoke
  - host runtime fallback under conflict
  - server/plugin conflict parity smoke
- benchmark gate：
  - fixed fixture throughput gate
  - queue ops reduction gate
  - compile fan-in/fan-out regression gate
- non-goal guard：
  - 不允许 caller 直接提交 `SelectionSet`
  - 不允许 caller 直接提交 `ScenarioExecutionPlanV1`
  - 不允许 scheduling hints 变成 raw runtime knob surface

## 稳定分类

### 可优先 batch 的动作

- 对同一执行波次可独立 fan-out 的 bulk action
- 不依赖前一条动作返回 host fact 的 homogeneous action

### 可考虑 merge 的动作

- 同一语义、同一目标、同一 placement policy 的重复动作
- 同一目标上的幂等去重型动作

### 必须保守串行的动作

- `daily_note_write`
- `replace_children_with_markdown`
- `replace_selection_with_markdown`
- 共享 parent / children 结构位点的 move / delete / create
- 任何依赖前序 host result 才能确定后序 targeting 的动作

## 红线

- 不得把 runtime heuristics 写死进 canonical schema
- 不得为了减少往返让 caller 直接提交 `SelectionSet` 或 `ScenarioExecutionPlanV1`
- 不得牺牲 parity、审计性或宿主权威语义换取吞吐
- 不得因为“理论上更快”而跳过安全证明、等价性证明或顺序语义证明
