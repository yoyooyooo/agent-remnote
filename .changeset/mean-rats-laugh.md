---
"agent-remnote": patch
---

Make `doctor --fix` auto-heal trusted live runtime build mismatches.

`doctor --fix` now safely restarts trusted daemon, API, and plugin runtimes when
their live build metadata is clearly stale, while continuing to clean stale
pid/state artifacts and preserving the existing guardrails for unsafe cases.

It also reads plugin artifact mismatch diagnostics from plugin state metadata so
the reported `plugin-artifact` status matches the actually served plugin build.
