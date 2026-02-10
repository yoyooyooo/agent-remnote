# Research 005：安全搜索（插件候选集 + DB 精筛 + 超时兜底）

**Feature**: `specs/005-search-safety/spec.md`  
**Date**: 2026-01-24

## 关键事实（来自代码/类型定义）

- RemNote 插件 SDK 提供候选集搜索：`plugin.search.search(queryText, searchContextRem?, { numResults, filterOnlyConcepts }) -> Promise<PluginRem[]>`（见 `node_modules/@remnote/plugin-sdk/dist/name_spaces/search.d.ts`）。
- `PluginRem`（`RemObject`）包含 `text?: RichTextInterface` 与 `backText?: RichTextInterface`，可用于生成预览；SDK 同时提供 `plugin.richText.toString(richText)` 把 RichText 转成普通字符串（见 `node_modules/@remnote/plugin-sdk/dist/name_spaces/rich_text.d.ts`）。
- 现有 WS bridge 为“写入派发”为主：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`，消息为 JSON `{ type: string, ... }`，并写出 state file `~/.agent-remnote/ws.bridge.state.json`（含 `clients[]`）。
- 插件侧现有握手与 worker 拉取模型：`packages/plugin/src/bridge/runtime.ts`（Hello/Register/RequestOp/OpAck + control channel 推送 selection/uiContext）。
- 现有 CLI 的 DB 搜索入口：`packages/agent-remnote/src/commands/read/search.ts`（调用 `executeSearchRemOverview`）；该链路在 `better-sqlite3` 同步执行下存在慢查询阻塞风险。

## Decision Log

### D1：采用“两阶段搜索”作为默认安全形态

- **Decision**：把搜索拆为「插件候选集（探索期）→ 后端 DB 精筛/展开（确定性处理）」两段，并明确任何一段都必须预算化（limit/timeout/payload）。
- **Rationale**：
  - 插件内部搜索语义更贴近 RemNote 的索引与排序，适合快速收敛候选。
  - 外部直接读 `remnote.db` 时，同步查询不可可靠硬取消；把“全表扫描风险”从默认路径移走，可显著降低卡死概率。
- **Alternatives considered**：
  - 仅靠后端 DB 一步到位：在 FTS 不可用/SQL 退化时风险过高。
  - 仅靠插件搜索完成全部展开：插件环境不适合深度遍历/大 payload（会影响 UI）。

### D2：read-rpc 采用 WS 消息对 + `requestId` 关联

- **Decision**：新增 `SearchRequest/SearchResponse`（见 `specs/005-search-safety/contracts/ws-read-rpc.md`），用 `requestId` 做并发隔离，服务端负责超时回收与回包路由。
- **Rationale**：阻塞式候选集需要确定性回包；并发下必须避免串包。
- **Alternatives considered**：
  - 广播 + 事件监听：无法保证回包归属，且在多窗口/多连接下不可诊断。

### D3：snippet 生成依赖 `plugin.richText.toString`

- **Decision**：插件侧把 `rem.text/backText` 转为纯文本后生成 snippet；若能定位命中位置则截取命中附近窗口，否则回退到开头预览。
- **Rationale**：避免自行解析 RichText 的格式细节；输出更稳定、更易预算。
- **Alternatives considered**：
  - 自己实现 RichText flatten：容易漏格式/引用，且后续 SDK 升级易漂移。

### D4：超时策略分层（插件软超时 + DB 硬超时）

- **Decision**：
  - 插件候选集：用软超时（Promise.race + 忽略晚到结果）保证 `<=3s` 返回。
  - 后端 DB：用 worker/子进程隔离实现真正硬超时（超时即 terminate），上限 `<=30s`。
- **Rationale**：`better-sqlite3` 主线程无法硬取消；必须用隔离进程/线程换取可控性。
- **Alternatives considered**：
  - 仅软超时：请求会继续占用 CPU/锁，仍可能拖垮进程。

### D5：`nextActions[]` 先用 `string[]`（建议型）

- **Decision**：当前阶段先把 `nextActions` 定义为 `string[]`（用于 CLI/Agent 直接展示），后续需要可执行建议再升级为结构化对象（不要求向后兼容）。
- **Rationale**：最小化协议设计成本，先把“建议型兜底”跑通。
- **Alternatives considered**：
  - 直接上结构化 action：需要统一 action taxonomy 与执行器，超出本 feature 当前目标。

## 风险与缓解

- **风险：插件搜索 Promise 超时后仍在后台执行** → **缓解**：用 `requestId`/本地序号丢弃迟到结果；避免把迟到结果写回 WS。
- **风险：多窗口/多连接导致 read-rpc 路由不稳定** → **缓解**：依赖 Spec 003 引入 `connId + active worker`，由服务端做唯一选举与路由。
- **风险：DB worker terminate 造成资源泄露/锁残留** → **缓解**：把 DB 查询限制在 worker 内；超时 terminate 并重建 worker；主进程仅处理结果与错误映射。
