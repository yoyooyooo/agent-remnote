# Feature Specification: Rem Create/Move Promotion With Canonical Plan Surface

**Feature Branch**: `[028-rem-create-move-page-portal-flow]`  
**Created**: 2026-03-20  
**Status**: Planned  
**Input**: User description: "Keep Daily Notes as the agent playground, but allow explicit `rem create` / `rem move` flows that promote content into a standalone destination Rem, optionally mark it as a document, and optionally leave portal backlinks at chosen locations."

## Context & Motivation

The user's preferred workflow has two layers:

- Daily Notes are the default playground for agent writing because they are easy to inspect and avoid silent orphaned Rems.
- When content proves valuable, the user wants to explicitly promote it into a durable standalone destination Rem and keep one or more portal backlinks from the original or chosen context.

The command surface should stay agent-friendly and composable:

- no new workflow noun such as `page` or `elevate`
- keep the public verbs inside `rem create` and `rem move`
- keep `portal create` as the canonical direct portal primitive
- internally normalize all business commands into one canonical write-plan / `apply`-compatible surface

This feature therefore focuses on one thing only: extending `rem create` and `rem move` into clear semantic facades over a shared planner, while preserving explicit placement semantics, explicit `--is-document`, and strong partial-success diagnostics.

## Scope

### In Scope

- Extend `rem create` to support standalone destination creation from multiple source modes
- Extend `rem move` to support standalone promotion of one existing Rem
- Add repeated `--target` support to `rem create` as an existing-Rem source mode
- Treat `--from-selection` as a source sugar that resolves to the same internal `targets[]` model
- Support portal placement as an optional second location model
- Keep `apply` as the canonical internal write-plan surface used by higher-level commands
- Return clear machine-readable receipts for success and partial success

### Out of Scope

- New top-level workflow commands such as `page ...` or `elevate ...`
- Silent default promotion behavior during ordinary DN writes
- Full rollback guarantees across all composite write steps
- Arbitrary mixed-depth or cross-parent selection capture
- UI-only implementations that bypass the queue -> WS -> plugin write path
- General multi-object batch semantics for `rem move`
- General multi-target batch semantics for `portal create` in this spec

## Assumptions & Dependencies

- Daily Notes remain the canonical agent playground, but promotion is always explicit.
- `portal create` remains the canonical runtime primitive for portal insertion.
- `rem create` and `rem move` may become higher-level atomic commands that compile into multiple existing primitives.
- `--is-document` remains explicit. Standalone placement alone must not silently imply document/page semantics.
- Current CLI option parsing uses `@effect/cli`, but most dynamic validation is hand-written in command handlers. This feature should centralize normalization and validation rather than spreading more imperative checks across multiple files.
- Canonical internal execution should be expressed as one shared plan model compatible with `apply` actions/ops.
- Selection-based promotion is limited to the contiguous selection model available in the product UI.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Direct Create Writes Durable Content And Optionally Leaves A Portal (Priority: P1)

As an agent, I want `rem create` to create durable standalone content and optionally leave a portal at a chosen DN or page location, so I can write directly into the knowledge base while preserving a playground backlink.

**Why this priority**: This directly serves the most common "write a large chunk into DN, but really keep it as a page" workflow.

**Independent Test**: This story is independently satisfied if one `rem create` invocation can create standalone content from markdown and insert a portal at an explicitly chosen location.

**Acceptance Scenarios**:

1. **Given** markdown input and a title, **When** the caller invokes `rem create` with standalone destination semantics plus portal placement, **Then** the command creates one standalone destination Rem, writes the markdown content there, and inserts one portal at the requested location.
2. **Given** the same direct-create flow without portal placement flags, **When** the caller invokes the command, **Then** the command creates the standalone destination only and does not create any portal.
3. **Given** `rem create --markdown`, **When** the caller omits `--title`, **Then** the command fails fast with a stable validation error rather than inferring a title from markdown structure.

---

### User Story 2 - Move Promotes One Existing Rem And Leaves A Portal In Place (Priority: P1)

As an agent, I want `rem move` to promote one existing Rem into a standalone destination and optionally leave a portal behind, so I can turn playground content into a durable page-like Rem without losing navigability from the original spot.

**Why this priority**: This is the explicit "write first in DN, then promote later" workflow.

**Independent Test**: This story is independently satisfied if one `rem move` invocation can move one existing Rem into a standalone destination and leave a portal at the original location.

**Acceptance Scenarios**:

1. **Given** a single existing Rem, **When** the caller invokes `rem move` with standalone-target semantics and in-place portal retention, **Then** the Rem is promoted out of its original parent and a portal to the moved Rem is inserted at the original location.
2. **Given** the same move flow with `--is-document`, **When** the command succeeds, **Then** the moved destination is explicitly marked as a document; omitting `--is-document` preserves non-document semantics.

---

### User Story 3 - Create Can Use Existing Rem Targets Or Selection As Source (Priority: P1)

As an agent, I want `rem create` to accept existing Rem targets or the current selection as a content source, so I can create a new standalone destination and move external or playground content into it without rewriting the content as markdown first.

**Why this priority**: This unifies "create a new durable container" across explicit target ids and UI selection.

**Independent Test**: This story is independently satisfied if `rem create` can build a new standalone destination from explicit `--target` inputs or from `--from-selection`, while keeping one canonical internal source model.

**Acceptance Scenarios**:

1. **Given** one explicit `--target`, **When** the caller invokes `rem create` with standalone-target semantics, **Then** the command creates a new destination Rem and moves the target Rem under it; omitting `--title` may default the destination title from the single source Rem text.
2. **Given** multiple explicit `--target` flags, **When** the caller omits `--title`, **Then** the command fails fast with a stable validation error.
3. **Given** `--from-selection`, **When** the caller invokes `rem create` with standalone-target semantics, **Then** the command resolves the current contiguous sibling selection into the same internal `targets[]` model used by explicit `--target`.
4. **Given** `--from-selection`, **When** the resolved selection has multiple roots and the caller omits `--title`, **Then** the command fails fast; when the selection has one root, omitting `--title` may default from the source root Rem text.
5. **Given** `--from-selection`, **When** the caller also passes `--text`, `--markdown`, or explicit `--target`, **Then** the command fails fast with a stable validation error.

---

### User Story 4 - Location Semantics Stay Consistent Across Create, Move, And Portal Placement (Priority: P2)

As a maintainer, I want content placement and portal placement to use one coherent location model, so agents can compose create and move operations without learning special-case spatial semantics.

**Why this priority**: Consistent parameter meaning is more important than minimizing the raw parameter count.

**Independent Test**: This story is independently satisfied if content placement and portal placement use parallel `parent / before / after / standalone`-style semantics and fail fast on ambiguous combinations.

**Acceptance Scenarios**:

1. **Given** content placement flags, **When** the caller provides more than one of the mutually exclusive placement groups, **Then** the command fails fast with a stable validation error.
2. **Given** portal placement flags, **When** the caller provides more than one portal placement mode, **Then** the command fails fast with a stable validation error.
3. **Given** an invalid command shape with no explicit destination semantics, **When** the caller invokes `rem create` or `rem move`, **Then** the command fails fast and tells the agent which placement arguments are required.

---

### User Story 5 - Partial Success Remains Diagnosable (Priority: P2)

As an agent, I want composite create/move + portal flows to return explicit partial-success receipts, so I can tell the user what exists already even if later steps fail.

**Why this priority**: The user explicitly prefers preserving created content over strict rollback.

**Independent Test**: This story is independently satisfied if create/move + portal flows return stable machine-readable output that identifies created or moved durable targets even when portal insertion fails.

**Acceptance Scenarios**:

1. **Given** a flow where the standalone destination is created or moved successfully but portal insertion fails, **When** the caller inspects the JSON receipt, **Then** the receipt still includes the durable destination id plus warnings and nextActions.
2. **Given** a flow where the new destination exists but the user may not see it from the original context, **When** the command returns, **Then** the output includes enough identifiers and guidance for the agent to explain the current state.

### Edge Cases

- `--target` and `--from-selection` are mixed in one command.
- `--from-selection` resolves to a non-contiguous, cross-parent, or otherwise unsupported selection shape.
- Multiple explicit targets come from unrelated places and the caller requests in-place portal replacement.
- The caller supplies both content placement and portal placement flags that imply contradictory destinations.
- A standalone destination is created successfully but content import fails before portal insertion.
- A standalone destination is created or moved successfully but portal insertion fails.
- A caller requests document semantics in one path but omits `--is-document` in another similar path.
- Remote mode must preserve the same command shape where the underlying write surfaces are already remotely supported.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The command surface for this capability MUST stay inside `rem create` and `rem move`; this feature MUST NOT introduce a new top-level workflow noun such as `page` or `elevate`.
- **FR-002**: `rem create` MUST support four mutually exclusive source modes: `--text`, `--markdown`, repeated `--target`, and `--from-selection`.
- **FR-003**: `--from-selection` MUST behave as a sugar that resolves to the same internal `targets[]` source model used by explicit repeated `--target`.
- **FR-004**: When `--from-selection` is present, `rem create` MUST reject simultaneous `--text`, `--markdown`, or explicit `--target`.
- **FR-005**: `rem create --markdown` MUST require `--title` and MUST NOT require single-root markdown.
- **FR-006**: `rem create` with multiple explicit `--target` inputs MUST require `--title`; with a single explicit `--target`, omitting `--title` MAY default the destination title from the source Rem text.
- **FR-007**: `rem create --from-selection` MUST require `--title` for multi-root selections; for a single-root selection, omitting `--title` MAY default the destination title from the selected root Rem text.
- **FR-008**: `rem create` MUST support explicit standalone-target semantics so a new destination Rem can be created outside the current parent tree.
- **FR-009**: `rem move` MUST support explicit standalone-target semantics so one existing Rem can be promoted outside the current parent tree.
- **FR-010**: Top-level placement alone MUST NOT imply document/page semantics; `--is-document` MUST stay explicit for both create and move flows and default to `false`.
- **FR-011**: Content placement for both `rem create` and `rem move` MUST use one coherent location model based on parent-relative and anchor-relative placement.
- **FR-012**: Portal placement MUST use a parallel location model with `portal-parent`, `portal-before`, and `portal-after` semantics.
- **FR-013**: Portal placement flags MUST be optional; omitting them MUST create or move the durable content without inserting a portal.
- **FR-014**: `rem move` MUST support in-place portal retention for single-Rem promotion flows.
- **FR-015**: `rem create --from-selection` MUST support replacing the original contiguous selection range with a portal to the new destination.
- **FR-016**: The first version of selection-based promotion MUST only support contiguous sibling selections under the same parent and MUST fail fast for unsupported shapes.
- **FR-017**: Commands MUST fail fast on ambiguous placement combinations and on missing required placement semantics.
- **FR-018**: Commands MUST return machine-readable receipts that identify durable targets even when later portal-related steps fail.
- **FR-019**: Receipts for partial success MUST include warnings and actionable next steps so the agent can explain where the created or moved durable content ended up.
- **FR-020**: Higher-level business commands in this feature MUST compile through one canonical internal write-plan surface compatible with `apply`.

### Non-Functional Requirements (Validation, Diagnosability, Consistency)

- **NFR-001**: Dynamic parameter normalization and validation for this feature MUST be centralized rather than duplicated across multiple handlers.
- **NFR-002**: The validation model MUST preserve stable `INVALID_ARGS` style failures and English diagnostics.
- **NFR-003**: Content placement and portal placement semantics MUST stay consistent across local and remote execution surfaces where the underlying write operations are supported remotely.
- **NFR-004**: The feature MUST preserve the queue -> WS -> plugin SDK write path; no side-channel direct DB writes are allowed.
- **NFR-005**: The command surface MUST remain agent-friendly by favoring semantic façades over workflow-specific nouns, while using one canonical internal planner.

### Key Entities _(include if feature involves data)_

- **Standalone Destination Rem**: The durable top-level or page-like Rem that receives newly created or promoted content.
- **Content Source**: One of `text`, `markdown`, or `targets[]`.
- **Content Placement**: The destination location for the durable content.
- **Portal Placement**: The location where a portal to the durable content is inserted.
- **In-Place Portal Retention**: Replacement of the original playground position or selection range with a portal to the durable content.
- **Canonical Write Plan**: The internal write-plan model that all higher-level create/move flows compile to before execution.
- **Partial Success Receipt**: A machine-readable command result that identifies durable state even when the whole composite workflow did not complete.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Agents can create a standalone page-like Rem from markdown and place a portal to it at an explicitly chosen DN or page location in one command.
- **SC-002**: Agents can promote one existing Rem into a standalone destination and leave a portal behind at the original location in one command.
- **SC-003**: Agents can create a new standalone destination from one or more existing explicit target Rems and move those targets under it in one command.
- **SC-004**: `--from-selection` and explicit `--target` converge to one shared internal source model rather than drifting into separate implementations.
- **SC-005**: Ambiguous or incomplete placement combinations fail fast with stable diagnostics rather than silently choosing a default destination.
- **SC-006**: Partial success receipts always identify the durable destination Rem when it exists, even if portal insertion fails afterward.
