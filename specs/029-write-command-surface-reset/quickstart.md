# Quickstart: 029-write-command-surface-reset

## 1. 直接把 markdown 沉淀成 standalone，并在指定 anchor 后补 portal

```bash
cat <<'MD' | agent-remnote --json rem create \
  --markdown - \
  --title "LangGraph" \
  --at standalone \
  --portal at:after:id:<anchorRemId> \
  --wait
- Overview
  - StateGraph
MD
```

## 2. 用多个已有 Rem 创建一个新容器

```bash
agent-remnote --json rem create \
  --from id:<remId1> \
  --from id:<remId2> \
  --title "Reading Pack" \
  --at standalone \
  --wait
```

说明：

- `--from` 表示这些已有 Rem 会被 move 到新容器下，不是 copy
- 如果传参顺序和原 sibling 顺序不同，最终仍按原 sibling 顺序归一化

## 3. 默认原位回填路径：把当前 selection 抽成一个 standalone subject，并原位回填 portal

```bash
agent-remnote --json rem create \
  --from-selection \
  --title "Bundle" \
  --at standalone \
  --portal in-place \
  --wait
```

## 4. Advanced path：把一组显式来源的 contiguous sibling Rem 抽成一个 standalone subject，并原位回填 portal

```bash
agent-remnote --json rem create \
  --from id:<remId1> \
  --from id:<remId2> \
  --title "Bundle" \
  --at standalone \
  --portal in-place \
  --wait
```

前提：

- 这些 `--from` 对应同一个 parent
- 它们在该 parent 下构成连续 sibling range
- contiguous 判定基于本地 hierarchy metadata 的 direct-sibling order，不是可见 outline 的过滤结果
- 默认心智优先用上一条 `--from-selection --portal in-place`
- 只有上游已经拿到稳定 rem ids，且明确不想依赖 UI selection 时，再用这一条

## 5. 把一个已有 Rem 挪成 standalone，并原位回填 portal

```bash
agent-remnote --json rem move \
  --subject id:<remId> \
  --at standalone \
  --portal in-place \
  --wait
```

## 6. 只创建一个 portal，把它插到指定父节点的第 2 个位置

```bash
agent-remnote --json portal create \
  --to id:<targetRemId> \
  --at parent[2]:id:<parentRemId> \
  --wait
```

## 7. 更新一个 Rem 的文本

```bash
agent-remnote --json rem set-text \
  --subject id:<remId> \
  --text "Updated text" \
  --wait
```

## 8. 把一段正文变成一个 titled note

```bash
agent-remnote --json rem create \
  --text "This is the body." \
  --title "Doc" \
  --at standalone \
  --wait
```

结果语义：

- `Doc` 是 destination title
- `"This is the body."` 会写成 destination 的第一条 body child

## 9. 在一个 Rem 下面追加 children

```bash
cat <<'MD' | agent-remnote --json rem children append \
  --subject id:<parentRemId> \
  --markdown - \
  --wait
- child
MD
```

## 10. 删除一个 Rem

```bash
agent-remnote --json rem delete \
  --subject id:<remId> \
  --wait
```

## 11. 给多个 Rem 添加一个 Tag

```bash
agent-remnote --json tag add \
  --tag id:<tagId> \
  --to id:<remId1> \
  --to id:<remId2> \
  --wait
```

## 12. 同时写多条 tag-rem 关系

```bash
agent-remnote --json tag add \
  --tag id:<tagId1> \
  --tag id:<tagId2> \
  --to id:<remId1> \
  --to id:<remId2> \
  --wait
```

说明：

- 实际执行为 `tags × to`
- 这不是一一配对语义
- 如果你想表达一一配对，应该拆成多次调用，或直接改走 `apply --payload`
