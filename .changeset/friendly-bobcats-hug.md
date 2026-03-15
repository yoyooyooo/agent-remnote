---
"agent-remnote": minor
---

Implement outline-aware writes and backup governance for RemNote operations.

- add `backup list` and `backup cleanup`, including precise cleanup by backup rem id
- add `rem children replace --selection`, `--backup`, and `--assert`
- avoid extra bundling for single-root daily markdown writes
- route large subtree deletes through frontend-safe deletion with dynamic `--max-delete-subtree-nodes`
