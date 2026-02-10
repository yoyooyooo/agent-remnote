# Feature Specification: tmux statusline cleanup

**Feature Branch**: `014-tmux-statusline-cleanup`  
**Created**: 2026-01-26  
**Status**: Accepted  
**Input**: 用户描述：「彻底修复 agent-remnote daemon 停止/重启后 tmux statusline RN 段残留显示，确保 stop/restart/status 等操作会清理所有相关展示缓存并触发即时刷新。」

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stop 后立刻消失 (Priority: P1)

作为 tmux 用户，当我执行 `agent-remnote daemon stop`（无论 daemon 是否仍在运行），tmux statusline 里的 RN 段都应当**立刻消失**，而不是继续显示旧状态一段时间。

**Why this priority**: 这是用户对“stop”的直觉语义；残留显示会误导后续判断（例如以为 daemon 仍在线/仍有连接），并造成排障噪音。

**Independent Test**: 在本地创建/模拟一个“可导致 RN 段显示”的状态，然后执行 `agent-remnote daemon stop`，验证 RN 段在极短时间内消失，且相关展示缓存不再存在或已被清空。

**Acceptance Scenarios**:

1. **Given** RN 段当前可见（代表“daemon up 或曾经 up”），**When** 执行 `agent-remnote daemon stop` 成功返回，**Then** RN 段在 1 秒内消失，并且后续不会因为旧缓存再度出现。
2. **Given** daemon 已不在运行但仍遗留展示缓存导致 RN 段可见，**When** 执行 `agent-remnote daemon stop`，**Then** RN 段在 1 秒内消失，并且缓存被清理（stop 具有“自愈/幂等清理”能力）。
3. **Given** 用户重复执行 `agent-remnote daemon stop`，**When** stop 反复运行，**Then** 每次都稳定返回成功且不会引入新的残留状态（幂等）。

---

### User Story 2 - Restart/失败路径不残留 (Priority: P2)

作为用户，当我执行 `agent-remnote daemon restart` 时，无论 restart 最终是否启动成功，tmux statusline 都不应继续显示 restart 前的旧状态（尤其是 “connected/selection” 等误导信息）。

**Why this priority**: restart 是“先 stop 再 start”的组合动作；如果中间或失败路径不清理，用户会被旧状态误导，且很难区分“新实例是否已起来”。

**Independent Test**: 构造“restart 前 RN 段可见”的条件，并在 restart 失败/成功两种情况下验证：旧状态不会残留；失败时应表现为“down/隐藏”。

**Acceptance Scenarios**:

1. **Given** RN 段当前显示为“connected”或带 selection，**When** 执行 `agent-remnote daemon restart`，**Then** stop 阶段完成后旧状态立刻消失；start 成功后状态由新实例重新驱动；start 失败时 RN 段保持隐藏/down。
2. **Given** restart 过程中出现错误（例如启动失败），**When** 命令退出，**Then** tmux 不会继续显示 restart 前的旧状态。

---

### User Story 3 - 非正常停止也不误显示“还在线” (Priority: P3)

作为用户，当 daemon 因为非 `daemon stop` 的方式退出（例如收到终止信号、异常退出），tmux statusline 不应长期显示“还在线/还连接着”的状态。

**Why this priority**: 现实中 daemon 可能被外部终止或崩溃；如果 tmux 继续显示旧状态，会显著降低系统可信度。

**Independent Test**: 在 RN 段可见时，通过“非 stop”的方式让 daemon 退出，然后验证 tmux 在合理时间内隐藏 RN 段（不依赖长时间的过期窗口）。

**Acceptance Scenarios**:

1. **Given** RN 段可见且 daemon 正在运行，**When** daemon 收到常见终止信号并退出，**Then** tmux 在 1 秒内隐藏 RN 段（或在下一个刷新周期内隐藏），且不会继续显示旧 selection/connected 信息。
2. **Given** RN 段可见但 daemon 已经不在运行，**When** tmux 下一次刷新/评估状态，**Then** RN 段必须隐藏（旧缓存不得导致“看起来还在线”）。

---

### Edge Cases

- 多个 tmux client 同时显示 RN 段：任一 stop/restart 后都应同时刷新到“隐藏/一致”。
- stop/restart 在非 tmux 环境下执行：仍应触发 tmux 侧尽快刷新（不依赖长时间过期窗口）。
- 用户自定义了状态/缓存文件路径：stop/restart/status 的清理必须作用于“实际被 statusline 使用”的路径，而不是误删其它文件或漏删目标。
- daemon 进程异常退出导致遗留缓存：tmux 不应长期误显示“connected/selection”。
- tmux 未安装或不可用：系统仍应完成清理，但“立即刷新”可退化为等待 tmux 自身的下一次刷新周期。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `agent-remnote daemon stop` 成功返回后，tmux statusline 的 RN 段必须在 1 秒内隐藏（或在下一个刷新周期内隐藏），不得再显示 stop 前的旧状态。
- **FR-002**: `agent-remnote daemon stop` 必须具备幂等清理能力：即使 daemon 已不在运行，只要存在会导致 RN 段显示的“展示缓存/快照”，也必须将其清理/置空并触发刷新。
- **FR-003**: `agent-remnote daemon restart` 的 stop 阶段必须达到与 `daemon stop` 相同的清理效果；若 restart 的 start 阶段失败，tmux 不得继续显示旧状态。
- **FR-004**: `agent-remnote daemon status`（或等价的状态查询入口）在检测到 daemon 不在运行且存在明显残留缓存时，应执行安全的自愈清理或提供明确提示，使“显示状态”与“真实运行状态”一致。
- **FR-005**: 当用户配置了自定义路径（状态/缓存文件、tmux statusline 数据源等），清理必须作用于“实际被 statusline 使用”的目标路径，避免路径不一致导致漏清理。
- **FR-006**: 清理过程必须是 best-effort：清理失败不得阻止 stop/restart 的核心语义（停止/重启进程），但必须提供可诊断信息以便排查（例如哪些缓存未能删除/置空、为何失败）。
- **FR-007**: stop/restart/status 的清理不得删除用户的持久数据（例如写入队列 DB）与排障日志（除非用户显式要求）。

*Example of marking unclear requirements:*

（本需求不使用 [NEEDS CLARIFICATION]；如后续发现关键分歧，进入 `/speckit.clarify`）

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: stop/restart/status 的“清理 + 刷新”必须是低风险操作：默认不执行破坏性删除（除展示缓存外），并且在异常情况下可回滚/可重试（幂等）。
- **NFR-002**: 诊断信息必须可行动：当无法清理/刷新时，输出应指向用户可以采取的下一步（例如检查 tmux 是否可用、检查路径配置是否一致）。
- **NFR-003**: 状态一致性优先于“显示更丰富”：在无法确认 daemon 仍在线时，宁可隐藏 RN 段也不要显示可能过期的 selection/connected 信息。

### Assumptions & Dependencies

- 用户是通过“官方提供的 tmux RN 段”或“statusline file 模式”之一来展示状态；本需求目标是让这些官方路径在 stop/restart/status 下不残留、不误导。
- “立刻刷新”依赖 tmux 在当前环境中可用；不可用时允许退化为等待 tmux 自身的下一次刷新周期，但不得继续显示可能过期的在线/连接信息。
- 不承诺覆盖不可捕获的强制终止带来的瞬时残留；但在下一次刷新周期内必须隐藏，避免长期误显示。

### Key Entities *(include if feature involves data)*

- **Statusline Segment (RN)**: tmux statusline 中用于展示 RemNote daemon 状态的片段；可见/不可见是最重要的用户感知信号。
- **展示缓存/快照**: 任何会被 statusline 读取并导致 RN 段显示的本地工件（例如“最后快照”与“statusline file 模式的输出文件”）。
- **运行态工件**: daemon/supervisor 为运行与自愈而写入的进程/状态信息（用于 stop/status 识别“是否在跑/是否 stale”）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在 RN 段可见的情况下执行 `agent-remnote daemon stop`，RN 段在 1 秒内隐藏（或在下一个刷新周期内隐藏），且不会因旧缓存再次出现。
- **SC-002**: 在 daemon 已不在运行但残留缓存存在的情况下执行 `agent-remnote daemon stop`，RN 段在 1 秒内隐藏（或在下一个刷新周期内隐藏），表现与“真正 stop”一致（自愈幂等）。
- **SC-003**: 执行 `agent-remnote daemon restart`：无论 start 成功或失败，tmux 都不会持续显示 restart 前的旧状态。
- **SC-004**: 当 daemon 不在运行时，tmux 不会显示“connected/selection”类的误导信息；最坏情况下在下一次刷新周期内隐藏。
