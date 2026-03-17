---
"agent-remnote": minor
---

Add the canonical `rem replace` command with `--surface children|self`, support repeated `--rem` and `--selection` target selectors, and update the CLI/docs to treat legacy replace surfaces as compatibility or advanced paths.

Also harden selection-replace assertion handling so lookup failures and missing created Rems fail closed instead of silently passing `no-literal-bullet`.
