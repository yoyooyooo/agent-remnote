# agent-remnote CLI · 对外契约（SSoT）

本文件定义 agent-remnote 的 CLI 对外契约（A 类不变量）。实现与测试必须以此为准。

## 1) 两个 surface，一个核心不变量

- **Machine surface**：当用户传入 `--json` 时，把 CLI 当作“协议/API”消费。
- **Human surface**：默认输出（`--md` / `--ids` / 无 `--json`）用于人类轻量使用。

核心不变量：

- 只要出现 `--json`，CLI 必须保持“严格协议输出”，避免任何环境把 stdout/stderr 合并后污染机器输出。

## 2) `--json`（Machine surface）输出契约

### MUST

- stdout **必须且只能输出一行 JSON**：`JSON.stringify(envelope) + "\n"`（禁止 pretty print）。
- stderr **必须为空**（包括错误、警告、提示、调试、日志）。
- 成功/失败都使用稳定 envelope（允许新增字段；禁止重命名/删除已发布字段）。
- exit code 语义：
  - `0`：成功
  - `2`：参数/用法错误（含 `@effect/cli` ValidationError、严格 argv 预检失败）
  - `1`：其他失败（运行时失败、依赖不可用、未知 defect）

### Envelope shape

与 `packages/agent-remnote/src/services/Errors.ts` 的 `JsonEnvelope` 对齐：

```ts
export type JsonEnvelope =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
      readonly hint?: readonly string[];
    };
```

约束：

- `error.code`：稳定机器码（例如 `INVALID_ARGS` / `INTERNAL` / `DB_UNAVAILABLE`）。
- `error.message`：英文短句（不含堆栈）。
- `error.details`：仅在需要时提供 JSON 可序列化细节（`--debug` 可扩大 details，但仍禁止写 stderr）。
- `hint[]`：可操作的英文建议（每条一句）。

### 禁止组合（为了保持协议纯度）

以下选项会触发 `@effect/cli` 内建的非 JSON 输出（help/version/completions/wizard）。为了保证 `--json` 永远可被机器稳定消费：

- `--json` **不得与** `--help` / `-h` / `--version` / `--completions` / `--wizard` 同时出现。
- 若出现，必须视为参数错误：exit code `2`，stdout 输出失败 envelope，stderr 仍为空。

## 3) Human surface 输出契约

### MUST

- stdout：输出主结果（可多行）。
- stderr：输出所有非结果文本（错误、人类提示、warnings、next actions 等）。
- 错误行必须以 `Error:` 前缀开头（英文），便于 grep/上游统一处理。
- exit code 语义同上（`0/2/1`）。

## 4) 全局 option 的位置约束（与 @effect/cli Subcommands 行为相关）

由于 `Command.withSubcommands` 的解析行为可能吞掉“子命令 token 之间乱塞的 flag/参数”，本 CLI 额外引入严格 argv 预检以保证对外契约一致：

- **global option 必须放在第一个子命令 token 之前**（例如 `agent-remnote --json --repo X search --query "..."`）。
- 在 leaf 子命令尚未选定前，遇到未知 `--xxx` 必须报错（exit code `2`），避免被吞掉。

## 5) 命令归属裁决（实体优先 + plugin 边界）

为降低 Agent “选错入口”的概率，命令树归属做如下裁决：

- 顶层命令集合固定为：`daemon` / `queue` / `apply` / `plugin` / `search` / `query` / `rem` / `daily` / `todo` / `topic` / `powerup` / `table` / `tag` / `portal` / `replace` / `db` / `config` / `doctor` / `ops`
- `plugin/*`：依赖 RemNote UI/插件/WS bridge state 的能力（例如候选集搜索、selection、ui-context）
- 其余 **只读** 能力优先直挂顶层实体子命令（例如 `search` / `query` / `db ...` / `powerup list/schema` / `todo list` / `rem outline`）
- 所有 **写入副作用** 必须通过“动词子命令”显式表达（create/move/text/delete/apply/add/remove/record/property/option/replace/...），并最终走 enqueue → WS → plugin SDK
- raw ops 仅允许作为 debug/escape hatch 暴露在 `apply`（结构化批量入口同样统一到 `apply` 的 `kind=actions`）

## 6) `config` 命令组契约

- `config path`：输出当前生效的用户配置文件路径
- `config list`：枚举用户配置文件中的显式配置项，返回 canonical key
- `config get --key <key>`：读取单个配置项；未设置时返回 `exists=false`
- `config set --key <key> --value <value>`：写入单个配置项；支持 `apiBaseUrl`、`apiHost`、`apiPort`、`apiBasePath`
- `config unset --key <key>`：删除单个配置项；若文件清空可直接删除配置文件
- `config validate`：校验用户配置文件的 JSON 结构与已知 key 语义，返回 `valid` 布尔值与 `errors[]`
- `config print`：输出最终解析后的运行时配置，包含默认值、用户配置、环境变量与 CLI 参数覆盖后的结果
- 用户配置文件路径优先级：`--config-file` > `REMNOTE_CONFIG_FILE` > `~/.agent-remnote/config.json`
- remote API base URL 优先级：`--api-base-url` > `REMNOTE_API_BASE_URL` > 用户配置文件中的 `apiBaseUrl` > direct mode
- API host 优先级：`--api-host` > `REMNOTE_API_HOST` > 用户配置文件中的 `apiHost` > 默认 `0.0.0.0`
- API port 优先级：`--api-port` > `PORT` / `REMNOTE_API_PORT` > 用户配置文件中的 `apiPort` > 默认 `3000`
- API base path 优先级：`--api-base-path` > `REMNOTE_API_BASE_PATH` > 用户配置文件中的 `apiBasePath` > 默认 `/v1`
