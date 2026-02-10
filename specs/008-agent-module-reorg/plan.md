# Implementation Plan: Merge core into agent-remnote（模块重组）

**Branch**: `008-agent-module-reorg` | **Date**: 2026-01-24 | **Spec**: `specs/008-agent-module-reorg/spec.md`  
**Input**: Feature specification from `specs/008-agent-module-reorg/spec.md`

## Summary

将 `packages/core` 的全部能力并入 `packages/agent-remnote`，并把 `agent-remnote` 组织为一个“模块化单体 CLI”（modular monolith）：

- 对外行为与契约保持不变（CLI/WS/queue/schema/输出约束）；现有契约测试继续作为硬证据。
- 对内通过“模块边界 data-model”一次性重组：把队列、WS bridge、只读 DB 工具、CLI 编排、运维守护拆成清晰模块，约束依赖方向。
- 交付一份面向未来的拆包路线图文档：当出现多 consumer/多发布物/跨仓复用需求时，如何把 internal 模块抽成硬子包。

本计划的策略是：**先无损搬迁（保持行为），再硬化边界（减少隐式耦合），最后删除 `packages/core`**。

## Technical Context

**Language/Version**: TypeScript（ESM）+ Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `@effect/platform-node` / `ws` / `better-sqlite3` / `zod` / `unified` + `remark-*`  
**Storage**:
- RemNote 官方 DB（只读）：`~/remnote/**/remnote.db`（路径推断/手动指定）
- 写入队列 DB：`~/.agent-remnote/queue.sqlite`（可 env 覆盖）
- WS bridge state file：`~/.agent-remnote/ws.bridge.state.json`（可 env 覆盖）
- daemon supervisor files：`~/.agent-remnote/ws.pid` / `~/.agent-remnote/ws.log` / `~/.agent-remnote/ws.state.json`
**Testing**: `vitest`（主要在 `packages/agent-remnote/tests/contract/*.contract.test.ts`；门禁在 `packages/agent-remnote/tests/gates/*.contract.test.ts`）  
**Target Platform**: 单机本地 Node.js + RemNote 桌面端插件（写入执行器）  
**Project Type**: bun workspace（`packages/*`）  
**Performance Goals**:
- CLI 启动与常用命令不引入可观测退化（以现有基线为准）
- DB 搜索的硬超时仍通过 worker 隔离实现（保持既有策略）
**Constraints**:
- 禁止写 `remnote.db`
- `--json` 模式 stdout 单行 JSON / stderr 为空
- 所有用户可见提示（CLI 输出/错误/日志/nextActions）保持英文
- 所有本地路径遵守 homedir + path.join/normalize，支持 `~` 展开
**Scale/Scope**: 单机单用户；多 RemNote 窗口/连接；默认唯一 active worker 消费队列

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- 禁止直接修改 `remnote.db`：本次仅重组代码组织，不改变写入链路（PASS）。
- Forward-only evolution：允许删除/合并 `packages/core`，但必须同步更新 SSoT 锚点与迁移说明（PASS）。
- SSoT 优先：涉及 queue/ws/写入工具语义的裁决仍以 `docs/ssot/agent-remnote/**` 为准；若发现漂移需在实施任务里修正（PASS，作为强约束）。
- 预算与超时兜底：维持现有 hard-timeout worker 策略；重组不得把同步 IO 误引入“不可控阻塞”路径（PASS）。
- 唯一消费与可诊断身份：active worker/connId 语义不变；state file 仍可诊断（PASS）。
- 跨平台路径规范：重组时会集中路径工具，消灭重复实现与手写路径拼接（PASS）。
- 用户可见输出英文：本次仅调整内部模块；对外输出文本不得变中文/不得新增噪声（PASS）。
- 可验证性：以现有 contract tests + ws health/smoke 作为 gate（PASS）。
- 非破坏性默认：不做清库/删用户数据；删除 `packages/core` 仅限仓库内代码（PASS）。

## Project Structure

### Documentation (this feature)

```text
specs/008-agent-module-reorg/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── module-boundaries.md
│   └── future-packaging.md
└── tasks.md
```

### Source Code (repository root, after reorg)

```text
packages/
├── agent-remnote/
│   ├── src/
│   │   ├── main.ts
│   │   ├── commands/                 # CLI command tree (presentation)
│   │   ├── services/                 # Effect runtime services (IO adapters)
│   │   ├── lib/                      # small pure helpers (path/ref parsing, ws state reader)
│   │   └── internal/                 # kernel modules (future extractable)
│   │       ├── queue/                # queue db + dao + sanitize + schema
│   │       ├── ws-bridge/            # ws daemon/bridge + state file + kick/election
│   │       └── remdb-tools/          # read-only remnote.db tools (search/outline/inspect/etc)
│   └── tests/
├── plugin/
└── (core removed)
```

**Structure Decision**:

- `packages/agent-remnote` 作为唯一“应用边界”（CLI/daemon/ops 编排），内部采用 `commands + services + internal(kernel)` 分层。
- `internal/*` 的模块边界以 `specs/008-agent-module-reorg/data-model.md` 为权威；跨模块调用只允许通过各模块 `index.ts`（最小入口），禁止深路径互引。
- 未来需要拆包时，把 `internal/queue`、`internal/ws-bridge`、`internal/remdb-tools` 迁移到 `packages/*` 即可（见 `contracts/future-packaging.md`）。

## Phase Plan（落地顺序）

### Phase 0（Research → `research.md`）

- 明确重组目标的“功能不变”证据与门禁：哪些 tests/commands 必须跑，什么算 pass。
- 明确新的模块划分与命名：internal 模块列表、职责、依赖方向、对外最小入口。
- 明确 `packages/core` 删除对 docs/ssot 与 README 的影响面（需要更新哪些锚点与示例）。

### Phase 1（Design → `data-model.md` + `contracts/*` + `quickstart.md`）

- 产出“模块边界 data-model”：把现有能力逐一归属到模块，并列出模块入口、允许/禁止依赖、未来抽包候选。
- 产出“contracts”：
  - `module-boundaries.md`：依赖方向与公共入口约束（对实施任务做验收基准）。
  - `future-packaging.md`：拆包触发条件、拆分顺序、迁移策略（面向未来说明）。
- 产出 `quickstart.md`：提供重组后验证路径（tests + smoke checks）与“去哪里找代码”的索引。
- 运行 `update-agent-context.sh` 更新 agent 上下文（确保后续实现阶段的约束与入口被工具看见）。

### Phase 2（Implementation tasks → `tasks.md`）

将重组拆成可执行任务（以“先无损拆分，再改语义”为纪律）：

- A. 引入 `src/internal/*` 骨架与入口（不改行为）
- B. 迁移 queue/ws-bridge/remdb-tools 实现（逐模块迁移，保持行为）
- C. 切换 `commands/services` 依赖到 internal（保持 API/输出）
- D. 删除 `packages/core` workspace（更新 root/package.json、turbo、imports）
- E. 文档对齐（SSoT/README/架构路线图）
- F. 质量门禁与回归（tests + smoke）

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | 本计划不需要违反 constitution | - |
