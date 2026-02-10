# Research Notes: 016-cli-entity-surface

本文件记录 016 立项时对“现状/缺口/可复用实现”的调查结论，供实现阶段引用。

## Current state (observed)

- 已有：`write tag add/remove`（内部生成并 enqueue `add_tag/remove_tag`；支持 `--wait`）。
- 已有：`write table record add/update/delete`、`write table property add/set-type`、`write table option add/remove`。
- 已有：`read table --id ...`（只读 DB，供 values 编译/诊断）。
- 缺口：没有 `write table create`（插件侧存在 `create_table` handler，但 CLI 侧缺语义命令）。
- 缺口：没有 `write portal ...` 语义命令（已存在底层 op `create_portal` + 插件 handler）。
- Rem 语义命令当前较薄：`write rem delete` 已存在，其它 create/move/text 需补齐（或以 plan/ops 间接实现）。

## Key risks

- 命令树重排会触发 breaking（forward-only 允许，但必须 fail-fast + 可诊断）。
- 双视角入口易导致“高熵”：必须明确 canonical，并确保 alias 是薄壳（参数/输出一致）。
- `--json` 输出纯度与 global flags 位置规则是 A 类不变量（见 `docs/ssot/agent-remnote/cli-contract.md`）。

## Reuse candidates

- `writeCommonOptions`（notify/ensure-daemon/wait/dry-run/priority/...）可复用到所有新命令。
- `normalizeOp` + `enqueueOps` 是当前语义命令的标准实现路径（避免手写 ops payload）。
- `RefResolver` 已支持 `remnote://w/<kbId>/<remId>` 作为 ref（应扩展到更多 ID 参数以统一体验）。

