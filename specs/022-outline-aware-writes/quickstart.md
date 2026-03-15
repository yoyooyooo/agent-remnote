# Quickstart：022-outline-aware-writes

## 目标

验证以下 5 件事：

1. 报告型内容默认单根写入
2. 不适合大纲化的内容可保持正常写法
3. 当前选中 Rem 可直接通过基础命令扩写，不在页面根下长并列节点
4. replace 成功路径默认不留下可见 backup
5. 残留 backup 能通过统一命令列出和清理

## 场景 A：报告型单根写入

```bash
cat <<'MD' | agent-remnote --json daily write --markdown - --wait
- Web 抓取策略总结
  - 登录态
  - 节奏控制
  - 错误恢复
MD
```

预期：

- 最终只有一个顶层根节点
- 不出现额外 bundle 根节点

## 场景 B：不适合大纲化的内容正常写入

```bash
agent-remnote --json daily write --text "我们已经知道 A，所以自然会问 B。假设 C 成立，就可以推出 D。"
```

预期：

- 系统允许正常写法
- 不强制把文本改造成单根大纲

## 场景 C：扩写当前选中 Rem

```bash
cat <<'MD' | agent-remnote --json rem children replace --selection --assert preserve-anchor --markdown - --wait
- 总体判断
  - 先解释问题
  - 再拆常见策略
  - 最后写边界与取舍
MD
```

预期：

- 保留当前选中的标题 Rem
- 只重写其 children
- 页面根下不新增并列报告根节点

## 场景 D：replace 默认不留可见 backup

```bash
cat <<'MD' | agent-remnote --json rem children replace --rem "<parentRemId>" --backup none --assert single-root --markdown - --wait
- 新结构
  - 子项 A
  - 子项 B
MD
```

预期：

- 成功写入后，看不到 `agent-remnote: ... backup ...` Rem

## 场景 E：列出和清理 orphan backup

```bash
agent-remnote --json backup list --state orphan
agent-remnote --json backup cleanup --state orphan
agent-remnote --json backup cleanup --state orphan --apply
```

预期：

- `list` 返回 orphan 候选
- `cleanup` 默认 dry-run
- 加 `--apply` 后才实际删除
