# CLI Contract：023-rem-replace-surface

## Canonical Public Replace Entry

### `rem replace`

```bash
agent-remnote rem replace (--rem <rid>... | --selection) --surface children|self --markdown <input-spec>
```

说明：

- `rem replace` 是 canonical replace family
- `--selection` 与 repeated `--rem` 是 target selector
- `--surface` 表达 replace 作用层

## Surface: `children`

```bash
agent-remnote rem replace --rem <rid> --surface children --markdown <input-spec>
agent-remnote rem replace --selection --surface children --markdown <input-spec>
```

语义：

- 保留目标 Rem 自身
- 重写其 direct children
- 空 Markdown 表示清空 direct children

校验：

- 解析后的 target set 必须恰好包含一个 Rem
- `--assert preserve-anchor` 合法

## Surface: `self`

```bash
agent-remnote rem replace --rem <ridA> --rem <ridB> --surface self --markdown <input-spec>
agent-remnote rem replace --selection --surface self --markdown <input-spec>
```

语义：

- 替换目标 Rem block 本身
- 一个或多个目标 Rem 都合法
- 空 Markdown 表示把目标 block 替换为空

默认校验：

- target set 至少包含一个 Rem
- target Rems 必须共享同一 parent
- target Rems 默认必须构成连续 sibling block
- `--assert preserve-anchor` 不合法

## Target Selector Rules

- `--rem` 可重复
- `--selection` 为布尔 selector
- `--rem` 与 `--selection` 互斥
- 至少提供一个 target selector

## Markdown Input Contract

所有 `rem replace` 路径使用：

```bash
--markdown <input-spec>
```

`input-spec` 形式：

- inline string
- `@file`
- `-`

## Common Wait Contract

```bash
agent-remnote rem replace ... --wait --timeout-ms <ms> --poll-ms <ms>
```

语义：

- 默认 enqueue-only
- `--wait` 才允许 `--timeout-ms` / `--poll-ms`

## Legacy / Advanced Surfaces

### `rem children replace`

定位：

- legacy / compatibility wrapper
- 不再是 canonical first-choice replace recipe

### `replace markdown`

定位：

- advanced/local-only block-replace surface
- 保留 advanced selector 语义
- 不再作为 canonical replace family

## Fail-Fast Expectations

- 缺失 target selector 时返回稳定的 `INVALID_ARGS`
- `surface=children` 且 target count 不等于 1 时返回稳定的 `INVALID_ARGS`
- `surface=self` 且 target set 不共享 parent 时返回稳定失败
- `surface=self` 且 target set 默认不连续时返回稳定失败
- `surface=self` + `--assert preserve-anchor` 返回稳定的 `INVALID_ARGS`
- local-only selector 若无法在 remote mode 下解析，必须 fail-fast，不得静默降级
