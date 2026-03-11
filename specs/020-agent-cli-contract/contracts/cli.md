# CLI Contract: 020-agent-cli-contract

## Canonical Public Write Entry

```bash
agent-remnote apply --payload <json|@file|->
```

### Canonical Envelope

```json
{
  "version": 1,
  "kind": "actions",
  "actions": []
}
```

or

```json
{
  "version": 1,
  "kind": "ops",
  "ops": []
}
```

## High-Frequency Wrapper Commands

### `rem children append`

```bash
agent-remnote rem children append --rem <rid> --markdown <input-spec>
```

Semantics:

- append a Markdown tree to the target Rem's direct children tail

### `rem children prepend`

```bash
agent-remnote rem children prepend --rem <rid> --markdown <input-spec>
```

Semantics:

- insert a Markdown tree at the head of the target Rem's direct children

### `rem children replace`

```bash
agent-remnote rem children replace --rem <rid> --markdown <input-spec>
```

Semantics:

- replace the target Rem's direct children with a Markdown tree

### `rem children clear`

```bash
agent-remnote rem children clear --rem <rid>
```

Semantics:

- clear direct children only
- never delete the target Rem

### `daily write`

```bash
agent-remnote daily write --markdown <input-spec>
agent-remnote daily write --text <literal>
```

Semantics:

- `--markdown` is the structured-content path
- `--text` is the literal-text path

## Markdown Input Contract

All Markdown-taking commands in scope use:

```bash
--markdown <input-spec>
```

### `input-spec` forms

- inline string
- `@file`
- `-`

### Examples

Inline:

```bash
agent-remnote rem children append --rem <rid> --markdown $'- topic\n  - point'
```

File:

```bash
agent-remnote rem children replace --rem <rid> --markdown @./note.md
```

stdin / heredoc:

```bash
agent-remnote rem children replace --rem <rid> --markdown - <<'MD'
- topic
  - point
MD
```

## `apply` Actions Example

```json
{
  "version": 1,
  "kind": "actions",
  "actions": [
    {
      "action": "rem.children.replace",
      "input": {
        "rem_id": "abc",
        "markdown": "- a\n  - b"
      }
    }
  ]
}
```

## `apply` Raw Ops Example

```json
{
  "version": 1,
  "kind": "ops",
  "ops": [
    {
      "type": "delete_rem",
      "payload": {
        "rem_id": "abc"
      }
    }
  ]
}
```

## Removed Public Commands

The following names are removed from the public CLI contract:

- `import`
- `import markdown`
- `import wechat outline`
- `plan apply`

## Fail-Fast Expectations

- Markdown-taking commands fail with `INVALID_ARGS` when `--markdown` is missing.
- `--markdown -` fails with a stable input error when stdin is not piped.
- Removed command names fail fast instead of delegating to a compatibility path.
