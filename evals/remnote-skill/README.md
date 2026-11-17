# remnote-skill evals

This directory keeps only the durable evaluation conclusions for the `skills/remnote` optimization work.

## Kept artifacts

- `iteration-1/summary.md`
  - first lightweight with-skill vs old-skill comparison
  - key win: `rem children replace` is selected reliably
- `iteration-2/summary.md`
  - boundary-case follow-up comparison
  - key win: `replace + explicit wait` now routes correctly
- `codex-eval/summary.md`
  - Codex-specific validation using `gpt-5.3-codex` with `model_reasoning_effort=medium`
  - confirms shortest-path routing is usable in Codex
- `trigger-optimization/summary.md`
  - notes why the Claude description-optimization loop was not trusted

## Deliberately removed

- per-eval raw `response.json` files
- old skill snapshots
- baseline snapshots
- automatic description-optimization logs

The canonical reusable eval set is part of the Notion-owned `remnote` Skill:

- `skill://41b5636c-236e-81a7-9619-f91a83e4164a/evals/evals.json`
- `skill://41b5636c-236e-81a7-9619-f91a83e4164a/evals/trigger-evals.json`

Use the formal `ntn-skills` reader and the fixed snapshot receipt in
`docs/skill-handoffs/remnote.json`. Historical summaries above retain their
original paths; they do not install or recreate `skills/remnote`.
