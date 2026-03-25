---
"agent-remnote": minor
---

Add a safe `doctor --fix` repair flow and harden packaged runtime behavior.

This release adds a repair mode for `doctor` that can clean stale runtime
artifacts, rewrite supported user config shapes into canonical keys, and report
restart guidance without auto-restarting services.

It also hardens runtime lifecycle handling by tightening PID trust checks,
cleaning managed state files more safely, improving installed-package behavior
for bundled scenarios and plugin artifacts, and keeping JSON-oriented flows such
as `search --json` stable in packaged layouts.
