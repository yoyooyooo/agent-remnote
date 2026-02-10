# Help Contract（增量）：Supervisor 模式相关

**Feature**: `specs/002-daemon-supervisor/spec.md`  
**Date**: 2026-01-23

> 本文件只描述 Supervisor 模式相关的增量；完整命令树以当前实现的 `agent-remnote --help` 输出为准。

## `daemon start`

新增/调整（可选）：

- `--supervisor`：强制以 supervisor 模式启动（默认即为 true；保留该 flag 仅用于未来回退/实验）
- `--max-restarts <n>`
- `--restart-window-ms <ms>`
- `--backoff-ms <ms>`
- `--log-max-bytes <bytes>`
- `--log-keep <n>`

## `daemon status`

- `--json` 输出新增 `service.mode/service.supervisor/service.child/supervisor_state` 字段（见 `contracts/cli.md`）。
