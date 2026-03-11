# Data Model: 020-agent-cli-contract

## Overview

This feature is contract-heavy. The primary "entities" are public request/command shapes rather than business records.

## Apply Envelope V1

Canonical machine write request shared by CLI and Host API.

### Fields

- `version`: integer
  - initial value: `1`
- `kind`: string
  - allowed values:
    - `actions`
    - `ops`
- `actions`: array of Action Requests
  - required when `kind="actions"`
- `ops`: array of Raw Op Requests
  - required when `kind="ops"`
- execution metadata at envelope scope
  - `priority`
  - `client_id`
  - `idempotency_key`
  - `meta`
  - `notify`
  - `ensure_daemon`
  - `wait`
  - `timeout_ms`
  - `poll_ms`

### Invariants

- `actions` and `ops` are mutually exclusive at the public envelope level.
- empty `actions` or `ops` arrays are invalid.
- envelope metadata applies uniformly regardless of `kind`.

## Action Request

Structured, agent-oriented write item inside `kind="actions"`.

### Fields

- `action`: string
- `input`: object
- `as`: optional alias for later action references in the same envelope

### Initial Public Action Family

- `rem.children.append`
- `rem.children.prepend`
- `rem.children.replace`
- `rem.children.clear`
- `daily.write`

### Invariants

- Action names stay semantically aligned with high-level CLI commands.
- Action input uses canonical field names and does not embed shell-only input conventions.
- Markdown in JSON payloads is always a literal string, not an `@file` or `-` indirection.

## Raw Op Request

Low-level advanced/debug item inside `kind="ops"`.

### Fields

- `type`
- `payload`
- optional op-scoped metadata already supported by the queue pipeline

### Invariants

- Raw ops remain available, but they no longer own a separate public command family or Host API route.

## Markdown Input Spec

CLI-only content locator used by `--markdown <input-spec>`.

### Allowed Forms

- inline string
- `@file`
- `-`

### Invariants

- The Markdown input spec exists only at the CLI layer.
- Once parsed, downstream layers receive a plain Markdown string.
- `--markdown` is required for Markdown-taking commands in scope.

## Children Write Command

High-frequency wrapper command targeting the direct children of one Rem.

### Public Variants

- `append`
- `prepend`
- `replace`
- `clear`

### Fields

- target Rem identity
- action kind
- Markdown string for append/prepend/replace

### Invariants

- The scope is direct children only.
- `clear` never deletes the target Rem itself.
- `replace` never changes the target Rem's own text.

## Canonical Host API Write Route

Shared HTTP write front door aligned with Apply Envelope V1.

### Fields

- same envelope body as CLI `apply --payload`

### Invariants

- There is only one public write route for structured and raw writes.
- Markdown-specific and ops-specific write routes are removed.

## Removed Public Surface

The following are intentionally removed from the public contract:

- `import` command group
- `import markdown`
- `import wechat outline`
- `plan apply`
- markdown-specific Host API write route
- ops-specific Host API write route
- split Markdown content flags in commands covered by this feature
