# Quickstart: 019-local-host-api-and-stack

## 目标

在宿主机上把 `daemon + api` 拉起，并让容器内 agent 可以通过标准 HTTP API 读写 RemNote。

## 步骤

1. 在宿主机确保 RemNote Desktop 打开，插件已安装。
2. 在仓库根目录执行：

```bash
agent-remnote stack ensure
```

3. 在宿主机验证：

```bash
curl http://127.0.0.1:3000/v1/health
```

4. 在容器内验证：

```bash
curl http://host.docker.internal:3000/v1/health
```

5. 做一次只读搜索：

```bash
curl -X POST http://host.docker.internal:3000/v1/search/db \
  -H 'content-type: application/json' \
  -d '{"query":"keyword","limit":10,"timeoutMs":30000}'
```

6. 做一次安全写入：

```bash
curl -X POST http://host.docker.internal:3000/v1/write/markdown \
  -H 'content-type: application/json' \
  -d '{"ref":"page:Inbox","markdown":"- hello from api","idempotencyKey":"demo:hello-from-api"}'
```

7. 若返回 `txn_id`，等待终态：

```bash
curl -X POST http://host.docker.internal:3000/v1/queue/wait \
  -H 'content-type: application/json' \
  -d '{"txnId":"<txn_id>","timeoutMs":30000,"pollMs":500}'
```

8. 停止整套服务：

```bash
agent-remnote stack stop
```

