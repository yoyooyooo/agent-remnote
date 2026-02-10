# Tasks: WS Daemon Supervisor（监工模式）

**Input**: `specs/002-daemon-supervisor/spec.md`, `specs/002-daemon-supervisor/plan.md`, `specs/002-daemon-supervisor/contracts/cli.md`  
**Prerequisites**: `specs/002-daemon-supervisor/plan.md`（required）, `specs/002-daemon-supervisor/spec.md`（required）

## Format: `[ID] [P?] Description`

- **[P]**: 可并行（不同文件、无前置依赖）
- 每条任务包含明确文件路径

---

## Phase 1: Data Model & Contracts

- [x] T001 固化 pidfile/statefile 字段与默认路径：`specs/002-daemon-supervisor/data-model.md`
- [x] T002 固化 `daemon status --json` 增量 shape：`specs/002-daemon-supervisor/contracts/cli.md`

---

## Phase 2: Supervisor 核心实现（最小可用）

- [x] T010 [P] 新增 Supervisor 状态结构与序列化：`packages/agent-remnote/src/services/SupervisorState.ts`
- [x] T011 [P] 新增日志托管与轮转器（stdout/stderr → file + rotate）：`packages/agent-remnote/src/services/LogWriter.ts`
- [x] T012 实现内部命令 `daemon supervisor`（spawn serve、监听 exit、带 backoff/熔断、信号代理）：`packages/agent-remnote/src/commands/ws/supervisor.ts`

---

## Phase 3: 接入现有 start/stop/status

- [x] T020 `daemon start` 改为启动 supervisor（pidfile 指向 supervisor；传递 serve 启动参数）：`packages/agent-remnote/src/commands/ws/start.ts`
- [x] T021 `daemon stop` 针对 supervisor 优雅停机（超时可强杀；清理 pid/state）：`packages/agent-remnote/src/commands/ws/stop.ts`
- [x] T022 `daemon status` 输出 supervisor/child/state，并保持既有字段兼容：`packages/agent-remnote/src/commands/ws/status.ts`
- [x] T023 `daemon restart/ensure` 行为对齐 supervisor 模式：`packages/agent-remnote/src/commands/ws/restart.ts`、`packages/agent-remnote/src/commands/ws/ensure.ts`

---

## Phase 4: 最小验证与回归

- [x] T030 [P] CLI 契约测试：`daemon status --json` shape（无 stderr 污染）：`packages/agent-remnote/tests/contract/daemon-status-supervisor.contract.test.ts`
- [x] T031 [P] CLI 契约测试：`daemon stop` 不触发重启（通过 state 断言）：`packages/agent-remnote/tests/contract/daemon-stop-no-restart.contract.test.ts`
