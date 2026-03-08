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

## Use CLI in remote API mode

```bash
agent-remnote --api-base-url http://host.docker.internal:3000 search --query "keyword"
REMNOTE_API_BASE_URL=http://host.docker.internal:3000 agent-remnote queue wait --txn <txn_id>
```

## Logs

```bash
agent-remnote api logs --lines 200
agent-remnote daemon logs --lines 200
```

## Stop everything

```bash
agent-remnote stack stop
```
