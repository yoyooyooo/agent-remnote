# 调研笔记

## 现状（基线行为）

- daemon（后台服务）通过 `StartSync` 进行通知；插件通过不断发送 `RequestOps` 拉取（batch pull），直到 `NoWork` 为止。
- 队列强制执行“每个 txn 同时最多一个 `in_flight` op”与“前序操作（op）成功后才能执行后续”的顺序语义。
- 插件侧已有操作（op）级锁管理器（`packages/plugin/src/bridge/opConcurrency.ts`），用于避免把冲突操作并发执行。

## 关键洞见

批量拉取是一种正交的优化：

- 它能减少 WS 往返次数，让插件更快“打满并发槽位”。
- 它本身并不会减少冲突；如果 daemon 不做更聪明的调度，反而可能增加插件侧锁竞争。

冲突感知调度把一部分工作前移到 daemon：

- 预览（peek）一段可执行操作（op）窗口
- 基于 `ConflictKey` 挑选“互不冲突”的子集
- 对该子集认领（claim）+ 批量派发

## 已知风险

- `ConflictKey` 推导的一致性：daemon 侧如果不只读查询本地 RemNote DB，可能拿不到完整上下文，从而只能更保守。
- 租约大小：`in_flight` 操作（op）变多会增加 lease 过期概率；需要调大 `leaseMs` 并限制 batch 大小。

## 现场事故：Queue DB 只读（入队阶段提前失败）

现象：

- 写入命令失败，错误码为 `QUEUE_UNAVAILABLE`
- 底层 sqlite 报错：`attempt to write a readonly database`（尝试写入只读数据库）

影响：

- 这不是“消费端”问题；它会在入队阶段直接阻断整条链路。
- 若错误信息不可行动，用户/代理无法快速修复（路径错误、权限错误、运行用户不一致、只读挂载等）。

规格驱动的行动：

- 明确要求队列 DB 的错误可诊断性（`db_path` + sqlite error + `nextActions`）。
- 扩展 `doctor` 覆盖队列 DB 可写性。
