# Iteration 2 Summary

## Eval result

- `set-text-vs-replace`: tie
- `delete-vs-clear`: tie
- `short-text-create`: tie
- `minimal-read`: tie
- `apply-with-wait`: tie
- `replace-with-wait`: current skill wins

## Key finding

The current skill is now clearly better in the one place that matters most for the shortest-path write surface:

- it upgrades “replace all chunks / replace all direct children” prompts to `rem children replace`
- it keeps that routing even when the user explicitly asks for confirmation, then correctly adds `--wait`

Everything else in this round stays stable:

- it does not regress `rem set-text`
- it does not confuse `rem delete` with `rem children clear`
- it does not over-upgrade short literal text into Markdown writes
- it still picks the shortest read path for current context
- it still uses `apply` only when there is a real dependency chain

## Conclusion

The skill is now materially better than the previous version on the highest-value routing gap, and neutral on the rest of the tested shortest-path behaviors.

## Recommended next step

- keep this skill body
- move to description optimization, or
- expand evals further only if you want to probe rarer edge cases such as portal insertion, DN child-target writes, or `sent=0` recovery prompts
