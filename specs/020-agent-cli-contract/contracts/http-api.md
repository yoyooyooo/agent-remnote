# HTTP API Contract: 020-agent-cli-contract

## Canonical Write Route

Planned canonical route:

```http
POST /v1/write/apply
```

This route accepts the same apply envelope used by CLI `apply --payload`.

## Request Shapes

### Structured Actions

```json
{
  "version": 1,
  "kind": "actions",
  "actions": [
    {
      "action": "rem.children.append",
      "input": {
        "rem_id": "abc",
        "markdown": "- hello"
      }
    }
  ]
}
```

### Raw Ops

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

## Response Envelope

Success:

```json
{
  "ok": true,
  "data": {
    "txn_id": "txn_xxx",
    "op_ids": ["op_1"]
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PAYLOAD",
    "message": "Invalid apply envelope"
  }
}
```

## Remote Mode Binding

In remote mode, high-level CLI commands in scope compile locally to the canonical apply envelope and submit it through the canonical write route.

In scope:

- `apply`
- `rem children append`
- `rem children prepend`
- `rem children replace`
- `rem children clear`
- `daily write`

## Removed Public Routes

The following routes are removed from the public Host API contract:

- `POST /v1/write/ops`
- `POST /v1/write/markdown`

## Fail-Fast Expectations

- Requests with unknown `kind` fail with a stable payload error.
- Requests with empty `actions` or `ops` fail with a stable payload error.
- Removed write routes are no longer documented and should fail fast if hit.
