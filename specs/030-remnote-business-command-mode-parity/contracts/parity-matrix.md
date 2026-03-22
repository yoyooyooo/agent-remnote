# Contract: RemNote Business Command Parity Matrix

日期：2026-03-22

## Source Hierarchy

唯一 authoritative inventory：

- `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`

本文件的角色：

- 只记录本次 feature 的 command-level gap ledger、wave allocation、以及
  fix/reclassify 进度
- 只记录 S 档升级需要的架构缺口与迁移状态
- 不能新增 authoritative 语义
- 不能与 global SSoT 出现冲突

代码侧 `packages/agent-remnote/src/lib/business-semantics/commandInventory.ts`
只做 machine-readable mirror，必须由 drift tests 约束。

代码侧 `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
只做 Wave 1 executable contract registry，必须受 inventory 对齐测试约束。

## Mode Parity Contract

对于被标记为 `business` 或 `business_deferred` 的命令：

- `apiBaseUrl` 只能切换 transport
- 不能改变命令形状
- 不能改变参数语义
- 不能改变校验规则
- 不能改变 success envelope / error code / receipt 语义
- 不能改变 stable failure contract

允许差异：

- reachability
- timeout / retry
- 服务未启动等 transport diagnostics

## S-Grade Architecture Upgrade Focus

Wave 1 若要达到 S 档，本 feature 还必须补齐以下跨命令缺口：

1. **Executable Contract Gap**
   - 现状：只有 authoritative inventory 与 code mirror，没有 executable
     registry 统一声明 Wave 1 command 的 capability / endpoint / normalizer
   - 目标：引入 `commandContracts.ts`，并以 contract tests 保证它不能脱离
     inventory 漂移

2. **Runtime Spine Gap**
   - 现状：mode switch 仍散在 command files / services 中
   - 目标：引入 `ModeParityRuntime` + local/remote adapters，让 Wave 1
     business command files 不再直接分支 `cfg.apiBaseUrl`

3. **Semantic Centralization Gap**
   - 现状：ref / placement / selection / title / receipt 语义仍有散点
   - 目标：这些语义全部下沉到 host-authoritative 模块

4. **Verification Spine Gap**
   - 现状：已有点状 remote tests，但缺 inventory-driven 总门禁
   - 目标：补齐 inventory -> contract -> verification case 三段映射

## Wave 1 Command-Level Ledger

| Command | Family | Classification | Target | Current Status |
| --- | --- | --- | --- | --- |
| `search` | search_outline | business | same_support | partial |
| `rem outline` | search_outline | business | same_support | partial |
| `daily rem-id` | search_outline | business | same_support | partial |
| `page-id` | ref_reads | business | same_support | none |
| `by-reference` | ref_reads | business | same_support | none |
| `references` | ref_reads | business | same_support | none |
| `resolve-ref` | ref_reads | business | same_support | none |
| `query` | ref_reads | business | same_support | none |
| `plugin current` | ui_context | business | same_support | partial |
| `plugin search` | ui_context | business | same_support | partial |
| `plugin ui-context snapshot` | ui_context | business | same_support | partial |
| `plugin ui-context page` | ui_context | business | same_support | partial |
| `plugin ui-context focused-rem` | ui_context | business | same_support | partial |
| `plugin ui-context describe` | ui_context | business | same_support | partial |
| `plugin selection current` | selection_context | business | same_support | partial |
| `plugin selection snapshot` | selection_context | business | same_support | partial |
| `plugin selection roots` | selection_context | business | same_support | partial |
| `plugin selection outline` | selection_context | business | same_support | partial |
| `daily write` | core_writes | business | same_support | partial |
| `apply` | core_writes | business | same_support | partial |
| `queue wait` | core_writes | business | same_support | partial |
| `rem create` | rem_graph_write | business | same_support | partial |
| `rem move` | rem_graph_write | business | same_support | partial |
| `portal create` | relation_write | business | same_support | none |
| `rem replace` | rem_graph_write | business | same_support | partial |
| `rem children append` | rem_graph_write | business | same_support | partial |
| `rem children prepend` | rem_graph_write | business | same_support | partial |
| `rem children clear` | rem_graph_write | business | same_support | partial |
| `rem children replace` | rem_graph_write | business | same_support | partial |
| `rem set-text` | rem_graph_write | business | same_support | none |
| `rem delete` | rem_graph_write | business | same_support | partial |
| `tag add` | relation_write | business | same_support | partial |
| `tag remove` | relation_write | business | same_support | partial |
| `rem tag add` | relation_write | business | same_support | partial |
| `rem tag remove` | relation_write | business | same_support | partial |

## Cross-Cutting Gap Ledger

| Gap | Severity | Current Status | Target State |
| --- | --- | --- | --- |
| Wave 1 executable command-contract registry missing | blocking | open | `commandContracts.ts` aligned with inventory |
| Unique `ModeParityRuntime` missing | blocking | open | single runtime owns mode switch |
| Residual command-layer `cfg.apiBaseUrl` branching | blocking | open | architecture guard blocks it |
| Residual direct `HostApiClient` dependency in Wave 1 command files | blocking | open | runtime/adapters only |
| Host-authoritative semantic modules incomplete | high | partial | all Wave 1 semantic families centralized |
| Inventory-driven parity gate incomplete | high | partial | command-level default `/v1` + `/remnote/v1` gate |

## Deferred Command-Level Ledger

These commands stay in the authoritative inventory. This feature must classify
their next step clearly, but does not need to implement all of them in Wave 1.

| Command | Family | Classification | Target | Next Step |
| --- | --- | --- | --- | --- |
| `table show` | table_reads | business_deferred | same_support | assign wave2 or reclassify |
| `table create` | table_writes | business_deferred | same_support | assign wave2 |
| `table property add` | table_writes | business_deferred | same_stable_failure | keep unsupported boundary explicit |
| `table property set-type` | table_writes | business_deferred | same_stable_failure | keep unsupported boundary explicit |
| `table option add` | table_writes | business_deferred | same_support | assign wave2 |
| `table option remove` | table_writes | business_deferred | same_support | assign wave2 |
| `table record add` | table_writes | business_deferred | same_support | assign wave2 |
| `table record update` | table_writes | business_deferred | same_support | assign wave2 |
| `table record delete` | table_writes | business_deferred | same_support | assign wave2 |
| `powerup list` | powerup_reads | business_deferred | same_support | assign wave3 |
| `powerup resolve` | powerup_reads | business_deferred | same_support | assign wave3 |
| `powerup schema` | powerup_reads | business_deferred | same_support | assign wave3 |
| `powerup apply` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup remove` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup property add` | powerup_writes | business_deferred | same_stable_failure | keep unsupported boundary explicit |
| `powerup property set-type` | powerup_writes | business_deferred | same_stable_failure | keep unsupported boundary explicit |
| `powerup option add` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup option remove` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup record add` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup record update` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup record delete` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup todo add` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup todo done` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup todo remove` | powerup_writes | business_deferred | same_support | assign wave3 |
| `powerup todo undone` | powerup_writes | business_deferred | same_support | assign wave3 |
| `connections` | analytical_reads | business_deferred | reclassify | decide business vs operational |
| `daily summary` | analytical_reads | business_deferred | reclassify | decide business vs operational |
| `topic summary` | analytical_reads | business_deferred | reclassify | decide business vs operational |
| `inspect` | analytical_reads | business_deferred | reclassify | decide business vs operational |
| `todos list` | analytical_reads | business_deferred | reclassify | decide business vs operational |

补充裁决：

- `powerup.todo.*` 是 canonical inventory 命名；顶层 `todo *` 继续保留为 alias
- `table create`、`table property add`、`powerup property add`、`powerup remove --tag-id`
  这类只编译 `ops` 的 deferred 写命令，在 remote mode 下必须走 `POST /write/apply`，
  不能静默写入调用端本地 queue/store

## Operational Exclusions

These commands are outside the parity contract:

- `api *`
- `stack *`
- `daemon *`
- `backup *`
- `config *`
- `doctor *`
- queue diagnostics such as `queue inspect`, `queue progress`, `queue stats`,
  `queue conflicts`

## Verification Contract

Before Wave 1 closes:

- every Wave 1 command must have at least one remote-first integration case
- every Wave 1 command must have an inventory row -> executable contract row mapping
- every Wave 1 command must have an inventory row -> verification case mapping
- parity-sensitive success cases must have direct-vs-remote comparison
- defined failure cases must also have direct-vs-remote comparison
- the suite must run once under default `/v1`
- the suite must run once under non-default `/remnote/v1`
- architecture guard tests must prove Wave 1 command files no longer branch on
  `cfg.apiBaseUrl`
