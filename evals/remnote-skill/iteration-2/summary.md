# Iteration 2 Summary

## Eval result

- `set-text-vs-replace`: tie _(eval 7, `set-text-vs-replace`)_ 
- `delete-vs-clear`: tie _(eval 8, `delete-vs-clear`)_ 
- `short-text-create`: tie _(eval 9, `short-text-create`)_ 
- `minimal-read`: tie _(eval 10, `minimal-read`)_ 
- `apply-with-wait`: tie _(eval 12, `apply-with-wait`)_ 
- `replace-with-wait`: current skill wins _(eval 11, `replace-with-wait`)_ 

## Key finding

The current skill is now clearly better in the one place that matters most for the shortest-path write surface:

- it upgrades “replace all chunks / replace all direct children” prompts to `rem children replace` _(eval 11, `replace-with-wait`; see also eval 1 in iteration 1)_ 
- it keeps that routing even when the user explicitly asks for confirmation, then correctly adds `--wait` _(eval 11, `replace-with-wait`)_ 

Everything else in this round stays stable:

- it does not regress `rem set-text` _(eval 7, `set-text-vs-replace`)_ 
- it does not confuse `rem delete` with `rem children clear` _(eval 8, `delete-vs-clear`)_ 
- it does not over-upgrade short literal text into Markdown writes _(eval 9, `short-text-create`)_ 
- it still picks the shortest read path for current context _(eval 10, `minimal-read`)_ 
- it still uses `apply` only when there is a real dependency chain _(eval 12, `apply-with-wait`)_ 

## Conclusion

The skill is now materially better than the previous version on the highest-value routing gap _(eval 11, `replace-with-wait`)_, and neutral on the rest of the tested shortest-path behaviors _(evals 7, 8, 9, 10, 12)_.

## Recommended next step

- keep this skill body
- move to description optimization, or
- expand evals further only if you want to probe rarer edge cases such as portal insertion, DN child-target writes, or `sent=0` recovery prompts

## Reference Map

- eval 7: `set-text-vs-replace`
- eval 8: `delete-vs-clear`
- eval 9: `short-text-create`
- eval 10: `minimal-read`
- eval 11: `replace-with-wait`
- eval 12: `apply-with-wait`
