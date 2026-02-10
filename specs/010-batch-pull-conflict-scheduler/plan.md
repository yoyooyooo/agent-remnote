# 计划：批量拉取 + 冲突感知调度

## 阶段 0（最小可用版本 / MVP）：仅批量拉取，不做调度

目标：减少 WS 往返次数，保持语义不变。

- 新增 WS 消息 `RequestOps` / `OpDispatchBatch`（breaking：升级后仅支持新协议）
- daemon 实现：循环调用现有 `claimNextOp`，收集最多 `maxOps` 条（不做冲突过滤）
- 插件实现：请求 `maxOps = maxConcurrency - inFlight.size`，然后对每个操作（op）启动一次 `runOne`
- 回执仍按 op 维度（`OpAck`），但必须纳入 013 的 attempt_id/CAS ack/AckOk 语义（避免 lease 回收 + 多客户端切换导致 stale ack 覆盖）

退出标准：

- 吞吐/往返延迟（RTT）的改善在日志/指标上可见
- 旧客户端（或模拟 `RequestOp`）会被快速拒绝，并给出可诊断错误与 `nextActions`

## 阶段 0.5：可运维性的低成本收益（CLI + 错误可诊断性）

目标：链路在入队阶段失败时用户能快速修复；链路成功时用户能快速验证。

- 支持 write-first：写入命令不要求单独的“事前检查”，应直接尝试入队并返回可行动的诊断信息
- 提升队列 DB 错误可诊断性（`db_path` + sqlite 错误信息 + `nextActions`）
- 扩展 `doctor`：校验队列 DB 可写性并输出明确修复建议
- 入队后验证路径的 `nextActions` 标准化（inspect/progress）

## 阶段 1：冲突感知调度器（服务端）

目标：避免在同一批次派发冲突操作，以最大化真实并发。

- 在队列 DAO 中实现 `peekEligibleOps(peekLimit)` + `claimOpById(op_id)`
- 在 daemon 中实现 `ConflictKey` 推导（基于 payload + 可选的只读 DB 查询）
- 实现贪心挑选，构造“冲突键不相交”的集合
- 增加诊断信息：选中/跳过数量、阻塞键 Top 列表

退出标准：

- 在混合冲突的积压队列中，非冲突操作优先且更快被消费
- 冲突操作不会被过度派发（减少插件侧锁竞争）

## 阶段 2：冲突面报告（CLI）

目标：让冲突可见且可行动。

- 增加 `agent-remnote queue conflicts`（JSON + Markdown 摘要）
- 可选：把摘要集成进 `daemon status` / `queue stats`
- 输出 `nextActions`：inspect txn/op ids、推荐处理策略

退出标准：

- 用户能看清“哪个 rem/page 在发热”以及为何消费变慢/被串行化

## 阶段 3（可选）：安全闸门 / 严格模式

目标：在需要时，避免“离线积压”导致的意外风险。

- 增加 `daemon sync --check-conflicts` 或 `--strict-conflicts` 模式：
  - 默认：仅提示
  - 严格：除非 `--force`，否则拒绝触发同步（sync）

退出标准：

- 在高风险场景下，系统能阻止误触发的危险执行
