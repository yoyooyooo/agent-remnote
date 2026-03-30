# agent-remnote

## 1.5.2

### Patch Changes

- 520b202: Fix standalone `rem create --markdown` so multi-root list content keeps
  top-level sections as siblings instead of nesting later roots under the
  previous branch.

  Add a regression test covering the plugin markdown tree import path used by the
  standalone create flow.

## 1.5.1

### Patch Changes

- 46fbcb0: Make `doctor --fix` auto-heal trusted live runtime build mismatches.

  `doctor --fix` now safely restarts trusted daemon, API, and plugin runtimes when
  their live build metadata is clearly stale, while continuing to clean stale
  pid/state artifacts and preserving the existing guardrails for unsafe cases.

  It also reads plugin artifact mismatch diagnostics from plugin state metadata so
  the reported `plugin-artifact` status matches the actually served plugin build.

## 1.5.0

### Minor Changes

- 77d941b: Add a safe `doctor --fix` repair flow and harden packaged runtime behavior.

  This release adds a repair mode for `doctor` that can clean stale runtime
  artifacts, rewrite supported user config shapes into canonical keys, and report
  restart guidance without auto-restarting services.

  It also hardens runtime lifecycle handling by tightening PID trust checks,
  cleaning managed state files more safely, improving installed-package behavior
  for bundled scenarios and plugin artifacts, and keeping JSON-oriented flows such
  as `search --json` stable in packaged layouts.

## 1.4.0

### Minor Changes

- d5e52bc: Deliver Wave 1 command-mode parity for RemNote business commands.

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

## 1.3.3

### Patch Changes

- ca915b7: Fix `apply --payload` so nested `markdown` fields expand input-spec values like `@file`, `-`, and `@@literal`, and harden queue enqueue/wait behavior by making enqueue atomic to reduce CI and `--wait` flakiness.

## 1.3.0

### Minor Changes

- 0b61c1e: Add the canonical `rem replace` command with `--surface children|self`, support repeated `--rem` and `--selection` target selectors, and update the CLI/docs to treat legacy replace surfaces as compatibility or advanced paths.

  Also harden selection-replace assertion handling so lookup failures and missing created Rems fail closed instead of silently passing `no-literal-bullet`.

## 1.2.0

### Minor Changes

- 13949c6: Implement outline-aware writes and backup governance for RemNote operations.

  - add `backup list` and `backup cleanup`, including precise cleanup by backup rem id
  - add `rem children replace --selection`, `--backup`, and `--assert`
  - avoid extra bundling for single-root daily markdown writes
  - route large subtree deletes through frontend-safe deletion with dynamic `--max-delete-subtree-nodes`

## 1.1.0

### Minor Changes

- 3676681: Add host API workspace binding resolution and `apiBaseUrl`-driven remote command support for the main read/write surface, plus runtime guards for unsupported property type mutations and invalid table option targets.

## 1.0.0

### Major Changes

- 586161c: Reset the public write contract around `apply --payload`, `rem children`, and `daily write --markdown`.

  Breaking changes:

  - remove `import` and `plan` public write entrypoints
  - remove `import markdown` and `import wechat outline`
  - remove `plan apply`
  - remove Host API `POST /v1/write/markdown` and `POST /v1/write/ops`
  - unify structured writes under `POST /v1/write/apply`
  - add `rem children append|prepend|replace|clear`
  - add `apply --wait --timeout-ms --poll-ms`
  - unify Markdown input to `--markdown <input-spec>` where `input-spec` is inline text, `@file`, or `-`

## 0.4.2

### Patch Changes

- 1dfc8f0: Fix Host API write flows so requests using the default `ensureDaemon=true` path no longer fail from missing daemon runtime services.

  Enable `rem outline` and `daily rem-id` over Host API, and make `apiBaseUrl` behave as a strict remote mode so local-only commands fail fast instead of silently reading local DB state.

## 0.4.1

### Patch Changes

- 53aad14: Fix Host API write endpoints so remote markdown and op writes no longer fail from a missing status-line runtime service.

## 0.4.0

### Minor Changes

- 44ce542: Add the unreleased `agent-remnote` changes after `0.3.0`, including the improved daily markdown write flow and full Host API config support for `apiHost`, `apiPort`, and `apiBasePath` through both user config and root CLI flags.

## 0.3.0

### Minor Changes

- 86f4855: Add a full `config` command suite for user config management, including `path`, `list`, `get`, `set`, `unset`, `validate`, and richer `print` output.

  Support `apiBaseUrl` in `~/.agent-remnote/config.json` and `--config-file` / `REMNOTE_CONFIG_FILE` so agents can keep using the same business commands across local and remote environments.

## 0.2.0

### Minor Changes

- a06edb8: Add the host API runtime, remote API mode, `api` / `stack` command groups, worker-wait support, and compact current-context reads for agents.

All notable changes to this package will be documented in this file.

The format is managed by Changesets.
