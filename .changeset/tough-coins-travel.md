---
"agent-remnote": patch
---

Fix `apply --payload` so nested `markdown` fields expand input-spec values like `@file`, `-`, and `@@literal`, and harden queue enqueue/wait behavior by making enqueue atomic to reduce CI and `--wait` flakiness.
