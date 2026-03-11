---
'agent-remnote': major
---

Reset the public write contract around `apply --payload`, `rem children`, and `daily write --markdown`.

Breaking changes:

- remove `import` and `plan` public write entrypoints
- remove `import markdown` and `import wechat outline`
- remove `plan apply`
- remove Host API `POST /v1/write/markdown` and `POST /v1/write/ops`
- unify structured writes under `POST /v1/write/apply`
- add `rem children append|prepend|replace|clear`
- add `apply --wait --timeout-ms --poll-ms`
- unify Markdown input to `--markdown <input-spec>` where `input-spec` is inline text, `@file`, or `-`
