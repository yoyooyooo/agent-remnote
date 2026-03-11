# Codex Eval Summary

Date: 2026-03-11
Command shape:

```bash
codex exec --model gpt-5.3-codex -c model_reasoning_effort=medium
```

## Why Codex

Claude trigger optimization remained abnormal:

- zero trigger rate on all should-trigger prompts
- automatic description optimization produced empty descriptions

So validation switched to Codex using explicit skill-file reading.

## Prompts checked

1. replace all direct children
2. daily write without wait
3. minimal read for current page/focus
4. dependency chain with explicit completion confirmation

## Result

- `replace all direct children`: PASS
  - chose `rem children replace`
- `daily write without wait`: PASS
  - chose `daily write --markdown`
- `minimal read`: PASS
  - chose `plugin current --compact`
- `dependency chain + wait`: PASS after tightening the skill rule
  - chose `apply --wait --payload ...`

## Key finding

Codex at medium effort can still over-explore and self-check help text, but with the current skill body it converges to the intended shortest-path business commands.

The highest-value fix was the added rule:

- if the next step depends on a newly created node, do not write first and then recover the id with `search`
- go straight to `apply --payload` with aliasing

## Conclusion

For Codex, the current skill is in a good state:

- shortest-path routing works for the highest-value cases
- `replace` is now promoted correctly
- `apply --payload` is only used when there is a real dependency chain
- default no-wait behavior is preserved unless the prompt explicitly asks for confirmation or the next step depends on completion
