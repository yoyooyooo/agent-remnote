# agent-remnote

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
