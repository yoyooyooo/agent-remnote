# Spec 005：安全搜索（插件候选集 + DB 精筛 + 超时兜底）

**Date**: 2026-01-24  
**Status**: Accepted  
**Accepted**: 2026-01-26  

相关草案（方案细节与预算口径）：`docs/proposals/agent-remnote/search-strategy.md`

## Input（用户期望）

1) Agent 在读取/检索本地 `remnote.db` 时，必须有**超时兜底**，避免一次“放飞自我”的大查询把进程卡死。  
2) 外部 DB 查询允许更长但必须有上限：**单次 ≤ 30s**；超时后应返回“建议型下一步 Action”（不强制）。  
3) 插件侧（RemNote 内部环境）可以承担“快速候选集生成”来加速探索：**单次 ≤ 3s**，默认返回 Top‑N（建议 N=20），并优先带“命中附近文本/预览片段”供 Agent 判断相关性。  
4) 需要把“前端负责什么、后端负责什么、何时回退、如何防止数据量过大”定性为**无歧义边界**与配套兜底策略。  

## 背景 / 现状

- 现有只读查询主要在服务端/CLI 侧用 `better-sqlite3` 同步执行；慢查询会阻塞 Node 进程，且在主线程里**无法可靠硬中断**。  
- 外部环境对 FTS（如 `remsContents`）可能因 tokenizer 不可用而失效，需要回退到 `remsSearchInfos`/JSON/LIKE 等策略。  
- 插件 SDK 提供 `plugin.search.search(...)`，更贴近 RemNote 内部搜索语义，但返回为 `PluginRem[]`（没有直接的 snippet/highlight 字段），需要自行从 `text/backText` 构造“预览片段”。  
- 本 spec 依赖 Spec 003：用服务端 `connId` + `clientInstanceId` + active worker 选举，为 read-rpc 路由与兜底回退提供基础。  

## 依赖（Dependencies）

- WS 连接实例与 active worker：`specs/003-ws-identity/spec.md`

## 目标（Goals）

- G1：任何检索调用都不会无限阻塞；超时/失败时给出**建议型**下一步行动。  
- G2：定义清晰的“插件候选集生成”与“后端 DB 精筛/展开”的职责边界，且有确定的回退路径。  
- G3：在“探索期”场景用插件快速收敛候选（默认 Top‑20，≤3s），减少 DB 侧高风险全表扫描。  
- G4：在“确定性处理”场景（分页/展开/结构化过滤）由后端 DB 承担，并提供预算控制（limit/offset、maxNodes、timeRange 等）。  

## 非目标（Non-goals）

- 不把 RemNote 搜索当作语义 RAG：无词法线索（关键词/短语/范围）的“我之前写过的那条…”不保证能命中。  
- 不在插件侧执行大规模遍历/深度展开（子树、引用链、属性反查、全文 dump）。  
- 不在 `better-sqlite3` 主线程模型下承诺“硬取消”；硬超时必须通过 worker/子进程隔离实现。  

## User Scenarios & Testing（SC；必须可验证）

### SC-001：探索期快速定位（P1）

作为 Agent，我希望用 1–3 个关键词快速拿到 Top‑20 候选，并携带可判别相关性的预览片段；若 3s 内拿不到结果，立即回退到后端 DB 搜索。

**Independent Test**：

1. 插件在线：执行一次“插件候选集搜索”请求，`duration_ms <= 3000` 且 `results.length <= 20`。  
2. 插件卡住/无响应：`~3000ms` 返回 timeout，并触发回退策略（或给出明确 nextActions）。  

### SC-002：后端精筛/展开（P1）

作为 Agent，我希望在拿到少量候选 RemId 后，能在后端做分页、展开、结构化过滤；单次查询超过 30s 必须超时并返回可行动建议。

**Independent Test**：

1. 选择 3 个候选 RemId，后端能返回路径/摘要/必要字段。  
2. 构造高风险查询：在 30s 内返回 timeout，并给出“收敛条件/缩小范围/改走插件候选”等建议。  

### SC-003：防止前端查询量过大（P2）

作为系统，我希望插件侧永远不会因为一个请求就返回海量数据或做深度遍历。

**Independent Test**：

1. 请求 `limit>maxLimit` 时被强制 clamp，并在响应里标注 `limit_clamped=true`。  
2. 插件返回 payload 始终在限制内（例如 `maxPreviewChars` 生效，富文本被截断并标记）。  

## Functional Requirements

- **FR-001**：系统 MUST 提供一个“插件候选集搜索”的阻塞式 RPC（后端发请求，等待插件响应）。  
- **FR-002**：插件候选集搜索 MUST 默认 `limit=20`，并提供可选提升（建议上限 `100`，且必须 clamp）。  
- **FR-003**：插件候选集搜索 MUST 默认 `timeoutMs=3000`（可配置，但不得超过 5000）。  
- **FR-004**：插件候选集搜索 MUST 返回精简结构：`remId + title + snippet + truncated`（可加 timestamps/ancestor 但必须可预算）。  
- **FR-005**：snippet MUST 来源于 `PluginRem.text/backText` 的纯文本预览，并尽量截取“命中附近窗口”；找不到命中则回退到开头预览。  
- **FR-006**：插件候选集阶段 MUST 禁止深度展开与全量 dump（子树/引用/属性反查）。  
- **FR-007**：后端 DB 查询 MUST 提供硬超时兜底 `<=30s`（实现要求：worker/子进程隔离）。  
- **FR-008**：当插件不在线/超时/报错时，系统 MUST 有确定的回退策略（转后端 DB 搜索）且返回建议型 nextActions。  
- **FR-009**：所有失败/超时响应 SHOULD 包含 `nextActions[]`（建议型），例如：缩小关键词、补充上下文 rem、限制 timeRange、提高 limit、改走另一策略。  
- **FR-010**：仓库内 MUST 补齐对 Skill 的指引：`$remnote` 需明确两阶段搜索策略、预算与回退口径（见 Tasks）。  
- **FR-011**：read-rpc MUST 基于 `connId` 做路由与关联隔离（例如 `(callerConnId, requestId)`），并与 “active worker 唯一消费” 口径一致（见 Spec 003）。  

## Non-Functional Requirements

- **NFR-001**：插件候选集响应 MUST 受预算约束（payload 大小上限可计算；必须显式提供 `limitEffective/maxPreviewChars` 等预算信息）。  
- **NFR-002**：后端 DB 查询 MUST 具备“硬中断”能力：超时后不得卡死主线程（通过 worker/子进程隔离终止）。  

## Deliverables（交付物）

- WS 协议扩展（read-rpc）：`SearchRequest/SearchResponse`（含 requestId、timeout、错误结构）。  
- CLI/Tool：提供“插件候选集搜索”入口（面向 Agent 显式调用，不强耦合到所有读命令）。  
- DB 查询执行器：支持 30s 硬超时、分页与预算字段、并带 nextActions 建议。  
- 文档：更新 `docs/ssot/**`（协议/边界）与 `docs/proposals/**`（方案细节），并同步到 Skill 指引。  
