# RemNote Business Command Mode Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a command-level parity program for RemNote business commands, deliver full Wave 1 parity, and make the remaining waves executable without ambiguity.

**Architecture:** Freeze one authoritative command inventory first, add one executable Wave 1 command-contract registry, centralize mode switching into one `ModeParityRuntime`, keep write compilation on the existing `apply envelope -> WritePlanV1 -> ops` path, route read/context semantics through shared runtime capabilities, and add a deterministic remote-first gate that proves Wave 1 parity at command level.

**Tech Stack:** TypeScript ESM, `effect`, `@effect/cli`, existing queue / WS / plugin SDK write pipeline, Host API runtime, Vitest contract and integration tests

---

## 实施计划：030-remnote-business-command-mode-parity

日期：2026-03-22  
Spec：`specs/030-remnote-business-command-mode-parity/spec.md`

## 摘要

本特性定义的是一个 parity program 的 Wave 1。

本轮目标：

- 锁定 command-level authoritative inventory
- 锁定 business / operational 边界
- 锁定 parity target：`same_support` / `same_stable_failure` / `reclassify`
- 引入可执行的 Wave 1 command-contract registry
- 引入唯一的 `ModeParityRuntime`
- 收口 host-dependent business semantics
- 交付 Wave 1 command set 的 full parity
- 给所有 deferred commands 写清后续 wave 决策
- 加一套命令级 remote-first verification gate

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: `effect`, `@effect/cli`, Host API runtime, existing queue / WS / plugin SDK pipeline
- **Storage**: No new persistent tables required; existing store DB and `workspace_bindings` remain authoritative
- **Testing**: Vitest contract tests, integration tests, command-level remote-first parity suite, direct-vs-remote comparison tests, architecture-guard tests
- **Target Platform**: Local CLI + Host API remote mode with default `/v1` and non-default `apiBasePath`
- **Project Type**: Monorepo with `packages/agent-remnote` and `packages/plugin`
- **Performance Goals**: Preserve current queue/write path and avoid introducing a second semantic layer or heavy double execution
- **Constraints**:
  - No direct writes to `remnote.db`
  - `apiBaseUrl` only switches transport, not business semantics
  - Host-dependent business semantics must be single-sourced
  - Wave 1 business commands must stop branching on `cfg.apiBaseUrl` in command files
  - Some deferred commands may satisfy parity via the same stable failure contract
  - Operational commands may remain host-only but must be documented explicitly
  - Reads do not need to force themselves into `WritePlanV1`
- **Scale/Scope**: Wave 1 full parity for the command set in `spec.md`, plus command-level inventory and wave assignment for all remaining RemNote-related commands

## Constitution Check

| Principle | Result | Notes |
| --- | --- | --- |
| 1. 禁止直接修改 RemNote 官方数据库 | PASS | All writes remain queue -> WS -> plugin SDK. |
| 2. Forward-only evolution | PASS | Reclassification, wave split, and explicit same-stable-failure contracts are allowed when docs/specs are updated. |
| 3. SSoT 优先 | PASS | Global SSoT inventory is the sole authoritative source; feature-local matrix is derived only; executable registry is bounded by the inventory. |
| 4. 预算与超时兜底 | PASS | New remote-first harness and comparison suites must carry explicit timeouts and keep transport diagnostics normalized. |
| 5. 唯一消费与可诊断身份 | PASS | No change to queue consumer model; parity tests must preserve txn/attempt identity semantics. |
| 6. 跨平台路径规范 | PASS | New fixture builders and docs must use normalized paths via existing path helpers. |
| 7. 语言（用户输出 + 代码注释） | PASS | CLI/HTTP contracts remain English; planning artifacts may stay Chinese. |
| 8. 可验证性 | PASS | Inventory drift tests, executable-contract drift tests, architecture-guard tests, and remote-first parity gates are explicit deliverables. |
| 9. 非破坏性默认 | PASS | No default destructive behavior is introduced; unsupported cases may return stable failures. |
| 10. 跨进程状态文件语义单一 | PASS | Deterministic fixtures must keep UI-context, selection, and API base-path fixtures separated by purpose. |
| 11. 架构边界必须可自动门禁 | PASS | Inventory drift tests, registry alignment tests, and command-layer branch guards become explicit automatic gates. |
| 12. Write-first（最短链路） | PASS | Business writes continue to route through business commands / apply, not inspect-first flows. |
| 13. CLI Agent-First（最小完备原子能力） | PASS | One registry plus one runtime avoids scene-specific duplicate surfaces. |
| 14. Agent Skill 同步 | PASS | Repo-local skill guidance is updated in the docs phase and checked again in polish. |
| 15. RemNote Business Command Mode Parity | PASS | This feature exists specifically to satisfy the new constitutional rule. |

## Perf Evidence Plan

N/A

原因：本特性主要收口 inventory、业务语义分层、命令运行时、Host API 覆盖面与验证门禁，不引入新的长期 hot-path data plane。

## Project Structure

### Documentation (this feature)

```text
specs/030-remnote-business-command-mode-parity/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── parity-matrix.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
docs/ssot/agent-remnote/
├── README.md
├── cli-contract.md
├── http-api-contract.md
├── tools-write.md
├── ui-context-and-persistence.md
├── write-input-surfaces.md
└── runtime-mode-and-command-parity.md        # sole authoritative inventory

packages/agent-remnote/src/lib/
├── hostApiUseCases.ts
├── apiUrls.ts
└── business-semantics/
    ├── commandInventory.ts                   # derived mirror only
    ├── commandContracts.ts                   # Wave 1 executable contract registry
    ├── modeParityRuntime.ts                  # only business-command mode switch
    ├── localModeAdapter.ts                   # local adapter behind runtime
    ├── remoteModeAdapter.ts                  # remote adapter behind runtime
    ├── capabilityGuards.ts
    ├── refResolution.ts
    ├── placementResolution.ts
    ├── selectionResolution.ts
    ├── titleInference.ts
    └── receiptBuilders.ts

packages/agent-remnote/src/runtime/http-api/
└── runHttpApiRuntime.ts

packages/agent-remnote/src/services/
├── HostApiClient.ts
├── RefResolver.ts
├── RemDb.ts
└── Config.ts

packages/agent-remnote/src/commands/
├── _remoteMode.ts
├── _enqueue.ts
├── daily/
├── read/
├── plugin/
├── queue/
├── write/
├── table/
├── tag/
└── portal/

packages/agent-remnote/tests/
├── contract/
│   ├── remnote-business-command-classification.contract.test.ts
│   ├── remnote-business-command-contracts.contract.test.ts
│   ├── remnote-business-command-architecture.contract.test.ts
│   ├── remnote-business-command-parity.contract.test.ts
│   └── existing remote-api / remote-mode contract suites
├── integration/
│   └── remnote-business-command-mode-parity.integration.test.ts
└── helpers/
    ├── remnoteBusinessCommandMatrix.ts
    ├── remnoteBusinessCommandContracts.ts
    ├── remoteModeHarness.ts
    ├── parityFixtureBuilders.ts
    └── parityComparison.ts
```

**Structure Decision**:

- `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md` is the single authoritative inventory
- `specs/.../contracts/parity-matrix.md` is the derived feature-local gap ledger
- `src/lib/business-semantics/commandInventory.ts` is a derived machine-readable mirror protected by drift tests
- `src/lib/business-semantics/commandContracts.ts` is an executable Wave 1 registry that cannot invent commands outside the inventory
- `src/lib/business-semantics/modeParityRuntime.ts` is the only Wave 1 runtime layer allowed to switch between local and remote execution
- command files remain thin adapters for argv parsing and output formatting

## Complexity Tracking

无已知宪法违规项。

## Phase 0：Authoritative Inventory & Wave Freeze

目标：在动实现前，先冻结 command-level inventory、唯一权威源、wave allocation、
same-support vs same-stable-failure 边界，以及 inventory -> test case mapping 规则。

交付：

- `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`
- `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
- `specs/030-remnote-business-command-mode-parity/research.md`
- `specs/030-remnote-business-command-mode-parity/data-model.md`

核心裁决：

- authoritative inventory 在 global SSoT
- feature-local matrix 只做 derived ledger
- inventory 必须精确到 command 级
- 每条 command 必须有 classification、parity target、wave
- Wave 1 与 deferred waves 的命令边界必须在这一步冻结

## Phase 1：Governance & SSoT Lock

目标：把全局治理与文档边界固定成单一事实源，并补齐与 inventory 直接相关的 SSoT。

交付：

- `.specify/memory/constitution.md`
- `docs/ssot/agent-remnote/README.md`
- `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`
- `docs/ssot/agent-remnote/http-api-contract.md`
- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/tools-write.md`
- `docs/ssot/agent-remnote/ui-context-and-persistence.md`
- `docs/ssot/agent-remnote/write-input-surfaces.md`
- `README.md`
- `README.zh-CN.md`
- `packages/agent-remnote/README.md`
- `skills/remnote/SKILL.md`

关键点：

- 明确允许的模式差异只有 transport 类字段
- inventory / docs / code mirror / executable registry 的主从关系要写死
- 所有 Wave 1 和 deferred decisions 都要有文档落点

## Phase 2：Executable Contract Spine & Architecture Guards

目标：在开始迁移命令前，先把 Wave 1 的执行骨架与边界门禁建起来。

新增模块：

- `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- `packages/agent-remnote/src/lib/business-semantics/modeParityRuntime.ts`
- `packages/agent-remnote/src/lib/business-semantics/localModeAdapter.ts`
- `packages/agent-remnote/src/lib/business-semantics/remoteModeAdapter.ts`
- `packages/agent-remnote/src/lib/business-semantics/capabilityGuards.ts`

新增门禁：

- `packages/agent-remnote/tests/contract/remnote-business-command-contracts.contract.test.ts`
- `packages/agent-remnote/tests/contract/remnote-business-command-architecture.contract.test.ts`

关键点：

- inventory 决定 inclusion / classification / wave
- executable registry 决定 Wave 1 命令怎么绑定 runtime capability
- runtime 决定唯一 mode switch
- business command 文件不再各自判断 `cfg.apiBaseUrl`

## Phase 3：Host-Authoritative Semantic Extraction

目标：把目前散在 CLI 的宿主依赖业务语义提取为可复用模块。

新增模块：

- `packages/agent-remnote/src/lib/business-semantics/refResolution.ts`
- `packages/agent-remnote/src/lib/business-semantics/placementResolution.ts`
- `packages/agent-remnote/src/lib/business-semantics/selectionResolution.ts`
- `packages/agent-remnote/src/lib/business-semantics/titleInference.ts`
- `packages/agent-remnote/src/lib/business-semantics/receiptBuilders.ts`

关键点：

- ref / placement / selection / title / receipt 语义统一
- capability gating 统一
- local / remote 只保留薄适配层
- 写路径继续走 apply/WritePlanV1；读路径通过 runtime capability 抽象

## Phase 4：Wave 1 Parity Migration

目标：交付 Wave 1 command set 的 full parity。

### Workstream A：Reference / Search / Context Reads

命令：

- `search`
- `rem outline`
- `daily rem-id`
- `page-id`
- `by-reference`
- `references`
- `resolve-ref`
- `query`
- `plugin current`
- `plugin search`
- `plugin ui-context snapshot/page/focused-rem/describe`
- `plugin selection current/snapshot/roots/outline`

### Workstream B：Core Rem Graph Writes

命令：

- `daily write`
- `apply`
- `queue wait`
- `rem create`
- `rem move`
- `portal create`
- `rem replace`
- `rem children append/prepend/clear/replace`
- `rem set-text`
- `rem delete`
- `tag add/remove`
- `rem tag add/remove`

关键点：

- 既要补 success parity，也要补 stable-failure parity
- Host API service-side route / schema / runtime handler 必须与 runtime adapter 同步改
- Wave 1 business command 文件必须迁到 runtime
- 旧 local-only assertions / help / docs 必须同步迁移

## Phase 5：Deferred Command Decisions & Migration Boundaries

目标：对非 Wave 1 commands 完成“same-support / same-stable-failure / reclassify”
决策，并写清后续波次。

涉及面：

- table family
- powerup family
- analytical read surfaces such as `connections`, `daily summary`,
  `topic summary`, `inspect`, `todos list`

关键点：

- 先做边界裁决，再进入后续波次
- 不在本 feature 内把 parity 误做成能力扩张
- deferred commands 的 remote guard 必须与 inventory target 一致

## Phase 6：Deterministic Verification Gate

目标：让 parity regression 能被默认门禁抓住，并且验证口径达到命令级。

交付：

- `packages/agent-remnote/tests/helpers/remnoteBusinessCommandMatrix.ts`
- `packages/agent-remnote/tests/helpers/remnoteBusinessCommandContracts.ts`
- `packages/agent-remnote/tests/helpers/remoteModeHarness.ts`
- `packages/agent-remnote/tests/helpers/parityFixtureBuilders.ts`
- `packages/agent-remnote/tests/helpers/parityComparison.ts`
- `packages/agent-remnote/tests/contract/remnote-business-command-classification.contract.test.ts`
- `packages/agent-remnote/tests/contract/remnote-business-command-contracts.contract.test.ts`
- `packages/agent-remnote/tests/contract/remnote-business-command-architecture.contract.test.ts`
- `packages/agent-remnote/tests/contract/remnote-business-command-parity.contract.test.ts`
- `packages/agent-remnote/tests/integration/remnote-business-command-mode-parity.integration.test.ts`

最少验证：

- inventory row -> verification case 映射
- inventory row -> executable contract row 映射
- Wave 1 每条 command 至少 remote 跑一次
- success comparison
- defined stable-failure comparison
- default `/v1`
- non-default `/remnote/v1`
- selection / UI-context / in-place portal / hierarchy / receipt fixtures 可重复
- architecture guard：Wave 1 command 文件无直接 mode 分支

## Phase 7：Docs & Skill Sync

目标：把 parity 规则、wave 边界和推荐路径同步到所有用户面与 agent 面文档。

关键点：

- README / SSoT / skill 词汇统一
- business command 与 operational command 边界统一
- executable registry / runtime / gate 的词汇统一
- deferred command 的后续波次信息一致

## 实施顺序

1. Phase 0 冻结 authoritative inventory、wave 和 parity target
2. Phase 1 先锁治理与全局 SSoT
3. Phase 2 先建 executable contract spine 与 architecture guards
4. Phase 3 抽 host-authoritative semantics
5. Phase 4 迁移 Wave 1 commands 到 runtime
6. Phase 5 写清 deferred commands 的边界与后续波次
7. Phase 6 跑命令级 remote-first gate
8. Phase 7 收 docs / skill 漂移

## 风险与缓解

### 风险 1：inventory 再次形成多份真相

缓解：

- 先冻结 authoritative inventory
- 其它表示全部声明为 derived 或 executable projection
- 加 drift tests

### 风险 2：registry 成为第二个权威源

缓解：

- registry 只能声明 Wave 1 executable metadata
- inclusion / classification / wave 仍由 authoritative inventory 决定
- 加 inventory -> registry alignment tests

### 风险 3：parity 被误做成能力扩张

缓解：

- 每条 command 先写 parity target
- deferred commands 先做 same-stable-failure / reclassify / wave 决策

### 风险 4：过度追求统一 IR，反而把读路径做复杂

缓解：

- 保持写路径使用 `apply/WritePlanV1`
- 读路径统一到 runtime capabilities，不强行写成 write plan

### 风险 5：remote-first gate 证明不了“100% parity”

缓解：

- 改成 inventory-driven command mapping
- success 和 stable-failure 都比较
- default 与 non-default base path 都跑

### 风险 6：selection / UI-context / portal 夹具不稳定

缓解：

- 单独建设 deterministic fixture builders
- 把 manual host smoke 与 deterministic gate 分开
