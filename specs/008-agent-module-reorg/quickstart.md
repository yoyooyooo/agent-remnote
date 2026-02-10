# Quickstart: 008-agent-module-reorg（如何实施与验收）

**Feature**: `008-agent-module-reorg`  
**Goal**: 合并 `packages/core` 到 `packages/agent-remnote`，重组模块边界，同时保证对外功能/契约不变。

## 1) 验收最小集（功能不变）

以现有自动化测试作为“功能不变”的硬证据：

- 运行 `packages/agent-remnote/tests/contract/*.contract.test.ts` 覆盖的 CLI 契约测试集。
- 覆盖 `--json` 输出纯度（stdout 单行 JSON、stderr 为空、exit code 语义不变）。
- 覆盖关键命令 smoke（在环境允许时）：
  - `agent-remnote --help`
  - `agent-remnote doctor`
  - `agent-remnote daemon status`
  - `agent-remnote daemon health`

## 2) 新目录速查（重组后）

> “去哪里找代码”的索引（按能力）。

- CLI 命令树：`packages/agent-remnote/src/commands/**`
- Effect 运行时服务（IO 适配与错误映射）：`packages/agent-remnote/src/services/**`
- kernel 模块（未来可抽包）：
  - Queue：`packages/agent-remnote/src/internal/queue/**`
  - WS bridge：`packages/agent-remnote/src/internal/ws-bridge/**`
  - RemDB tools：`packages/agent-remnote/src/internal/remdb-tools/**`
- 小型纯 helper：`packages/agent-remnote/src/lib/**`

## 3) 文档对齐要求（SSoT）

实施阶段必须同步更新：

- `docs/ssot/agent-remnote/ws-bridge-protocol.md` 中的实现锚点路径（原指向 `packages/core/src/ws/bridge.ts`）。
- 任何引用 `packages/core` 的 README/guide/脚本说明。
- 新增或更新 `docs/architecture/**` 的“未来拆包路线图”（与 `contracts/future-packaging.md` 对齐）。

## 4) 实施纪律（避免风险叠加）

- 先无损搬迁：移动/复制文件与调整 import，不改语义。
- 每完成一个模块迁移（queue/ws-bridge/remdb-tools）就跑一次最小回归（至少相关 contract tests）。
- 最后一步才删除 `packages/core` workspace，并统一修复文档锚点与依赖声明。

## 5) 下一步

进入任务拆分阶段：生成 `specs/008-agent-module-reorg/tasks.md`（由 `$speckit tasks 008-agent-module-reorg` 产出）。
