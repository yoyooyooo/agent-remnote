# Iteration 5 Summary

## Goal

Run Codex-based behavior evals with **explicit skill injection** and **no command execution**, so the result reflects route quality rather than local environment failures.

This round does **not** measure automatic trigger.

It measures:

- whether Codex follows the skill when explicitly told to read it
- whether the current split-skill structure improves answer quality vs the old snapshot

## Method

- runner: `codex exec`
- workdir: `/tmp`
- repo skill injected by prompt, not auto-triggered
- explicit instruction: do not execute any shell/CLI/tool command; only produce the final user-facing answer

Compared:

- `current_skill`: current `skills/remnote`
- `old_skill`: `skills/remnote-workspace/skill-snapshot`

## Case Results

### 1. rem-children-replace

- current: pass
- old: pass

Notes:

- both choose `rem children replace`
- current is shorter and cleaner
- old uses heredoc; current uses inline `$'...'`

### 2. daily-write-markdown

- current: weak
- old: weak / slightly better

Notes:

- neither output gives the concrete command line
- current only says the write has been appended and wait was skipped
- old at least mentions “single-root outline”, which is closer to the shape rule
- this eval prompt likely needs to force “reply with the exact command”

### 3. remote-append-api-base-url

- current: pass
- old: pass

Notes:

- both keep the business command at `rem children append`
- both avoid inventing a separate markdown API surface

### 4. scenario-user-file-explain

- current: pass
- old: pass

Notes:

- both keep `scenario schema explain` local under `apiBaseUrl`
- current is shorter and more focused
- old adds an extra speculative `scenario run recent-review --dry-run` suggestion

### 5. scenario-builtin-move

- current: pass
- old: incomplete

Notes:

- current returns a complete help-first + explain/list + dry-run route
- old snapshot did not finish to a final output within the observed run
- the old run log shows it kept traversing the large inline scenario section
- this is the clearest evidence that the progressive-disclosure split improved navigability for Codex-style explicit-skill usage

## Main Finding

For explicit-injection behavior evals, the current split skill is better than the old snapshot.

The strongest evidence is not just answer style, but completion behavior:

- current `scenario` case finished with a complete route
- old `scenario` case stalled in the oversized inline skill body

That means the progressive-disclosure refactor materially improved *agent usability*, even though the external trigger harness still shows no positive auto-triggering.

## Limits

- This round measures explicit-injection behavior, not automatic skill triggering
- One case (`daily-write-markdown`) needs a stricter eval prompt if we want command-shaped outputs to be required
- The old `scenario-builtin-move` run did not finish cleanly, so that comparison is directional rather than perfectly symmetric

## Recommendation

Keep the split structure.

If continuing evaluation work, next best move is:

1. tighten the behavior eval prompts so they always demand exact commands when that is the expected shape
2. stop spending time on automatic trigger for repo-local skill usage unless the skill is installed globally
