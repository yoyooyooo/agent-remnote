# Research: 030-remnote-business-command-mode-parity

日期：2026-03-22

## 决策 1：Parity 的定义是“业务契约对等”

### Decision

对 RemNote business commands，local mode 与 remote mode 的对等目标是：

- 同一命令形状
- 同一参数语义
- 同一校验规则
- 同一 envelope / error code / receipt 语义
- 同一成功语义
- 同一稳定失败语义

允许差异只存在于：

- transport
- timeout / retry / reachability diagnostics

### Rationale

用户要的是命令可移植性。把 parity 定义成 transport 一致没有必要，也会把
本地开发路径做重。

## 决策 2：必须有单一 authoritative inventory

### Decision

`docs/ssot/agent-remnote/runtime-mode-and-command-parity.md` 作为唯一
authoritative inventory。

派生关系：

- feature-local `contracts/parity-matrix.md` 只做当前 wave 的 gap ledger
- code-side `commandInventory.ts` 只做 machine-readable mirror
- Wave 1 executable `commandContracts.ts` 只做可执行契约投影
- tests 负责检查这三者与 authoritative inventory 不漂移

### Rationale

如果 inventory 同时存在于 feature 文档、全局文档、代码模块而没有权威源，
这次特性最核心的 business/operational 边界会立刻再次漂移。

## 决策 3：本次 feature 采用 wave-based execution

### Decision

本次 feature 交付 Wave 1：

- 锁 inventory
- 锁治理与 SSoT
- 先建 executable contract spine
- 抽 host-authoritative semantics
- 实现 Wave 1 command set 的 full parity
- 为剩余 commands 写清 wave / same-stable-failure / reclassify 决策

### Rationale

直接在一个 feature 内吃下全部 command families，实施和回归风险过高。先把
Wave 1 做到位，能让后续波次有稳定入口和门禁。

## 决策 4：Parity 与 capability expansion 必须拆开

### Decision

对每条 business command，都要明确 parity target：

- `same_support`
- `same_stable_failure`
- `reclassify`

### Rationale

当前仓库有不少已知宿主能力边界，尤其在 table/powerup/property 面上。若不先
拆开，实施者很容易把 parity 错做成“新增能力开发”。

## 决策 5：Host-dependent business semantics 统一下沉为 host-authoritative

### Decision

以下语义必须收口为 host-authoritative，local/remote 复用同一套判断：

- ref resolution
- workspace binding
- placement resolution
- selection resolution
- contiguous sibling range determination
- title inference
- capability gating
- receipt enrichment

### Rationale

当前仓库最明显的 parity 漂移来源，就是这些语义散在 CLI 本地 helper 中。

## 决策 6：Remote-first verification 必须命令级、失败路径、可重复

### Decision

最终验收需要一套 remote-first verification gate：

- 显式设置 `apiBaseUrl`
- 全程 remote mode
- 覆盖默认 `/v1` 和非默认 `/remnote/v1`
- Wave 1 每条 command 至少 remote 走一次
- success cases 做 direct-vs-remote comparison
- defined failure cases 也做 direct-vs-remote comparison
- 使用确定性 fixture builders，不依赖人工宿主环境

### Rationale

现有 remote tests 是点状覆盖，还无法证明“命令级 100% parity”。

## 决策 7：不追求把所有命令都压成一种通用 Plan JSON

### Decision

- 写路径继续使用 `apply envelope -> actions -> WritePlanV1 -> ops`
- 读路径与 UI-context 路径统一到 runtime capability 抽象
- 本次 feature 不把 read surface 强制改写成 write-plan 风格 IR

### Rationale

写入和读取的约束不同。写路径已经有成熟的 `WritePlanV1` 编译链路；读路径的
核心问题是宿主语义和 mode switch，而不是缺少统一 IR。

## 决策 8：Wave 1 必须引入 executable command-contract registry

### Decision

在 authoritative inventory 之外，引入一个受其约束的 Wave 1 executable
registry：

- 文件：`packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- 角色：声明 Wave 1 命令对应的 capability、endpoint、normalizer、verification mapping
- 限制：不能独立决定哪些命令属于 Wave 1，必须由 inventory 驱动

### Rationale

只有 inventory 没法约束“命令怎么执行、怎么比较、怎么验证”。没有 executable
registry，Wave 1 parity 仍会停留在“文档正确但实现分散”的层面。

## 决策 9：Wave 1 的 mode switch 必须收口成单一运行时

### Decision

引入 `ModeParityRuntime`：

- 它是 Wave 1 business command 唯一允许做 mode switch 的层
- 它通过 local / remote adapter 暴露统一 capability
- Wave 1 command files 不再直接判断 `cfg.apiBaseUrl`
- Wave 1 command files 不再直接依赖 `HostApiClient`

### Rationale

当前实现的主要技术债并不是“没有 remote route”，而是“mode switch 分散在多层
命令和 helper 里”，这会持续制造回归。

## 决策 10：必须增加 architecture guard，而不只靠行为测试

### Decision

除了 parity behavior tests，还要增加 architecture guard tests：

- 检查 Wave 1 command files 是否直接读取 `cfg.apiBaseUrl`
- 检查 Wave 1 command files 是否直接依赖 `HostApiClient`
- 检查 executable registry 是否完整覆盖 Wave 1 inventory rows

### Rationale

只靠行为测试，容易在功能不变的前提下把架构再次做散。030 要到 S 档，必须连
“实现姿势”一起门禁。

## 当前已确认的缺口簇

### 缺口 A：SSoT command matrix 落后于实际 surface

证据：

- `docs/ssot/agent-remnote/http-api-contract.md`

现状：

- remote-capable 矩阵没有 command-level inventory
- `028/029` 引入或重塑后的多个 surface 没有系统纳入

### 缺口 B：客户端仍持有宿主事实解析

证据文件：

- `packages/agent-remnote/src/services/RefResolver.ts`
- `packages/agent-remnote/src/commands/write/_placementSpec.ts`
- `packages/agent-remnote/src/commands/write/_shared.ts`
- `packages/agent-remnote/src/commands/write/rem/_promotion.ts`

现状：

- 非 `id:` ref remote path 会被拒绝
- `before/after` placement 依赖本地 DB hierarchy metadata
- contiguous sibling range 判定依赖本地 DB
- 单 source title inference 仍带本地 DB 依赖

### 缺口 C：部分 business commands 仍 local-only、partial remote-only、或边界未决

证据文件：

- `packages/agent-remnote/src/commands/write/portal/create.ts`
- `packages/agent-remnote/src/commands/write/rem/text.ts`
- `packages/agent-remnote/src/commands/write/table/record/*.ts`
- `packages/agent-remnote/src/commands/write/powerup/*.ts`
- `packages/agent-remnote/src/commands/read/page-id.ts`
- `packages/agent-remnote/src/commands/read/by-reference.ts`
- `packages/agent-remnote/src/commands/read/references.ts`
- `packages/agent-remnote/src/commands/read/resolve-ref.ts`
- `packages/agent-remnote/src/commands/read/query.ts`
- `packages/agent-remnote/src/commands/table/show.ts`
- `packages/agent-remnote/src/commands/read/connections.ts`
- `packages/agent-remnote/src/commands/read/daily/summary.ts`
- `packages/agent-remnote/src/commands/read/topic/summary.ts`
- `packages/agent-remnote/src/commands/read/inspect.ts`

### 缺口 D：验证口径仍停留在 family 级

现状：

- 缺命令级 inventory -> test case 映射
- 缺失败路径 comparison 规则
- 缺 selection/UI-context/portal 的确定性夹具

### 缺口 E：缺少 executable contract spine

现状：

- inventory 已经存在
- code mirror 已经存在
- 但还没有一份 Wave 1 executable registry 把 capability / endpoint /
  normalizer / verification 绑定起来

### 缺口 F：mode switch 仍散在 command 层

现状：

- 多个 Wave 1 command file 或 helper 仍直接判断 `cfg.apiBaseUrl`
- 多个命令仍直接依赖 `HostApiClient`
- 这会让后续 parity 修复持续以“逐命令补洞”的形式出现

## 结论

本次 feature 需要先锁 6 件事：

1. 单一 authoritative inventory
2. Wave 1 executable registry
3. 单一 `ModeParityRuntime`
4. host-authoritative semantics
5. 命令级 remote-first verification gate
6. architecture guard tests
