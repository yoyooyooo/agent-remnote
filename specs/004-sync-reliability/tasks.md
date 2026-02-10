# Tasks 004：同步可靠性（默认 notify + 兜底 kick）

> 代码已落地；当前剩余工作以“文档/测试对齐”为主（forward-only）。

- [x] T001 固化需求决策（interval=30s；无进展阈值=30s/90s；StartSync 默认 silent；计数单位=一次 CLI 写入调用）

## 依赖

- [x] D001 先完成 Spec 003（active worker + connId；移除 consumerId），否则 kick/定向与“sent=0”语义无法稳定

## Phase A：CLI 默认实时（P1）

- [x] T010 统一默认值：写入类命令默认 `notify=true` + `ensure-daemon=true`，并支持 `--no-notify/--no-ensure-daemon`
- [x] T011 收敛 ensure：`enqueueOps` 的 ensure 改为 supervisor 模式（避免 `ensureWsDaemon`/`ensureWsSupervisor` 分裂）
- [x] T012 `sent=0` 可见性：非 JSON 输出中必须可见英文提示 + 建议动作（不改变退出码）

## Phase B：bridge kick loop（P1）

- [x] T020 bridge 增加 kick loop（interval=30s；可配置/可关闭；仅队列有活且 active worker 存在时 kick）
- [x] T021 进展信号：维护 `lastDispatchAt/lastAckAt/lastKickAt`，用于无进展升级判定
- [x] T022 无进展升级：30s 重 kick/重选；90s 兜底策略（依赖 Spec 003 的接管能力）

## Phase C：plugin 降噪与自恢复（P1/P2）

- [x] T030 plugin：服务端 StartSync 默认 silent drain（不 toast）；手动命令保留 toast
- [x] T031 可选 watchdog：避免 `syncing=true` 卡死（超时自恢复 + 诊断字段）

## Phase D：进度查询（P1）

- [x] T040 进度查询 UX：新增 `queue progress --txn`（或增强 `queue inspect --txn`）并输出 score/is_done/is_success/nextActions
- [x] T041 score 定义落地（dead 计入完成但标 failed；或其它口径，需在 data-model 与实现一致）

## Phase E：测试与文档（P1）

- [x] T050 契约测试：默认 notify/ensure 生效；`sent=0` 提示可见；基础输出 shape 稳定
- [x] T051 端到端脚本：模拟积压 + kick 唤醒 + 无进展升级（覆盖多窗口 active worker 场景）
- [x] T052 文档同步：更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 与 `docs/guides/ws-debug-and-testing.md`
