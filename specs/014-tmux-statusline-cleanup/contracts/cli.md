# Contracts 014：CLI（stop/restart/status 的展示工件清理）

**Feature**: `specs/014-tmux-statusline-cleanup/spec.md`  
**Date**: 2026-01-26

> 目标：把 tmux RN 段显示从“依赖 stale 窗口自然过期”升级为“命令语义驱动的即时对齐”。

## 展示工件（Display Artifacts）

以下工件会影响 tmux/CLI 的“是否显示 RN 段”：

- Bridge snapshot：`ws.bridge.state.json`
- Status line file mode：`status-line.txt`（+ debug json）

stop/restart/status 在合适时机必须清理这些工件（best-effort）。

## 路径来源（Source of Truth）

- 若 pidfile 存在且包含扩展字段：以 pidfile 中记录的路径为准进行清理。
- 若 pidfile 缺失或无扩展字段：回退到当前 CLI 解析出的 config 路径（env/默认）。

## `agent-remnote daemon stop`

语义：

1. 尝试停止 daemon/supervisor 进程（若存在）。  
2. 无论 daemon 是否仍存活，只要 stop 判定为“已停止/无进程”，必须执行展示工件清理并触发 tmux 刷新。  

清理要求：

- 删除 bridge snapshot（若存在）
- 将 status-line file 置空（或删除）
- best-effort 刷新 tmux（全 clients；失败可忽略但应可诊断）

## `agent-remnote daemon restart`

语义：

- stop 阶段必须达到与 `daemon stop` 相同的清理效果。  
- start 阶段若失败，必须保持“已清理”的最终状态（不得回滚为旧状态）。

## `agent-remnote daemon status`

自愈要求：

- 若 pidfile 存在但 pid 不存活：应视为 stale，清理 pidfile/supervisor state，并清理展示工件，避免 tmux 误显示。  

## 非破坏性默认

- 不得删除队列 DB、日志等持久/排障证据；清理仅限展示工件与明显 stale 的运行态工件（pidfile/state）。
