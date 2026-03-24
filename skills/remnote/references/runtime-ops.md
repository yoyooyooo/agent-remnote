# Runtime And Ops

只在这些情况加载本文件：

- 需要决定是否 `--wait`
- 需要决定读路径、help-first、plugin local URL
- 需要进一步分流到 remote parity 或 failure recovery

## Wait Policy

默认策略：不等待。

只有以下情况加 `--wait` 或单独 `queue wait`：

- 用户明确说“确认写入成功”
- 下一步依赖这次写入已经进入终态
- 需要立即拿到新建 Rem 的真实 ID
- 上一次返回 `sent=0`、`TXN_TIMEOUT`、`TXN_FAILED`

优先级：

1. 业务命令直接带 `--wait`
2. 已有 `txn_id` 时再用 `queue wait`

## Structure-Sensitive Exception

默认不要为了写入去做额外读取。

但以下任务允许一次轻量 `outline`：

- 扩写当前 Rem
- 把长内容重组为单根大纲
- 校验父子层级是否写对

边界：

- 只做 `rem outline`
- 不要升级成 `search`、`inspect`、全文扫描

## Read Path Priority

只在确实需要读的时候，按这个顺序：

1. `agent-remnote --json plugin current --compact`
2. `agent-remnote --json plugin selection current --compact`
3. `agent-remnote --json plugin ui-context describe`
4. `agent-remnote rem outline --id <remId> --depth 3 --format md`
5. `agent-remnote --json search --query "<keyword>" --limit 10`

## Help-First Exceptions

默认不要为了普通高频命令先跑 `--help`。

但遇到下面几类面时，先看 help 再组命令：

- `scenario` 这种 planned / experimental surface
- 低频命令族，且你这轮要传多个 flags
- var type 是 `scope` / `ref` 这类泛型字符串，但当前 prompt 又依赖精确字面量

## Plugin Local URL

如果用户是在处理 RemNote Developer URL、本地插件静态服、或“为什么本地插件地址打不开”，优先用：

```bash
agent-remnote plugin ensure
agent-remnote plugin status
agent-remnote plugin logs --lines 50
agent-remnote plugin stop
```

## Further Routing

### Remote Parity

读 [remote-parity.md](remote-parity.md)：

- 需要在 `apiBaseUrl` 模式下判断 remote vs host-only
- 需要确认某条命令是否支持透明远端执行
- 需要处理 parity authority

### Failure Recovery

读 [failure-recovery.md](failure-recovery.md)：

- 需要处理 `sent=0`
- 需要处理 `TXN_TIMEOUT`、错误 parent、typed property 失败
- 需要选择 queue / daemon / plugin 的最短排障路径
