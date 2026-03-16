# Feature Specification: Unified Rem Replace Surface

**Feature Branch**: `[023-rem-replace-surface]`  
**Created**: 2026-03-16  
**Status**: Planned  
**Input**: User description: "Unify replace workflows under `agent-remnote rem replace`, keep selection as a target selector rather than a command noun, support repeated `--rem` targets, and use `--surface children|self` to distinguish single-anchor direct-children rewrite from in-place self replacement of one or more Rems."

## Context & Motivation

The current replace surface is split across two different mental models:

- `rem children replace` describes a single-anchor rewrite where one existing Rem is preserved and only its direct children change.
- `replace markdown` describes block-range replacement and can target one or more selected Rems, but it lives under a separate command family and is framed around selection.

This split raises command-selection cost for agents and maintainers:

- the same verb, "replace", is spread across unrelated public entry points
- target selection sometimes appears in the command noun instead of staying in parameters
- multi-Rem replace is available in runtime behavior but not presented as a canonical `rem` command
- command choice currently depends on remembering surface-specific command names instead of choosing one object, one action, and one target selector

This feature defines a single canonical replace family under `rem`, with target selection and replace surface expressed as parameters.

## Scope

### In Scope

- Define `agent-remnote rem replace` as the canonical public replace wrapper
- Define target selectors for `rem replace`, including repeated `--rem` and `--selection`
- Define replace surface selection through `--surface children|self`
- Define validity rules for target count, shared parent, contiguity, and assertion compatibility
- Define canonical documentation expectations for the new command family

### Out of Scope

- Redesign the queue, WS, or plugin execution chain
- Introduce new write capabilities unrelated to replace workflows
- Expand assertion vocabulary beyond what this feature needs
- Add new scene-named commands centered on selection or editor state
- Lock in a long-lived compatibility layer for older replace commands

## Assumptions & Dependencies

- Existing single-anchor direct-children rewrite behavior remains valid and should be preserved under the new canonical command family.
- Existing in-place multi-Rem replacement behavior remains a valid capability and should be surfaced through `rem replace` rather than through a selection-named command.
- A target selector is an input convenience. It must not become the primary noun of the command.
- Any migration from older replace commands must follow forward-only evolution and be documented explicitly in planning and SSoT updates.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - One Canonical Replace Family (Priority: P1)

As an agent, I want both single-anchor children rewrite and multi-Rem in-place replacement to live under one `rem replace` command family, so command selection stays low-entropy and composable.

**Why this priority**: This is the core user-facing problem. If the canonical command family remains split, every future replace workflow continues to carry unnecessary routing cost.

**Independent Test**: The feature is independently validated if a caller can express both "replace this Rem's children" and "replace these Rems in place" under `rem replace` without changing to another command family.

**Acceptance Scenarios**:

1. **Given** one explicit target Rem and structured Markdown, **When** the caller runs `rem replace` with `--surface children`, **Then** the system interprets the request as "preserve this Rem and rewrite its direct children only".
2. **Given** two sibling target Rems and structured Markdown, **When** the caller runs `rem replace` with `--surface self`, **Then** the system interprets the request as "replace this block of Rems in place with the new Markdown tree".

---

### User Story 2 - Target Selection Stays a Parameter (Priority: P1)

As an agent, I want editor selection to remain a target selector rather than a command noun, so the public command model stays focused on Rem objects and replace actions.

**Why this priority**: This preserves the repository's object-action style. The caller should choose `rem` as the object and use selection only when it is the most convenient way to specify the target set.

**Independent Test**: The feature is independently validated if the canonical docs and CLI help describe replace workflows under `rem replace`, with `--selection` and repeated `--rem` as interchangeable target selectors where valid.

**Acceptance Scenarios**:

1. **Given** a current editor selection of one or more Rem roots, **When** the caller uses `rem replace --selection`, **Then** the selection is treated as a target selector feeding the same replace command family as explicit `--rem` inputs.
2. **Given** the canonical replace documentation, **When** a caller reviews the public CLI surface, **Then** the primary replace path is described under `rem replace` rather than under a selection-named command.

---

### User Story 3 - Invalid Combinations Fail Fast (Priority: P2)

As an agent or maintainer, I want invalid target and surface combinations to fail fast with stable reasons, so multi-Rem replace remains safe and predictable.

**Why this priority**: A unified command family is only useful if callers can rely on explicit argument validation instead of guessing which combinations are legal.

**Independent Test**: The feature is independently validated if invalid `rem replace` combinations are rejected before write dispatch, with deterministic reasons tied to the requested target selector, surface, and assertions.

**Acceptance Scenarios**:

1. **Given** multiple target Rems, **When** the caller requests `--surface children`, **Then** the system rejects the command because direct-children rewrite requires exactly one anchor Rem.
2. **Given** target Rems that do not form one replaceable sibling block, **When** the caller requests `--surface self` under default policy, **Then** the system rejects the command with a stable explanation.
3. **Given** `--surface self`, **When** the caller also requests `--assert preserve-anchor`, **Then** the system rejects the command because preserved-anchor semantics apply only to single-anchor children rewrite.

### Edge Cases

- `rem replace --surface children` receives `--selection` that resolves to zero or multiple Rems.
- `rem replace --surface self` receives explicit targets that do not share the same parent.
- `rem replace --surface self` receives targets that are siblings but not contiguous under default policy.
- `rem replace --surface self` receives empty Markdown and must replace the target block with nothing.
- `rem replace --surface children` receives empty Markdown and must clear direct children without deleting the anchor Rem itself.
- `rem replace` is called without any target selector.
- Canonical docs and skill guidance drift and still recommend the old top-level replace surface as the first-choice path.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST expose `agent-remnote rem replace` as the canonical public replace wrapper for Rem-oriented replace workflows.
- **FR-002**: `rem replace` MUST accept target selection through repeated `--rem` and through `--selection`.
- **FR-003**: Canonical command guidance MUST treat `--selection` as a target selector and MUST NOT elevate selection into the primary noun of the public replace command family.
- **FR-004**: `rem replace` MUST require a replace surface selector with the public values `children` and `self`.
- **FR-005**: `rem replace --surface children` MUST mean "rewrite the direct children of exactly one target Rem while preserving that target Rem".
- **FR-006**: `rem replace --surface self` MUST mean "replace the target Rem block itself in place" and MUST allow one or more target Rems.
- **FR-007**: `rem replace --surface children` MUST fail fast unless the resolved target set contains exactly one Rem.
- **FR-008**: `rem replace --surface self` MUST use the same target model for repeated `--rem` inputs and for `--selection`.
- **FR-009**: `rem replace --surface self` MUST fail fast under default policy when the resolved target set does not form one replaceable sibling block, at minimum when the targets do not share a parent or are not contiguous.
- **FR-010**: If the system exposes a non-contiguous override for `--surface self`, the default behavior MUST still remain contiguous-only.
- **FR-011**: `--assert preserve-anchor` MUST be accepted only with `--surface children` and MUST be rejected for `--surface self`.
- **FR-012**: Empty Markdown MUST remain a valid replace input. For `--surface children`, it clears direct children. For `--surface self`, it replaces the target block with nothing.
- **FR-013**: Canonical docs, help output, and synchronized agent guidance MUST promote `rem replace` as the primary replace family under `rem`.
- **FR-014**: Older replace surfaces that remain available during migration MUST be documented as non-canonical or advanced. They MUST NOT continue to appear as co-equal first-choice replace paths.
- **FR-015**: `rem replace` MUST preserve the repository's write-first rule. Callers must be able to issue the replace command directly without a mandatory preflight inspect step.
- **FR-016**: Invalid combinations of target selector, replace surface, and assertions MUST return stable, actionable failure reasons.
- **FR-017**: `rem replace` MUST be eligible for remote-mode use whenever its target selector can be resolved without local-only semantics.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The canonical replace surface MUST reduce command-selection entropy by centering common replace tasks on one object-action family under `rem`.
- **NFR-002**: The public mental model for replace workflows MUST remain stable: choose a target selector, choose a replace surface, then provide Markdown.
- **NFR-003**: Failure cases for `rem replace` MUST be diagnosable from the command result alone, without requiring a second exploratory read to understand why the requested combination was rejected.
- **NFR-004**: Documentation, SSoT, and synchronized agent guidance MUST use the same vocabulary for target selector, replace surface, single-anchor children rewrite, and self replacement.
- **NFR-005**: If the feature changes the canonical public replace command path, planning and migration notes MUST state the transition explicitly and MUST avoid indefinite compatibility layers.
- **NFR-006**: The feature MUST preserve forward-only evolution: command-surface changes may be breaking, but they must be explicit, documented, and fail-fast.

### Key Entities _(include if feature involves data)_

- **Replace Target Set**: The resolved set of Rems selected by repeated `--rem`, `--selection`, or another public target selector. It is the object set the replace command validates before execution.
- **Replace Surface**: The user-facing declaration of what is being replaced. `children` targets the direct children of one anchor Rem. `self` targets the Rem block itself.
- **Replace Assertion Profile**: The subset of structural assertions that are valid for the chosen replace surface. Some assertions apply only to single-anchor children rewrite.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All primary replace workflows documented for this feature can be expressed under one canonical command family: `rem replace`.
- **SC-002**: Canonical docs and help output contain zero first-choice replace recipes that require a selection-named command noun or the old top-level replace family.
- **SC-003**: The command contract distinguishes `children` and `self` surfaces with no ambiguous overlap in acceptance scenarios or functional requirements.
- **SC-004**: A caller can express multi-Rem in-place replacement without manually resolving a parent Rem id.
- **SC-005**: Invalid combinations of target selector, replace surface, and assertions are rejected deterministically in all contract-covered scenarios.
- **SC-006**: The synchronized spec, docs, and agent guidance use one consistent vocabulary for target selector and replace surface.
