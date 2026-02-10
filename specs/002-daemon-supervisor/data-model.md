# Data Model: WS Daemon Supervisor（监工模式）

**Feature**: `specs/002-daemon-supervisor/spec.md`  
**Date**: 2026-01-23

## 文件布局（默认）

- `~/.agent-remnote/ws.pid`：pidfile（JSON；Supervisor 为权威）
- `~/.agent-remnote/ws.state.json`：statefile（JSON；重启/熔断/lastExit）
- `~/.agent-remnote/ws.log`：logfile（append；由 Supervisor 写入）
- `~/.agent-remnote/ws.log.*`：轮转历史（最多 `logKeep` 个）

## PidFile（ws.pid）

> 兼容性原则：允许新增字段；实现应在字段缺失时降级推断。

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `mode` | `"supervisor"` | 固定值 |
| `pid` | number | Supervisor PID（保留 `pid` 便于现有逻辑复用） |
| `child_pid` | number \| null | 最近一次 child PID（可为空） |
| `started_at` | number | Supervisor 启动时间（epoch ms） |
| `ws_url` | string | WS 目标 URL（供 health/status） |
| `log_file` | string | 日志文件路径 |
| `state_file` | string | 状态文件路径 |
| `cmd` | string[] | Supervisor 启动命令摘要 |

## StateFile（ws.state.json）

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `"running" \| "backing_off" \| "failed" \| "stopping"` | Supervisor 状态机 |
| `restart_count` | number | 当前窗口内重启次数 |
| `restart_window_started_at` | number | 计数窗口起点（epoch ms） |
| `backoff_until` | number \| null | 退避结束时间（epoch ms） |
| `last_exit` | object \| null | 最近一次 child 退出信息 |
| `failed_reason` | string \| null | 熔断原因（如超阈值） |

`last_exit` 建议：

| 字段 | 类型 | 说明 |
|---|---|---|
| `at` | number | 退出时间 |
| `code` | number \| null | exit code |
| `signal` | string \| null | signal |
| `reason` | string \| null | 归一化原因（例如 `CRASH`/`SIGKILL`/`SPAWN_FAILED`） |
