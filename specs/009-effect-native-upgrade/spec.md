# Feature Specification: Effect Native Upgrade（全链路 Effect Native 化）

**Feature Branch**: `[009-effect-native-upgrade]`  
**Created**: 2026-01-25  
**Status**: Accepted  
**Accepted**: 2026-01-25  
**Input**: User description: “整体把 CLI/daemon 相关的异步与副作用面向 Effect Native 收口；其中包含 tmux statusLine 的文件缓存模式 + 事件驱动刷新，并要求 daemon 不可达时也能直观看到队列待同步数（↓N）。”

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CLI/Agent 使用者：无感升级且状态栏更直观 (Priority: P1)

作为 `agent-remnote` 的使用者（人类或上层 Agent/脚本），我希望在进行一次“全链路 Effect Native 化”的大重构后，核心工作流依然可用；如果发生 breaking change（本仓为 forward-only，不提供向后兼容层），必须把变化点显式记录到裁决文档/README，并同步更新 contract tests 作为新基线。同时 tmux 右下角能稳定显示：

- 连接状态（RemNote/daemon 是否可用）
- selection 数量（沿用既有语义）
- 队列待同步数：`↓N`（N 表示队列中尚未同步到插件/客户端的操作数量）

**Why this priority**: 这是一切架构升级的前提：即使允许 breaking change，也必须避免“无谓破坏”；状态栏则是最高频的运维/直觉反馈入口。

**Independent Test**: 现有 CLI contract tests + 新增“状态栏文件输出契约测试”即可独立验收（无需真实 RemNote 环境）。

**Acceptance Scenarios**:

1. **Given** 升级后的对外契约（可能 breaking，且已在 docs/README 中记录），**When** 执行更新后的 CLI contract tests（以及 `--json` 输出约束），**Then** 全部通过（作为新契约基线的证据）。
2. **Given** tmux 的 status-right 配置为读取 statusLine 文件，**When** 队列入队后 daemon 不可达，**Then** statusLine 仍能在合理时间内显示 `↓N`，且不会刷到过于频繁。
3. **Given** daemon 可达且插件已连接，**When** selection 变化/入队/ack 发生，**Then** statusLine 能在关键点及时更新，并收敛到正确最终值。

---

### User Story 2 - 维护者：异步/副作用全部在 Effect 里可组合、可取消、可测试 (Priority: P1)

作为仓库维护者，我希望把所有“异步控制流 + 资源生命周期 + 副作用执行”（timer、WebSocket、子进程、文件 IO、worker、长驻 daemon 生命周期等）统一建模在 Effect runtime 下，通过 Service/Layer/Scope/Queue/Fiber 等能力实现：

- 统一的取消语义（可中断、可超时、可组合）
- 统一的节流/防抖/背压（收口到 Actor/Controller）
- 统一的资源获取与释放（acquireRelease / Scope）
- 可测性（尤其是时钟、超时、重试、并发竞争）

**Why this priority**: 这波升级的核心价值是“可维护性与可验证性”；如果仍大量依赖手写 Promise/timer/callback，就无法获得 Effect 的系统性收益。

**Independent Test**: 静态边界门禁 + contract tests（无需真实 RemNote 环境）。

**Acceptance Scenarios**:

1. **Given** 代码库，**When** 运行“禁止非收口点的 raw timers/Promise/child_process 调用”的静态门禁，**Then** 不出现违规（或违规有明确 whitelist）。
2. **Given** 任意一个带超时/重试/取消的命令（例如 ws health、search-plugin、write wechat outline），**When** 触发超时或中断，**Then** 不遗留悬挂 timer / 未关闭 socket / 未回收 worker / 未关闭文件句柄。

---

### User Story 3 - 运维：daemon/bridge 生命周期更清晰且可诊断 (Priority: P2)

作为运维/调试者，我希望 daemon/bridge 的生命周期管理更结构化：启动/停止/心跳/踢人/状态文件写入都由 Effect 管理，避免“隐式 setInterval + 多处 try/catch 静默失败”导致的不可控状态。

**Independent Test**: contract tests +（可选）脚本化 smoke tests。

**Acceptance Scenarios**:

1. **Given** daemon 运行中，**When** 触发 stop/restart，**Then** 资源能被 Scope 正确释放（端口释放、timer 停止、文件句柄关闭），且 pid/state/log 文件保持一致语义。
2. **Given** 多窗口/多连接，**When** active worker 选举发生变化，**Then** 状态栏与状态文件能及时反映选举结果（并受统一节流策略约束）。

---

### Edge Cases

- tmux 不存在 / 不在 tmux session 内：刷新请求 MUST 静默失败且不影响主流程。
- daemon 不可达：statusLine 仍应展示 `↓N`（至少队列待同步数可见）。
- ws state file 缺失或 stale：连接/selection 信息不可用时，不应输出误导信息；但队列 `↓N` 仍应尽可能展示。
- 高并发触发：短时间内多次入队/ack/selection 变化 MUST 合并处理，避免 tmux 刷新风暴。
- `--json` 模式：stdout 纯净单行 JSON，stderr 为空（不可被 statusLine 刷新污染）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MAY 引入 breaking change（forward-only，不提供向后兼容层）；任何 breaking change MUST 同步更新 `docs/ssot/agent-remnote/**`、`README.md` / `README.zh-CN.md` 与相关 contract tests，并提供最小迁移说明（可执行的 nextActions）。
- **FR-002**: 系统 MUST 将所有异步/副作用执行收口为 Effect Service/Layer（定时器、WebSocket client/server、子进程、文件 IO、worker、长驻 runtime 生命周期），并避免在业务逻辑中直接使用 `setTimeout`/`new Promise`/`spawn`/`fs.*` 等原语。
- **FR-003**: 系统 MUST 引入 `StatusLineController`（Actor/Controller）作为唯一 statusLine 更新入口，负责事件合并、节流/背压、计算与输出。
- **FR-004**: 系统 MUST 支持 tmux 从“缓存文件”读取 statusLine（而不是每次 spawn node 命令计算），并以事件驱动方式触发 `tmux refresh-client -S`。
- **FR-005**: 当 daemon 不可达时，CLI MUST 仍能更新 statusLine（至少包含 `↓N` 队列待同步数），以提供直观反馈。
- **FR-006**: 系统 MUST 提供稳定的刷新频率控制（默认最小间隔 250ms，可 env 覆盖），并对 burst 事件做合并，避免过于频繁刷新。
- **FR-007**: 系统 SHOULD 提供“跨进程触发刷新”的统一机制：CLI 优先请求 daemon 合并刷新；失败时 fallback 本地刷新（符合 FR-005）。
- **FR-008**: 系统 MUST 保持安全红线：禁止直接修改 RemNote 官方数据库；所有写入仍必须走“队列 → WS bridge → RemNote 插件执行器”链路。
- **FR-009**: 系统 MUST 禁止通过 `process.env = ...` 方式跨模块注入配置；所有 env 解析必须集中在配置层（services/config），并以显式参数传递给 runtime/kernel。
- **FR-010**: 系统 MUST 引入可移植内核 `packages/agent-remnote/src/kernel/**`：不依赖 Node/Effect、不读 env、不触达 IO 原语；内核通过 `Cmd[]` 表达意图，由 `runtime/**` Actor 解释执行（见 `specs/009-effect-native-upgrade/contracts/portable-kernel-and-actors.md`）。

### Non-Functional Requirements (Performance & Testability)

- **NFR-001**: statusLine 刷新 MUST 低成本：tmux 渲染不应触发 node/tsx 启动；刷新应为“读文件 + refresh-client”。
- **NFR-002**: Effect 化 MUST 提升可测试性：关键异步逻辑应可通过 TestClock/Deterministic scheduling 做稳定测试，减少 flaky timeout。
- **NFR-003**: MUST 保持可诊断性：错误码/诊断字段/状态文件关键字段保持稳定；新增机制应提供最小必要的调试开关与可观测字段。
- **NFR-004**: MUST 避免引入可观测性能退化（CLI 启动、入队、ws health、search-plugin、daemon 派发/心跳等关键路径）。
- **NFR-005**: 写入链路 MUST 支持 write-first：写入命令应直接尝试入队（必要校验内化），并在成功时返回可行动的 `nextActions`（英文命令，指向 inspect/progress/sync 等）；失败时返回稳定错误码与可修复提示。`--json` 输出保持单一 envelope 且 stderr 为空，`--ids` 输出保持 stdout 纯 ids 且 stderr 为空。
- **NFR-006**: 关键改造 MUST 配套单元测试（避免仅靠人工验证）：测试应尽量确定性（TestClock/可控 mock），并按 `specs/009-effect-native-upgrade/contracts/testing-strategy.md` 的对齐矩阵落到具体 tests 文件中。

### Assumptions & Dependencies

- 引入可移植内核 `packages/agent-remnote/src/kernel/**` 并新增静态门禁锁死其“无 Node/无 Effect/纯确定性”的约束；`packages/agent-remnote/src/internal/**` 视为 legacy 存量，009 期间逐步拆解迁移到 `kernel/**` + `services/**` + `runtime/**`。
- tmux 侧允许修改配置为读取缓存文件（已确认）。
- plugin 侧可在后续阶段考虑“结构化并发”改造，但本需求的硬约束优先聚焦 CLI/daemon（插件改造可作为 P3/可选）。

### Key Entities *(include if feature involves data)*

- **StatusLine File**: tmux 读取的单行文本缓存（包含连接/selection/`↓N` 等片段）。
- **StatusLine Model**: 由 ws state + queue stats 聚合出的中间结构（用于渲染字符串）。
- **Runtime Events**: `SelectionChanged` / `UiContextChanged` / `QueueEnqueued` / `OpDispatched` / `OpAcked` / `DaemonHealthTick` 等。
- **Kernel Cmds**: 内核输出的“意图命令”（例如 `WriteStatusLine` / `WsSend` / `QueueStatsRequest`），由 runtime/services 解释执行。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 受影响的 CLI 契约测试（`packages/agent-remnote/tests/contract/*.contract.test.ts`）已按新契约更新并全部通过（作为新的对外契约基线证据）。
- **SC-002**: statusLine 在高频事件下不会形成刷新风暴：在 burst 输入下刷新频率受最小间隔控制且最终状态正确收敛。
- **SC-003**: daemon 不可达时，队列 `↓N` 仍能出现在 statusLine 文件中，并被 tmux 渲染（作为 FR-005 的硬证据）。
- **SC-004**: 引入静态门禁：在预期范围内禁止 raw timers/Promise/spawn/sync-fs 直接出现在非收口层（或有明确 whitelist），避免回退到命令式异步。
- **SC-005**: `kernel/**` 可移植性门禁生效：禁止任何 Node/Effect/平台依赖进入内核（或有明确 whitelist），确保内核可重放且可被替换实现承载。
