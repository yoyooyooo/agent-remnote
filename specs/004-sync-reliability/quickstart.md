# Quickstart 004：同步可靠性（默认 notify + kick）

**Feature**: `specs/004-sync-reliability/spec.md`  
**Date**: 2026-01-24

> 本 Quickstart 用于实现完成后的最小验证闭环（P1）：默认实时 + 长尾兜底 + 无 UI 噪音 + 可查询进度。

## 0) 前置条件

- Spec 003 已落地（active worker + connId；移除 consumerId）。
- WS daemon 已启动：`npm run dev:ws` 或 `agent-remnote daemon ensure`。
- RemNote 插件已连接 WS（control channel 在线）。

## 1) 默认实时（P1）

1. 执行一个写入类命令（例如 `agent-remnote write md ...` / `agent-remnote apply ...`）。
2. 验收：
   - 不需要显式传 `--notify/--ensure-daemon` 也会触发同步（`notified=true`）。
   - 若 `sent=0`：命令退出码仍为 0，但输出中必须给出英文提示与建议动作。

## 2) 降噪（P1）

1. 等待 kick 周期或手动触发一次 `daemon sync`。
2. 验收：
   - 服务端 StartSync 不产生频繁 toast（silent drain）。
   - 手动在插件内点击“Start sync”命令仍可 toast（用户主动行为）。

## 3) 长尾兜底（P1）

1. 构造“写入但未触发消费”的场景（例如临时断开 control channel，或显式 `--no-notify`）。
2. 在插件重新连上后，等待 kick 周期。
3. 验收：
   - kick 会在队列有活且 active worker 存在时唤醒消费。
   - 若长期无进展，会触发无进展升级策略（30s/90s）。

## 4) 进度查询（P1）

1. 拿到写入返回的 `txn_id`。
2. 查询进度（`queue progress --txn` 或增强后的 `queue inspect --txn`）。
3. 验收：能看到 `score/is_done/is_success/nextActions[]`，并可判断是否需要人工介入。
