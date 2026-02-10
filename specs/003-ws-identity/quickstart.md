# Quickstart 003：WS 连接身份与 active worker（移除 `consumerId`）

**Feature**: `specs/003-ws-identity/spec.md`  
**Date**: 2026-01-24

> 本 Quickstart 用于实现完成后的最小验证闭环（P1）：多窗口下“最近会话唯一消费”、掉线可接管、read-rpc 并发不串包的前置能力。

## 0) 前置条件

- WS bridge 已启动（示例：仓库根目录 `npm run dev:ws`）。
- RemNote 客户端已安装并打开本仓库插件，且至少打开两个窗口（或两端）同时连接 WS。

## 1) 多窗口：最近会话唯一消费（P1）

1. 同时保持两个 RemNote 窗口连接。
2. 在窗口 A 中产生 UI 活动（selection/uiContext 更新）。
3. 通过 `agent-remnote daemon status --json`（实现后输出应包含 `connId/isActiveWorker/clientInstanceId`）确认：
   - A 的连接被选为 `isActiveWorker=true`
   - B 的连接为 `isActiveWorker=false`
4. 在窗口 B 操作后，应观察到 active worker 迁移到 B。

验收口径：

- 非 active worker 请求任务时返回 `NoWork(reason='not_active_worker', activeConnId)`（不再使用 `worker_busy/consumerId`）。

## 2) 接管：active worker 掉线自动迁移（P1）

1. 关闭 active worker 所在窗口或断开其 WS。
2. 观察服务端在 staleness/close 触发后自动选举下一候选连接接管。

## 3) 同步触发：默认只触发 active worker（P1）

1. 执行：`agent-remnote daemon sync --ensure-daemon`
2. 期望响应：`sent=1`，并带 `activeConnId`。
3. 若无 active worker：返回 `sent=0` + `nextActions[]`（英文句子，指导用户切到目标窗口触发 selection 更新等）。
