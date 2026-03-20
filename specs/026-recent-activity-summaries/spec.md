# Feature Specification: Normalized Recent Activity Query

**Feature Branch**: `[026-recent-activity-summaries]`  
**Created**: 2026-03-19  
**Status**: Planned  
**Input**: User description: "Upgrade `db recent` into a more complete low-level query primitive with normalized result schema, generic filters, generic aggregates, and generic limits, so Skills can build recaps without the CLI growing scene-specific output shapes."

## Context & Motivation

The current `db recent` surface already exposes some raw recent-activity signals, but it is still incomplete as a low-level query primitive:

- created and modified-existing activity are not normalized into one machine-friendly item model
- aggregation dimensions are not yet expressed as generic query inputs
- the result shape is still too tailored to a narrow set of pre-decided views

For an agent-first CLI, the right move is to improve query completeness and normalize the schema, not to add summary-specific flags or hard-coded view shapes.

This feature therefore upgrades `db recent` into a richer primitive:

- one normalized `items[]` collection
- one normalized `aggregates[]` collection
- generic query dimensions for kind, aggregate, timezone, and limits

## Scope

### In Scope

- Normalize recent-activity items into one typed item collection
- Add generic activity-kind filters
- Add generic aggregate dimensions
- Add generic output-size limits
- Keep one stable machine-readable schema across different query combinations

### Out of Scope

- Summary-specific flags or command names
- Hard-coded result views such as dedicated `created_items`, `modified_items`, `by_day`, or `by_parent` top-level fields
- Topic extraction, semantic clustering, or prose generation in the CLI
- Silent fallback to a weaker query contract

## Assumptions & Dependencies

- `db recent` remains the canonical entry point.
- Skills can derive created-vs-modified, day recaps, and parent summaries from a richer normalized schema.
- Generic query dimensions should remain few, composable, and scene-agnostic.
- If the current execution mode cannot satisfy the requested query dimensions, the command must fail fast.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Normalized Recent Activity Items (Priority: P1)

As an agent, I want recent activity to be returned as one typed item collection, so I can filter and reshape it without depending on multiple scene-specific top-level sections.

**Why this priority**: This is the most fundamental schema cleanup.

**Independent Test**: This story is independently satisfied if one query returns `items[]` and each item identifies its activity kind explicitly.

**Acceptance Scenarios**:

1. **Given** a recent-activity window with created and modified-existing activity, **When** the caller runs `db recent`, **Then** the result returns one `items[]` collection and each item includes an explicit activity-kind field.
2. **Given** the caller requests only one activity kind, **When** the query runs, **Then** `items[]` is filtered by that generic kind filter.

---

### User Story 2 - Generic Aggregate Dimensions (Priority: P1)

As an agent, I want recent-activity aggregates to be requested through generic dimensions, so I can compose the view I need without the CLI growing dedicated scene-shaped outputs.

**Why this priority**: This keeps the surface reusable and low-entropy.

**Independent Test**: This story is independently satisfied if one query can request one or more aggregate dimensions and receive them through one normalized `aggregates[]` section.

**Acceptance Scenarios**:

1. **Given** a query with `aggregate=day`, **When** it runs with a timezone, **Then** `aggregates[]` contains day aggregates aligned to that timezone.
2. **Given** a query with `aggregate=parent`, **When** it runs, **Then** `aggregates[]` contains parent aggregates in the same normalized aggregate schema.

---

### User Story 3 - Generic Output Shaping (Priority: P2)

As an agent, I want generic limits and projections, so I can bound result size while keeping the same normalized schema.

**Why this priority**: Output shaping should be primitive and composable, not scene-specific.

**Independent Test**: This story is independently satisfied if generic limits reduce returned volume without changing the top-level schema.

**Acceptance Scenarios**:

1. **Given** a large recent-activity window, **When** the caller provides item and aggregate limits, **Then** the result size is bounded without changing the top-level schema.
2. **Given** the same query with and without limits, **When** the caller compares the results, **Then** the schema stays the same and only result volume changes.

### Edge Cases

- A query returns only created activity.
- A query returns only modified-existing activity.
- A query requests `aggregate=day` with a timezone different from the local timezone.
- A query requests multiple aggregate dimensions in one call.
- Limits reduce the returned aggregates below the full result set.
- The command is invoked in an execution mode that cannot satisfy the requested query dimensions.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The recent-activity query surface MUST return one normalized `items[]` collection.
- **FR-002**: Each activity item MUST include an explicit activity-kind field that distinguishes created activity from modified-existing activity.
- **FR-003**: The query surface MUST support a generic activity-kind filter.
- **FR-004**: The query surface MUST support one or more generic aggregate dimensions.
- **FR-005**: Day aggregates MUST support an explicit timezone parameter and default to the caller’s local timezone when none is provided.
- **FR-006**: The result MUST return aggregates through one normalized `aggregates[]` collection rather than through scene-specific top-level sections.
- **FR-007**: The query surface MUST support generic item and aggregate limits.
- **FR-008**: Different limit values MUST NOT change the top-level schema.
- **FR-009**: If the current execution mode cannot satisfy the requested query dimensions, the command MUST fail fast rather than silently degrade.
- **FR-010**: Docs and tests MUST describe the feature as a normalized query primitive rather than a summary mode.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The surface MUST provide enough normalized raw structure for Skills to build higher-level summaries without introducing scene-specific CLI concepts.
- **NFR-002**: Aggregate semantics MUST be explicit and stable across runs for the same input query.
- **NFR-003**: The JSON schema MUST remain parser-stable under different filter, aggregate, and limit combinations.
- **NFR-004**: The command MUST remain read-only and side-effect free.
- **NFR-005**: User-visible command output and diagnostics MUST remain in English.

### Key Entities _(include if feature involves data)_

- **Activity Item**: One typed recent-activity record in `items[]`.
- **Activity Kind**: A generic activity classification such as created or modified-existing.
- **Aggregate Dimension**: A generic grouping key such as day or parent.
- **Aggregate Entry**: One normalized entry in `aggregates[]`.
- **Output Limit**: A generic cap on returned items or aggregates.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: `db recent` returns one normalized `items[]` collection with explicit activity kinds.
- **SC-002**: Aggregate dimensions can be requested through generic parameters and returned through one normalized `aggregates[]` collection.
- **SC-003**: Result volume can be bounded through generic limits without changing the top-level schema.
- **SC-004**: No summary-specific flag, command name, or dedicated scene-shaped top-level section is introduced for this capability.
