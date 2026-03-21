# CLI Contract: 029-write-command-surface-reset

## Goal

把 Rem graph / portal 写命令统一成 `subject / from / to / at / portal` 五轴。

## Shared Value Grammar

### Ref Value

```text
<ref> :=
  id:<remId>
  | page:<pageTitle>
  | title:<searchTitle>
  | daily:<offset>
  | remnote://...
```

### Placement Spec

```text
<at> :=
  standalone
  | parent:<ref>
  | parent[<position>]:<ref>
  | before:<ref>
  | after:<ref>
```

### Portal Strategy

```text
<portal> :=
  in-place
  | at:<at>
```

Additional rule:

- `at:standalone` is invalid for portal strategy because a portal itself cannot be standalone

## `rem create`

### Syntax

```bash
agent-remnote rem create \
  (--text <text> | --markdown <input-spec> | --from <ref>... | --from-selection) \
  --at <placement-spec> \
  [--title <text>] \
  [--portal <portal-strategy>] \
  [--is-document] \
  [--tag <ref>...]
```

### Source Rules

Exactly one:

- `--text`
- `--markdown`
- repeated `--from`
- `--from-selection`

Title rules:

- `--markdown` without `--title` -> `INVALID_ARGS`
- repeated `--from` with multiple refs and no `--title` -> `INVALID_ARGS`
- single `--from` MAY infer title from the source Rem text
- `--from-selection` resolving to multiple roots and no `--title` -> `INVALID_ARGS`
- single-root `--from-selection` MAY infer title from the selected root text
- `--text` without `--title` uses the text as destination title
- `--text` with `--title` means title = destination title and text = first body child

### Placement Rules

- `--at` is required
- accepted values are defined by `<at>`
- malformed placement spec -> `INVALID_ARGS`

### Portal Rules

- `--portal` is optional
- accepted values are defined by `<portal>`
- `--portal in-place` is valid with:
  - `--from-selection`
  - repeated `--from` that resolve to one contiguous sibling range under one parent
- `--portal in-place` with `--text` or `--markdown` -> `INVALID_ARGS`
- `--portal in-place` with repeated `--from` that do not resolve to one contiguous sibling range -> `INVALID_ARGS`
- `--portal at:standalone` -> `INVALID_ARGS`

### Semantics

- repeated `--from` means "use existing Rems as source and move them under the new destination"
- repeated `--from` moves source Rems; it does not copy them
- `--from-selection` means "resolve the current contiguous sibling selection as the source set"
- `--at standalone` means "create a destination whose parent is null"
- `--portal in-place` means "replace the original source slot or contiguous source range with a portal to the durable destination"
- for repeated explicit `--from`, contiguous is evaluated against the local direct-sibling order from hierarchy metadata
- for repeated explicit `--from`, execution order and resulting child order are normalized to the original sibling order, not the CLI argument order

## `rem move`

### Syntax

```bash
agent-remnote rem move \
  --subject <ref> \
  --at <placement-spec> \
  [--portal <portal-strategy>] \
  [--is-document]
```

### Rules

- `--subject` is required
- `--at` is required
- `--portal in-place` is valid and means "leave a portal at the original location"
- `--portal at:standalone` -> `INVALID_ARGS`
- malformed `--at` / `--portal` values -> `INVALID_ARGS`

### Semantics

- `--subject` identifies the existing durable subject being moved
- `--at` identifies the new location
- `--portal in-place` maps to the existing in-place portal retention behavior
- for same-parent reordering flows, "in-place" refers to the subject's pre-move slot

## `portal create`

### Syntax

```bash
agent-remnote portal create \
  --to <ref> \
  --at <placement-spec>
```

### Rules

- `--to` is required and identifies the Rem that the portal should point to
- `--at` is required and identifies where the portal itself should be inserted
- `--at standalone` is invalid -> `INVALID_ARGS`
- portal create does not accept `--portal`
- portal create does not accept `--from`

### Semantics

- `--to` identifies the target Rem that the portal should point to
- `--at` identifies where the portal itself should be inserted

## Single-Subject Rem Writes

The following commands move to `--subject`:

- `rem set-text`
- `rem delete`
- `rem children append`
- `rem children prepend`
- `rem children clear`
- `rem children replace`
- `rem replace`

Where selection remains a valid alternate target mode, `--selection` may remain, but explicit Rem targeting uses `--subject`.

## Removed Flags

The following names are removed by `029`:

- `--rem`
- write-command-level `--ref`
- repeated `--target` as create-source
- portal-create `--target`
- `--parent`
- `--before`
- `--after`
- `--standalone`
- `--portal-parent`
- `--portal-before`
- `--portal-after`
- `--leave-portal`
- `--leave-portal-in-place`

All of the above must fail fast and be covered by contract tests.

## Receipt Expectations

`rem create` / `rem move` receipts keep the `028` durable-target and portal diagnostics model:

- `txn_id`
- `op_ids`
- `durable_target`
- `portal`
- `source_context`
- `warnings?`
- `nextActions?`

What changes is only the public command contract.
