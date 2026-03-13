# agent-remnote

A CLI + Host API for reading local RemNote data and writing safely through queue -> WS bridge -> RemNote plugin.

## Install

```bash
npm i -g agent-remnote
```

## Quick start

```bash
agent-remnote --json doctor
agent-remnote --json daemon status
agent-remnote --json plugin current --compact
agent-remnote plugin serve
```

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

For local RemNote plugin loading, serve the embedded plugin artifacts at the default URL:

```bash
agent-remnote plugin serve
```

Default URL: `http://127.0.0.1:8080`
The command prints a Vite-like `Local:` line in human mode. Add `--debug` to also print `Dist:`.

Background lifecycle commands:

```bash
agent-remnote plugin ensure
agent-remnote plugin status
agent-remnote plugin logs --lines 50
agent-remnote plugin stop
```

One-off override remains available with `--api-base-url`, `--api-host`, `--api-port`, `--api-base-path` or the matching env vars. Use `agent-remnote config path|list|get|set|unset|validate|print` to manage user config. `config set` supports `apiBaseUrl`, `apiHost`, `apiPort`, and `apiBasePath`.

## Docs

See the repository root `README.md` and `README.zh-CN.md` for full documentation.
