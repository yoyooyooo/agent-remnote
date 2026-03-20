# Feature Specification: Typed Outline Nodes With Target Metadata

**Feature Branch**: `[027-portal-outline-observability]`  
**Created**: 2026-03-19  
**Status**: Planned  
**Input**: User description: "Upgrade outline output into a more typed, low-level node schema with optional target metadata, so portal verification becomes possible without adding selector aliases or workflow-specific commands."

## Context & Motivation

The current outline surface can already traverse a subtree, but its node model is still too weak for agent verification:

- some nodes carry implicit structural meaning without explicit typed metadata
- portal nodes are not sufficiently target-aware
- callers may fall back to raw DB inspection because the node schema itself is too lossy

For an agent-first CLI, the right fix is to strengthen the node schema, not to expand selector aliases or introduce a second verification command. This feature therefore upgrades outline output toward typed nodes with optional target metadata.

## Scope

### In Scope

- Add explicit node typing to outline output
- Add optional target metadata to nodes that refer to another Rem
- Keep markdown and JSON/detail output aligned with the richer node model
- Keep verification flows built on the existing outline surface

### Out of Scope

- Adding selector aliases
- Adding workflow-specific verification commands
- Rendering full target subtrees by default
- Falling back to raw DB inspection in the canonical path

## Assumptions & Dependencies

- `outline` / `rem outline` remains the canonical subtree verification surface.
- The existing selector surface stays unchanged for this feature.
- Target metadata should be generic enough to fit any target-bearing node, not only portals.
- Skills and docs can build higher-level verification flows once the node schema is rich enough.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Outline Nodes Become Explicitly Typed (Priority: P1)

As an agent, I want outline nodes to expose explicit node kinds, so I can reason about structure through one machine-readable schema.

**Why this priority**: Typed nodes are the minimal schema improvement that unlocks better verification.

**Independent Test**: This story is independently satisfied if outline output identifies node kind explicitly in machine-readable form.

**Acceptance Scenarios**:

1. **Given** an outline query, **When** the caller requests machine-readable output, **Then** each node includes an explicit node kind.
2. **Given** a subtree containing portal nodes, **When** the caller inspects the output, **Then** portal nodes are distinguishable through the typed node schema.

---

### User Story 2 - Target-Bearing Nodes Expose Optional Target Metadata (Priority: P1)

As an agent, I want target-bearing nodes to expose optional target metadata, so I can verify references without needing a special-case portal inspection path.

**Why this priority**: This keeps the schema generic while still solving portal verification.

**Independent Test**: This story is independently satisfied if portal nodes expose target metadata through the generic node schema.

**Acceptance Scenarios**:

1. **Given** a portal node, **When** the caller inspects outline output, **Then** the node includes target metadata with target id and target text when available.
2. **Given** a target-bearing node whose target text cannot be resolved, **When** the caller inspects outline output, **Then** the output shows an explicit unresolved-target marker rather than empty text.

---

### User Story 3 - Existing Outline Surface Supports CLI-Only Verification (Priority: P2)

As a maintainer, I want docs and quickstart material to show CLI-only verification built on typed nodes, so higher-level verification stays out of the command surface.

**Why this priority**: This keeps the CLI minimal and pushes scene composition to Skills.

**Independent Test**: This story is independently satisfied if docs and quickstart material describe verification using the richer node schema and the existing outline surface only.

**Acceptance Scenarios**:

1. **Given** a portal-heavy subtree, **When** the caller follows the documented verification flow, **Then** they can verify target identity and structure without querying SQLite directly.
2. **Given** the same outline read through remote mode where supported, **When** the caller inspects the result, **Then** node kind and target metadata semantics match the local result.

### Edge Cases

- A subtree contains both target-bearing and non-target-bearing nodes.
- A target-bearing node cannot resolve target text.
- Node-count and depth limits truncate part of the subtree while preserving typed-node semantics.
- Remote outline output loses typed-node or target metadata that local outline includes.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Outline machine-readable output MUST include an explicit node-kind field for each returned node.
- **FR-002**: Nodes that refer to another Rem MUST expose optional target metadata through a generic target field.
- **FR-003**: For portal nodes, the target metadata MUST include target id and target text when available.
- **FR-004**: When target text cannot be resolved, the output MUST expose an explicit unresolved-target marker rather than empty text.
- **FR-005**: Markdown output MUST remain consistent with the richer typed-node semantics even if it is less verbose than JSON/detail output.
- **FR-006**: Local and remote outline results MUST use the same node-kind and target-metadata semantics where outline is already supported remotely.
- **FR-007**: This feature MUST NOT add selector aliases or workflow-specific verification commands.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: CLI-only verification of target-bearing nodes MUST be possible without raw DB inspection.
- **NFR-002**: The node schema MUST stay generic enough that target metadata is not modeled as a portal-only special case.
- **NFR-003**: Markdown and JSON/detail output MUST convey the same core typed-node semantics.
- **NFR-004**: Docs and tests MUST describe the feature as a node-schema upgrade, not as a new command surface.
- **NFR-005**: User-visible command output and diagnostics MUST remain in English.

### Key Entities _(include if feature involves data)_

- **Outline Node**: One typed node in outline output.
- **Node Kind**: A generic node classification such as `rem` or `portal`.
- **Target Metadata**: Optional metadata describing the referenced target of a target-bearing node.
- **Verification Recipe**: A CLI-only verification flow built on the existing outline surface.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Outline output exposes an explicit typed-node schema.
- **SC-002**: Target-bearing nodes expose optional target metadata through one generic field model.
- **SC-003**: Portal verification is possible through typed-node output without raw DB inspection.
- **SC-004**: No selector alias or workflow-specific verification command is introduced for this capability.
