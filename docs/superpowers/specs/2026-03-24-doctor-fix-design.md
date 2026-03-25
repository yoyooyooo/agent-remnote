# Doctor Fix Design

## Goal

Add a safe `doctor --fix` repair path for runtime/process drift, config migration, packaged release integrity, and environment readiness, while also fixing the packaged builtin-scenarios path bug and the `search --json` stdout pollution bug.

## Scope

- Add `doctor --fix` with a safe default repair boundary
- Keep `doctor` as the single diagnostics entrypoint
- Detect and repair stale runtime pid/state artifacts
- Detect and migrate supported config shapes into canonical user config
- Detect packaged release layout problems and surface stable repairability
- Fix packaged builtin-scenarios path resolution
- Fix `search --json` so stdout stays a single JSON envelope
- Update README, README.zh-CN, SSoT, and feature specs
- Run a 5-reviewer evaluation loop after implementation and keep iterating until all reviewers approve

## Non-Goals

- No direct edits to `remnote.db`
- No queue deletion or mutation beyond existing command-managed lifecycle
- No automatic RemNote desktop reload in default `doctor --fix`
- No destructive cleanup of user content or backups

## Command Shape

`agent-remnote doctor [--fix] [--json]`

Semantics:

1. `doctor`
   - Collect structured checks
   - Return diagnostics only
2. `doctor --fix`
   - Collect checks
   - Apply safe repairs
   - Re-run checks
   - Return before/after evidence and unresolved items

## Check Families

Stable check ids for the first iteration:

- `runtime.stale_pid_or_state`
- `runtime.version_mismatch`
- `config.migration_needed`
- `package.builtin_scenarios_broken`
- `package.plugin_artifacts_unavailable`
- `env.path_or_permission_problem`

Each check must include:

- `id`
- `ok`
- `severity`
- `summary`
- `details`
- `repairable`
- `fixed`

## Fix Boundary

Safe default repairs:

- Remove stale daemon/api/plugin pid or state files when the referenced process is no longer alive
- Restart trusted live daemon/api/plugin runtimes when their build metadata is mismatched and ownership can be proven safely
- Normalize and rewrite supported config keys into canonical user config
- Repair packaged builtin-scenarios resolution when the installed package layout is valid but the runtime locator is wrong
- Report `restart_summary`, including restarted, skipped, and failed runtime actions

Diagnostics only:

- `remnote.db` structure
- queue contents
- user content
- desktop app reload

## Implementation Shape

- Extract doctor check/fix logic into reusable library code
- Keep command file thin
- Reuse existing lifecycle commands/services for restart and file cleanup
- Add packaged layout resolution that works in source and installed npm layouts
- Patch the CLI JSON/help interaction so `--json` commands never emit help text to stdout on success

## Verification

Minimum verification:

- contract tests for `doctor --fix`
- contract tests for packaged builtin-scenarios resolution
- contract tests for `search --json` stdout purity
- targeted unit tests for config migration helpers
- full `npm test --workspace agent-remnote`

## Review Gate

After implementation and local verification, run 5 parallel reviewer subagents covering:

1. CLI contract and UX
2. Runtime/process safety
3. Config migration correctness
4. Packaging/release integrity
5. Test and docs completeness

Main agent aggregates findings, applies fixes, and repeats until all five reviewers approve.
