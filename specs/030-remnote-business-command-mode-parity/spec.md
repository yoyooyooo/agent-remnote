# Feature Specification: RemNote Business Command Mode Parity

**Feature Branch**: `[030-remnote-business-command-mode-parity]`  
**Created**: 2026-03-22  
**Updated**: 2026-03-22  
**Status**: In Progress (PR #25)  
**Input**: User description: "RemNote business commands must achieve 100% local/remote parity for business semantics, with host-authoritative logic, explicit boundary docs, gap inventory, and final remote-first integration verification."

## Context & Motivation

The repository already has a strict remote-mode switch via `apiBaseUrl`, but
current behavior is still mixed:

- some business commands already route through Host API
- some commands keep host-dependent business logic in the CLI process
- some commands fail fast in remote mode even though they belong to the RemNote
  business surface
- the global docs do not yet provide one durable place that explains which
  commands must be mode-invariant, which commands remain operational/host-only,
  and how new features are expected to preserve parity
- mode switching and executable parity knowledge are still distributed across
  command files, helpers, and point tests

The user wants a stronger rule: for RemNote business commands, local mode and
remote mode must be fully equivalent from the caller's point of view. Setting
`apiBaseUrl` may change transport, but it must not change business semantics.

This feature is therefore defined as **Wave 1 of the parity program**:

- it must make full parity executable by locking one command-level inventory,
  one executable command-contract registry, one host-authoritative runtime
  model, and one remote-first gate
- it must deliver full parity for the current Wave 1 command set
- it must classify every remaining RemNote-related command and assign a concrete
  follow-up action: `same_support`, `same_stable_failure`, or `reclassify`

To reach an S-grade architecture, Wave 1 must upgrade from "commands gradually
learn remote mode" to "commands consume one runtime that owns mode switching".

## Scope

### In Scope For This Feature

- Define one authoritative, command-level classification of RemNote business
  commands versus operational/host-only commands
- Define one authoritative source for that inventory and make every other
  representation derived and drift-checked
- Define one executable Wave 1 command-contract registry that aligns with the
  authoritative inventory without becoming a second truth source
- Define one `ModeParityRuntime` as the only place where Wave 1 business
  commands switch between local and remote execution
- Inventory all current parity gaps across all RemNote-related command surfaces
- Amend the constitution to require mode parity for RemNote business commands
- Add or update global docs/SSoT so the boundary, wave allocation, and allowed
  mode differences are explicit
- Refactor host-dependent business semantics toward host-authoritative logic with
  thin local and remote adapters
- Deliver full parity for the Wave 1 command set
- Add a command-level remote-first integration suite with deterministic fixtures
  and direct-vs-remote comparison rules
- Produce explicit wave or reclassification decisions for every deferred command

### Wave 1 Command Set

Wave 1 must deliver full parity for the following command set:

- `search`
- `rem outline`
- `daily rem-id`
- `page-id`
- `by-reference`
- `references`
- `resolve-ref`
- `query`
- `plugin current`
- `plugin search`
- `plugin ui-context snapshot`
- `plugin ui-context page`
- `plugin ui-context focused-rem`
- `plugin ui-context describe`
- `plugin selection current`
- `plugin selection snapshot`
- `plugin selection roots`
- `plugin selection outline`
- `daily write`
- `apply`
- `queue wait`
- `rem create`
- `rem move`
- `portal create`
- `rem replace`
- `rem children append`
- `rem children prepend`
- `rem children clear`
- `rem children replace`
- `rem set-text`
- `rem delete`
- `tag add`
- `tag remove`
- `rem tag add`
- `rem tag remove`

### Deferred Implementation In This Feature

The following commands remain in the parity program inventory, but this feature
only needs to classify them, define their parity target, and assign their next
wave or reclassification decision:

- `table show`
- `table create`
- `table property add`
- `table property set-type`
- `table option add`
- `table option remove`
- `table record add`
- `table record update`
- `table record delete`
- `powerup list`
- `powerup resolve`
- `powerup schema`
- `powerup apply`
- `powerup remove`
- `powerup property add`
- `powerup property set-type`
- `powerup option add`
- `powerup option remove`
- `powerup record add`
- `powerup record update`
- `powerup record delete`
- `powerup todo add`
- `powerup todo done`
- `powerup todo remove`
- `powerup todo undone`
- `connections`
- `daily summary`
- `topic summary`
- `inspect`
- `todos list`

### Out of Scope

- `api`, `stack`, `daemon`, `backup`, `config`, `doctor`, queue diagnostics,
  and other operational/host lifecycle surfaces
- External auth, transport hardening, or network exposure policy changes beyond
  what is required for parity verification
- A universal IR that forces all read paths into `WritePlanV1`

## Assumptions & Dependencies

- `apiBaseUrl` remains the only remote-mode switch
- Host API stays the unified remote execution surface
- Local mode may still execute in-process, but it must reuse the same business
  semantics as remote mode
- Forward-only evolution still applies; if a command must be reclassified or
  reshaped, docs/specs must say so explicitly
- Some command surfaces currently have stable unsupported-capability behavior; in
  those cases parity may be satisfied by the same stable failure contract rather
  than by immediate new capability support
- The existing queue -> WS -> plugin SDK write path remains the only write path
- Writes continue to use `apply envelope -> actions -> WritePlanV1 -> ops`;
  reads and UI-context flows may use dedicated runtime capabilities instead

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Command Inventory And Boundary Clarity (Priority: P1)

As a maintainer, I want one explicit, command-level inventory that classifies
RemNote business commands versus operational commands, so the repository has a
stable answer for which surfaces must maintain local/remote parity.

**Why this priority**: Without a single command-level inventory, the parity rule
cannot be enforced consistently and future commands will drift immediately.

**Independent Test**: This story is independently satisfied if one global SSoT
doc can enumerate every current RemNote-related command, classify each command,
assign its wave/target state, and drive drift checks in code/tests.

**Acceptance Scenarios**:

1. **Given** the current command surface, **When** a maintainer reviews the
   inventory, **Then** every relevant command is classified as either
   `business`, `business_deferred`, or `operational_host_only` with an
   explicit rationale.
2. **Given** a command previously sitting in a gray zone, **When** the
   inventory is updated, **Then** the docs make clear whether it is in Wave 1,
   deferred to a later wave, or reclassified outside the business set.

---

### User Story 2 - Wave 1 Business Commands Stay Mode-Invariant (Priority: P1)

As an agent, I want every Wave 1 RemNote business command to behave the same
with or without `apiBaseUrl`, so I can switch execution surfaces without
relearning command rules or losing advanced behaviors.

**Why this priority**: This is the core product requirement for the first
deliverable wave.

**Independent Test**: This story is independently satisfied if parity-sensitive
flows such as `page:/title:/daily:` refs, `before/after` placement,
selection-driven commands, in-place portal workflows, and stable failure
contracts all work the same in both modes for the Wave 1 set.

**Acceptance Scenarios**:

1. **Given** a Wave 1 business command that resolves `page:`, `title:`,
   `daily:`, or a RemNote deep link, **When** the caller runs it in local mode
   and remote mode, **Then** both paths resolve the same target and return the
   same semantic contract fields.
2. **Given** a Wave 1 business command that depends on host facts such as
   `before/after` placement, current selection, or contiguous sibling ranges,
   **When** the caller runs it in remote mode, **Then** the command succeeds or
   fails with the same business semantics as local mode.
3. **Given** a Wave 1 business command whose current capability boundary is
   intentionally unsupported, **When** the caller runs it in both modes, **Then**
   both modes return the same stable failure contract instead of diverging.

---

### User Story 3 - Wave 1 Commands Reuse One Business Runtime (Priority: P1)

As a maintainer, I want host-dependent business semantics and mode switching to
live in one authoritative runtime layer plus one executable contract registry,
so future RemNote business commands do not require duplicated local and remote
implementations.

**Why this priority**: The parity rule will not survive if command files keep
splitting business logic between CLI-side local helpers, ad-hoc remote branches,
and Host API helpers.

**Independent Test**: This story is independently satisfied if command files
become thin adapters, Wave 1 command contracts are declared in one registry, and
the only remaining local/remote switch happens inside the runtime adapters.

**Acceptance Scenarios**:

1. **Given** a host-dependent business semantic such as ref resolution,
   workspace binding, selection interpretation, or receipt enrichment,
   **When** the implementation is complete, **Then** that semantic is defined
   once as host-authoritative logic rather than separately in local and remote
   branches.
2. **Given** a Wave 1 business command file, **When** the implementation is
   complete, **Then** the file does not directly branch on `apiBaseUrl` and does
   not directly call `HostApiClient`; it only consumes the shared runtime.
3. **Given** a new RemNote business command added after this feature,
   **When** a maintainer extends the command inventory, **Then** the command can
   reuse the shared runtime and executable contract registry and will fail
   governance/tests if parity is not planned.

---

### User Story 4 - Remote-First Verification Prevents Drift (Priority: P2)

As a maintainer, I want a remote-first integration suite that runs with
`apiBaseUrl` configured from the beginning, so parity regressions are caught
before release.

**Why this priority**: Without a dedicated remote-first gate, the repository can
easily regress back into "local works, remote fails or behaves differently."

**Independent Test**: This story is independently satisfied if the repository
can run a deterministic integration suite that exercises every Wave 1 business
command through remote mode under both `/v1` and `/remnote/v1`, and compare
direct-vs-remote success and defined failure cases.

**Acceptance Scenarios**:

1. **Given** a configured `apiBaseUrl`, **When** the remote-first suite runs,
   **Then** every Wave 1 business command is executed through remote mode at
   least once.
2. **Given** default `/v1` and non-default `/remnote/v1` API base paths,
   **When** the remote-first suite runs, **Then** the same Wave 1 commands still
   pass under both paths.
3. **Given** parity-sensitive success and failure scenarios, **When** the suite
   compares local and remote results, **Then** contract drift causes a test
   failure while transport-only diagnostics are normalized out.

### Edge Cases

- A command is currently documented as business-facing but still depends on
  local DB access in the CLI process.
- A command supports `id:` refs remotely but diverges for `page:`, `title:`,
  `daily:`, or deep-link refs.
- A command resolves placement or in-place portal semantics differently because
  sibling order or anchor context is computed on the client side.
- Selection-driven flows depend on stale or missing UI-context/WS state.
- A command may only achieve parity in the short term via the same stable
  failure contract.
- A command works remotely only when `apiBaseUrl` uses the default `/v1` prefix.
- A command returns different envelope fields, error codes, or receipt warnings
  across modes.
- Inventory, docs, code mirrors, command-contract registry, and tests drift
  from one another.
- A Wave 1 command file silently reintroduces direct `cfg.apiBaseUrl` branching.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The project MUST define one authoritative, command-level inventory
  of all current RemNote-related commands in
  `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`.
- **FR-002**: Every command in that inventory MUST be classified as one of:
  `business`, `business_deferred`, or `operational_host_only`, and the
  classification MUST include a rationale.
- **FR-003**: `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
  MUST be a derived working ledger for this feature; it MUST NOT become a
  second authoritative source.
- **FR-004**: Any machine-readable inventory such as
  `packages/agent-remnote/src/lib/business-semantics/commandInventory.ts` MUST be
  derived from the authoritative SSoT inventory and protected by drift tests.
- **FR-005**: Setting `apiBaseUrl` MUST switch only the execution surface for
  Wave 1 business commands; it MUST NOT silently reduce business capability.
- **FR-006**: This feature MUST deliver full parity for the entire Wave 1
  command set listed in the Scope section.
- **FR-007**: For every deferred business command, this feature MUST assign one
  explicit next state: `same_support`, `same_stable_failure`, or `reclassify`,
  and MUST assign a target follow-up wave or rationale.
- **FR-008**: The feature MUST distinguish mode parity from capability
  expansion. Where a command is intentionally unsupported, parity may be
  satisfied by the same stable failure contract.
- **FR-009**: The feature MUST produce a gap inventory that covers every
  command-level inventory row and records current parity status, missing Host API
  capabilities, client-side business logic leaks, documentation gaps, and test
  gaps.
- **FR-010**: The project MUST define one executable Wave 1
  `CommandContractRegistry` in code for parity-mandatory commands.
- **FR-011**: Each Wave 1 command contract row MUST declare at least:
  `command_id`, `family`, `parity_target`, `required_capabilities`,
  `local_use_case`, `remote_endpoint`, `success_normalizer`,
  `stable_failure_normalizer`, and `verification_case_ids`.
- **FR-012**: The executable command-contract registry MUST align with the
  authoritative inventory and MUST fail contract tests on drift.
- **FR-013**: The project MUST define one `ModeParityRuntime` for Wave 1
  business commands, and that runtime MUST be the only place where mode
  switching occurs.
- **FR-014**: Local mode and remote mode MUST reuse the same host-authoritative
  business semantics through thin runtime adapters instead of maintaining
  independent business decision branches.
- **FR-015**: Wave 1 business command files MUST NOT directly branch on
  `cfg.apiBaseUrl` and MUST NOT directly depend on `HostApiClient`, except for
  runtime/adapter infrastructure files explicitly designated for that purpose.
- **FR-016**: Host-dependent business semantics include at least ref
  resolution, workspace binding, placement resolution, selection resolution,
  contiguous range determination, title inference, capability gating, and
  receipt enrichment.
- **FR-017**: The feature MUST preserve the existing
  `apply envelope -> actions -> WritePlanV1 -> ops -> enqueue` write path.
- **FR-018**: Reads and UI-context flows do not need to force themselves into
  `WritePlanV1`, but they MUST still go through the shared Wave 1 runtime
  capabilities and normalizers.
- **FR-019**: The feature MUST migrate or rewrite existing local-only tests,
  help output, and docs for every Wave 1 command whose remote behavior changes.
- **FR-020**: The feature MUST update
  `docs/ssot/agent-remnote/http-api-contract.md`,
  `docs/ssot/agent-remnote/cli-contract.md`,
  `docs/ssot/agent-remnote/tools-write.md`,
  `docs/ssot/agent-remnote/ui-context-and-persistence.md`, and
  `docs/ssot/agent-remnote/write-input-surfaces.md` to align with the command
  inventory and parity rule.
- **FR-021**: The repository MUST add a deterministic, command-level
  remote-first integration suite that runs with `apiBaseUrl` configured from
  start to finish and executes every Wave 1 command at least once.
- **FR-022**: The remote-first suite MUST run under both default `/v1` and
  non-default `/remnote/v1` base paths.
- **FR-023**: The remote-first suite MUST compare local and remote outcomes for
  both success cases and defined failure cases. Transport-only diagnostics may
  differ; business semantics may not.
- **FR-024**: The feature MUST provide deterministic fixture builders for
  hierarchy/placement, selection/UI-context, partial-success receipts, and API
  base-path variants so the parity gate is reproducible.
- **FR-025**: Help output, README guidance, and repo-local skill guidance MUST
  explain that Wave 1 business commands are mode-invariant while operational
  commands remain host-only.
- **FR-026**: Any new RemNote business command added after this feature MUST be
  blocked by governance/tests if it lacks an inventory row, a Wave 1 registry
  decision or later-wave rationale, and a verification plan.

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: The final design MUST keep business semantics single-sourced;
  transport-specific logic MUST stay thin and non-authoritative.
- **NFR-002**: The project MUST avoid dual truth sources across SSoT, feature
  ledgers, code mirrors, executable command contracts, and tests.
- **NFR-003**: The command inventory and parity rule MUST be discoverable in one
  global SSoT doc rather than inferred from scattered examples.
- **NFR-004**: The final implementation MUST preserve the existing queue -> WS
  -> plugin SDK write path.
- **NFR-005**: Remote-first parity verification MUST become part of the default
  release-quality gate for Wave 1 business commands.
- **NFR-006**: The feature MUST preserve support for non-default API base paths
  in both runtime behavior and automated verification.
- **NFR-007**: Any forward-only breaking changes introduced to achieve parity
  MUST be documented explicitly in spec, plan, tasks, and user-facing docs.
- **NFR-008**: Architecture guards MUST be reproducible in CI and MUST fail on
  residual Wave 1 command-layer mode branching.

### Key Entities _(include if feature involves data)_

- **Authoritative Command Inventory**: The single source of truth that lists
  every RemNote-related command, its classification, parity target, and wave.
- **Executable Command Contract Registry**: The code-side executable projection
  of Wave 1 parity-mandatory commands. It does not decide inclusion; it binds
  each Wave 1 command to runtime capabilities, normalizers, and verification.
- **Mode Parity Runtime**: The only Wave 1 runtime layer allowed to switch
  between local and remote execution and expose normalized business
  capabilities.
- **Host-Authoritative Business Logic**: The single source of truth for
  host-dependent semantic decisions shared by local and remote adapters.
- **Parity Target**: The declared target state for a command:
  `same_support`, `same_stable_failure`, or `reclassify`.
- **Remote-First Verification Case**: A deterministic success or failure case
  tied to a command-level inventory row and executable contract row.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of current RemNote-related commands are present in the
  authoritative command-level inventory with classification, parity target, and
  wave assignment.
- **SC-002**: 100% of Wave 1 commands have executable command-contract rows
  aligned with the inventory.
- **SC-003**: 100% of Wave 1 commands pass the remote-first suite under both
  `/v1` and `/remnote/v1`.
- **SC-004**: Wave 1 direct-vs-remote comparison covers both success cases and
  defined failure cases without business-contract drift.
- **SC-005**: No Wave 1 command file directly branches on `apiBaseUrl` or
  directly imports `HostApiClient` outside approved runtime/adapter
  infrastructure.
- **SC-006**: No Wave 1 command relies on a client-side host-fact resolution
  path as its authoritative business implementation.
- **SC-007**: Constitution, global docs, SSoT, README guidance, repo-local skill
  guidance, code-side inventory mirror, executable command-contract registry,
  and verification helpers all align with the same command-level parity model.
- **SC-008**: Every deferred business command has an explicit next-step
  decision, and no command remains in an unclassified or ambiguous state.
