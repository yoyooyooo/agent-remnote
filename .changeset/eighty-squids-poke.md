---
'agent-remnote': minor
---

Deliver Wave 1 command-mode parity for RemNote business commands.

This release introduces a shared `ModeParityRuntime` and executable command
contract registry so Wave 1 business commands keep the same business semantics
in local mode and remote mode when `apiBaseUrl` is configured.

Wave 1 parity now covers the current business command set, including:

- search and analytical read commands such as `search`, `rem outline`,
  `daily rem-id`, `page-id`, `by-reference`, `references`, `resolve-ref`,
  and `query`
- plugin/UI-context/selection commands such as `plugin current`,
  `plugin search`, `plugin ui-context *`, and `plugin selection *`
- write commands such as `daily write`, `apply`, `queue wait`, `rem create`,
  `rem move`, `portal create`, `rem replace`, `rem children *`,
  `rem set-text`, `rem delete`, and tag operations

This release also:

- moves host-dependent business semantics such as ref resolution, placement,
  selection interpretation, contiguous sibling range resolution, title
  inference, and receipt normalization behind shared parity runtime layers
- adds host-backed routing for deferred write commands that compile `ops`,
  preventing remote mode from silently enqueueing to the caller-side local
  store
- defines `powerup todo *` as the canonical Todo command family while keeping
  top-level `todo *` as a supported alias
- aligns the authoritative parity inventory, CLI/HTTP/SSoT docs, and spec
  ledgers for the Wave 1 boundary
- expands command-level contract coverage and remote-first integration coverage,
  including `/v1` and `/remnote/v1` base-path verification
