# Notes (Working Memory)

## Scope

- Covers the execution-facing reasoning for fixed-owner claim, runtime-root
  derivation, source-vs-published isolation, and stack/doctor ownership
  behavior.
- Does not replace `spec.md`, `plan.md`, or SSoT. Any durable contract belongs
  in those documents, not here.

## Entry Points

- `entrypoints.md`

## Current Status

- Focus: freeze the ownership model before implementing runtime changes
- Phase:
  - [x] Rehydrate / Align
  - [x] Explore / Locate
  - [x] Decide / Sync SSoT
  - [ ] Implement / Verify

## Current Hypothesis

- The real conflict is not “too many ports”, but “no durable owner for the
  fixed URL”.
- Stable published install should remain the default fixed owner.
- Source-tree execution should default to isolated runtime roots and isolated
  ports.
- `launcher_ref` is required, otherwise stable cannot be relaunched from dev.
- claim discovery must live under a global control-plane path, not a profile root.
- `doctor --fix` should repair toward the canonical claim, not guess user
  intent.
- Explicit transfer belongs under `stack`, not under `doctor`.

## Errors Encountered

- 2026-03-28 16:03 — current repository worktree was on an older feature branch
  with unrelated modifications → created a fresh worktree from `origin/master`
  before writing 033 artifacts.

## Next Actions

- Run multi-perspective review on the 033 doc set and resolve disagreements.
- Keep command surface minimal while still making daemon + api + plugin one
  fixed-owner bundle.
- Only move to implementation after `launcher_ref`, control-plane claim path,
  migration semantics, and packed-vs-source verification are all locked.

## Last Flush

- At: 2026-03-28 16:12
- Intent: lock a fixed-owner runtime model that preserves one constant RemNote
  URL without stable/dev collisions
- Session: `sessions/2026-03-28.md` (not created yet)
