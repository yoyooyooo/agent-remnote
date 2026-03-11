# HTTP API Contract: 020-agent-cli-contract

## Canonical Write Route

Current canonical route:

```http
POST /v1/write/apply
```

This route accepts the same apply envelope used by CLI `apply --payload`.

When callers need completion confirmation, the same request body may also include:

- `wait: true`
- `timeoutMs`
- `pollMs`

All timeout and polling values are expressed in milliseconds.

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
      "type": "create_rem",
      "payload": {
        "parent_id": "demo-parent-id",
        "text": "demo content"
      }
    }
  ]
}
```

## Wait Semantics

- Default behavior is enqueue-only.
- When `wait: true` is present, the API blocks until the transaction reaches a terminal state.
- `timeoutMs` and `pollMs` follow the same semantics as CLI `--timeout-ms` and `--poll-ms`.
- Timeout and terminal-state failures return the normal error envelope with deterministic error codes.

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
