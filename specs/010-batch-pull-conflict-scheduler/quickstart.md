# 快速开始（草案）：如何验证本规格

> 本文档是验证路线的草案，会在进入实现阶段时进一步细化与定稿。

## 准备工作

- 确保 daemon 正在运行，且插件已连接。
- 确保队列 DB 路径为默认值，或通过 `REMNOTE_QUEUE_DB` 指定。

## 场景

1) **批量拉取减少往返次数**

- 入队 ~100 条互不依赖的 ops（不同 parents / 不同 remIds）。
- 入队 ~100 条互不依赖的操作（op）（不同父节点 / 不同 `remId`）。
- 触发同步（sync），观察插件收到 `OpDispatchBatch`（而不是每条操作（op）一次 `OpDispatch`）。

2) **冲突感知调度优先消费非冲突 ops**

- 入队：
  - 多条写同一个 parent/page 的操作（op）
  - 多条写其他互相独立 parent 的操作（op）
- 触发同步（sync），验证非冲突操作（op）更早完成且能并发推进。

3) **冲突报告可行动**

- 入队一组混合操作（op），包含对同一 `remId` 的删除/更新。
- 运行 `agent-remnote queue conflicts --json`，确认输出把该 remId 纳入高风险分组。

4) **队列 DB 可写，并且失败可行动**

- 运行 `agent-remnote --json doctor`，确认输出包含队列 DB 路径与可写性检查。
- 临时把 `REMNOTE_QUEUE_DB` 指向只读位置（或把测试 DB `chmod` 为只读），确认写入命令以“可行动”的错误信息失败（`db_path` + sqlite 错误 + `nextActions`）。
