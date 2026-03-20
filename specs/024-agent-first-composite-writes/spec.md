# Feature Specification: Apply Portal Action Parity

**Feature Branch**: `[024-agent-first-composite-writes]`  
**Created**: 2026-03-19  
**Status**: Planned  
**Input**: User description: "Expose the existing portal primitive as a first-class atomic action inside `apply`, so agent workflows can compose it with other actions without inventing a higher-level workflow command."

## Context & Motivation

The runtime already has the primitive needed for portal insertion:

- `create_portal`

The gap is one layer higher:

- `apply` / action envelopes cannot yet express portal insertion as a first-class atomic action
- callers who want to compose portal insertion with other actions must either fall back to raw ops or break the workflow into multiple commands

For an agent-first CLI, the goal is not to add a coarse workflow command. The goal is to expose the missing atomic capability at the same abstraction level as the rest of the action vocabulary, then let Skills compose higher-level scenarios on top.

This feature therefore focuses on one thing only: action-layer parity for portal creation.

## Scope

### In Scope

- Expose one canonical portal action inside `apply` / action envelopes
- Allow the portal action to reference explicit ids or earlier aliases
- Keep local and remote `write/apply` semantics aligned for that atomic action
- Document the action as a primitive that Skills can compose

### Out of Scope

- Introduce a workflow-specific top-level command
- Add a second portal action alias with overlapping semantics
- Add report-specific, summary-specific, or note-assembly-specific CLI concepts
- Add a new runtime primitive beyond the existing `create_portal` op
- Bypass existing runtime guards or write directly to `remnote.db`

## Assumptions & Dependencies

- The existing `create_portal` op remains the canonical runtime primitive.
- `apply` remains the canonical surface for multi-step dependency chains.
- Alias references already exist and should be extended, not replaced.
- Skill guidance can own high-level scenario composition once the missing atomic action exists.
- Any public contract change must be synchronized back to `docs/ssot/agent-remnote/**`, `README.md`, `README.zh-CN.md`, `README.local.md`, and the RemNote skill.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - One Canonical Portal Action in `apply` (Priority: P1)

As an agent, I want a canonical portal action in `apply`, so I can compose portal insertion with other actions without dropping to raw ops.

**Why this priority**: This is the actual capability gap in the current CLI surface.

**Independent Test**: This story is independently satisfied if one `apply` envelope can include a portal action and compile it to `create_portal`.

**Acceptance Scenarios**:

1. **Given** an `apply` envelope with a portal action and explicit ids, **When** the caller runs `apply --dry-run`, **Then** the compiled ops include `create_portal`.
2. **Given** the same envelope in real execution, **When** the write succeeds, **Then** the portal is created through the existing queue -> WS -> plugin SDK path.

---

### User Story 2 - Portal Action Supports Alias-Based Composition (Priority: P1)

As an agent, I want the portal action to accept earlier aliases for parent and target ids, so I can compose dependent writes inside one envelope without extra command hops.

**Why this priority**: This keeps the CLI atomic while still enabling higher-level composition through parameters.

**Independent Test**: This story is independently satisfied if a portal action can reference an earlier alias introduced by another action in the same envelope.

**Acceptance Scenarios**:

1. **Given** an earlier action with `as: "anchor"`, **When** a later portal action uses `parent_id=@anchor`, **Then** the portal action resolves successfully within the same envelope.
2. **Given** a missing or forward-only alias reference, **When** the caller submits the envelope, **Then** the command fails fast before dispatch.

---

### User Story 3 - Skills Own Scenario Composition (Priority: P2)

As a maintainer, I want docs and skills to present this feature as an atomic building block, so higher-level workflows remain in the Skill layer instead of becoming a second CLI abstraction.

**Why this priority**: This preserves the CLI’s minimal, composable surface.

**Independent Test**: This story is independently satisfied if the public contract documents the portal action as a primitive and avoids introducing workflow-specific CLI nouns or parameters.

**Acceptance Scenarios**:

1. **Given** official docs and the RemNote skill, **When** portal insertion is described, **Then** the CLI surface is presented as one atomic action inside `apply`.
2. **Given** a higher-level scenario such as a weekly recap, **When** the scenario is documented, **Then** the workflow composition lives in examples or skills rather than in a new command or parameter.

### Edge Cases

- A portal action references an alias that has not been introduced earlier in the envelope.
- A portal action omits `parent_id`.
- A portal action omits `target_rem_id`.
- A portal action references explicit ids in local mode and the same shape is used in remote mode.
- `apply --dry-run` must preserve the portal step without dispatching any write.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST expose one canonical portal action inside `apply` / action envelopes.
- **FR-002**: The canonical portal action MUST compile to the existing `create_portal` runtime op.
- **FR-003**: The canonical portal action MUST accept `parent_id` and `target_rem_id` as first-class inputs.
- **FR-004**: The canonical portal action MUST allow alias references to earlier actions in `parent_id` and `target_rem_id`.
- **FR-005**: `apply --dry-run` MUST reveal the compiled `create_portal` op for the portal action.
- **FR-006**: Invalid portal actions, including missing fields or unresolved aliases, MUST fail fast before dispatch.
- **FR-007**: Local and remote `write/apply` surfaces MUST accept the same atomic portal-action contract wherever the underlying op is already supported.
- **FR-008**: Docs and the RemNote skill MUST describe the portal action as an atomic capability that higher-level workflows can compose.
- **FR-009**: This feature MUST NOT introduce a workflow-specific top-level command or scenario-specific command parameter.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The feature MUST preserve the CLI’s minimal atomic surface by adding one missing primitive instead of a coarse workflow abstraction.
- **NFR-002**: Action ordering and alias resolution MUST remain deterministic within one envelope.
- **NFR-003**: The public mental model MUST remain stable: small atomic actions, explicit parameters, scenario composition in Skills.
- **NFR-004**: Docs, SSoT, quickstart, and skill guidance MUST use one vocabulary for the canonical portal action.
- **NFR-005**: User-visible command output and diagnostics MUST remain in English.

### Key Entities _(include if feature involves data)_

- **Portal Action**: The canonical atomic `apply` action for portal insertion.
- **Action Alias**: A transaction-local identifier exposed by an earlier action and referenced by a later action.
- **Portal Action Input**: The explicit parameter set needed to create one portal: parent and target.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An `apply` envelope can express portal insertion through one canonical atomic action.
- **SC-002**: The atomic portal action can reference earlier aliases within the same envelope.
- **SC-003**: `apply --dry-run` shows portal compilation without requiring raw-op authoring.
- **SC-004**: No new workflow-specific CLI command or scenario-specific parameter is introduced for this capability.
