# Feature Specification: Fixed Runtime Owner Governance

**Feature Branch**: `[033-fixed-runtime-owner]`  
**Created**: 2026-03-28  
**Updated**: 2026-03-28  
**Status**: Planned  
**Input**: User description: "Keep the RemNote-connected URL fixed, make that fixed URL correspond to exactly one backend owner at any time, prevent the installed npm/Volta runtime and local source runtimes from colliding, default source development to an isolated profile, expose ownership conflicts through doctor/status, and provide an explicit takeover/reclaim flow when local development must temporarily own the fixed URL."

## Context & Motivation

Today the repository already uses one global default runtime root:

- `~/.agent-remnote/store.sqlite`
- `~/.agent-remnote/ws.pid`
- `~/.agent-remnote/api.pid`
- `~/.agent-remnote/plugin-server.pid`

That is convenient for the published CLI, but it becomes ambiguous once the
same machine also runs the repository from source:

- the installed npm/Volta release and the source-tree CLI both target the same
  default pid/state/log/store paths
- the fixed RemNote developer URLs and fixed default ports implicitly point to
  "whatever answered last", instead of to one declared owner
- `doctor` can detect stale artifacts and build mismatches, but it still does
  not define which runtime is supposed to own the fixed URL
- local development can accidentally disturb the published runtime even when the
  maintainer only wanted to test source changes in isolation

The user requirement is stricter than "detect conflicts":

- the RemNote-facing URL must stay fixed
- that fixed URL must correspond to exactly one declared backend owner
- the published install must remain the stable owner by default
- source development must not silently interfere unless the maintainer makes an
  explicit takeover decision

## Scope

### In Scope For This Feature

- Define one durable ownership model for the fixed RemNote URL and canonical
  ports
- Define one runtime-profile model that separates the stable published runtime
  from source-tree development by default
- Make all default runtime file paths derive from one resolved runtime root
- Add explicit ownership metadata to daemon/api/plugin pid and state artifacts
- Add one canonical fixed-owner claim that tells `doctor` and `stack` which
  runtime is expected to own the fixed URL
- Make `doctor --fix` repair deterministic ownership problems that are
  unambiguous and safe
- Add an explicit takeover/reclaim flow for temporarily transferring the fixed
  URL between stable and dev owners
- Expose ownership, claim status, and conflicts in `doctor`, `stack status`,
  `daemon status`, `api status`, `plugin status`, and `config print`
- Update SSoT, README docs, local runbooks, and agent guidance together

### Out of Scope

- Changing the fixed RemNote URL itself
- Introducing multiple simultaneously valid fixed owners for one URL
- Supporting long-term compatibility shims between old and new runtime metadata
- Changing the queue -> WS -> plugin SDK write path
- Reworking unrelated write semantics, remote-mode parity, or release workflow

## Assumptions & Dependencies

- The published npm package installed through Volta remains the expected stable
  runtime on the user's machine
- Source-tree execution can be distinguished from the published install with
  stable metadata such as entrypoint, repo root, and install source
- The repository may continue to support advanced explicit overrides for pid
  files, state files, runtime root, and ports, but default behavior must become
  deterministic
- Forward-only evolution applies: pid/state metadata and config shape may be
  refactored, but long-lived dual formats are not allowed
- `doctor --fix` may only perform repairs that are clearly safe and do not
  require guessing user intent
- The canonical ownership control plane must remain discoverable from any
  invocation profile, including source worktrees and packed installs
- If a takeover changes which plugin assets are served from the fixed URL, the
  system may require a RemNote reload and must report that fact explicitly

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Stable Runtime Owns The Fixed URL By Default (Priority: P1)

As a maintainer, I want the published installed runtime to remain the declared
default owner of the fixed RemNote URL, so my normal daily use of RemNote keeps
working even if I occasionally run repository code from source.

**Why this priority**: This is the base safety rule. Without it, the fixed URL
can silently drift to the wrong backend and invalidate every later diagnosis.

**Independent Test**: This story is satisfied if a machine with both the
published install and the source repository can report one declared fixed owner,
and `doctor --fix` can restore the stable owner whenever the fixed owner is
expected to be stable and the repair is unambiguous.

**Acceptance Scenarios**:

1. **Given** the fixed-owner claim points to the stable published runtime,
   **When** the maintainer runs `stack ensure` or `doctor --fix`, **Then** the
   canonical ports and fixed URL resolve to the stable owner and status surfaces
   report that owner explicitly.
2. **Given** stale pid/state artifacts or stale fixed-owner metadata remain from
   an earlier session, **When** the maintainer runs `doctor --fix`, **Then** the
   stale artifacts are cleaned and the fixed-owner claim resolves back to one
   live stable owner without touching user content.
3. **Given** the stable owner must be restored from a source-side maintenance
   session, **When** the repair or reclaim flow targets `stable`, **Then** the
   system relaunches the stable owner through its declared launcher instead of
   reusing the currently running source-tree entrypoint.

---

### User Story 2 - Source Development Is Isolated By Default (Priority: P1)

As a developer, I want repository-local execution to default to an isolated
runtime profile, so I can run tests and source builds without disturbing the
published runtime that owns the fixed RemNote URL.

**Why this priority**: Safe local development is impossible if every repo-local
command can overwrite the same global runtime artifacts by accident.

**Independent Test**: This story is satisfied if source-tree execution derives a
separate runtime root and non-canonical lifecycle artifacts by default, while
the published runtime remains untouched unless an explicit takeover is
requested.

**Acceptance Scenarios**:

1. **Given** the developer runs the CLI from the repository worktree, **When**
   the command resolves its runtime profile, **Then** it uses an isolated
   runtime root and does not reuse the stable runtime's default pid, log, state,
   or store paths.
2. **Given** the stable owner already holds the fixed URL, **When** the
   developer starts source-side services without an explicit takeover, **Then**
   the source runtime starts in isolation or fails fast, but it does not steal
   the fixed URL.
3. **Given** two different worktrees of the same repository run on the same
   machine, **When** they resolve isolated dev defaults, **Then** they derive
   different runtime roots and isolated port classes so they do not collide with
   each other.

---

### User Story 3 - Explicit Takeover Transfers The Fixed URL Deterministically (Priority: P2)

As a developer, I want one explicit takeover flow that can temporarily transfer
the fixed URL from the stable owner to the source runtime and later reclaim it,
so I can debug against the same RemNote URL without leaving ownership ambiguous.

**Why this priority**: The user wants the fixed URL to stay constant. That
requires an explicit transfer flow rather than ad-hoc port changes.

**Independent Test**: This story is satisfied if the developer can intentionally
transfer the fixed-owner claim to `dev`, observe that the fixed URL now belongs
to the source runtime, and later transfer the claim back to `stable` without
manual pid-file surgery.

**Acceptance Scenarios**:

1. **Given** the fixed-owner claim currently belongs to `stable`, **When** the
   developer runs the explicit takeover flow for `dev`, **Then** the current
   stable owner is stopped or relinquished in a controlled way, the fixed-owner
   claim moves to `dev`, and status surfaces report the new owner.
2. **Given** the fixed-owner claim currently belongs to `dev`, **When** the
   developer reclaims the fixed URL for `stable`, **Then** the claim moves back
   to `stable`, the canonical ports are re-owned by the stable runtime, and the
   system reports any required RemNote reload.
3. **Given** the source-side plugin artifacts required for a dev takeover are
   missing or stale, **When** the developer requests `dev` takeover, **Then**
   the system fails before transferring the fixed-owner claim and explains the
   preflight failure.

---

### User Story 4 - Ownership Conflicts Are Visible And Repairable (Priority: P2)

As a maintainer, I want `doctor` and runtime status commands to explain owner,
claim, profile, and conflict state directly, so I can diagnose runtime conflicts
without guessing from ports or logs.

**Why this priority**: Once ownership becomes a first-class concept, diagnostics
must expose it explicitly or the feature will only exist in implementation.

**Independent Test**: This story is satisfied if status commands and
`doctor --json` show fixed-owner claim metadata, live owner metadata, ownership
conflict categories, and whether the issue is auto-fixable.

**Acceptance Scenarios**:

1. **Given** daemon/api/plugin metadata belongs to different owners or runtime
   roots, **When** the maintainer runs `doctor --json`, **Then** the result
   reports an ownership conflict, identifies the claimed owner, and states
   whether the issue is repairable.
2. **Given** the live runtime matches the fixed-owner claim, **When** the
   maintainer runs `stack status` or `config print`, **Then** the output shows
   the resolved runtime profile, runtime root, fixed-owner claim, and live owner
   consistently.

---

### Edge Cases

- The fixed-owner claim points to `stable`, but the stable process is gone and a
  trusted `dev` process still occupies the canonical port
- The source runtime is started from more than one worktree or repo root on the
  same machine
- Canonical pid/state files are missing, but the fixed URL still answers on the
  canonical ports
- A takeover succeeds for daemon/api but plugin asset ownership changes require
  a RemNote reload before source changes are visible
- The maintainer explicitly overrides runtime-root or port flags for a one-off
  debug session
- The fixed-owner claim references a repo path that no longer exists on disk
- The stable owner launcher is unavailable or resolves to the wrong executable
- `doctor --fix` sees an ownership mismatch but cannot prove which live process
  is safe to stop

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST resolve one runtime profile for each invocation
  and classify it as at least `stable` or `dev`.
- **FR-002**: The system MUST derive all default runtime artifact paths from one
  resolved runtime root instead of hardcoding all defaults directly under
  `~/.agent-remnote`.
- **FR-003**: The published installed runtime MUST be the default owner of the
  fixed RemNote URL and canonical ports unless an explicit transfer changes the
  fixed-owner claim.
- **FR-004**: Source-tree execution MUST default to an isolated runtime profile
  and MUST NOT mutate the stable runtime's default pid/log/state/store artifacts
  unless an explicit takeover flow is invoked.
- **FR-005**: The system MUST persist one canonical fixed-owner claim that
  states which owner is expected to hold the fixed URL at the current moment.
- **FR-005a**: The canonical fixed-owner claim MUST be discoverable from one
  stable control-plane path rather than by guessing the current runtime root.
- **FR-006**: The daemon, API, and plugin runtime artifacts MUST record owner
  metadata sufficient to distinguish stable versus dev owners, runtime root,
  install source, and repo provenance when available.
- **FR-006a**: The owner metadata and/or canonical claim MUST reference a launch
  descriptor that can restart the claimed owner even when the current CLI
  invocation comes from a different install source.
- **FR-007**: `stack ensure`, runtime starts, and runtime ensures MUST respect
  the fixed-owner claim for canonical ports and MUST fail fast or isolate
  themselves instead of silently stealing the fixed URL.
- **FR-007a**: Direct `daemon`, `api`, and `plugin` lifecycle commands that
  target canonical ports MUST obey the same claim policy as `stack`.
- **FR-008**: The system MUST provide one explicit takeover/reclaim flow that
  can transfer the fixed-owner claim between `stable` and `dev` deterministically.
- **FR-008a**: The fixed-owner transfer bundle MUST include daemon, API, and
  plugin together; the system MUST NOT report a successful owner transfer while
  those services still belong to mixed owners.
- **FR-009**: `doctor --json` and status commands MUST expose fixed-owner claim
  state, live owner state, conflict category, and whether the issue is safely
  repairable.
- **FR-009a**: `config print` and status commands MUST expose effective
  endpoints, resolved local profile, per-service owner/trust/claimed state, and
  the selected repair strategy so operators can tell stable canonical state from
  isolated dev state at a glance.
- **FR-010**: `doctor --fix` MUST automatically repair stale or deterministic
  ownership issues when the expected owner is clear from trusted metadata and
  the repair does not require guessing user intent.
- **FR-011**: `doctor --fix` MUST NOT kill or replace an ambiguous live owner
  when trusted metadata is insufficient to prove the correct transfer target.
- **FR-012**: `config print` MUST surface the resolved runtime profile, runtime
  root, canonical fixed-owner claim, and the default artifact locations derived
  from that resolution.
- **FR-012a**: Stable migration semantics MUST preserve the current stable user
  data root and existing `config.json`, `store.sqlite`, workspace bindings, and
  runtime artifacts unless an explicit migration step says otherwise.
- **FR-012b**: The isolated dev profile MUST define an explicit bootstrap
  strategy for config and workspace bindings that avoids silent full-store
  copying while still keeping local debugging usable.
- **FR-013**: Repository docs, local runbooks, and repo-local agent guidance
  MUST explain the stable-owner default, isolated dev default, and explicit
  takeover workflow together.

### Non-Functional Requirements

- **NFR-001**: Ownership metadata, fixed-owner claim state, and repair outcomes
  MUST be machine-readable and stable across `doctor --json`, `stack status`,
  `daemon status`, `api status`, and `plugin status`.
- **NFR-002**: The feature MUST preserve the existing non-destructive default:
  automatic repairs are limited to stale artifacts, canonical config rewrites,
  and deterministic owner realignment backed by trusted metadata.
- **NFR-003**: All user-visible CLI strings, status fields, and repair messages
  introduced by this feature MUST remain English.
- **NFR-004**: All new paths MUST follow the existing cross-platform path rules:
  `node:os` + `node:path`, `~` expansion for user input, and normalized stored
  paths.
- **NFR-005**: The fixed-owner claim and runtime owner identifiers MUST be
  deterministic, comparable across processes, and suitable for doctor/status
  diffing.
- **NFR-006**: The feature MUST not introduce a second truth source for runtime
  ownership; one canonical claim drives the expected fixed owner, and live
  runtime metadata only reports observed state.
- **NFR-007**: If a takeover changes plugin asset ownership in a way that
  requires a RemNote reload, the command result MUST report that requirement
  explicitly instead of assuming visibility has changed already.

### Key Entities

- **Runtime Profile**: The resolved execution profile for one invocation, such as
  stable or isolated dev, including its runtime root and default port class.
- **Runtime Owner**: The identity attached to one live daemon/api/plugin set,
  including owner channel, install source, runtime root, worktree provenance,
  and launch descriptor.
- **Fixed Owner Claim**: The canonical persisted statement of which owner is
  expected to hold the fixed RemNote URL and canonical ports.
- **Owner Launcher**: The durable description of how the target owner should be
  relaunched, even from another invocation context.
- **Control-Plane Root**: The stable global root that stores cross-profile
  control data such as config and the fixed-owner claim.
- **Ownership Conflict**: A mismatch between the fixed-owner claim and the live
  runtime metadata, or between multiple live services that disagree on owner.
- **Repair Decision**: The structured result that explains whether an ownership
  conflict is auto-fixable, skipped, or requires manual takeover.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a machine that has both the published install and the source
  repository, the fixed URL resolves to exactly one declared owner in all normal
  status surfaces.
- **SC-002**: Running source-tree lifecycle commands without explicit takeover
  leaves the stable runtime artifacts and fixed-owner claim unchanged.
- **SC-003**: An explicit transfer of the fixed-owner claim from `stable` to
  `dev` and back to `stable` can be completed without manual pid/state cleanup.
- **SC-004**: `doctor --json` reports fixed-owner claim metadata, live owner
  metadata, and repairability for daemon/api/plugin conflicts in a stable
  machine-readable form.
- **SC-005**: `doctor --fix` can repair deterministic stale or mismatched owner
  states in contract tests without touching `remnote.db`, queue contents, or
  user-authored data.
- **SC-006**: The planning and final implementation docs explain the stable
  owner default, isolated dev default, and takeover workflow with no drift
  across SSoT, README docs, and repo-local agent guidance.
- **SC-007**: One automated verification path exercises packed install plus
  source-tree coexistence, isolated dev startup, dev takeover, stable reclaim,
  and published-launcher resolution without relying only on manual host checks.
