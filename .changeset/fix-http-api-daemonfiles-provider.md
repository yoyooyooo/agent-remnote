---
'agent-remnote': patch
---

Fix Host API write flows so requests using the default `ensureDaemon=true` path no longer fail from missing daemon runtime services.

Enable `rem outline` and `daily rem-id` over Host API, and make `apiBaseUrl` behave as a strict remote mode so local-only commands fail fast instead of silently reading local DB state.
