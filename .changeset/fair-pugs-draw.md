---
"agent-remnote": patch
---

Fix standalone `rem create --markdown` so multi-root list content keeps
top-level sections as siblings instead of nesting later roots under the
previous branch.

Add a regression test covering the plugin markdown tree import path used by the
standalone create flow.
