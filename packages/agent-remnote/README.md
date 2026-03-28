# agent-remnote

A CLI + Host API for reading local RemNote data and writing safely through queue -> WS bridge -> RemNote plugin.

## Install

```bash
npm i -g agent-remnote
```

## Quick start

```bash
agent-remnote --json doctor
agent-remnote --json config print
agent-remnote --json stack status
agent-remnote --json daemon status
agent-remnote --json plugin current --compact
agent-remnote plugin serve
```

## Write surface

Core write commands use the reset axes `subject / from / to / at / portal`.

```bash
agent-remnote --json rem create --at standalone --markdown @./note.md --title "Doc"
agent-remnote --json rem move --subject "id:<remId>" --at "parent[0]:id:<parentId>" --portal in-place
agent-remnote --json portal create --to "id:<targetRemId>" --at "after:id:<anchorRemId>"
agent-remnote --json rem children append --subject "id:<parentRemId>" --markdown @./children.md
agent-remnote --json tag add --tag "id:<tagRemId>" --to "id:<remId1>" --to "id:<remId2>"
```

Notes:

- `rem create --from-selection --portal in-place` is the preferred original-slot backfill path.
- repeated `--from ... --portal in-place` is an advanced path that requires one contiguous sibling range under one parent.
- `tag add/remove` are relation writes. Repeated `--tag` and repeated `--to` expand as a cross-product, not pairwise.

## Remote mode

Configure once in `~/.agent-remnote/config.json`:

```json
{
  "apiBaseUrl": "http://host.docker.internal:3000"
}
```

Or write it through the CLI:

```bash
agent-remnote config set --key apiBaseUrl --value http://host.docker.internal:3000
agent-remnote config set --key apiHost --value 0.0.0.0
agent-remnote config set --key apiPort --value 3001
agent-remnote config set --key apiBasePath --value /v1
agent-remnote config validate
```

Then keep using the same business commands:

```bash
agent-remnote search --query "keyword"
agent-remnote plugin current --compact
```

The authoritative inventory for parity-mandatory business commands lives in
`docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`.

For local RemNote plugin loading, serve the embedded plugin artifacts at the default URL:

```bash
agent-remnote plugin serve
```

Default URL: `http://127.0.0.1:8080`
The command prints a Vite-like `Local:` line in human mode. Add `--debug` to also print `Dist:`.

Background lifecycle commands:

```bash
agent-remnote stack ensure
agent-remnote stack status
agent-remnote stack stop
agent-remnote stack takeover --channel dev
agent-remnote stack takeover --channel stable
agent-remnote plugin ensure
agent-remnote plugin status
agent-remnote plugin logs --lines 50
agent-remnote plugin stop
```

Current runtime defaults are profile-aware:

- published install defaults to the canonical `stable` runtime root under `~/.agent-remnote`
- source worktrees default to isolated `dev` runtime roots and isolated ports
- `config print` and `stack status` expose `runtime_profile`, `runtime_root`, and `fixed_owner_claim`

One-off override remains available with `--api-base-url`, `--api-host`, `--api-port`, `--api-base-path` or the matching env vars. Use `agent-remnote config path|list|get|set|unset|validate|print` to manage user config. `config set` supports `apiBaseUrl`, `apiHost`, `apiPort`, and `apiBasePath`.

## Docs

See the repository root `README.md` and `README.zh-CN.md` for full documentation.
