# Feature Specification: WS Daemon Supervisor（监工模式）

**Feature Branch**: `002-daemon-supervisor`  
**Created**: 2026-01-23  
**Status**: Accepted  
**Accepted**: 2026-01-26  
**Input**: 用户描述：为 `agent-remnote daemon` 引入“Supervisor（监工）模式”，把现有“两层（CLI → 业务进程）”演进为“三层（CLI → Supervisor → 业务进程）”，以获得可用性（崩溃自动拉起）、可维护性（统一信号与停机语义）、可诊断性（统一日志托管与轮转）。

## Clarifications

### Session 2026-01-23

- Q: PID 文件记录谁？ → A: 记录 **Supervisor** 的 PID（以及最近一次 child PID），Supervisor 是停机/重启策略的唯一权威。
- Q: Supervisor 是否处理 RemNote 业务？ → A: 不处理。仅负责：启动/监听/重启子进程；信号代理；日志托管/轮转；状态落盘。
- Q: 何时重启？ → A: **仅在异常退出**时重启；当 Supervisor 收到 stop 信号并主动终止子进程时，视为“正常停机”，不得重启。
- Q: 是否追求 PM2 全量功能？ → A: 否。本需求只覆盖最小“高可用守护 + 优雅停机 + 日志轮转 + 可诊断状态”。
- Q: CLI 接口是否破坏性变更？ → A: 对外命令保持 `daemon start/stop/status/health/ensure/logs` 不变；内部新增 `daemon supervisor`（可隐藏在 `--help` 之外）；`status --json` 的 `data` shape 允许新增字段。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 高可用后台服务（Priority: P1）

作为开发者/Agent，我希望 WS 后台服务具备“自愈能力”：当业务进程崩溃时自动拉起，并且 `daemon stop` 能稳定、可预期地停止整个服务（不残留孤儿进程）。

**Independent Test**:

1. 启动：`agent-remnote daemon start` 后，`daemon status --json` 显示 `supervisor.running=true` 且 `child.running=true`。
2. 自愈：人为杀掉子进程（仅 child PID），`daemon status --json` 在短时间内显示 child 被重启（`restart_count` 增加，`child.pid` 发生变化）。
3. 停机：`agent-remnote daemon stop` 后，`daemon status --json` 显示 supervisor/child 均不运行，pidfile/state 文件被清理或进入 stopped 状态。

### User Story 2 - 可控日志与磁盘安全（Priority: P2）

作为用户，我希望后台日志不会无限增长占满磁盘，且轮转行为可预测（保留有限个历史日志文件）。

**Independent Test**:

1. 设定较小轮转阈值（通过 flags/env），产生足够日志。
2. 观察 log 文件发生轮转：当前 log 继续写入，新文件大小重新从小开始；历史 log 文件数量不超过保留上限。

### User Story 3 - 可诊断状态（Priority: P3）

作为开发者/Agent，我希望 `daemon status --json` 能准确表达：Supervisor/子进程存活状态、最近一次退出原因、当前是否处于 backoff/熔断、以及下一步可行动提示。

## Functional Requirements

- **FR-001**: 系统 MUST 引入 Supervisor 进程，作为 `daemon start/stop/status` 的管理对象（pidfile 指向它）。
- **FR-002**: Supervisor MUST 以子进程方式启动 `daemon serve`，并监听退出事件。
- **FR-003**: Supervisor MUST 实现“有界重启策略”：在时间窗口内限制重启次数，采用退避（backoff），并在超过阈值后进入 failed 状态（不再自动重启）。
- **FR-004**: Supervisor MUST 实现“信号代理”：收到 SIGTERM/SIGINT 时，先优雅停止子进程，等待退出后自身退出；该路径不得触发重启。
- **FR-005**: 子进程 stdout/stderr MUST 通过管道交给 Supervisor；Supervisor 负责写入 log 文件。
- **FR-006**: Supervisor MUST 支持日志轮转：当 log 文件超过阈值时，执行 rotate（重命名旧文件 + 继续写入新文件），并限制历史文件数量。
- **FR-007**: `daemon status --json` MUST 输出 Supervisor 与 child 的状态，并包含重启/退避/熔断的关键字段（详见 `contracts/cli.md`）。
- **FR-008**: CLI MUST 在 Supervisor 缺失/崩溃场景下具备“兜底可行动”行为：识别 stale pid/state，并给出可执行提示（必要时清理 stale 文件）。

## Scope & Non-Goals

### In Scope

- 单服务（WS daemon）守护与重启；单机单用户。
- `daemon start/stop/status/ensure/logs` 行为升级为 Supervisor 模式。
- 基于文件的状态记录（pidfile/state/logs），用于可诊断与恢复。

### Out of Scope

- 多应用管理、cluster、watch & reload、远程管理、监控面板、日志压缩上传。
- 对 RemNote 插件协议/队列协议的破坏性更改。

## Compatibility & Migration

- 对外命令保持不变；仅增强 `status`/`start` 的语义。
- pidfile 字段允许新增/演进；实现应在一段过渡期内容忍旧字段缺失（以提升鲁棒性）。
