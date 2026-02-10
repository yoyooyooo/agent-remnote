# Contracts 004：WS kick（StartSync 兜底策略）

**Feature**: `specs/004-sync-reliability/spec.md`  
**Date**: 2026-01-24

> 本契约依赖 Spec 003 的 vNext 协议：active worker 唯一消费、移除 `consumerId`。kick 的目标必须是 active worker。

## StartSync（Server → Plugin）

- 消息形状沿用现有 `{ "type": "StartSync" }`（不要求新增字段）。
- 插件必须把该触发视为“服务端兜底/自动触发”，默认 **silent drain**：
  - 不 toast
  - 只做一次 drain loop（直到 NoWork）

## TriggerStartSync（CLI/Producer → Server）

> 作为人工触发或 CLI notify 的底层消息；实现上可以复用该消息承载 kick（由 server 定时发送给自己/内部调用），但对外行为口径一致。

期望语义（vNext）：

- 默认只触发 active worker（sent=1）；
- 若无 active worker：返回 `sent=0` + `reason='no_active_worker'` + `nextActions[]`（英文句子）。

## Kick loop（Server internal）

- 默认 interval=30s（可配置/可关闭）
- 仅在以下条件均满足时触发：
  - 存在 active worker
  - 队列存在“可执行工作”（pending & due）
  - 满足 cooldown（避免短时间重复 kick）
- 无进展升级（基于 `lastDispatchAt/lastAckAt`）：
  - 30s 无进展：重 kick / 重新选举 active worker
  - 90s 无进展：执行兜底策略（由 Spec 003 的接管能力定义）
