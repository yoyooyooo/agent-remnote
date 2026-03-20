# CLI Contract: 027-portal-outline-observability

## Canonical Verification Entry

```bash
agent-remnote rem outline (--id <id> | --ref <ref>) --depth <n> --format md|json
```

## Typed Node Contract

Machine-readable output MUST use this schema:

```json
{
  "id": "string",
  "depth": 0,
  "kind": "rem",
  "text": "visible text or empty string",
  "target": null
}
```

Required fields:

- `id: string`
- `depth: number`
- `kind: "rem" | "portal"`
- `text: string`
- `target: TargetMetadata | null`

## Target Metadata Contract

When present, `target` MUST use this schema:

```json
{
  "id": "string",
  "text": "string or null",
  "resolved": true
}
```

Rules:

- non-target-bearing nodes MUST return `target: null`
- target-bearing nodes MUST return a `target` object
- `resolved` is required and indicates whether `text` was resolved successfully
- `text` MAY be `null` when the target exists logically but its label cannot be resolved

## Surface Discipline

- This feature MUST NOT add selector aliases
- This feature MUST NOT add workflow-specific verification commands
- The upgrade is limited to typed node schema and optional target metadata

## Remote Parity

If outline is exposed through Host API, local and remote output MUST use identical typed-node and target-metadata semantics.
