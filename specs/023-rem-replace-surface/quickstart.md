# Quickstart：023-rem-replace-surface

## 目标

验证以下 5 件事：

1. `rem replace` 成为 canonical replace path
2. `surface=children` 正确表达单 anchor children rewrite
3. `surface=self` 正确表达多 Rem in-place replace
4. `selection` 只作为 target selector 使用
5. 非法 selector/surface/assertion 组合会 fail-fast

## 场景 A：单个 Rem 的 children replace

```bash
cat <<'MD' | agent-remnote --json rem replace --rem "<remId>" --surface children --markdown - --wait
- Overview
  - Point A
  - Point B
MD
```

预期：

- 目标 Rem 自身保留
- direct children 被新 Markdown 重写

## 场景 B：多个显式 Rem 的 self replace

```bash
cat <<'MD' | agent-remnote --json rem replace --rem "<remIdA>" --rem "<remIdB>" --surface self --markdown - --wait
- New Block 1
  - child 1
- New Block 2
  - child 2
MD
```

预期：

- 原有两个 sibling Rem 被整块替换
- 新 block 插回原位置

## 场景 C：当前 selection 的 self replace

```bash
cat <<'MD' | agent-remnote --json rem replace --selection --surface self --markdown - --wait
- Replacement 1
  - detail
- Replacement 2
  - detail
MD
```

预期：

- `selection` 只充当 target selector
- 命令家族仍然是 `rem replace`

## 场景 D：非法组合 fail-fast

```bash
cat <<'MD' | agent-remnote --json rem replace --rem "<remIdA>" --rem "<remIdB>" --surface children --markdown - 
- invalid
MD
```

预期：

- 返回稳定错误
- 错误原因指出 `surface=children` 需要 exactly one target

## 场景 E：断言与 surface 不兼容

```bash
cat <<'MD' | agent-remnote --json rem replace --selection --surface self --assert preserve-anchor --markdown -
- invalid
MD
```

预期：

- 返回稳定错误
- 错误原因指出 `preserve-anchor` 只适用于 `surface=children`
