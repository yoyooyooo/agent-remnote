# Feature Specification: Agent-First CLI Contract Reset

**Feature Branch**: `[020-agent-cli-contract]`  
**Created**: 2026-03-11  
**Status**: Planned  
**Input**: User description: "Agent-first CLI contract reset: make apply --payload the canonical write entry with kind=actions|ops; keep high-level thin wrappers under rem children append/prepend/replace/clear and daily write; remove import markdown, import wechat outline, and plan apply; unify Markdown input as --markdown <input-spec> supporting inline, @file, and -."

## Context & Motivation

Current CLI write surfaces are split across several partially overlapping concepts:

- high-level write commands
- `import markdown`
- `plan apply`
- raw `apply --payload`
- WeChat-specific import/write entrypoints

From an agent-oriented perspective, that creates avoidable entropy:

1. the agent has to choose between multiple write entrypoints for the same intent,
2. markdown input conventions differ between commands,
3. batch/action JSON and raw ops JSON are split into separate public contracts,
4. old command groups remain visible even after their mental model is no longer preferred.

This feature resets the CLI write contract around one canonical JSON entry and a small set of thin, entity-oriented wrapper commands. It supersedes conflicting assumptions from earlier CLI-surface drafts where necessary. Forward-only evolution applies: once the new contract is accepted, old entrypoints are removed instead of preserved as long-lived compatibility layers.

## Scope

### In Scope

- canonical public write entry reset around `apply --payload`
- structured `actions` and raw `ops` under one apply envelope
- `rem children append/prepend/replace/clear` as the direct-children wrapper family
- `daily write` alignment with the same Markdown input contract
- Host API write surface alignment with the same canonical contract
- removal of obsolete public write entrypoints and their synchronized docs

### Out of Scope

- new RemNote write semantics unrelated to the CLI contract reset
- preserving deprecated command aliases for a transition period
- source-specific import flows that are not part of the canonical agent write surface

## Dependencies & Assumptions

- This feature supersedes conflicting public-surface assumptions from older CLI specs when they disagree with the agent-first contract defined here.
- Existing queue, daemon, and plugin write execution guarantees remain the execution substrate; this feature changes the public contract shape rather than the underlying persistence safety model.
- `apply --payload` already exists as a raw entry; this feature elevates and reshapes it into the canonical public contract rather than inventing a second JSON write surface.
- Host API remote mode is part of the public contract surface for agent callers and must stay semantically aligned with CLI write entrypoints.
- Documentation surfaces listed in repository policy must be updated together once this spec is implemented.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Agent chooses one canonical write contract (Priority: P1)

As an agent, I want a single canonical write entry so I can generate one stable JSON shape for most write operations and stop branching between `apply`, `plan apply`, and older command families.

**Why this priority**: This is the highest-leverage change. If the canonical write contract remains ambiguous, every higher-level command still inherits that ambiguity.

**Independent Test**: A caller can express both a structured action request and a raw ops request through `apply --payload <json|@file|->`, and the CLI help/docs expose that path as the primary write contract.

**Acceptance Scenarios**:

1. **Given** a caller has a multi-step write request, **When** it submits an `actions` envelope through `apply --payload`, **Then** the CLI accepts it as the canonical structured write path.
2. **Given** a caller has a low-level debug request, **When** it submits an `ops` envelope through `apply --payload`, **Then** the CLI accepts it without requiring a different public command family.

---

### User Story 2 - Agent uses thin entity wrappers for common children writes (Priority: P1)

As an agent, I want the most common Rem subtree edits exposed as thin wrapper commands so I can issue short, discoverable commands for frequent tasks without giving up contract consistency.

**Why this priority**: High-frequency tasks should stay terse, but they must still map to the canonical write contract rather than inventing parallel semantics.

**Independent Test**: A caller can use `rem children append/prepend/replace/clear` and `daily write` for common cases, and those commands behave as thin wrappers over the canonical write contract.

**Acceptance Scenarios**:

1. **Given** a target Rem id and Markdown content, **When** the caller runs `rem children replace`, **Then** the command expresses "replace direct children only" without requiring raw JSON.
2. **Given** a target Rem id and Markdown content, **When** the caller runs `rem children append` or `prepend`, **Then** the command expresses direct-children insertion at tail or head with no alternate Markdown flag syntax.

---

### User Story 3 - Agent sees one Markdown input convention everywhere (Priority: P2)

As an agent, I want every Markdown-taking command to use the same argument contract so I can template command generation once and reuse it everywhere.

**Why this priority**: Input-shape drift is a common cause of tool misuse in automated flows. A single convention lowers prompt complexity and lowers failure variance.

**Independent Test**: Every Markdown-taking public command accepts `--markdown <input-spec>` and the same three input-spec forms: inline string, `@file`, and `-`.

**Acceptance Scenarios**:

1. **Given** inline Markdown content, **When** the caller passes `--markdown $'...'`, **Then** the command accepts it without needing `--file` or `--stdin`.
2. **Given** a file path or heredoc, **When** the caller passes `--markdown @./note.md` or `--markdown -`, **Then** the command reads the content using the same contract.

---

### User Story 4 - Old write entrypoints disappear instead of lingering (Priority: P2)

As a maintainer, I want obsolete entrypoints removed once the new contract is defined so agents cannot keep selecting stale flows from help text or docs.

**Why this priority**: Forward-only evolution loses value if old entrypoints continue to appear beside the new contract.

**Independent Test**: CLI help, docs, and command routing no longer expose `import markdown`, `import wechat outline`, or `plan apply` as public commands after the migration.

**Acceptance Scenarios**:

1. **Given** the new CLI build, **When** a caller inspects help text, **Then** obsolete command groups are absent from the public surface.
2. **Given** an outdated invocation, **When** a caller tries a removed command, **Then** the CLI fails fast instead of silently maintaining a compatibility path.

### Edge Cases

- What happens when `--markdown` is omitted for a Markdown-taking command? The command must fail fast with `INVALID_ARGS` and a stable hint that Markdown content is required.
- What happens when `--markdown -` is used without piped stdin? The command must fail fast with a stable input error instead of blocking indefinitely.
- How does the system handle an empty `actions` or `ops` envelope? The canonical `apply` contract must reject empty write batches with a stable payload-shape error.
- How does the system handle `rem delete` versus `rem children clear`? The public contract must keep "delete self and subtree" distinct from "clear direct children only".
- How does the system handle obsolete command invocations after migration? Removed commands must fail fast with no hidden compatibility layer.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST define `apply --payload <json|@file|->` as the canonical public write entry for agent callers.
- **FR-002**: System MUST support a single top-level apply envelope with `version` and `kind`, where `kind` is either `actions` or `ops`.
- **FR-003**: System MUST support an `actions` envelope for structured, agent-oriented write requests and an `ops` envelope for raw advanced/debug requests.
- **FR-004**: System MUST remove `plan apply` as a separate public command and fold its structured-write capability into `apply --payload`.
- **FR-005**: System MUST expose `rem children append`, `rem children prepend`, `rem children replace`, and `rem children clear` as public high-frequency commands for direct-children operations.
- **FR-006**: System MUST keep `daily write` as a public high-frequency command and align its Markdown input contract with the same `--markdown <input-spec>` convention used elsewhere.
- **FR-007**: Every public command that accepts Markdown MUST use exactly one Markdown content flag: `--markdown <input-spec>`.
- **FR-008**: `input-spec` for `--markdown` MUST support exactly three public forms: inline string, `@file`, and `-` for stdin.
- **FR-009**: System MUST preserve a clear semantic separation between:
  - deleting a Rem and its subtree,
  - clearing only a Rem's direct children,
  - clearing only a Rem's own text.
- **FR-010**: High-level write commands MUST behave as thin wrappers over the canonical apply contract rather than defining independent write semantics.
- **FR-011**: System MUST remove the public `import` command group, including `import markdown` and `import wechat outline`.
- **FR-012**: System MUST remove WeChat-specific write/import logic from the supported public CLI surface and synchronized documentation.
- **FR-013**: System MUST keep raw ops available for advanced/debug use through `apply --payload` with `kind: "ops"` rather than through a separate public write family.
- **FR-014**: System MUST keep the public CLI agent-oriented and entity-oriented; it MUST NOT reintroduce a top-level `read/write` split as the canonical surface for this feature.
- **FR-015**: When obsolete commands are removed, the CLI MUST fail fast on those names instead of preserving a long-lived compatibility alias.
- **FR-016**: System MUST align Host API write routing with the same canonical apply contract used by CLI callers.
- **FR-017**: Host API MUST expose exactly one canonical write route for structured and raw write requests instead of maintaining separate Markdown-specific and ops-specific write routes.
- **FR-018**: Remote-mode high-level commands in scope MUST compile to the canonical apply envelope and send that envelope through the canonical Host API write route.
- **FR-019**: System MUST remove the Markdown-specific Host API write route from the supported public API surface and synchronized documentation.
- **FR-020**: System MUST update remote-mode guidance so commands formerly routed through `import markdown` now route through the new high-level wrappers or canonical apply contract.
- **FR-021**: `apply` MUST support `--wait` so callers can block until the txn reaches a terminal state.
- **FR-022**: When `--wait` is enabled, CLI and Host API MUST expose aligned timeout and polling controls (`--timeout-ms` / `timeoutMs`, `--poll-ms` / `pollMs`) in milliseconds.
- **FR-023**: `apply --wait` timeout and failure responses MUST be deterministic for both CLI and Host API callers, including stable exit/error codes and queue-wait style terminal-state reporting.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The canonical write contract MUST remain low-entropy for agent callers: one primary JSON entrypoint, one Markdown flag shape, and one direct-children command family.
- **NFR-002**: The CLI MUST preserve existing write-side output guarantees for agent automation, including stable JSON envelopes and machine-parseable failure modes.
- **NFR-003**: The migration MUST be forward-only: if this feature introduces breaking command changes, documentation and planning artifacts must be updated, and no compatibility period may be kept.
- **NFR-004**: Public command names and JSON action names MUST remain semantically aligned so an agent can map between shell invocation and payload invocation without lossy translation.
- **NFR-005**: The canonical contract MUST be documented identically across local CLI docs, README surfaces, and spec artifacts so agents do not encounter conflicting mental models.

### Key Entities _(include if feature involves data)_

- **Apply Envelope**: The canonical JSON write request wrapper with `version`, `kind`, request body, and top-level execution metadata.
- **Action Request**: A structured write descriptor inside an `actions` envelope that expresses an agent-facing intent instead of raw op wiring.
- **Raw Ops Request**: A low-level advanced/debug write descriptor inside an `ops` envelope that maps directly to queue ops.
- **Markdown Input Spec**: The normalized content locator accepted by `--markdown`, covering inline content, `@file`, and `-`.
- **Children Write Command**: A high-frequency wrapper command that targets the direct children of a specific Rem and compiles to the canonical write contract.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Public CLI help exposes exactly one canonical JSON write entry, `apply --payload`, and does not expose `plan apply` or `import markdown` afterward.
- **SC-002**: Public CLI help exposes a single direct-children command family under `rem children` with `append`, `prepend`, `replace`, and `clear`.
- **SC-003**: All public Markdown-taking commands in scope use `--markdown <input-spec>` and no longer require separate `--file`, `--stdin`, or `--md-file` variants.
- **SC-004**: At least one structured `actions` example and one raw `ops` example can be expressed through the same `apply --payload` entry in docs and contract tests.
- **SC-005**: Removed write entrypoints are absent from synchronized docs and fail fast when invoked, with no hidden compatibility path.
- **SC-006**: Host API docs expose one canonical write route for both `actions` and `ops`, and no longer expose a separate Markdown write route.
- **SC-007**: `apply --wait` is documented and contract-tested with aligned CLI and Host API timeout/poll semantics.
