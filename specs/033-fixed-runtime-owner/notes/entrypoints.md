# Entry Points

## Specs (SSoT)

- `../spec.md`
- `../plan.md`
- `../research.md`
- `../data-model.md`
- `../contracts/runtime-ownership.md`
- `../tasks.md`

## Code Entry Points (Files / Symbols)

- `packages/agent-remnote/src/services/Config.ts` — current root of default path
  and port resolution; must be upgraded to runtime profile/root resolution
- `packages/agent-remnote/src/services/DaemonFiles.ts` — current canonical
  daemon pid/log defaults still hardcode `~/.agent-remnote`
- `packages/agent-remnote/src/services/ApiDaemonFiles.ts` — same problem for API
  runtime artifacts
- `packages/agent-remnote/src/services/PluginServerFiles.ts` — same problem for
  plugin runtime artifacts
- `packages/agent-remnote/src/lib/pidTrust.ts` — currently trusts “agent-remnote
  enough”; must evolve to ownership-aware trust
- `packages/agent-remnote/src/lib/doctor/checks.ts` — current home for runtime
  mismatch/stale artifact diagnostics
- `packages/agent-remnote/src/lib/doctor/fixes.ts` — current home for safe
  repair logic
- `packages/agent-remnote/src/commands/stack/ensure.ts` — lifecycle entry point
  that will need to respect the fixed-owner claim
- `packages/agent-remnote/src/commands/stack/status.ts` — best top-level place
  to surface claim/live ownership state
- `packages/agent-remnote/src/commands/ws/_shared.ts` — current daemon start and
  ensure logic
- `packages/agent-remnote/src/commands/api/_shared.ts` — current API start and
  ensure logic
- `packages/agent-remnote/src/commands/plugin/_shared.ts` — current plugin start
  and ensure logic
