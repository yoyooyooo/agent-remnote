# Feature Specification: Outline-Aware Agent Write Experience

**Feature Branch**: `[022-outline-aware-writes]`  
**Created**: 2026-03-14  
**Status**: Draft  
**Input**: User description: "把 agent-remnote 的写入命令面优化成更短路径、更智能的大纲写入体验。要求：Skill 能智能判断内容是否适合大纲化，适合时优先单根、递进、可扩写的结构；不适合时保持正常写法。CLI/插件侧应减少结构优化任务的调用步数，支持更高层的意图与结构约束，并避免可见 backup 节点污染结果。还要补充对当前选中 Rem 直接扩写、单根报告写入、避免双层 bundle、结构断言与最小读取路径的需求。"

全局概念与术语裁决见：`specs/CONCEPTS.md`。

## Context & Motivation

当前 `agent-remnote` 已经具备安全写入、结构化 Markdown 导入、Daily Note 写入、以及围绕 `rem children` 的高频写入命令。

但从 Agent 视角回看，当前写入体验仍存在几类高频摩擦：

- Agent 需要自己判断内容是否适合转为大纲，而命令面还缺少足够清晰的原子约束去承接这种判断结果。
- “把当前选中的 Rem 往下展开”这类结构优化任务，虽然本质上是 direct-children rewrite，但当前仍缺少更短的目标选择与结果约束手段。
- 报告型内容虽然更适合单一主线和递进层级，但当前体验仍容易长出多个并列根节点，或在单根 Markdown 上再叠一层 bundle。
- 结构优化任务完成后，可能留下用户可见的 backup 节点，污染最终大纲结果。
- Agent 为了确保结构写对，往往需要额外读取 selection / current / outline，再发起写入，链路偏长。
- 命令面还存在一定程度的双表面与便利封装，容易把 Agent 引向非最短路径。

本 feature 的目标是把写入链路进一步收敛为“最短路径 + 最优结构”的 Agent 体验：

- 让系统能智能判断内容是否适合大纲化
- 让报告型和扩写型内容默认形成更稳定的树形结构
- 让结构敏感任务减少读取和善后步骤
- 让正常写入路径与显式备份路径分离，避免成功写入后仍留下噪音节点
- 让残留 backup 在极少数异常情况下仍然可被快速发现与清理
- 让 Agent 主命令面进一步收敛到原子能力，而不是场景型包装命令

## Scope

### In Scope

- 为 Agent 写入链路引入“内容形态判断”语义，但保持公开 CLI 的原子性
- 优化“扩写当前选中 Rem / 现有标题 Rem”的基础命令路径
- 优化单根 Markdown 的默认写入体验，避免双层单根
- 为结构敏感任务增加更高层的意图和结构约束表达
- 为结构写入引入更明确的成功后默认行为，避免可见 backup 节点污染
- 为 backup artifact 建立可诊断、可检索、可清理的最小治理面
- 为 Agent 使用面建立“主命令面 / 辅助命令面 / 运维命令面”的清晰分层
- 更新 Skill 与相关文档，使 Agent 能稳定选择最短、最合适的命令路径

### Out of Scope

- 改变 `queue -> WS -> plugin SDK` 的写入红线
- 重新设计 RemNote 官方富文本模型
- 引入新的远程鉴权模型或新的 API trust boundary
- 面向普通终端用户的大规模交互式编辑器体验 redesign
- 为旧命令面提供并存支持

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 报告型内容自动走单根大纲 (Priority: P1)

作为 Agent，我希望在写入调研、总结、会议纪要这类长内容时，系统能优先形成单一主线的大纲结构，而不是把多个顶层 bullet 平铺到目标页面根下。

**Why this priority**: 这是当前结构质量问题最集中的来源，也是 Agent 写入体验中最常见的失败模式。

**Independent Test**: 给定一份已经具备单根结构的 Markdown 报告，系统能够把它写入目标位置，并保持单一顶层根节点，不额外叠加 bundle 或平铺多个根节点。

**Acceptance Scenarios**:

1. **Given** 一份调研总结已经整理成单根 Markdown，**When** Agent 将其写入 Daily Note，**Then** 最终结果必须保持单一顶层根节点。
2. **Given** 一份报告型 Markdown 已经具备清晰主线，**When** 系统决定默认写入策略，**Then** 不得再额外生成第二层容器根节点。

---

### User Story 2 - 现有 Rem 的扩写任务走就地重构 (Priority: P1)

作为 Agent，我希望当用户选中一个现有 Rem 并要求“展开讲讲”“继续往下分层”时，系统能在现有基础命令上直接表达“以当前选中 Rem 为目标、保留锚点、重写 children”，而不是逼我额外拼接冗长链路。

**Why this priority**: 这是结构敏感写入中最容易破坏上下文的位置。如果锚点保不住，后续知识树会迅速长歪。

**Independent Test**: 给定一个已存在的标题 Rem，调用方可以通过现有 replace / children rewrite 命令上的目标选择与结构断言参数，完成“保留 anchor、重写 children、无并列根”的写入。

**Acceptance Scenarios**:

1. **Given** 用户选中一个标题 Rem，**When** 请求“按由浅入深的方式继续展开”，**Then** 系统必须保留该标题 Rem，并把新结构写入其 children。
2. **Given** 一个结构优化任务以现有 Rem 为目标，**When** 写入成功，**Then** 父页面根下不得出现新的并列报告根节点。

---

### User Story 3 - 不适合大纲化的内容保持正常写法 (Priority: P2)

作为 Agent，我希望面对连续论证、修辞性段落、或强依赖上下文的文本时，系统不要为了“规整”而强行改写成单根大纲。

**Why this priority**: 大纲化是优势，不是强制。误判会让原本连续的论证变成难以理解的残句树。

**Independent Test**: 给定一段不适合直接大纲化的连续论证文本，系统不会默认把它拆成看似规整但语义断裂的树结构。

**Acceptance Scenarios**:

1. **Given** 一段连续论证文字，**When** Agent 请求写入 Daily Note，**Then** 系统可以保留正常写法，而不强制改写成单根大纲。
2. **Given** 内容缺少局部闭包和稳定层级关系，**When** 系统做形态判断，**Then** 它必须允许“正常写入”作为合法结果。

---

### User Story 4 - 结构优化链路默认更短、更干净 (Priority: P2)

作为 Agent，我希望结构敏感任务的默认调用链路更短，并且在成功后不会留下用户可见的备份节点或其他噪音结果。

**Why this priority**: 当前真正让 Agent 体验变差的，不只是“能不能写进去”，还有“写完后要不要继续清垃圾、补结构、做额外读取”。

**Independent Test**: 在结构优化场景下，系统能够用最少的前置读取和一次主写入完成任务，并在默认成功路径下不产生用户可见的 backup 节点。

**Acceptance Scenarios**:

1. **Given** 一个结构优化任务，**When** Agent 走默认路径，**Then** 允许最多一次轻量结构读取用于确认层级。
2. **Given** 一次成功的 children replace / outline rewrite，**When** 任务完成，**Then** 默认结果中不应保留用户可见的 backup 节点。

---

### User Story 5 - 残留 backup 能被快速捞出和清理 (Priority: P2)

作为维护者或 Agent，我希望即使极少数 replace 任务因为异常留下了 backup Rem，也能通过统一命令快速找到并清理，而不需要在知识树里人工搜垃圾节点。

**Why this priority**: 即使默认成功路径最终不留 backup，可诊断和可恢复能力仍然需要一个统一抓手，否则偶发残留会持续污染用户知识库。

**Independent Test**: 在人为制造 backup 残留后，系统能够通过统一命令列出 orphan backup，并在 dry-run 与 apply 两种模式下完成清理。

**Acceptance Scenarios**:

1. **Given** 一批带有 `agent-remnote backup` 标记且满足 orphan 条件的 Rem，**When** 调用 `backup list`，**Then** 系统能够列出它们及其来源信息。
2. **Given** `backup cleanup` 的默认模式，**When** 调用方未显式确认执行，**Then** 系统只做 dry-run 预览而不实际删除任何 backup Rem。
3. **Given** orphan backup 已被列出，**When** 调用 `backup cleanup --apply`，**Then** 系统能够清理目标 backup Rem，并更新其治理状态。

---

### User Story 6 - Agent 主命令面保持低熵 (Priority: P2)

作为 Agent，我希望公开命令面以原子动作和基础对象为主，而不是同时暴露太多语义重复的场景型命令和双表面写法。

**Why this priority**: 结构写入是否优雅，不只取决于写入能力本身，也取决于 Agent 是否容易选到最短路径。双表面和过多附属包装会直接增加选择成本。

**Independent Test**: 在文档、skill 和规划后的命令分层中，Agent 的主写入面明确收敛到少量基础对象和动作，重复语义的表面被删除或收紧。

**Acceptance Scenarios**:

1. **Given** Agent 在做结构敏感写入， **When** 它查阅主命令面， **Then** 核心路径应围绕 `apply`、`rem`、`replace`、`tag`、`portal`、`backup` 等基础对象，而不是场景型命令。
2. **Given** `powerup` 与 `table` 存在部分写入能力重叠， **When** 规划 Agent 主路径， **Then** 系统必须明确哪一套是主表面，哪一套退出主写入路径。

### Edge Cases

- 当输入既像报告型内容又包含多块并列素材时，系统如何决定是单根整合还是保留多根。
- 当 Markdown 只有一个顶层列表项时，系统如何确保不会把字面 `- ` 残留到最终 Rem 文本中。
- 当目标是当前选中 Rem，但 selection 缺失、focus 缺失或 selection 包含多个根时，系统如何 fail-fast 或降级。
- 当结构优化任务需要读取当前树结构时，系统如何避免把一次轻量读取升级成冗余的 search / inspect 链路。
- 当用户明确要求保留多个根节点时，系统如何跳过单根偏好而不与默认规则冲突。
- 当显式备份被启用时，系统如何让备份存在但不污染默认成功结果。
- 当 backup Rem 已残留但 PowerUp 标记缺失、Store DB 记录存在，系统如何判断和清理。
- 当 PowerUp 标记存在但 Store DB 中已无对应事务记录，系统如何避免误删用户手工保留的内容。
- 当 `--assert` 引入过多可选值时，系统如何避免其膨胀成一套表达式语言。
- 当 `table` 与 `powerup` 的写入语义重叠时，系统如何避免 Agent 被双表面误导。

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support an internal outline-suitability decision before structured writes, so agent routing can distinguish outline-first writing from normal writing without forcing those categories into public CLI flags.
- **FR-002**: (Write-first) When content is naturally outline-shaped and report-like, the default write path MUST preserve or produce a single top-level root.
- **FR-003**: When content is already a single-root Markdown outline, the default write path MUST avoid adding an extra container root on top of it.
- **FR-004**: When content is not naturally outline-shaped, the system MUST allow normal writing without forcing a tree rewrite.
- **FR-005**: Existing structure-rewrite commands MUST support expand-in-place behavior for an existing target Rem, where the anchor Rem is preserved and its direct children become the primary rewrite surface.
- **FR-006**: The canonical expand-in-place rewrite path MUST support a direct target-selection mechanism for current selection, so agent callers can target the selected Rem without first resolving and reinjecting its id manually.
- **FR-007**: For expand-in-place tasks, the default path MUST avoid creating new sibling roots at the parent page level.
- **FR-008**: The public CLI MUST remain primitive and composable: scene classification such as capture/report/summary/expand MUST NOT become required public command categories or public flags.
- **FR-009**: The public CLI MAY expose result constraints and execution controls, but those controls MUST be atomic and composable rather than scene-named. At minimum this feature must support:
  - target selection for the current selection
  - backup policy selection
  - structure assertions
- **FR-010**: The system MUST support explicit structure assertions for agent-driven writes, including at least:
  - single-root result
  - preserved anchor
  - no literal bullet marker for plain-text single-item imports
- **FR-011**: The system MUST support a minimal structural-read path for structure-sensitive tasks and keep it separate from heavier search/inspect flows.
- **FR-012**: The system MUST distinguish between ordinary write success and explicit backup behavior, so a successful default write does not leave user-visible backup nodes unless the caller requested that behavior.
- **FR-013**: If backup behavior is supported for structure rewrites, the system MUST provide a way to disable it or keep it out of the default visible result.
- **FR-014**: Agent-facing guidance MUST document a tiered routing model where:
  - `daily write` covers report-style single-root writing and ordinary writing without explicit structure rewrite
  - `rem children replace` is the canonical expand-in-place and section-rewrite path
  - `replace markdown` is reserved for advanced local-only block-range replacement
- **FR-015**: The `$remnote` skill MUST encode the same routing logic and structure rules as the CLI surface, so agents do not need to infer them ad hoc.
- **FR-016**: Default write guidance for report-style content MUST remain aligned with forward-only evolution and MUST NOT rely on hidden transition behavior.
- **FR-017**: The CLI MUST add a backup governance command surface, at minimum `backup list` and `backup cleanup`.
- **FR-018**: Existing replace-style commands that can create backup artifacts MUST expose explicit backup behavior control, with a default that does not leave visible backup Rems on successful writes.
- **FR-019**: The system MUST register or resolve a plugin-owned PowerUp named `agent-remnote backup` for backup artifacts.
- **FR-020**: The `agent-remnote backup` PowerUp MUST be applied to backup Rems whenever a replace-style write intentionally creates a recoverable backup artifact.
- **FR-021**: Backup artifacts MUST carry enough metadata to support listing, cleanup, and diagnosis, including at least backup kind, cleanup policy, cleanup state, source txn, source op, and source location.
- **FR-022**: Store DB MUST remain the truth source for backup lifecycle and orphan determination; the PowerUp tag is an index and operator-facing marker, not the sole source of truth.
- **FR-023**: The system MUST maintain a persistent backup-artifact registry in Store DB for replace-style writes that create recoverable backup artifacts.
- **FR-024**: The default successful write path MUST not require a visible backup Rem to persist after commit; if a visible backup remains, it MUST be treated as exceptional state.
- **FR-025**: `backup list` MUST support filtering at least by cleanup state, backup kind, and age threshold.
- **FR-026**: `backup cleanup` MUST default to dry-run and require explicit execution to delete backup artifacts.
- **FR-027**: The backup governance surface MUST distinguish between:
  - auto cleanup candidates
  - explicitly retained backups
  - orphan backups
- **FR-028**: The system MUST use the `agent-remnote` prefix for internal PowerUp names introduced by this feature family.
- **FR-029**: The public CLI surface MUST explicitly distinguish between:
  - agent-primary primitive commands
  - advanced local-only block-replace commands
  - auxiliary read commands
  - ops / daemon / environment commands
- **FR-030**: Agent-primary write guidance MUST center on a low-entropy command set built from primitive objects and actions, rather than scene-named commands, and MUST NOT present `replace markdown` as a co-equal default rewrite path alongside `rem children replace`.
- **FR-031**: The public `--assert` surface MUST remain intentionally narrow in v1 and support only a fixed set of built-in assertions rather than arbitrary expressions.
- **FR-032**: The initial public `--assert` set MUST be limited to `single-root`, `preserve-anchor`, and `no-literal-bullet`.
- **FR-033**: Overlapping write surfaces for structured data MUST be resolved. If `table` and `powerup` overlap, the system MUST designate one as the primary Agent-facing write surface and delete the other from the public write surface.
- **FR-034**: `powerup` read capabilities such as discovery and schema inspection MAY remain public even if `powerup` write capabilities are downgraded from the Agent-primary path.
- **FR-035**: Ops / lifecycle commands such as `daemon` / `api` / `plugin` / `stack` / `queue` / `doctor` / `config` MUST remain available but MUST be classified outside the Agent-primary write surface.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The default agent path for structure-sensitive writes MUST minimize command count and avoid unnecessary exploratory reads.
- **NFR-002**: Structure-sensitive writes MUST be predictable enough that the same input shape leads to the same default routing choice.
- **NFR-003**: Successful default writes MUST produce low-noise results: no unexpected visible backup nodes, no duplicated single-root containers, and no stray literal list markers where plain Rem text is intended.
- **NFR-004**: User-facing guidance and diagnostics MUST use a stable mental model for outline suitability, structure constraints, and backup policy.
- **NFR-005**: If the feature introduces new structure constraints or backup controls, the synchronized docs and skills MUST be updated together.
- **NFR-006**: The feature MUST preserve the repository constitution's write-first rule: structure validation and lightweight diagnostics should be integrated into the main write flow instead of requiring separate preflight rituals.
- **NFR-007**: Backup governance MUST remain low-noise: ordinary users should not see backup artifacts in the success path unless they explicitly asked to retain them.
- **NFR-008**: Backup cleanup MUST be diagnosable and conservative: the system must prefer false negatives over accidental deletion when truth sources disagree.
- **NFR-009**: Agent command selection cost MUST be reduced by lowering surface entropy, avoiding redundant scene-named commands and overlapping primary write paths.
- **NFR-010**: Public parameter growth MUST be controlled; new flags should prefer primitive selectors, execution policies, and postconditions over scene semantics.

### Key Entities _(include if feature involves data)_

- **Outline Suitability Decision**: The internal classification result that determines whether content should be written as a hierarchical outline or kept in a normal prose shape.
- **Anchor Rem**: The existing Rem that must be preserved during an expand-in-place rewrite.
- **Target Selector**: A primitive way to identify the write target, such as explicit rem id or current selection.
- **Structure Assertion**: A caller-visible requirement on the final tree shape, such as single-root, preserved-anchor, or no-literal-bullet.
- **Backup Artifact**: Any recovery or snapshot result produced during a structure rewrite, which must be controlled separately from the default visible output.
- **Backup Registry Entry**: The Store DB record that tracks a backup artifact's identity, source operation, cleanup policy, and lifecycle state.
- **Backup PowerUp**: The plugin-owned PowerUp named `agent-remnote backup`, used to mark backup Rems in the visible knowledge graph.
- **Command Surface Tier**: A classification of commands into agent-primary primitives, auxiliary reads, or ops/lifecycle controls.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For report-style single-root inputs, the default successful write result contains exactly one top-level root under the target location.
- **SC-002**: For expand-in-place tasks, successful writes preserve the selected anchor Rem and do not create a new sibling root at the parent page level.
- **SC-003**: For prose-like inputs that are not outline-suitable, the default route permits normal writing without forced tree conversion.
- **SC-004**: The default structure-sensitive write path can be executed with at most one lightweight structural read before the main write.
- **SC-005**: Successful default structure rewrites leave no user-visible backup artifact unless backup behavior was explicitly requested.
- **SC-006**: Synchronized agent guidance (`$remnote` skill and related docs) explicitly describes outline suitability, report-style single-root behavior, `rem children replace` as the canonical expand-in-place path, `replace markdown` as an advanced local-only block-replace path, and when normal writing is preferred.
- **SC-007**: Replace-style writes that intentionally create recoverable backups can be listed through a unified `backup list` surface with enough metadata to locate and reason about them.
- **SC-008**: Orphan backup artifacts can be previewed and cleaned through `backup cleanup`, with dry-run as the default behavior.
- **SC-009**: Agent-primary command guidance converges on a small primitive set, with `rem children replace` established as the canonical structure-rewrite command and `replace markdown` clearly downgraded to an advanced local-only surface.
- **SC-010**: The public `--assert` surface remains fixed and small in v1, without turning into a general expression language.
