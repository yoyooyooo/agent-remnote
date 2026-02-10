# Data Model 005：安全搜索（插件候选集 + DB 精筛 + 超时兜底）

**Feature**: `specs/005-search-safety/spec.md`  
**Date**: 2026-01-24

## 核心对象

### SearchBudget

> 所有搜索响应都必须携带预算信息，便于诊断与引导下一步收敛。

| 字段 | 类型 | 说明 |
|---|---|---|
| `timeoutMs` | number | 本次请求超时预算（插件候选集默认 3000；最大 5000） |
| `limitRequested` | number | 调用方请求的 limit |
| `limitEffective` | number | 实际生效的 limit（clamp 后） |
| `limitClamped` | boolean | 是否发生 clamp |
| `maxPreviewChars` | number | snippet 最大字符数（建议 200） |
| `durationMs` | number | 实际耗时（由服务端或插件侧测量） |

### SearchResult

| 字段 | 类型 | 说明 |
|---|---|---|
| `remId` | string | Rem 的稳定 id |
| `title` | string | 纯文本标题（来自 `text`） |
| `snippet` | string | 纯文本预览（来自 `text/backText` 合成的窗口/开头预览） |
| `truncated` | boolean | snippet 是否被截断 |

### SearchError

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | `'TIMEOUT' \| 'NO_ACTIVE_WORKER' \| 'PLUGIN_ERROR' \| 'VALIDATION_ERROR' \| 'BRIDGE_ERROR'` | 错误码 |
| `message` | string | 面向开发者/日志的简短说明（用户可见输出仍需英文） |

### NextAction（建议型）

当前阶段：`nextActions` 使用 `string[]`，每条为“一句可执行建议”，例如：

- 缩小关键词：优先 1–3 个核心词
- 补充上下文：提供 pageRemId / 目标页面
- 提高 limit（最多 100）或改走 DB 搜索
- 限制 timeRange / parentId 以降低 DB 风险

## WS read-rpc 数据形状（概览）

> 具体消息协议见 `specs/005-search-safety/contracts/ws-read-rpc.md`。

### SearchRequest

- `requestId`: string（UUID；调用方生成）
- `queryText`: string（原始字符串；插件侧用 `toRichText` 转为 RichText 再调用 `plugin.search.search`）
- `searchContextRemId?`: string（可选；用于收敛范围）
- `limit?`: number（默认 20；最大 100；clamp）
- `timeoutMs?`: number（默认 3000；最大 5000；clamp）

### SearchResponse

- `ok`: boolean
- `budget`: SearchBudget
- `results`: SearchResult[]（`ok=true` 时）
- `error`: SearchError（`ok=false` 时）
- `nextActions?`: string[]（建议型）

## snippet 生成规则（插件侧）

1) 把 `rem.text` 与 `rem.backText`（若有）转为纯文本：
   - 优先使用 `plugin.richText.toString(...)`。
2) 合成候选文本：
   - `title = textPlain.trim()`
   - `body = backTextPlain.trim()`（可为空）
   - `full = body ? title + \"\\n\" + body : title`
3) 命中窗口：
   - 将 `queryText` 拆为 tokens（按空白/标点分割；过滤长度=0 的 token）。
   - 在 `full` 中找第一个命中 token 的位置 `idx`：
     - 命中 → 截取 `idx-80 .. idx+120`（可调），并在两侧补省略号。
     - 未命中 → 截取开头 `0..maxPreviewChars`。
4) 预算化输出：
   - `maxPreviewChars` 默认 200（可配置但必须 clamp）
   - 超长则截断并 `truncated=true`
