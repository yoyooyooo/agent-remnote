# Implementation Plan: 安全搜索（插件候选集 + DB 精筛 + 超时兜底）

**Branch**: `005-search-safety` | **Date**: 2026-01-24 | **Spec**: `specs/005-search-safety/spec.md`  
**Input**: Feature specification from `specs/005-search-safety/spec.md`

## Summary

把“读取/检索”拆成两段并强制预算：

1) **插件侧候选集**：`plugin.search.search` 在 RemNote 内部语义下快速返回 Top‑K（默认 `K=20`，`timeoutMs=3000`），同时生成可判别相关性的 `title/snippet`（截断标记）。
2) **后端 DB 精筛/展开**：对候选 RemId 做分页/结构化过滤/展开；任何单次 DB 查询必须有 **硬超时**（`<=30s`，需要 worker/子进程隔离实现）。

当插件不在线/非 active worker/超时/报错时，必须有确定的兜底：要么自动回退到 DB 搜索，要么返回建议型 `nextActions[]`（不强制执行）。

## Technical Context

**Language/Version**: TypeScript（ESM）+ Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `ws` / `better-sqlite3` / `zod`  
**Storage**: RemNote 本地 DB（`remnote.db`，只读）+ 写入队列 DB（`~/.agent-remnote/queue.sqlite`）  
**Testing**: `vitest`（主要在 `packages/agent-remnote`）+ `scripts/` 端到端模拟  
**Target Platform**: Node.js 20+（daemon/CLI）+ RemNote 桌面端插件运行时  
**Project Type**: bun workspace（`packages/*`）  
**Performance Goals**: 插件候选集 `<=3s`；DB 精筛单次 `<=30s`（硬超时）  
**Constraints**: 禁止直接写入 `remnote.db`；所有链路必须预算化（limit/timeout/payload）  
**Scale/Scope**: 单机本地知识库；结果需对 LLM 友好（payload 可控）

补充事实：

- 代码边界：
  - `packages/agent-remnote/src/internal`: WS bridge + queue + RemNote DB 只读工具
  - `packages/plugin`: RemNote 插件执行器（官方 SDK）
  - `packages/agent-remnote`: CLI（Effect + @effect/cli）
- WS bridge 现状：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`（JSON 消息 + state file `~/.agent-remnote/ws.bridge.state.json`）
- CLI 现状：`agent-remnote read search` 走 DB（`executeSearchRemOverview`），存在慢查询阻塞风险
- Hard timeout 约束：`better-sqlite3` 同步查询在主线程不可可靠硬取消；必须用 worker/子进程隔离 + 超时后 terminate
- Dependency：本 feature 的 read-rpc 路由与兜底依赖 Spec 003 的 `connId + active worker`（移除 `consumerId`）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- 不直接修改 `remnote.db`：本 feature 仅新增读取链路的预算化与路由；写入仍走队列 + 插件执行器（PASS）。
- Forward-only evolution：允许协议/CLI breaking change；但必须同步更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 与迁移说明（PASS，按 Spec 003/005 的文档任务执行）。
- SSoT 优先：read-rpc 与 active worker 的裁决版需落 `docs/ssot/agent-remnote/ws-bridge-protocol.md`；草案留在 `docs/proposals/**`（PASS）。
- 预算与超时：插件候选集 `timeoutMs<=5000/limit clamp`；DB 精筛单次硬超时 `<=30s`（PASS，见 `research.md`/`data-model.md`）。
- 唯一消费与可诊断身份：read-rpc 必须路由到 active worker；所有诊断以 `connId/clientInstanceId` 表达（PASS，依赖 Spec 003）。
- 用户可见输出英文：CLI 新增命令/错误信息必须英文（PASS，作为实现 gate）。
- Quality gates（实现前）：`npm run typecheck && npm run lint && npm run format:check && npm test`（PASS）。

## Project Structure

### Documentation (this feature)

```text
specs/005-search-safety/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ws-read-rpc.md
│   └── cli.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── core/
│   └── src/ws/bridge.ts
├── plugin/
│   └── src/bridge/runtime.ts
└── agent-remnote/
    └── src/commands/read/search.ts

docs/
├── ssot/agent-remnote/ws-bridge-protocol.md
└── proposals/agent-remnote/search-strategy.md
```

**Structure Decision**: 设计产物落在 `specs/005-search-safety/`；协议裁决落 `docs/ssot/agent-remnote/ws-bridge-protocol.md`，草案与示例留 `docs/proposals/**`。

## Phase Plan（落地顺序）

### Phase A（定约：无歧义边界 + 输出契约）

- 固化两阶段职责边界：插件候选集生成 vs 后端 DB 精筛/展开。
- 固化预算：插件 `timeout=3s/limit=20`；DB `timeout<=30s`（硬超时）。
- 固化响应 envelope：`results` + `budget` + `truncated/hasMore` + `nextActions[]`（建议型）。

### Phase B（read-rpc：WS 协议与 bridge 路由）

- 扩展 WS 协议（SSoT）：新增 `SearchRequest/SearchResponse`（requestId、timeout、errors）。
- 依赖 Spec 003：先移除 `consumerId`，引入 `connId/clientInstanceId` 与 active worker 选举（为 read-rpc 路由与回退兜底打底）。
- bridge 侧实现 request/response 关联与超时回收（避免悬挂）。

### Phase C（插件侧候选集搜索 + snippet）

- 用 `plugin.search.search` 执行检索并强制预算（limit clamp、timeout）。
- 生成 `title/snippet`：从 `text/backText` 转纯文本并截取“命中附近窗口”，并对长度做截断标记。
- 确保 payload 小且稳定（为 LLM 友好）。

### Phase D（CLI/Tool：显式调用 + 回退策略）

- 增加一个专用命令/工具：面向 Agent 显式调用插件候选集搜索（阻塞式，3s timeout）。
- 失败/超时：自动回退到后端 DB 搜索（或返回明确的 nextActions 建议）。

### Phase E（后端 DB：30s 硬超时与预算化输出）

- 引入 worker/子进程执行 DB 查询，支持硬超时取消与资源隔离。
- 对高风险查询强制分页与预算：limit/offset、timeRange、maxNodes/maxLeafResults 等。
- 统一错误归因与 nextActions 建议模板。

### Phase F（文档与 Skill）

- 更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md`（vNext：无 `consumerId` + active worker + read-rpc）。
- 更新 `docs/proposals/agent-remnote/search-strategy.md`（方案细节与示例）。
- 完善 `$remnote`：增加“何时用插件候选集/何时用 DB 精筛/默认预算/回退口径/常见 nextActions”。

## Complexity Tracking

> 本 feature 不引入新的“长期复杂度”抽象；主要复杂度来自“硬超时隔离”与“read-rpc 关联路由”，属于必要安全成本。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Hard timeout via worker/child | 防止慢查询把进程卡死（30s 上限） | 主线程 `better-sqlite3` 无法可靠硬取消；软超时会继续占用 CPU/锁 |
| read-rpc routing | 插件候选集必须阻塞式拿结果，且不串包 | 仅靠 broadcast/日志无法提供确定性响应；并发会话会互相干扰 |
