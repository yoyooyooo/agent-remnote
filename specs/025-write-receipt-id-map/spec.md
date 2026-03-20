# Feature Specification: Stable Write Receipts With Canonical ID Mapping

**Feature Branch**: `[025-write-receipt-id-map]`  
**Created**: 2026-03-19  
**Status**: Planned  
**Input**: User description: "Make `id_map` the canonical machine-readable write receipt so agents can continue from one stable result contract, while keeping any wrapper-specific ids as optional compatibility sugar."

## Context & Motivation

The current write flow already has the core fact agents need after success:

- client temp id -> remote id mapping

But the public wait-mode result surface is still too wrapper-shaped:

- created ids are often recovered through wrapper-specific logic
- callers can drift toward per-command parsers instead of one stable machine contract
- `queue inspect` is still too easy to treat as the normal next step

For an agent-first CLI, the receipt should be shaped around one canonical machine contract. Wrapper-specific convenience ids may still exist for compatibility or ergonomics, but they should not be the primary parsing model.

## Scope

### In Scope

- Make `id_map` the canonical machine-readable wait-mode result contract
- Keep local and remote receipt shapes aligned
- Keep wrapper-specific convenience ids optional and subordinate to `id_map`
- Improve timeout and failure receipts with the same canonical mapping model

### Out of Scope

- Redesign queue acknowledgements
- Add a streaming progress surface
- Replace `queue inspect` as an advanced debugging tool
- Add duplicate receipt fields with overlapping semantics

## Assumptions & Dependencies

- Queue id mapping remains the source of truth.
- Agents should parse `id_map` first.
- Convenience ids such as `rem_id` or `portal_rem_id` can remain, but only as derived sugar.
- Local and remote wait-mode receipts should keep the same field semantics.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - `id_map` Is the Canonical Success Contract (Priority: P1)

As an agent, I want successful wait-mode writes to return `id_map` directly, so I can continue from one stable machine-readable contract.

**Why this priority**: This is the lowest-entropy continuation model for agents.

**Independent Test**: This story is independently satisfied if successful wait-mode writes expose `id_map` directly in their results.

**Acceptance Scenarios**:

1. **Given** a successful `rem create --wait`, **When** the command returns, **Then** the result includes `id_map` directly.
2. **Given** a successful `portal create --wait`, **When** the command returns, **Then** the result includes `id_map` directly.

---

### User Story 2 - Local and Remote Receipts Share One Machine Contract (Priority: P1)

As an agent author, I want local and remote wait-mode results to expose the same canonical mapping contract, so parser logic does not depend on execution surface.

**Why this priority**: Agent parsers should not split by local vs remote mode.

**Independent Test**: This story is independently satisfied if local and remote successful wait-mode results share the same `id_map` semantics.

**Acceptance Scenarios**:

1. **Given** a successful local `apply --wait`, **When** the result is returned, **Then** `id_map` is present in the canonical machine-readable result.
2. **Given** the same flow through remote mode, **When** the result is returned, **Then** the same `id_map` contract is present with the same semantics.

---

### User Story 3 - Convenience IDs Stay Secondary (Priority: P2)

As a maintainer, I want wrapper-specific ids to remain secondary to `id_map`, so the CLI stays machine-consistent without forcing an abrupt compatibility break.

**Why this priority**: This preserves compatibility while keeping the primary contract clean.

**Independent Test**: This story is independently satisfied if any convenience ids that remain are explicitly documented as derived sugar.

**Acceptance Scenarios**:

1. **Given** a wrapper result that includes `rem_id` or `portal_rem_id`, **When** the caller compares it with `id_map`, **Then** the convenience field agrees with the canonical mapping.
2. **Given** docs and quickstart material, **When** continuation is described, **Then** `id_map` is described as the primary machine contract.

### Edge Cases

- A successful wait-mode write creates no new ids and should still return an explicit empty `id_map`.
- A timeout occurs after some mappings are already durable.
- Local and remote surfaces expose different convenience fields but must still share the same `id_map` contract.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Successful wait-mode write commands MUST return `id_map` as the canonical machine-readable mapping contract, and each entry MUST follow the canonical `ID Map Entry` shape defined below.
- **FR-002**: `apply --wait` MUST return `id_map` in both local and remote mode with the same semantics.
- **FR-003**: Wrapper-specific convenience ids MAY remain, but they MUST be derived from and agree with `id_map`.
- **FR-004**: When no ids were created, the receipt MUST still include an explicit empty `id_map`.
- **FR-005**: Timeout and failure details MUST include any durable `id_map` entries already known at that point.
- **FR-006**: Docs and quickstart material MUST describe `id_map` as the primary machine-readable continuation contract.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The receipt contract MUST support one-pass agent continuation after successful writes.
- **NFR-002**: The canonical machine-readable surface MUST be stable across wrapper commands and `apply`, including field names and required keys for each `id_map` entry.
- **NFR-003**: Convenience fields, if retained, MUST remain secondary to the canonical mapping contract.
- **NFR-004**: User-visible command output and diagnostics MUST remain in English.

### Key Entities _(include if feature involves data)_

- **ID Map Entry**: One mapping object with required keys:
  - `client_temp_id: string`
  - `remote_id: string`
  - `remote_type: string`
  - optional `source_txn: string`
  - optional `updated_at: number`
- **Canonical Write Receipt**: The machine-readable result object centered on `id_map`.
- **Convenience ID**: An optional wrapper-specific sugar field derived from `id_map`.

### Canonical `id_map` Entry Shape

```json
{
  "client_temp_id": "tmp:opaque-client-id",
  "remote_id": "opaque-remote-id",
  "remote_type": "rem",
  "source_txn": "optional-txn-id",
  "updated_at": 1773931673116
}
```

Rules:

- `client_temp_id`, `remote_id`, and `remote_type` are required.
- `client_temp_id` is the exact temporary identifier used inside the write transaction.
- `remote_id` is the durable identifier that subsequent agent steps should continue with.
- `remote_type` names the durable resource class and is currently expected to be a stable string such as `rem`.
- `source_txn` and `updated_at` are optional enrichment fields and MUST NOT change the semantics of the mapping.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Successful wait-mode writes expose `id_map` directly with no follow-up command needed to recover the mapping.
- **SC-002**: Local and remote `apply --wait` results share the same `id_map` semantics.
- **SC-003**: Official continuation examples treat `id_map` as the primary machine-readable contract.
- **SC-004**: Any retained convenience ids are explicitly secondary and consistent with `id_map`.
