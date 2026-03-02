---
name: remnote
description: Use agent-remnote to read RemNote locally and write safely via queue+plugin (no direct DB writes).
---

# RemNote (agent-remnote)

## Safety boundaries (non-negotiable)

- Never modify RemNote’s official database (`remnote.db`) directly (read-only access is OK).
- All writes MUST go through: queue → WS bridge (daemon) → RemNote plugin executor (official SDK).
- For write retries, always pass a stable `--idempotency-key` to avoid duplicate Rems.

## Default workflow (recommended)

### Read: prefer fast candidates, always keep deterministic fallback

1) Fast candidates (requires an active RemNote window + plugin):

```bash
agent-remnote --json plugin search --query "..." --timeout-ms 3000
```

2) Deterministic fallback (read-only DB Pull, no plugin needed):

```bash
agent-remnote --json search --query "..." --timeout-ms 30000
```

### Write: enqueue by default, wait only when needed

- Prefer enqueue-only writes (avoid blocking in backlog scenarios).
- Use `--wait` only when the workflow requires synchronous confirmation (or user explicitly asks).
- Multi-line Markdown inputs often include accidental leading/trailing blank lines (from heredocs / clipboard). `import markdown` trims boundary blank lines by default to avoid creating empty Rems.
- For a smoother “one-shot insert” (less UI waterfall flicker), add `--staged` to `import markdown` (imports under a temporary container, then moves roots into place once).

### Backlinks (must use write paths that parse reference tokens)

- Supported backlink input syntaxes: `((<remId>))` and `{ref:<remId>}`.
- For single Rem updates, prefer `rem set-text` (compat alias: `rem text`).
- Avoid `replace text` for backlink creation; it can leave literal text instead of real references on rich-text Rems.

Example:

```bash
agent-remnote --json rem set-text --rem "<remId>" --text "see also {ref:<targetRemId>}" --wait
agent-remnote --json rem inspect --id "<remId>" --expand-references
```

One-shot verified write (recommended for zero-context agents):

```bash
node scripts/remnote-set-text-verify-ref.mjs \
  --rem "<remId>" \
  --text "see also {ref:<targetRemId>}" \
  --timeout-ms 60000 \
  --poll-ms 1000
```

Example:

```bash
agent-remnote --json import markdown --ref "page:Inbox" --file ./note.md --idempotency-key "inbox:note:2026-01-26"
agent-remnote --json queue wait --txn "<txn_id>"
```

## Troubleshooting (shortest path)

1) `agent-remnote --json doctor`
2) `agent-remnote --json daemon status`
3) If Plugin RPC fails / no `activeWorkerConnId`: click inside the target RemNote window and re-check status.

## Common recipe: summarize current selection into the current page (top)

1) Read current page + selection (plugin snapshot required):

```bash
PRID="$(agent-remnote --ids plugin ui-context page)"
agent-remnote plugin selection outline --max-depth 10 --max-nodes 1000 --exclude-properties
```

2) After you have the summary Markdown, insert it at the top (single op):

```bash
cat <<'MD' | agent-remnote --json import markdown --parent "$PRID" --stdin --bulk never --position 0 --wait
- Summary (selected Rems)
  - ...
MD
```
