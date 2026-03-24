# 031 后续路线：Performance Uplift

日期：2026-03-23  
适用范围：`specs/031-query-scenario-package-and-command-taxonomy/**`

## 背景

031 已经把“少调用链路、高表达力、批处理、锁感知并行”冻结为正式目标，也冻结了 benchmark gate、冲突模型一致性和 scheduling hints 的边界。

当前实现仍存在一条明显缺口：

- `scenario run`
- `apply kind=actions`
- `WritePlanV1`

这三层仍然主要按 `1 action -> 1 op` 下沉。

因此，当前瓶颈不在“命令轮次仍然很长”，而在“高层 fan-out 语义还没有真正下沉成 bulk execution unit”。

## 路线裁决

后续性能优化采用以下优先级：

1. 先做 `bulk-first`
2. 再做 queue / WS 热路径收口
3. 最后才考虑协议级批 ack 与更激进调度

原因：

- bulk 能同时减少 queue row、WS dispatch、ack 次数、锁获取次数
- queue / WS 优化主要降低热路径常数项与波次装载损耗
- 协议级优化改动面更大，失败语义更复杂，不适合作为第一波

## 设计原则

- 继续遵守 safe-by-default
- 允许激进提效，但不允许越过确定性、顺序语义、宿主边界
- 不为历史 CLI 兼容背负长期负担，允许 forward-only 重塑命令面
- 任何 breaking change 必须同步更新 `docs/ssot/agent-remnote/**` 与相关 `specs/**`
- 不把“自动 merge 黑盒”塞进 queue；bulk 必须先成为显式 action / op family

## Caller Neutral 原则

- 调用方继续使用业务语义 command surface
- 不要求 agent 为了性能显式改写命令习惯、prompt 习惯或 action 形状
- 性能收益优先通过 lowering、coalescing、queue / WS hot path 与 plugin runtime 静默生效
- `*Many` / `*_bulk` family 可以存在，但默认视为 internal lowering/runtime family，不作为推荐 caller surface
- 任一 silent batching 若无法证明等价性，必须自动回退到 scalar 语义，不把优化负担转移给 caller

## 当前瓶颈归纳

### 1. 编译层瓶颈

- `scenario run` 在 `compileActions()` 中逐项 fan-out
- `apply kind=actions` 没有 coalescing
- `WritePlanV1` 里的 `portal.create`、`rem.move`、`tag.add/remove` 仍然编译成 scalar op

结论：

- 当前高层语义没有在 lowering 过程中压缩

### 2. plugin 执行层瓶颈

- `create_portal` 仍是单 portal 串行 handler
- `move_rem` 虽然底层调用 `moveRems([id], ...)`，但仍按单 rem 执行
- `runSyncLoop` 默认并发只有 `4`
- 每处理 `10` 个 op 固定 `sleep(50ms)`

结论：

- plugin 已有并发框架，但还没有 bulk-aware handler

### 3. queue / WS 热路径瓶颈

- `peekEligibleOps -> claimOpById x N` 两段式 claim 往返偏多
- conflict scheduler 是 greedy first-fit
- eligibility SQL 缺少更贴近热路径的复合索引
- 当前仍然是 single active worker 架构

结论：

- 这部分值得优化，但优先级低于 bulk lowering

## 推荐波次

### Wave 0：契约补齐与观测基线

目标：

- 补齐 031 contract 与实现之间的性能相关漂移
- 为后续 aggressive 优化提供统一语义与验证口径

范围：

- 在 shared contract / execution plan 中补齐 `scheduling`
- 明确 bulk 的 ordering、partial failure、retry 语义
- 为 `scenario run`、`apply`、queue、plugin 增加最小观测字段或 benchmark fixture 约束

建议触点：

- `packages/agent-remnote/src/lib/scenario-shared/index.ts`
- `packages/agent-remnote/src/lib/scenario-runtime/index.ts`
- `specs/031-query-scenario-package-and-command-taxonomy/contracts/scenario-execution-plan.md`
- `specs/031-query-scenario-package-and-command-taxonomy/contracts/performance-and-scheduling.md`

退出条件：

- `ScenarioExecutionPlanV1.scheduling` 有实现级载体
- `bulk` 的 canonical 失败/顺序语义有书面裁决

### Wave 1：Bulk-First 主线

目标：

- 把最常见、收益最高的 fan-out 路径降成 bulk execution unit

首批范围：

- `rem.moveMany -> move_rem_bulk`
- `portal.createMany -> create_portal_bulk`

补充说明：

- `rem.moveMany` 与 `portal.createMany` 主要用于 internal lowering
- caller 继续以 `rem.move`、`portal.create` 这类业务语义 surface 为主
- 只有测试、调试或未来明确 promotion 时，才考虑是否公开 `*Many`

裁决：

- `move_rem_bulk` 优先级高于 `create_portal_bulk`
- `move_rem_bulk` 首版只支持：
  - 同一 `new_parent_id`
  - `standalone=false`
  - `leave_portal=false`
  - `is_document` 同值
  - 不支持异构 `position`
- `create_portal_bulk` 首版只支持：
  - 同一 `parent_id`
  - item 级 `target_rem_id`
  - item 级 `position` 可选
  - handler 内逐项执行，失败即停，返回 `item_results`

建议触点：

- `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- `packages/agent-remnote/src/kernel/op-catalog/catalog.ts`
- `packages/agent-remnote/src/internal/queue/dao.ts`
- `packages/agent-remnote/src/kernel/conflicts/deriveConflictKeys.ts`
- `packages/plugin/src/bridge/ops/mapOpType.ts`
- `packages/plugin/src/bridge/ops/executeOp.ts`
- `packages/plugin/src/bridge/ops/handlers/remCrudOps.ts`
- `packages/plugin/src/bridge/ops/handlers/portalOps.ts`
- `packages/plugin/src/bridge/opConcurrency.ts`

预期收益：

- 直接降低 op 数量
- 直接降低 ack 数量
- 直接降低 lock acquire 次数
- 对 `scenario run` 和 `apply` 同时生效

### Wave 2：Caller Lowering 与命令面收口

目标：

- 让 bulk 收益从“手写 bulk action”扩展到所有高层调用面

范围：

- 在 `apply kind=actions` 增加 coalescing pass
- 在 `scenario-runtime` 直接输出 bulk action
- 在高频直接命令中，把手工拼 N op 的路径迁移到 bulk family

补充说明：

- 这里的“命令面收口”指 internal lowering 收口，不要求 agent 改写调用策略
- 目标是让高层 caller 在无感条件下吃到 bulk-first 收益

第二批候选：

- `tag.addMany`
- `tag.removeMany`
- `todo.setStatusMany`
- `source.addMany`
- `source.removeMany`

建议触点：

- `packages/agent-remnote/src/commands/_applyEnvelope.ts`
- `packages/agent-remnote/src/lib/scenario-runtime/index.ts`
- `packages/agent-remnote/src/commands/write/tag/index.ts`
- `packages/agent-remnote/src/commands/write/powerup/todo/**`

裁决：

- coalescing 只处理连续、同质、无 alias 依赖、目标形状一致的 action
- 含 `as/@alias`、`client_temp_id`、`leave_portal`、异构 `position` 的 action 保留 scalar fallback
- `scenario run`、`apply kind=actions`、直接写命令都应优先共享同一套 silent coalescing 规则

### Wave 3：queue / WS 热路径优化

目标：

- 在不改变 single active worker 基线的前提下，减少热路径成本并提高单波次装载率

范围：

- 引入 `claimEligibleOpsBatch()`
- 补 eligibility 热路径索引
- 把 current greedy 改成有限 lookahead packing
- 清理 `Set` / bytes estimate / oversize hot path 的无谓常数项

建议触点：

- `packages/agent-remnote/src/internal/queue/dao.ts`
- `packages/agent-remnote/src/internal/store/schema.sql`
- `packages/agent-remnote/src/lib/wsBridgeCoreDispatch.ts`
- `packages/agent-remnote/src/kernel/conflicts/scheduler.ts`

不在本波范围：

- multi active worker
- 跨 wave 预取未 ready op
- 改写 active worker election 模型

### Wave 4：plugin 执行循环与锁收紧

目标：

- 清掉不必要的固定节流
- 把 plugin 的并发框架真正用满
- 尽量把算锁阶段的 live read 前推到上游 payload

范围：

- 删除 `processed % 10 === 0` 的固定 `sleep(50)`
- 默认 `syncConcurrency` 从 `4` 提高到 `8`
- 对 `move/delete` 一类 op 逐步引入 `old_parent_id` 等辅助字段
- 在不破坏安全边界前提下评估 `rem:<parent>` 级别的锁收紧

建议触点：

- `packages/plugin/src/bridge/runtime.ts`
- `packages/plugin/src/bridge/opConcurrency.ts`
- `packages/plugin/src/bridge/ops/handlers/**`

### Wave 5：协议级批处理

目标：

- 在 bulk 与热路径收口后，再决定是否值得做协议级批 ack

候选：

- `OpAckBatch`
- server 侧批量 txn/attempt/result 推进

裁决：

- 这波必须晚于 bulk-first
- 若 Wave 1-4 已经达到可接受吞吐，可以不做

## 暂缓事项

- 不优先做 multi active worker
- 不优先做 queue 层 opaque auto-merge
- 不优先做“全局最优”调度器
- 不优先做跨 worker 横向扩吞吐

## 建议同步的 SSoT / Spec 工件

至少同步：

- `docs/ssot/agent-remnote/ws-bridge-protocol.md`
- `docs/ssot/agent-remnote/tools-write.md`
- `docs/ssot/agent-remnote/cli-contract.md`
- `specs/031-query-scenario-package-and-command-taxonomy/contracts/performance-and-scheduling.md`
- `specs/031-query-scenario-package-and-command-taxonomy/contracts/scenario-execution-plan.md`
- `specs/031-query-scenario-package-and-command-taxonomy/tasks.md`

## 验证策略

每波都要同时覆盖：

- contract / schema drift
- unit / integration
- bulk fallback correctness
- ordering parity
- conflict class 与 lock class 一致性

重点新增：

- bulk op contract tests
- scalar -> bulk lowering tests
- single-parent portal / move ordering tests
- queue hot path integration tests
- plugin live or fake-worker throughput smoke

## 本文用途

本文是 031 的后续实施入口，不代表本波已经完成实现。

后续若进入具体实施，应以本文为路线图，并把每一波再拆成：

- contract sync
- tests first
- implementation
- live verification
