# Feature Specification: Write Command Surface Reset With Subject/From/To/At/Portal Axes

**Feature Branch**: `[029-write-command-surface-reset]`  
**Created**: 2026-03-21  
**Status**: Planned  
**Input**: User description: "在 028 的基础上，继续把 create / move / portal 以及相关写命令的参数、概念、模型全部收齐，按 breaking change 做一次大版本重构。"

## Context & Motivation

`028` 已经把 `rem create` / `rem move` 推到了 shared planner 与 portal promotion 流程，但用户面仍然有几组明显裂缝：

- 同样是单主体命令，有的用 `--rem`，有的用 `--target`
- 同样是空间位置，有的用 `--parent/--before/--after/--standalone`，有的用 `--portal-parent/--portal-before/--portal-after`
- `portal create` 和 `rem create` / `rem move` 不在同一水平线上解释
- write command 的公共心智模型没有被显式命名，Agent 需要记住很多局部例外

这条 spec 的目标是做一次彻底的 command-surface reset：

- 用统一参数轴重做高频 write surface
- 把所有相关 CLI 命令都视为 Agent-facing primitives
- 保留 `028` 的 canonical plan 与 runtime op，不动执行路径
- 明确这是 forward-only 的 breaking change，不保留兼容 alias

## Scope

### In Scope

- 对 Rem graph / portal 相关高频写命令做统一参数面重构
- `rem create` 收敛为 `from + at + optional portal`
- `rem move` 收敛为 `subject + at + optional portal`
- `portal create` 收敛为 `to + at`
- 单主体 write commands 统一改用 `--subject`
- 用 `--at` 承载所有空间位置
- 用 `--to` 承载关系目标
- 用 `--portal` 承载附加 portal 策略
- 消除 write commands 里的独立 `--ref` 参数，ref 语义改为值语法
- 把 `--leave-portal` / `--leave-portal-in-place` 收敛为 `--portal in-place`
- 更新 contract tests、quickstart、SSOT、README 与 `skills/remnote/SKILL.md`
- 增补独立命令设计文档，系统化解释命令心智模型与 breaking changes

### In Scope Command Families

- `rem create`
- `rem move`
- `portal create`
- `rem set-text`
- `rem delete`
- `rem children append/prepend/clear/replace`
- `rem replace`
- `tag add/remove` 中直接面向 Rem 的写入面

### Out of Scope

- read commands 的 `--id/--ref` 统一化
- table / powerup / record / property 这类非 Rem graph 写入面的整体重命名
- queue / WS / plugin primitive 类型重命名
- `apply` payload schema 的本轮语法翻新
- 任何兼容 alias、兼容告警或双命令时期

## Assumptions & Dependencies

- 本轮允许 breaking change，且必须在 SSoT / spec / skill 中显式记录
- ref 仍然是统一值概念，但不再作为单独 flag 存在于 write surface
- `028` 的 canonical plan surface 继续保留，`029` 只重构 CLI contract
- 所有相关 CLI 命令都是 Agent-facing primitives，只是原子意图不同
- `in-place` 只属于 portal strategy，表示“原位回填”
- `in-place` 只在存在稳定原位置语义时允许：
  - `rem move`
  - `rem create --from-selection`
  - `rem create` with repeated explicit `--from` when those refs resolve to one contiguous sibling range under one parent

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Core Write Primitives Share One Mental Model (Priority: P1)

As an agent, I want `rem create`, `rem move`, and `portal create` to expose one aligned command grammar, so I can reason in terms of `subject / from / to / at / portal` instead of memorizing per-command flag dialects.

**Why this priority**: This is the highest leverage surface simplification and directly reduces agent prompt / routing complexity.

**Independent Test**: Help text, contract tests, and quickstart examples can describe the three command families using one shared axis vocabulary with no fake symmetry.

**Acceptance Scenarios**:

1. **Given** a new durable subject flow, **When** the caller uses `rem create`, **Then** the command shape is describable as `from + at + optional portal`.
2. **Given** a single existing subject relocation flow, **When** the caller uses `rem move`, **Then** the command shape is describable as `subject + at + optional portal`.
3. **Given** a pure relation insertion flow, **When** the caller uses `portal create`, **Then** the command shape is describable as `to + at`.

---

### User Story 2 - Spatial Semantics Collapse Into `--at` (Priority: P1)

As a maintainer, I want all spatial placement semantics to live behind one `--at` grammar, so location rules are learned once and reused everywhere.

**Why this priority**: Position-related parameter sprawl is the most visible inconsistency in the current write surface.

**Independent Test**: Commands that formerly used `parent/ref/before/after/standalone` or `portal-*` flags now accept one placement spec and still compile to the same internal plan semantics.

**Acceptance Scenarios**:

1. **Given** subject placement, **When** the caller passes `--at standalone`, `--at parent:<ref>`, `--at parent[2]:<ref>`, `--at before:<ref>`, or `--at after:<ref>`, **Then** the command resolves to the same normalized placement kinds that exist today.
2. **Given** portal placement via `--portal at:<placement-spec>`, **When** the caller uses any legal `placement-spec`, **Then** the portal location resolves through the same placement grammar as `--at`.
3. **Given** an invalid placement spec, **When** the caller invokes any affected command, **Then** the command fails fast with stable English diagnostics.

---

### User Story 3 - Create Source Semantics Collapse Into `--from` / `--from-selection` (Priority: P1)

As an agent, I want `rem create` to expose one explicit source model, so content input is clearly separated from destination placement and optional portal strategy.

**Why this priority**: `rem create` 是当前最重的 write primitive，source 与位置语义耦合最深。

**Independent Test**: `rem create` accepts exactly one source mode among `--text`, `--markdown`, repeated `--from`, and `--from-selection`, and the command contract no longer uses `--target` for source Rems.

**Acceptance Scenarios**:

1. **Given** one or more existing Rem inputs, **When** the caller uses repeated `--from`, **Then** the command creates a new destination and moves those source Rems under it.
2. **Given** current contiguous selection input, **When** the caller uses `--from-selection`, **Then** the command resolves selection to the same `targets[]` model used by repeated `--from`.
3. **Given** explicit repeated `--from` values from one contiguous sibling range under one parent, **When** the caller also passes `--portal in-place`, **Then** the command replaces that original range with one portal to the new destination.
4. **Given** explicit repeated `--from` values that do not resolve to one contiguous sibling range, **When** the caller also passes `--portal in-place`, **Then** the command fails fast.

---

### User Story 4 - Single-Subject And Relation Commands Use Stable Axes (Priority: P2)

As a maintainer, I want single-subject writes to use `--subject` and relation writes to use stable relation endpoints, so the write surface consistently names acted-on objects versus related objects.

**Why this priority**: 这是位置语义之外最主要的概念错位。

**Independent Test**: All in-scope single-subject write commands use `--subject <ref>`, relation insertion uses `--to <ref>`, tag relations use repeated `--tag <ref>` + `--to <ref>`, and help / tests no longer advertise removed names.

**Acceptance Scenarios**:

1. **Given** `rem move`, `rem set-text`, and `rem delete`, **When** the caller inspects help or uses the commands, **Then** they all use `--subject`.
2. **Given** `portal create`, **When** the caller specifies the portal target, **Then** the command uses `--to`.
3. **Given** direct subject-oriented helper surfaces such as `rem children append`, **When** the caller targets a Rem explicitly, **Then** the command uses `--subject`.
4. **Given** `tag add` or `tag remove`, **When** the caller specifies relation endpoints, **Then** the command uses repeated `--tag <ref>` and repeated `--to <ref>` instead of `--subject`.

---

### User Story 5 - Docs, SSoT, And Skills Reflect The Reset (Priority: P2)

As an agent author, I want one dedicated command-surface document plus synced SSoT and skill guidance, so future prompts can teach one clean model instead of multiple legacy branches.

**Why this priority**: 只有 docs 和 skill 同步收口，这次 reset 才真正落地。

**Independent Test**: command docs, quickstart, skill guidance, and SSOT all describe the same new syntax and explicitly mark the old parameter names as removed.

**Acceptance Scenarios**:

1. **Given** the new command surface, **When** the user opens the dedicated command-surface document, **Then** they can see create / move / portal create aligned on one axis table.
2. **Given** `skills/remnote/SKILL.md`, **When** the agent routes a write request, **Then** the examples and heuristics use the new `subject / from / to / at / portal` language.
3. **Given** the old flags, **When** a user consults the new docs, **Then** the docs clearly state that those names were removed as a breaking change.

### Edge Cases

- `--from` is combined with `--text`, `--markdown`, or `--from-selection`
- `--portal in-place` is used where no stable original position exists
- `--portal at:standalone` is used even though a portal itself cannot be standalone
- `--at parent[2]:<ref>` contains malformed numeric prefixes
- repeated `--from` spans multiple parents or non-contiguous siblings
- repeated `--from` is passed in a different order from the original sibling order
- `--text + --title` leaves the final destination shape ambiguous if not explicitly specified
- write commands that previously accepted raw `--ref` must now express the same target in value syntax
- help output, contract tests, and skill examples drift from the new terms

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `029` MUST be a deliberate breaking change and MUST NOT keep compatibility aliases for removed parameter names.
- **FR-002**: `rem create` MUST support exactly one content source mode among `--text`, `--markdown`, repeated `--from`, and `--from-selection`.
- **FR-003**: `rem create` MUST require exactly one placement via `--at <placement-spec>`.
- **FR-004**: `rem create` MUST support optional portal behavior via `--portal in-place | at:<placement-spec>`.
- **FR-005**: `rem move` MUST require exactly one `--subject <ref>` and exactly one `--at <placement-spec>`.
- **FR-006**: `rem move` MUST support optional portal behavior via `--portal in-place | at:<placement-spec>`.
- **FR-007**: `portal create` MUST require exactly one relation target via `--to <ref>` and exactly one placement via `--at <placement-spec>`.
- **FR-008**: In-scope single-subject write commands MUST use `--subject <ref>` instead of `--rem`.
- **FR-008A**: `tag add` and `tag remove` MUST use repeated `--tag <ref>` plus repeated `--to <ref>` as their direct CLI relation surface.
- **FR-008B**: `tag add` and `tag remove` MUST expand repeated `--tag` × repeated `--to` into multiple relation ops without inventing a separate batch primitive.
- **FR-009**: In-scope write commands MUST remove dedicated `--ref` flags and consume ref syntax through value positions instead.
- **FR-010**: `placement-spec` MUST support `standalone`, `parent:<ref>`, `parent[<position>]:<ref>`, `before:<ref>`, and `after:<ref>`.
- **FR-011**: `--portal in-place` MUST only be legal when the runtime can derive one stable original position.
- **FR-012**: `rem create --from-selection --portal in-place` MUST preserve the current `in_place_selection_range` behavior.
- **FR-013**: `rem move --portal in-place` MUST preserve the current `in_place_single_rem` behavior.
- **FR-014**: `rem create` with repeated `--from` over one contiguous sibling range under one parent MUST support `--portal in-place`.
- **FR-015**: `rem create` with repeated `--from` over non-contiguous or cross-parent refs MUST reject `--portal in-place`.
- **FR-015A**: `--portal at:standalone` MUST be rejected for every command because a portal itself cannot be standalone.
- **FR-015B**: For repeated explicit `--from`, `contiguous sibling range` MUST be evaluated against the local RemNote direct-sibling order used by hierarchy metadata, not visible-only outline rendering.
- **FR-015C**: For repeated explicit `--from`, execution order and resulting child order MUST be normalized to the original sibling order under the source parent, not the CLI argument order.
- **FR-016**: `rem create` title policy MUST stay explicit:
  - `--markdown` requires `--title`
  - single `--from` MAY infer title from that source
  - repeated `--from` with multiple refs requires `--title`
  - single-root `--from-selection` MAY infer title from that root
  - multi-root `--from-selection` requires `--title`
  - `--text` without `--title` uses the text as destination title
  - `--text` with `--title` creates a titled destination and writes the text as its first body child
- **FR-017**: `rem create` and `rem move` MUST continue compiling through one canonical internal write-plan surface compatible with `apply`.
- **FR-018**: `portal create` MUST continue compiling to the existing `create_portal` primitive semantics.
- **FR-019**: All affected CLI commands MUST be described as Agent-facing primitives; the spec MUST NOT require a “higher-level vs lower-level” user mental model.
- **FR-020**: Help output, validation errors, quickstart, and skill guidance MUST stop advertising removed flags such as `--rem`, `--target` as create-source or portal target, `--parent`, `--before`, `--after`, `--standalone`, `--portal-parent`, and `--leave-portal*`.
- **FR-021**: Contract tests MUST verify that the old parameter names are rejected.

### Non-Functional Requirements

- **NFR-001**: The new surface MUST reduce agent prompt complexity by exposing one axis vocabulary: `subject / from / to / at / portal`.
- **NFR-002**: The reset MUST preserve queue -> WS -> plugin SDK write behavior; only the public contract changes.
- **NFR-003**: Validation MUST remain centralized and return stable English diagnostics.
- **NFR-004**: The command-surface design MUST be documented in one dedicated spec artifact instead of being inferred from scattered examples.
- **NFR-005**: The final docs set MUST be coherent enough that `skills/remnote/SKILL.md` can route writes without keeping legacy exceptions in memory.
- **NFR-006**: The final grammar MUST avoid ambiguous position delimiters inside ref values.

### Key Entities

- **Subject**: The direct acted-on object for single-subject write commands.
- **Tag Endpoint**: One side of a tag-rem relation, modeled by repeated `--tag`.
- **Content Source**: One of `text`, `markdown`, repeated `from`, or `from-selection` for `rem create`.
- **Relation Target**: The object that a relation-creating primitive points to, modeled by `--to`.
- **Placement Spec**: The normalized placement grammar carried by `--at`.
- **Portal Strategy**: The optional portal behavior carried by `--portal`, either `in-place` or `at:<placement-spec>`.
- **Ref Value**: A value-level reference syntax such as `id:<remId>`, `page:<title>`, `title:<text>`, `daily:today`, or a RemNote deep link.
- **Durable Subject**: The durable Rem that create/move flows ultimately produce or reposition.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: `rem create`, `rem move`, and `portal create` can all be taught using one axis vocabulary without command-specific position flag lists.
- **SC-002**: At least the in-scope Rem graph / portal write commands no longer expose `--rem` or dedicated `--ref` flags.
- **SC-003**: `rem create --from-selection --portal in-place`, repeated explicit `--from ... --portal in-place` over one contiguous range, and `rem move --portal in-place` preserve the old in-place portal semantics after the rename.
- **SC-004**: Old flags removed by this spec fail fast and are explicitly covered by contract tests.
- **SC-005**: `docs/ssot/agent-remnote/tools-write.md`, `docs/ssot/agent-remnote/cli-contract.md`, the quickstart, and `skills/remnote/SKILL.md` all describe the same new command surface.
