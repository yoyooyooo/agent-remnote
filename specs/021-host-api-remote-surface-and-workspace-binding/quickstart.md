# Quickstart: 021-host-api-remote-surface-and-workspace-binding

## 目标

验证以下四件事：

1. Host API 对调用方统一只暴露 `apiBaseUrl`
2. 首次 live `uiContext.kbId` 能自动建立 workspace binding
3. binding 建立后，插件短暂离线时 DB read 仍命中同一 KB
4. 多候选且没有强信号时返回 `WORKSPACE_UNRESOLVED`

## 前置条件

1. 宿主机已安装并打开 RemNote Desktop
2. RemNote 插件已安装并能连接 WS daemon
3. 本机 `~/remnote/` 下至少存在两个 `remnote-<workspaceId>/remnote.db`
4. Host API 与 daemon 可由 `stack ensure` 拉起

## 场景 A：非默认 `apiBasePath` 贯通

1. 启动 Host API：

```bash
agent-remnote stack stop
agent-remnote --api-port 3011 --api-base-path /remnote/v1 stack ensure
```

2. 直接检查健康接口：

```bash
curl http://127.0.0.1:3011/remnote/v1/health
```

3. 用同一 `apiBaseUrl` 驱动业务命令：

```bash
agent-remnote --api-base-url http://127.0.0.1:3011/remnote/v1 search --query "keyword"
agent-remnote --api-base-url http://127.0.0.1:3011/remnote/v1 plugin current --compact
```

预期：

- 服务端路由与客户端请求都命中 `/remnote/v1`
- `api status --json` / `stack status --json` 返回的 `base_path` 与 `base_url` 一致

## 场景 B：首次自动绑定当前 KB

1. 先重置回默认监听参数：

```bash
agent-remnote stack stop
agent-remnote stack ensure --wait-worker --worker-timeout-ms 15000
```

2. 在 RemNote 中切到目标 KB，并确保插件已连接。
3. 检查状态：

```bash
agent-remnote api status --json
curl http://127.0.0.1:3000/v1/status
```

预期：

- 状态中存在 `currentWorkspaceId`
- 状态中存在 `currentDbPath`
- `bindingSource` 为 `live_ui_context` 或随后转为 `binding`
- `db_read_ready=true`

## 场景 C：binding 建立后，插件暂时离线仍可 DB read

1. 在场景 B 建立 binding 后，关闭 RemNote 或让插件断开。
2. 检查状态：

```bash
agent-remnote api status --json
```

3. 执行 DB read：

```bash
agent-remnote --api-base-url http://127.0.0.1:3000 search --query "keyword"
agent-remnote --api-base-url http://127.0.0.1:3000 rem outline --id <known-rem-id>
```

预期：

- `plugin_rpc_ready=false` 或 `write_ready=false`
- `db_read_ready=true`
- 读请求继续命中与场景 B 相同的 `currentWorkspaceId`

## 场景 D：多候选且没有强信号时返回 unresolved

1. 清空或隔离现有 workspace binding。
2. 确保没有 live `uiContext.kbId`，同时 `~/remnote/` 下存在多个 primary KB。
3. 直接发起状态查询：

```bash
agent-remnote api status --json
curl http://127.0.0.1:3000/v1/status
```

预期：

- 返回 `workspace.resolved=false`
- 返回 `candidateWorkspaces[]`
- 若直接调用依赖 DB 的端点，应返回 `WORKSPACE_UNRESOLVED`

示例：

```bash
agent-remnote --api-base-url http://127.0.0.1:3000 search --query "keyword"
```

## 场景 E：同一 `apiBaseUrl` 供不同调用方复用

1. 在本机直接调用：

```bash
agent-remnote --api-base-url http://127.0.0.1:3000 search --query "keyword"
```

2. 在容器或远程环境中用同一业务语义调用：

```bash
curl -X POST http://<same-host-api>/v1/search/db \
  -H 'content-type: application/json' \
  -d '{"query":"keyword","limit":10}'
```

预期：

- 调用方无需配置本地 DB 路径
- 调用方无需区分 container 分支和 remote 分支
- 响应 envelope 与错误语义一致
