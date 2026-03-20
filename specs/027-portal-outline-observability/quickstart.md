# Quickstart：027-portal-outline-observability

## 目标

验证现有 outline surface 已经具备 typed node schema，足以做 CLI-only 验证。

## JSON / Detail Verification

```bash
agent-remnote rem outline --id <parentRemId> --depth 3 --format json --detail
```

验收点：

- 每个 node 有 `kind`
- target-bearing node 有 `target`
- non-target-bearing node 也必须显式返回 `target: null`

## Markdown Verification

```bash
agent-remnote rem outline --id <parentRemId> --depth 3 --format md
```

验收点：

- target-bearing node 不是空文本
- unresolved target 可见
