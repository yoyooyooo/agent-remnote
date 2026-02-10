# WS 调试与端到端测试指南

开启调试日志

- 启动服务：
  - 根目录：npm run dev:ws:debug
  - 包目录：cd packages/agent-remnote && REMNOTE_WS_DEBUG=1 npm run dev -- daemon serve
- 环境变量：REMNOTE_WS_DEBUG=1（已由脚本注入）
- 日志内容：连接/注册、派发/无任务、确认（成功/重试/死亡）、租约回收计数、StartSync 广播等。

观察状态（无需调试日志）

- CLI：
  - daemon：`agent-remnote --json daemon status`
  - queue：`agent-remnote --json queue stats` / `agent-remnote --json queue inspect --txn <txn_id>`

用脚本模拟“插件端”

- 连接并领取/确认（成功）：
  - npx tsx scripts/ws-cli-test.ts
- 行为：Hello → Register(v2) → RequestOps →（如有）OpDispatchBatch → OpAck(success)
- 结果：`agent-remnote --json queue inspect --txn <txn_id>`（或 `npx tsx scripts/queue-inspect.ts <txn_id>`）可看到 succeeded 与 id_map 映射。

用 wscat 手动调试

- 安装（或直接 npx wscat -c ...）：npm i -g wscat
- 连接：wscat -c ws://localhost:6789/ws
- 发送：
  - {"type":"Hello"}
  - {"type":"Register","protocolVersion":2,"clientType":"debug","clientInstanceId":"wscat","capabilities":{"control":false,"worker":true,"readRpc":false,"batchPull":true}}
  - {"type":"SelectionChanged","selectionType":"debug","totalCount":0,"truncated":false,"remIds":[]}
  - {"type":"RequestOps","leaseMs":15000,"maxOps":1,"maxBytes":512000,"maxOpBytes":256000}
  - （收到 OpDispatchBatch 后，复制 op_id 与 attempt_id）
  - （可选：长 op 续租）{"type":"LeaseExtend","op_id":"<op_id>","attempt_id":"<attempt_id>","extendMs":120000}
  - {"type":"OpAck","op_id":"<op_id>","attempt_id":"<attempt_id>","status":"success","result":{"ok":true}}
  - 可查看统计：{"type":"QueryStats"}
  - 可查看连接：{"type":"QueryClients"}

常见问题

- 看不到日志：默认只打印启动/错误；带 REMNOTE_WS_DEBUG=1 才输出明细；或使用工具/脚本查看状态。
- 无任务（NoWork）：先入队：npx tsx scripts/queue-seed.ts 'create_rem' '{"text":"hello"}'；再检查队列：npx tsx scripts/queue-stats.ts
- 连接太多 Pending：插件侧已改为复用连接；可在插件里用“断开控制通道”命令手动断开并重连。
- 多开执行器导致“看起来不消费”：只有 **active worker** 才允许 `RequestOps`；其它连接会收到 `NoWork(reason='not_active_worker', activeConnId)`。切到目标 RemNote 窗口触发 selection/uiContext 更新即可切换 active worker。
- 看到 `in_flight` 一次变多：执行器默认会做受控并发（见插件 Settings 的 `Sync concurrency`）；同一 Rem/同一父级结构变更仍会自动串行。
- 看不懂派发变少：`OpDispatchBatch.budget/skipped` 会回显 `maxBytes/maxOpBytes` clamp 结果与跳过统计（overBudget/oversizeOp/conflict/txnBusy）；可结合 `agent-remnote --json queue inspect --op <op_id>` 定位具体 op。
