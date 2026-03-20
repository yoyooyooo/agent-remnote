# Quickstart: 028-rem-create-move-page-portal-flow

## 1. 直接把 markdown 沉淀成独立 page，并在今日 DN 留 portal

```bash
cat <<'MD' | agent-remnote --json rem create \
  --standalone \
  --is-document \
  --title "LangGraph" \
  --markdown - \
  --portal-parent daily:today \
  --wait
- 定位
  - LangGraph 是...
- 核心概念
  - StateGraph
MD
```

## 2. 用一个已有 Rem 创建新的独立 page，并把它移进去

```bash
agent-remnote --json rem create \
  --standalone \
  --is-document \
  --target id:<sourceRemId> \
  --wait
```

说明：

- 单个 `--target` 可缺省 `--title`
- destination title 默认沿用 source Rem 文本

## 3. 用多个已有 Rem 创建新的独立 page，并在今日 DN 留 portal

```bash
agent-remnote --json rem create \
  --standalone \
  --is-document \
  --title "LangGraph Reading Pack" \
  --target id:<remId1> \
  --target id:<remId2> \
  --portal-parent daily:today \
  --wait
```

## 4. 把已有单个 Rem 提级为独立 page，并原地留 portal

```bash
agent-remnote --json rem move \
  --rem <remId> \
  --standalone \
  --is-document \
  --leave-portal \
  --wait
```

## 5. 把当前连续 selection 抽成独立 page，并原地留 portal

```bash
agent-remnote --json rem create \
  --from-selection \
  --standalone \
  --is-document \
  --title "LangGraph" \
  --leave-portal-in-place \
  --wait
```

## 6. 把内容放到指定知识页下，同时在另一个 anchor 后留 portal

```bash
cat <<'MD' | agent-remnote --json rem create \
  --parent page:Research \
  --title "LangGraph" \
  --markdown - \
  --portal-after id:<anchorRemId> \
  --wait
- 概览
  - ...
MD
```
