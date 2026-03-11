# Trigger Optimization Summary

## Scope

Tried automatic description optimization for `skills/remnote/SKILL.md` using the `skill-creator` trigger-eval loop.

## Result

Claude-based trigger optimization was not trustworthy in this environment.

Observed behavior:

- all should-trigger queries stayed at zero trigger rate
- should-not-trigger queries stayed correctly non-triggered
- the optimizer proposed empty descriptions in repeated iterations
- final score stayed flat at 50% accuracy purely because only the negatives passed

## Decision

Do not continue using this Claude trigger-optimization loop for this skill in the current environment.

Switch validation to Codex-focused behavior checks instead:

- explicit skill-file reading
- shortest-path command routing checks
- medium-effort Codex evals for high-value prompts

## Follow-up

The Codex evaluation path is documented in:

- `../codex-eval/summary.md`
