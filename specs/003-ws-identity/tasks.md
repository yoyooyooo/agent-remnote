# Tasks 003：WS 连接实例标识与活跃会话选举（移除 `consumerId`）

> 代码已落地；当前剩余工作以“文档/脚本/指引对齐”为主（forward-only）。

- [x] T001 固化决策：移除 `consumerId`；以服务端 `connId` 区分实例；active worker 由 UI 活跃度选举
- [x] T010 协议（SSoT）：更新 WS 协议为 vNext（无 `consumerId`；新增 `connId/clientInstanceId`；定义 active worker 与错误 reason）
- [x] T020 core/bridge：为连接分配 `connId`，并在 `Clients`/state file 中暴露（含 active worker 信息）
- [x] T030 core/bridge：实现 active worker 选举 + `RequestOp` gating（`not_active_worker`）
- [x] T040 core/queue：`ops.locked_by` 迁移为 `connId`（含 recover/diagnostics 口径更新）
- [x] T050 plugin：实现 `clientInstanceId` 生成/持久化与注册上报；移除 consumerId 设置/生成
- [x] T060 agent-remnote：移除 consumerId 配置（flags/env）；更新 `ws sync/query-clients` 等命令的定向逻辑与输出
- [x] T070 scripts/tests：更新 ws 调试脚本与端到端模拟（覆盖多窗口选举与接管）
- [x] T080 文档：新增 vNext 草案 `docs/proposals/agent-remnote/ws-bridge-protocol-vnext.md`；更新排障/食谱口径
- [x] T090 Skill：完善 `$remnote`（active worker 心智模型、nextActions、以及“无需用户配置 id”的说明；仅维护全局 `$remnote`，不提供项目级覆盖）
