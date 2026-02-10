# Contracts 014：tmux helper（RN 段隐藏判定）

**Feature**: `specs/014-tmux-statusline-cleanup/spec.md`  
**Date**: 2026-01-26

> 目标：tmux RN 段宁可“隐藏”也不要误显示“connected/selection”；当 daemon 不在运行时必须尽快隐藏。

## Inputs

- Bridge snapshot：`ws.bridge.state.json`（可 env 覆盖/禁用）
- Daemon pidfile：`ws.pid`（用于 pid gate；必要时支持 env 覆盖）
- Queue DB（可选，仅用于 `↓N`）

## Rules

1. **Pid gate 优先**：当 pidfile 存在且 pid 不存活时，无论 snapshot 是否“新鲜”，必须输出空（隐藏 RN 段）。  
2. **Snapshot staleness**：当 snapshot 缺失或 stale 时，输出空（隐藏 RN 段）。  
3. **无客户端**：当 snapshot 不 stale 且 clients=0 时，可输出灰底 `RN`。  
4. **有客户端**：当 snapshot 不 stale 且 clients>0 时，可输出暖底 `RN/TXT/N rems`（与现有约定一致）。  

## Fallback

当 fast path（`jq` 或 snapshot）不可用时，可 best-effort 调用 `agent-remnote daemon status-line`；若其输出为空则隐藏 RN 段。
