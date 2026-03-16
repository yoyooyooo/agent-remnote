# 数据模型：023-rem-replace-surface

## 1. Replace Target Selector

用途：用统一方式表达 replace 的目标集合。

公开 selector：

| 选择器 | 形态 | 含义 |
| --- | --- | --- |
| `--rem <id>` | 可重复 | 显式提供 target Rem 集合 |
| `--selection` | 布尔 | 使用当前 UI selection 解析 target Rem 集合 |

约束：

- `--rem` 与 `--selection` 不能同时出现
- 两者至少出现一个
- selection 只是 target selector，不改变命令家族

## 2. Replace Surface

用途：声明 replace 作用在哪一层。

公开值：

| 值 | 含义 |
| --- | --- |
| `children` | 保留目标 Rem，自身不删，重写其 direct children |
| `self` | 直接替换目标 Rem block 本身 |

说明：

- `children` 只适用于一个目标 Rem
- `self` 适用于一个或多个目标 Rem
- `children` 和 `self` 是能力维度，不是场景词

## 3. Resolved Target Set

用途：在命令解析后，形成可验证的统一目标集合。

字段建议：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `source` | `explicit` \| `selection` | 目标来源 |
| `ids` | `string[]` | 去重后的 target Rem ids |
| `count` | `number` | 目标数量 |
| `same_parent` | `boolean` | 是否共享同一 parent |
| `contiguous` | `boolean` | 是否构成连续 sibling block |

说明：

- `surface=children` 只关心 `count===1`
- `surface=self` 默认要求 `same_parent=true` 且 `contiguous=true`

## 4. Surface-Specific Validation Matrix

| 条件 | `surface=children` | `surface=self` |
| --- | --- | --- |
| target count | 必须等于 1 | 必须大于等于 1 |
| same parent | 不需要额外公开约束 | 默认必须满足 |
| contiguous | 不适用 | 默认必须满足 |
| empty markdown | 合法，表示清空 children | 合法，表示删掉 target block |
| `preserve-anchor` | 允许 | 禁止 |

## 5. Assertion Profile

用途：根据 replace surface 限定可用断言集合。

建议规则：

| 断言 | `children` | `self` |
| --- | --- | --- |
| `single-root` | 允许 | 允许 |
| `preserve-anchor` | 允许 | 禁止 |
| `no-literal-bullet` | 允许 | 允许 |

说明：

- `preserve-anchor` 依赖单一 anchor Rem 的存在
- `self` surface 可替换多个 roots，没有稳定的单一 anchor 概念

## 6. Compilation Mapping

用途：把 canonical command 映射到现有 runtime primitive。

| Canonical surface | 目标 primitive |
| --- | --- |
| `children` | `replace_children_with_markdown` |
| `self` | `replace_selection_with_markdown` |

说明：

- 本 feature 的重点是命令面统一
- runtime primitive 继续复用现有执行器能力

## 7. Legacy Surface Positioning

用途：明确旧命令在新模型里的位置。

| 旧 surface | 新定位 |
| --- | --- |
| `rem children replace` | legacy / compatibility wrapper for `surface=children` |
| `replace markdown` | advanced/local-only block-replace surface |

说明：

- 它们可以在迁移期继续存在
- canonical docs 与 skill 不再把它们当作第一推荐路径
