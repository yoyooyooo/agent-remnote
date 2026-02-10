# Implementation Plan: WS Daemon Supervisor（监工模式）

**Branch**: `002-daemon-supervisor` | **Date**: 2026-01-23 | **Spec**: `specs/002-daemon-supervisor/spec.md`  
**Input**: Feature specification from `specs/002-daemon-supervisor/spec.md`

## Summary

把现有 `agent-remnote daemon` 从“CLI 直接 detached 启动 serve”升级为“三层（CLI → Supervisor → serve）”：
- Supervisor 负责 keep-alive（异常退出自动拉起、带熔断/退避）；
- Supervisor 负责信号代理（优雅停机，stop 不触发重启）；
- Supervisor 负责日志托管与轮转（stdout/stderr 管道 → 文件，限制磁盘增长）；
- CLI `daemon status --json` 提供可诊断状态（supervisor/child/lastExit/restarts/backoff/failures）。

## Technical Context

- **Language/Runtime**: Node.js 20+，TypeScript ESM
- **Package**: `packages/agent-remnote`（对外包名 `agent-remnote`）
- **Constraints**: 不直接改写 RemNote 官方 DB；写入仍走队列 + 插件执行器；本需求仅影响 WS daemon 的进程管理层

## Design Decisions

### Supervisor 入口

- 新增内部命令：`agent-remnote daemon supervisor`
- `daemon start` 改为启动 `daemon supervisor`（detached）
- `daemon serve` 保持现有业务职责（WS bridge）

### 状态文件

- pidfile：`~/.agent-remnote/ws.pid`（指向 Supervisor；包含最近一次 child pid）
- statefile：`~/.agent-remnote/ws.state.json`（重启计数、窗口、backoff、lastExit、failed 原因）
- logfile：`~/.agent-remnote/ws.log`（由 Supervisor 写入）

### 重启策略（默认值）

- `maxRestarts`：10
- `restartWindowMs`：60_000
- `baseBackoffMs`：500
- `maxBackoffMs`：10_000
- 进入 failed 后不再自动重启，直到用户显式 `daemon restart`/`daemon start`

### 日志轮转（默认值）

- `logMaxBytes`：20 MiB
- `logKeep`：5
- rotate 语义：关闭旧 fd → rename → 打开新 fd（确保写入切到新文件）

## Testing Strategy（最小）

- 构建与 `--help`/`--version` 基础可运行
- 增加 CLI 契约测试（若可用）：`daemon status --json` shape、`stop` 不触发重启、熔断状态可观察
- 不引入长驻不稳定测试：自愈/轮转可用脚本式集成测试（可选，非强依赖）
