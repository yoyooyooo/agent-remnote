# Contracts: Supervisor 模式下的 CLI 对外接口（命令 + 输出）

**Feature**: `specs/002-daemon-supervisor/spec.md`  
**Date**: 2026-01-23

> 本契约描述 Supervisor 模式下的增量接口约束：命令名保持不变，`--json` shape 允许新增字段。

## `daemon start`

- 行为：启动 Supervisor（detached），Supervisor 再启动 `daemon serve`
- pidfile：写入 Supervisor PID（字段 `pid`）

## `daemon stop`

- 行为：对 Supervisor 发送 SIGTERM；Supervisor 负责优雅关闭 child 并退出
- 强约束：stop 触发的 child 退出不得被当作“异常退出”，不得自动重启

## `daemon status --json`（增强 data shape）

```json
{
  "ok": true,
  "data": {
    "service": {
      "mode": "supervisor",
      "supervisor": { "running": true, "pid": 123, "started_at": 1730000000000 },
      "child": { "running": true, "pid": 456, "started_at": 1730000001000 }
    },
    "supervisor_state": {
      "status": "running",
      "restart_count": 0,
      "restart_window_started_at": 1730000000000,
      "backoff_until": null,
      "last_exit": null,
      "failed_reason": null
    },
    "ws": { "url": "ws://localhost:3010/ws", "healthy": true, "rtt_ms": 12 }
  }
}
```

兼容性：

- 允许未来新增字段；不得删除 `service`、`ws`。
- 若 pidfile/statefile 不存在或损坏，应返回 `ok:true` 并在 `data.service.supervisor.running=false` 上表达“未运行”，同时提供 `hint`（若为 `--json` 失败则走 `ok:false`）。

## `daemon supervisor`（内部命令）

- 对外不保证稳定；仅作为 `daemon start` 的实现细节入口。
