# Spec

## Title

Doctor Fix And Runtime Self-Heal

## Problem

Current diagnostics stop at read-only reporting while common failure modes still require manual cleanup. Recent release validation also exposed two product defects:

- installed npm packages can fail before startup because builtin scenario paths are resolved against a source-tree layout
- `search --json` can emit help text on stdout, breaking machine consumers

## Requirements

1. Add `doctor --fix` as a safe repair mode under the existing `doctor` command.
2. `doctor --fix` must only perform safe repairs:
   - stale pid/state cleanup
   - supported config migration/normalization
   - packaged resource self-check and stable repairability reporting
   - restart reporting without automatically restarting background services
3. `doctor --fix` must not mutate queue contents, `remnote.db`, or user content.
4. `doctor --json` must expose stable structured checks and fix results.
5. Installed npm package layout must support builtin scenario loading without source-tree assumptions.
6. `search --json` must emit exactly one JSON envelope to stdout on success.
7. README, localized README, SSoT, and feature docs must be updated together.

## Acceptance

- `doctor --fix` cleans stale runtime artifacts in tests and reports the repair
- builtin scenario loading works in a simulated installed package layout
- `search --json` stdout contains only one JSON object
- local test suite passes

## Non-Goals

- No automatic RemNote desktop restart
- No destructive repair of queue or content data
