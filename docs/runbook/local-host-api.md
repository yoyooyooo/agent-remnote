# Local Host API Runbook

## Start everything

```bash
agent-remnote stack ensure
```

## Check status

```bash
agent-remnote stack status --json
agent-remnote api status --json
agent-remnote daemon status --json
```

## Read from host api

```bash
curl http://127.0.0.1:3000/v1/health
curl -X POST http://127.0.0.1:3000/v1/search/db \
  -H 'content-type: application/json' \
  -d '{"query":"keyword","limit":10}'
```

Non-default base path:

```bash
agent-remnote --api-base-path /remnote/v1 stack ensure
curl http://127.0.0.1:3000/remnote/v1/health
```

## Use CLI in remote API mode

Recommended one-time config:

```json
{
  "apiBaseUrl": "http://host.docker.internal:3000"
}
```

`apiBaseUrl` may also include the path prefix directly:

```json
{
  "apiBaseUrl": "https://host.example.com/remnote/v1"
}
```

If this base URL is exposed beyond the host, put it behind an explicit auth boundary first. Sensitive write routes such as `POST /v1/write/apply` are intended for trusted callers only.

You can also write it through the CLI:

```bash
agent-remnote config set --key apiBaseUrl --value http://host.docker.internal:3000
agent-remnote config validate
```

Save it to `~/.agent-remnote/config.json`, then keep using the same business commands:

```bash
agent-remnote search --query "keyword"
agent-remnote rem children append --rem "<parentRemId>" --markdown @./note.md
agent-remnote daily write --markdown @./daily.md
agent-remnote queue wait --txn <txn_id>
```

`REMNOTE_API_BASE_URL` and user config `apiBaseUrl` are equivalent entry points with different precedence. If `apiBaseUrl` already includes a path prefix, that prefix is used directly.

Temporary overrides are still available with `--api-base-url` or `REMNOTE_API_BASE_URL`. Use `agent-remnote config path` to confirm the active file path.

## Logs

```bash
agent-remnote api logs --lines 200
agent-remnote daemon logs --lines 200
```

## Stop everything

```bash
agent-remnote stack stop
```
