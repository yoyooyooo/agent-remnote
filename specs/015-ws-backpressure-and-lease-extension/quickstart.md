# Quickstart: 015-ws-backpressure-and-lease-extension

> 实现完成后用于本地验收；当前为占位。

## 目标

- 验证 `RequestOps.maxBytes/maxOpBytes` 生效，`OpDispatchBatch` 不超预算且有可诊断统计。
- 验证长 op 在续租下不会被回收重派发；stale extend 会被拒绝。

## 本地验收（建议）

1) 启动 WS bridge：`npm run dev:ws`
2) 启动插件并确认已 `Register(protocolVersion=2, batchPull=true)`。
3) 入队一个大 payload 的写入（或模拟大 payload op），观察 daemon 的 budget/skipped 诊断。
4) 模拟长 op（在插件侧 sleep/延迟 ack），确认 lease_extend 生效且不触发回收重派发。
