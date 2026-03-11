# Research: 020-agent-cli-contract

Date: 2026-03-11  
Spec: `specs/020-agent-cli-contract/spec.md`

## Decision 1: Canonical write entry stays at `apply --payload`

### Chosen

- Keep `apply --payload <json|@file|->` as the single canonical public write entry.
- Fold former `plan apply` semantics into `apply` through one envelope with `kind: "actions" | "ops"`.

### Rationale

- Agent callers benefit more from one stable JSON contract than from multiple specialized JSON entrypoints.
- Existing `apply` already owns queue enqueue semantics, idempotency-related flags, and remote-mode routing.
- A single canonical JSON entry avoids split documentation and split Host API routing.

### Alternatives Considered

#### Alternative A: Keep `apply` for raw ops and `plan apply` for actions

- Rejected because it keeps two public JSON contracts for one write domain.

#### Alternative B: Make high-level shell commands the canonical contract

- Rejected because shell command names are convenient wrappers, but agent orchestration and remote clients still need one stable machine contract.

## Decision 2: Keep `rem children ...` namespace

### Chosen

- Use:
  - `rem children append`
  - `rem children prepend`
  - `rem children replace`
  - `rem children clear`

### Rationale

- Namespace form is easier for agents to enumerate and map.
- The scope of these commands is explicit: they operate on direct children, not on the Rem text or the Rem subtree delete semantics.
- It leaves room for future siblings under `rem`, while keeping the write family grouped.

### Alternatives Considered

#### Alternative A: `rem append-children` style flat verbs

- Rejected because it is shorter for humans but less composable for machine discovery.

#### Alternative B: plain `rem append/prepend/replace/clear`

- Rejected because `replace` and `clear` are ambiguous at the Rem root level.

## Decision 3: Host API write surface must collapse with CLI

### Chosen

- Replace the dual write routes with one canonical route, planned as `POST /v1/write/apply`.
- The route accepts the same apply envelope used by CLI.

### Rationale

- Remote mode is part of the public contract surface.
- Keeping `/v1/write/markdown` and `/v1/write/ops` would recreate the same write-surface split that the CLI reset is trying to remove.

### Alternatives Considered

#### Alternative A: Keep `/v1/write/ops` and `/v1/write/markdown`

- Rejected because the route split leaks old mental models into remote mode.

#### Alternative B: Keep both old routes and add `/v1/write/apply`

- Rejected because it leaves compatibility residue and raises contract entropy.

## Decision 4: Markdown input uses one CLI flag

### Chosen

- Every Markdown-taking command uses `--markdown <input-spec>`.
- `input-spec` supports:
  - inline string
  - `@file`
  - `-`

### Rationale

- One content flag is easier for agents to template than separate `--file`, `--stdin`, and `--md-file` branches.
- `@file` and `-` already map well onto existing file-input infrastructure.

### Alternatives Considered

#### Alternative A: Keep `--file`, `--stdin`, `--md-file`

- Rejected because it multiplies prompt branches with no meaningful capability gain.

#### Alternative B: Use `--markdown` only for inline content and keep separate file/stdin flags

- Rejected because it still leaves multiple public input shapes.

## Decision 5: No compatibility aliases for removed entrypoints

### Chosen

- Remove old public entrypoints outright:
  - `import markdown`
  - `import wechat outline`
  - `plan apply`
  - markdown-specific Host API write route
  - ops-specific Host API write route

### Rationale

- The repository is explicitly forward-only.
- Any long-lived alias would keep obsolete command names visible in help, docs, and agent prompts.

### Alternatives Considered

#### Alternative A: Keep short-term compatibility aliases

- Rejected because this feature is specifically about contract entropy reduction.

## Decision 6: Delete WeChat write/import logic in the same wave

### Chosen

- Remove the WeChat-specific command family and its synchronized documentation in the same feature.

### Rationale

- Once `import` is deleted as a public command group, keeping a single source-specific import under that old shape no longer makes sense.
- The user explicitly asked for this logic to be removed rather than migrated.

### Alternatives Considered

#### Alternative A: Keep WeChat as a separate top-level command

- Rejected because it broadens the scope of the new CLI surface for a source-specific path that is no longer wanted.

## Decision 7: Remove duplicate internal command surfaces while implementing

### Chosen

- During implementation, delete or merge stale duplicate write surfaces that only exist to preserve earlier command families, including:
  - `write md` duplication if still separate from the canonical wrappers
  - dedicated `writeMarkdown` / `writeOps` Host API client split
  - stale remote-mode hints that still point to `import markdown`

### Rationale

- Forward-only cleanup is incomplete if old internal branches remain and continue to leak into docs, errors, or tests.
