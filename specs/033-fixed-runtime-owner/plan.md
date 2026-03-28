# Fixed Runtime Owner Governance Implementation Plan

> **For agentic workers:** REQUIRED: use a docs-first, evidence-backed flow. Do not start implementation until the fixed-owner claim model, runtime-root model, and status/doctor contract are aligned.

**Goal:** Keep the RemNote-facing URL fixed while ensuring exactly one declared backend owner holds it at a time, default source execution to isolated dev runtime roots and ports, and make owner conflicts diagnosable and safely repairable.

**Architecture:** Introduce one globally discoverable control-plane root plus per-owner runtime roots, persist one canonical fixed-owner claim under the control-plane root, attach durable owner metadata and launcher references to daemon/api/plugin artifacts, route doctor/status/stack decisions through the claim plus trusted live metadata, and make explicit transfer happen via one lifecycle command surface under `stack` that moves daemon + api + plugin as one owner bundle.

**Tech Stack:** TypeScript ESM, `effect`, `@effect/cli`, existing daemon/api/plugin lifecycle services, pid/state JSON artifacts, Vitest contract and integration tests

---

## 实施计划：033-fixed-runtime-owner

日期：2026-03-28  
Spec：`specs/033-fixed-runtime-owner/spec.md`

## 摘要

这次不是做“多加几个 warning”，而是把固定 URL 背后的运行时治理补成一套完整
模型：

- `stable` published install 是 fixed URL 默认 owner
- source-tree 执行默认进入 isolated `dev` profile
- `control_plane_root` 与 runtime root 分层，claim 不再绑在 runtime root 上
- 所有默认路径先收口到 runtime root，再派生具体文件
- daemon/api/plugin pid/state 都带 owner metadata
- owner metadata 和 claim 都带 `launcher_ref`
- fixed URL 的预期 owner 由一个 canonical claim 驱动
- `doctor --fix` 只修 deterministic ownership 问题
- 显式 owner transfer 通过 `stack takeover --channel <stable|dev>` 完成
- fixed-owner bundle 明确包括 daemon + api + plugin

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js 22
- **Primary Dependencies**: `effect`, `@effect/cli`, existing lifecycle/runtime services, JSON pid/state artifacts
- **Storage**:
  - canonical control-plane root under `~/.agent-remnote`
  - stable runtime root stays on the current stable user-data root for migration safety
  - isolated dev runtime roots derive from worktree identity under the control-plane namespace
  - canonical fixed-owner claim under the control-plane root
  - no new writes to `remnote.db`
- **Testing**: Vitest contract tests, focused lifecycle integration tests, doctor fix tests, status/config contract tests
- **Target Platform**: macOS-first local host runtime, but path handling must remain cross-platform
- **Project Type**: Monorepo with `packages/agent-remnote` and `packages/plugin`
- **Performance Goals**:
  - no extra long-lived polling loops
  - no additional hot-path overhead for normal command execution beyond reading small JSON metadata
  - no repeated full process scans when claim metadata already proves state
- **Constraints**:
  - fixed RemNote URL and canonical ports remain stable for the user
  - stable/dev must not share runtime artifacts by default
  - multiple worktrees must isolate from each other by default
  - `doctor --fix` stays non-destructive and claim-driven
  - command output and diagnostics remain English
  - forward-only metadata evolution; no long-term dual schema
- **Scale/Scope**:
  - daemon + api + plugin lifecycle
  - config resolution and default paths
  - doctor/status/stack/config print
  - docs/runbooks/skills alignment

## Constitution Check

| Principle | Result | Notes |
| --- | --- | --- |
| 1. 禁止直接修改 RemNote 官方数据库 | PASS | No new write path touches `remnote.db`; lifecycle governance only. |
| 2. Forward-only evolution | PASS | Pid/state/config metadata may evolve without compatibility shims beyond bounded migration. |
| 3. SSoT 优先 | PASS | CLI/status/doctor/stack ownership semantics must be written into SSoT before closing the feature. |
| 4. 预算与超时兜底 | PASS | Claim reads remain file-based and bounded; lifecycle probes keep explicit timeouts. |
| 5. 唯一消费与可诊断身份 | PASS | Ownership metadata strengthens single-owner diagnostics instead of weakening them. |
| 6. 跨平台路径规范 | PASS | Runtime root derivation becomes the central place for normalized paths. |
| 7. 语言（用户输出 + 代码注释） | PASS | New CLI/status fields stay English. |
| 8. 可验证性 | PASS | Contract tests cover profile resolution, ownership metadata, doctor repair, and transfer flows. |
| 9. 非破坏性默认 | PASS | Automatic repair is limited to deterministic stale/mismatch cases; ambiguous transfer requires explicit action. |
| 10. 跨进程状态文件语义单一 | PASS | One fixed-owner claim is the only expected-owner truth source; pid/state remain live observation only. |
| 11. 架构边界必须可自动门禁 | PASS | Ownership fields and claim/state drift get dedicated contract tests. |
| 12. Write-first（最短链路） | PASS | This feature does not add inspect-first requirements to write commands. |
| 13. CLI Agent-First（最小完备原子能力） | PASS | Owner transfer stays in one lifecycle command surface; no scenario explosion. |
| 14. Agent Skill 同步 | PASS | Local runbooks and repo-local skill guidance must be updated together. |
| 15. RemNote Business Command Mode Parity | PASS | This feature affects operational lifecycle only and must stay classified outside business parity. |

## Perf Evidence Plan

N/A

原因：

- 本特性是 lifecycle governance 和 metadata 改造
- 不引入新的持续热路径
- 主要风险在错误修复边界和 owner 诊断，而不是吞吐性能

## Project Structure

### Documentation (this feature)

```text
specs/033-fixed-runtime-owner/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── runtime-ownership.md
├── checklists/
│   └── requirements.md
├── notes/
│   ├── README.md
│   ├── entrypoints.md
│   └── questions.md
└── tasks.md
```

### Source Code (repository root)

```text
docs/ssot/agent-remnote/
├── README.md
├── cli-contract.md
├── http-api-contract.md
├── ui-context-and-persistence.md
└── runtime-mode-and-command-parity.md          # remains the authority for business vs operational classification

README.md
README.zh-CN.md
AGENTS.md
packages/agent-remnote/README.md
skills/remnote/SKILL.md

packages/agent-remnote/src/services/
├── Config.ts
├── DaemonFiles.ts
├── ApiDaemonFiles.ts
├── PluginServerFiles.ts
├── StatusLineFile.ts
└── ...existing lifecycle services

packages/agent-remnote/src/lib/
├── pidTrust.ts
├── doctor/
│   ├── checks.ts
│   └── fixes.ts
└── runtime-ownership/
    ├── launcher.ts
    ├── profile.ts
    ├── paths.ts
    ├── claim.ts
    ├── ownerDescriptor.ts
    ├── portClass.ts
    └── conflictDetection.ts

packages/agent-remnote/src/commands/
├── doctor.ts
├── config/print.ts
├── stack/
│   ├── ensure.ts
│   ├── status.ts
│   ├── stop.ts
│   └── takeover.ts
├── ws/
│   ├── _shared.ts
│   └── status.ts
├── api/
│   ├── _shared.ts
│   └── status.ts
└── plugin/
    ├── _shared.ts
    └── status.ts

packages/agent-remnote/tests/
├── contract/
│   ├── runtime-owner-profile.contract.test.ts
│   ├── runtime-owner-status.contract.test.ts
│   ├── runtime-owner-doctor.contract.test.ts
│   ├── runtime-owner-takeover.contract.test.ts
│   └── ...updated lifecycle contract tests
└── integration/
    └── runtime-owner-lifecycle.integration.test.ts
```

**Structure Decision**:

- runtime root / profile resolution belongs in a dedicated `runtime-ownership`
  slice, not spread across individual file services
- `control_plane_root` is the stable global discovery root; fixed-owner claim
  and global config live there
- pid/state file services remain the persistence layer for each runtime family
- the canonical fixed-owner claim is the only expected-owner truth source
- the stable runtime root remains on the current stable user-data root to avoid
  involuntary migration of existing config/store/workspace bindings
- isolated dev roots derive from normalized `worktree_root`, not only `repo_root`
- `launcher_ref` is mandatory for any claimed owner that may need to be
  restarted from another invocation context
- `doctor` and `status` compute conflicts by comparing claim vs live metadata
- `stack ensure/status/stop/takeover` form the fixed-owner orchestration surface
  for daemon + api + plugin together
- direct `daemon/api/plugin start|ensure` on canonical ports must still obey the
  same claim policy

## Complexity Tracking

无已知宪法违规项。

## Phase 0：Contract Freeze

目标：先锁清楚 fixed-owner claim、runtime profile、owner metadata、status/doctor
语义与 transfer 边界，再动实现。

交付：

- `specs/033-fixed-runtime-owner/spec.md`
- `specs/033-fixed-runtime-owner/research.md`
- `specs/033-fixed-runtime-owner/data-model.md`
- `specs/033-fixed-runtime-owner/contracts/runtime-ownership.md`
- `specs/033-fixed-runtime-owner/quickstart.md`

关键裁决：

- canonical fixed-owner claim 是唯一 expected-owner truth source
- stable 是默认 claimed owner
- source-tree 默认 isolated dev profile
- transfer 属于 `stack`
- `doctor --fix` 只处理 deterministic ownership repair

## Phase 1：Runtime Root & Profile Foundation

目标：让所有默认路径和默认端口先建立在统一的 control-plane / runtime profile /
runtime root 决策上。

核心改动：

- `Config.ts` 解析 control-plane root、runtime profile / runtime root / port class
- 所有 default path helpers 从 runtime root 派生
- stable runtime root 继续兼容当前 stable 用户态根
- isolated dev profile 生成 deterministic 非 canonical 端口
- `config print` 暴露解析后的 profile/root/default paths

关键点：

- source-tree 调用默认不再写 stable root
- advanced overrides 仍然允许，但必须先过 profile/root 解析
- isolated dev 的派生键按 `worktree_root`
- dev bootstrap 明确只继承必要控制信息，而不复制完整 stable store

## Phase 2：Owner Metadata & Trust Evolution

目标：让 daemon/api/plugin 的 live metadata 足够表达“谁在跑、从哪儿跑、是否持有
fixed claim”。

核心改动：

- 扩展 `WsPidFile`、`ApiPidFile`、`PluginServerPidFile`
- 扩展对应 state file schema
- 新增 `launcher_ref` / launcher resolver
- `pidTrust.ts` 从“像不像 agent-remnote”升级到“是不是可信的期望 owner”

关键点：

- build id 继续保留
- 新增 owner descriptor 字段
- trust 逻辑先验证 live process，再验证 owner consistency
- plugin artifacts origin 也要进入 owner metadata / preflight 语义

## Phase 3：Migration Semantics & Fixed-Owner Claim Policy

目标：把 expected-owner 决策独立成一个小而清晰的治理层。

核心改动：

- 写死 migration 语义：
  - stable runtime root 继续等于当前 stable 用户态根
  - 现有 `config.json` 保持在 control-plane root
  - 现有 stable `store.sqlite` / `workspace_bindings` 保留原位
  - isolated dev store 不复制 queue / receipts / 历史运行态
- 新增 fixed-owner claim service
- 提供 claim read/write/normalize/staleness helpers
- 统一 claim vs live comparison

关键点：

- claim 只表达 expected owner
- claim canonical path 独立于 runtime root，可从任意 profile 发现
- pid/state 只表达 observed live owner
- conflict detection 统一输出 deterministic categories
- `doctor --fix` 的作用域默认对 canonical fixed owner 生效，而不是只修当前 profile

## Phase 4：Doctor / Status / Stack Governance

目标：把 ownership 变成一等诊断对象，而不是隐藏逻辑。

核心改动：

- `doctor --json` 暴露 claim、live owner、conflict、repairability
- `doctor --fix` 基于 claim 做 deterministic repair
- `stack status`、`daemon status`、`api status`、`plugin status` 暴露 owner fields
- `config print` 暴露 effective endpoints、resolved local profile、claim/live summary
- `stack ensure/status/stop` 明确把 plugin 纳入 fixed-owner bundle
- `stack ensure` respect claim and profile defaults

关键点：

- 当 claim 指向 stable 时，canonical runtime 的 repair 方向是 stable
- 当 claim 指向 dev 时，`doctor --fix` 不会偷偷回滚到 stable
- ambiguity 只能 report + next actions，不能 auto transfer
- status 必须同时区分 `resolved_local_profile` 与 `fixed_owner_claim`

## Phase 5：Explicit Takeover / Reclaim Flow

目标：在不改变 RemNote 固定 URL 的前提下，允许维护者显式切换 owner。

核心改动：

- 新增 `stack takeover --channel <stable|dev>`
- 先验证当前 claim/live/trust，再执行 plugin preflight、controlled stop、claim transfer、target restart
- 命令结果显式报告：
  - previous owner
  - new owner
  - restarted services
  - skipped/failures
  - `remnote_reload_required`

关键点：

- reclaim stable 不新增独立 public command，复用 `--channel stable`
- 只有 trusted ownership graph 才能自动 stop live runtime
- canonical ports 只能被 claimed owner 占用
- stable/dev launcher 解析必须脱离当前调用 entrypoint 自举

## Phase 6：Docs, Runbooks, Verification

目标：把这套模型写进全局文档、README、本地 runbook、agent guidance，并加测试门禁。

必须同步：

- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/http-api-contract.md`
- `docs/ssot/agent-remnote/ui-context-and-persistence.md`
- `docs/ssot/agent-remnote/README.md`
- `README.md`
- `README.zh-CN.md`
- `README.local.md` (create if absent; this feature changes local debugging behavior)
- `AGENTS.md`
- `packages/agent-remnote/README.md`
- `skills/remnote/SKILL.md`

验证门：

- profile/root resolution contract tests
- owner metadata/status contract tests
- doctor deterministic repair contract tests
- takeover/reclaim contract tests
- direct `daemon/api/plugin start|ensure` canonical-port claim-policy tests
- one lifecycle integration smoke covering stable -> dev -> stable
- one packed-install + source-tree coexistence gate covering stable default,
  isolated dev startup, dev takeover, stable reclaim, and published launcher
  resolution
