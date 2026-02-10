# Tasks: tmux statusline cleanup (014)

**Input**: Design documents from `specs/014-tmux-statusline-cleanup/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`  
**Tests**: REQUIRED（本仓库 CLI/daemon 变更默认需要最小 contract 覆盖，符合 Constitution “可验证性”）

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件/无依赖）
- **[Story]**: [US1]/[US2]/[US3]（仅用户故事阶段任务需要）
- 每条任务必须包含明确的文件路径

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 为“展示工件清理”建立可复用的最小基础模块

- [X] T001 Create a shared cleanup helper in `packages/agent-remnote/src/lib/statuslineArtifacts.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 全部 user stories 共享的底座（路径一致性 + tmux 全 client 刷新）

- [X] T002 [P] Extend pidfile model to include artifact paths in `packages/agent-remnote/src/services/DaemonFiles.ts`
- [X] T003 Update daemon start pidfile writes to persist artifact paths in `packages/agent-remnote/src/commands/ws/_shared.ts`
- [X] T004 Update supervisor runtime pidfile writes to persist artifact paths in `packages/agent-remnote/src/runtime/supervisor/runSupervisorRuntime.ts`
- [X] T005 [P] Honor `WS_STATE_FILE` env in CLI config provider `packages/agent-remnote/src/services/CliConfigProvider.ts`
- [X] T006 Implement tmux refresh-all-clients in `packages/agent-remnote/src/lib/tmux.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Stop 后立刻消失 (Priority: P1) 🎯 MVP

**Goal**: `daemon stop` 立即清理展示工件并触发刷新，RN 段不再残留

**Independent Test**: 在临时 HOME 下构造“新鲜 snapshot + 非空 status-line file”，执行 `daemon stop` 后这些工件被清理，并且 tmux RN 段不再输出

### Tests for User Story 1

- [X] T007 [P] [US1] Extend stop contract test to assert bridge/state-line cleanup in `packages/agent-remnote/tests/contract/daemon-stop-no-restart.contract.test.ts`

### Implementation for User Story 1

- [X] T008 [US1] Wire unified cleanup into `daemon stop` in `packages/agent-remnote/src/commands/ws/stop.ts`
- [X] T009 [US1] Ensure stop cleanup uses pidfile source-of-truth when available in `packages/agent-remnote/src/commands/ws/stop.ts`

**Checkpoint**: `agent-remnote daemon stop` is idempotent and clears display artifacts

---

## Phase 4: User Story 2 - Restart/失败路径不残留 (Priority: P2)

**Goal**: `daemon restart` 的 stop 阶段复用同一清理逻辑；start 失败也不残留旧状态

**Independent Test**: 构造 RN 段可见条件，模拟 restart 失败，确保退出后展示工件被清理且 RN 段隐藏

### Tests for User Story 2

- [X] T010 [P] [US2] Add restart cleanup contract test in `packages/agent-remnote/tests/contract/daemon-restart-cleans-statusline.contract.test.ts`

### Implementation for User Story 2

- [X] T011 [US2] Reuse stop cleanup in restart flow in `packages/agent-remnote/src/commands/ws/restart.ts`

**Checkpoint**: restart never leaves pre-restart display artifacts behind

---

## Phase 5: User Story 3 - 非正常停止也不误显示“还在线” (Priority: P3)

**Goal**: 覆盖常见非 stop 退出（优雅信号）并为不可捕获退出提供 tmux 侧兜底

**Independent Test**: daemon 收到终止信号退出后，展示工件被清理，tmux RN 段在下一次刷新内隐藏；当 pid 不存活时 RN 段不因 snapshot 新鲜而误显示

### Tests for User Story 3

- [X] T012 [P] [US3] Add stale self-heal cleanup contract test in `packages/agent-remnote/tests/contract/daemon-status-stale-cleans-statusline.contract.test.ts`

### Implementation for User Story 3

- [X] T013 [US3] Add graceful shutdown cleanup hooks in `packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [X] T014 [US3] Add stale self-heal cleanup in `packages/agent-remnote/src/commands/ws/status.ts`
- [X] T015 [US3] Add pid gate to tmux helper in `scripts/tmux/remnote-right-value.sh`
- [X] T016 [US3] Document pid gate + pidfile env override in `docs/guides/tmux-statusline.md`

**Checkpoint**: non-stop exits do not leave “connected/selection” visible beyond the next refresh

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T017 [P] Update SSoT notes if behavior/schema changes affect docs in `docs/ssot/agent-remnote/ui-context-and-persistence.md`
- [X] T018 Run feature validation steps from `specs/014-tmux-statusline-cleanup/quickstart.md`
- [X] T019 Run test suite from `packages/agent-remnote/package.json` and ensure pass (Vitest)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 blocks all stories
- US1 is MVP and should land first
- US2 depends on foundational cleanup reuse but can follow US1 directly
- US3 can be developed after US1 (pid gate + graceful exit + status self-heal)

## Parallel Opportunities

- [P] tasks can run in parallel (different files): T002, T005, T007, T010, T012, T017
