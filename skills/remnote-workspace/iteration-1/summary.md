# Iteration 1 Summary

## Goal

Use one full `skill-creator`-style upgrade round to improve `skills/remnote/SKILL.md`, with focus on the `scenario` surface:

- decide whether `scenario` should become a separate skill or a separate document narrative
- reduce main-skill sprawl
- improve agent guidance for `source_scope` / `target_ref` / planned `scenario` routing

## Decision

Keep a single `remnote` skill.

Do not split `scenario` into a second skill yet.

Reason:

- `scenario` is still a RemNote-specific planned / experimental surface
- a second skill would create trigger competition between "generic remnote" and "remnote scenario"
- the higher-value change is progressive disclosure: keep routing in `SKILL.md`, move details into a dedicated reference

## Changes Applied

1. Added `skills/remnote/references/scenario-surface.md`
   - standalone narrative for builtin/user-store routing
   - help-first flow
   - scope literal table
   - builtin dry-run pattern
2. Replaced the long inline `Scenario Files` section in `skills/remnote/SKILL.md`
   - main skill now has a short `Scenario Router`
   - the router explicitly tells the model when to read `references/scenario-surface.md`
3. Strengthened scenario-trigger coverage in `SKILL.md` frontmatter description
4. Added 3 scenario-focused behavior eval prompts
   - builtin move dry-run
   - user file explain under `apiBaseUrl`
   - builtin portal dry-run
5. Added trigger-eval coverage for scenario phrasing and one near-miss negative case

## Size Impact

- `skills/remnote/SKILL.md`: 829 lines -> 779 lines
- `skills/remnote/references/scenario-surface.md`: 98 lines

Main skill is still large. This round only extracted the `scenario` narrative. The next best split candidate is the remote capability matrix.

## Behavior Evals

Compared:

- `old_skill`: snapshot before scenario-reference split
- `with_skill`: current skill after the split

### Eval 16: builtin move dry-run

- Prompt: recover vars/defaults for `dn_recent_todos_to_today_move`, then produce a dry-run command for past 3 days
- Result:
  - `old_skill`: pass
  - `with_skill`: pass
- Notes:
  - both versions used `source_scope=daily:past-3d`
  - both avoided retired `daily:previous-*`
  - `with_skill` was more explicit about planned-surface gating

### Eval 17: user file explain

- Prompt: explain vars for `~/.agent-remnote/scenarios/recent-review.json` under `apiBaseUrl`
- Result:
  - `old_skill`: pass
  - `with_skill`: pass
- Notes:
  - both versions correctly kept `scenario schema explain` local
  - `with_skill` was shorter and more direct

### Eval 18: builtin portal dry-run

- Prompt: recover the portal variant and produce a dry-run route for past 2 days
- Result:
  - `old_skill`: pass
  - `with_skill`: pass
- Notes:
  - both versions avoided guessing extra vars
  - `with_skill` more strongly pushed `schema explain` before `scenario run`

## Qualitative Findings

### What improved

- The scenario narrative is now discoverable on demand rather than embedded in the middle of an 800-line skill body.
- The main skill has a clearer "router vs detail" separation.
- Scenario answers became more procedural:
  - help first
  - inspect vars
  - dry-run before write

### Regression found during eval

The first post-split runs sometimes surfaced internal file-path citations such as `SKILL.md` / `scenario-surface.md` in the final user-facing answer, and one answer used `@~/.agent-remnote/...` in an example path.

Patched after eval:

- added guidance to avoid surfacing internal reference paths in normal answers
- added guidance to prefer `@$HOME/...` or normalized absolute paths in file-spec examples

The micro-rerun for these patches was started, but not all long-running Codex eval jobs had fully completed by the time this summary was written.

## Recommendation

Keep the single `remnote` skill.

Keep `scenario` as a separate reference document inside the same skill.

Do not create a dedicated `remnote-scenario` skill yet.

## Next Round Candidates

1. Extract the remote capability matrix into its own reference
2. Add explicit "do not cite internal skill/reference files unless asked" guidance to more surfaces, not just scenario
3. Add one eval that checks whether the answer stays concise when the user only wants "the final dry-run command"
