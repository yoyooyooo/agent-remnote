# Implementation Plan: 020-agent-cli-contract

Date: 2026-03-11  
Spec: `specs/020-agent-cli-contract/spec.md`

## Summary

This feature is a single-wave contract reset for write-related CLI and Host API surfaces.

The implementation goal is to leave exactly one canonical machine write contract and a small set of agent-oriented wrapper commands, while deleting obsolete entrypoints in the same wave:

- canonical JSON write entry: `apply --payload <json|@file|->`
- one apply envelope with `kind: "actions" | "ops"`
- high-frequency wrappers:
  - `rem children append`
  - `rem children prepend`
  - `rem children replace`
  - `rem children clear`
  - `daily write`
- one Host API write route aligned with the same apply envelope
- no compatibility aliases for removed public write entrypoints

## Technical Context

- CLI runtime: TypeScript ESM + `effect` + `@effect/cli`
- Host API runtime: Node HTTP runtime sharing the same queue enqueue pipeline
- Existing write substrate remains unchanged:
  - queue SQLite
  - WS bridge
  - RemNote plugin SDK executor
- Existing remote-mode client already supports Host API reads/writes, but current write routing is split and must be collapsed

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | This feature changes only public command/API contracts above the queue/WS/plugin chain. |
| Forward-only evolution | PASS | Old public commands and routes are removed in the same wave; no compatibility layer is planned. |
| SSoT priority | PASS | This plan includes synchronized updates to SSoT, README, and skill guidance. |
| Budgets and timeout guardrails | PASS | Existing wait/timeout patterns stay in place; removed routes do not change queue execution budgets. |
| Unique consumer and diagnosable identity | PASS | No change to queue/worker concurrency semantics. |
| Cross-platform paths | PASS | `@file` and `-` reuse existing path/input infrastructure. |
| User-visible English output | PASS | No change; new command/API diagnostics remain English. |
| Local verifiability | PASS | Contract tests, help tests, and Host API route tests will be added or updated. |
| Non-destructive defaults | PASS | `rem children clear` remains explicit; no hidden delete behavior is added. |
| Single-purpose state files | PASS | No new state-file multiplexing is introduced. |
| Enforceable boundaries | PASS | Help contracts and route contracts can gate the final surface. |
| Write-first | PASS | Canonical `apply` path and thin wrappers strengthen write-first instead of weakening it. |
| Agent skill sync | PASS | Skill sync is included in the final workstream. |

## Workstream A: Canonical Apply Contract

Goal: collapse all public machine write flows onto one apply envelope.

Deliverables:

- `apply --payload` accepts:
  - `kind: "actions"`
  - `kind: "ops"`
- former `plan apply` semantics are re-expressed as `kind: "actions"`
- shared parser/normalizer/compiler path exists for:
  - CLI `apply`
  - Host API apply route
  - high-level wrapper commands

Key changes:

- merge plan-oriented action compilation into the canonical apply pipeline
- keep raw ops as the advanced/debug branch under the same envelope
- remove the public `plan` write path from command routing and docs

## Workstream B: High-Level Wrapper Surface

Goal: expose a small public wrapper family for high-frequency writes while keeping the wrapper layer thin.

Deliverables:

- `rem children append`
- `rem children prepend`
- `rem children replace`
- `rem children clear`
- `daily write --markdown <input-spec>`
- `daily write --text <literal>`

Key changes:

- direct-children commands compile into the canonical apply contract
- `replace` and `clear` semantics stay distinct from:
  - `rem delete`
  - `rem set-text`
- stale duplicate Markdown entrypoints are deleted instead of rewrapped

## Workstream C: Markdown Input Contract Unification

Goal: make Markdown input shape identical across all public commands in scope.

Deliverables:

- one CLI flag: `--markdown <input-spec>`
- one grammar for `input-spec`:
  - inline string
  - `@file`
  - `-`

Key changes:

- remove public `--file`
- remove public `--stdin`
- remove public `--md-file`
- update all in-scope error hints and examples to the new convention

## Workstream D: Host API and Remote Mode Alignment

Goal: make remote mode semantically identical to local CLI contract shape.

Deliverables:

- one canonical Host API write route, planned as `POST /v1/write/apply`
- shared apply envelope for CLI and HTTP callers
- remote-mode wrapper commands compile locally and submit through the canonical apply route

Key changes:

- delete `POST /v1/write/markdown`
- delete `POST /v1/write/ops`
- collapse `HostApiClient.writeMarkdown` and `HostApiClient.writeOps` into one write method
- remove stale remote-mode hints that still tell users to use `import markdown`

## Workstream E: Obsolete Surface Deletion

Goal: remove all directly related obsolete command and API surfaces in the same wave.

Deliverables:

- delete public `import` command group
- delete `import markdown`
- delete `import wechat outline`
- delete WeChat-specific CLI logic and synced docs
- remove stale write-command duplicates that only served old command families

Guardrail:

- no alias layer
- no soft deprecation window
- no hidden fallback route

## Workstream F: Docs, Tests, and Skill Sync

Goal: keep public contract artifacts in lockstep with the new surface.

Deliverables:

- SSoT updates:
  - `docs/ssot/agent-remnote/tools-write.md`
  - `docs/ssot/agent-remnote/http-api-contract.md`
  - any related CLI contract docs
- README updates:
  - `README.md`
  - `README.zh-CN.md`
  - `README.local.md`
- skill sync:
  - `~/.codex/skills/remnote/SKILL.md`
- contract tests:
  - CLI help surface
  - apply envelope shape
  - Host API route surface
  - removed command and removed route fail-fast behavior

## Implementation Order

1. canonical apply envelope and shared compiler path
2. Host API write-route collapse
3. high-level wrapper commands
4. Markdown input unification
5. deletion sweep for obsolete command/API logic
6. docs, skill, and contract-test sync

## Complexity Tracking

- No compatibility layer is permitted.
- If implementation reveals a hard blocker that would normally suggest a temporary alias, the correct response is to change all callers in the same wave, not to add a compatibility shim.
