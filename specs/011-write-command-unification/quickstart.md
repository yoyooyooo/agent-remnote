# Quickstart: Write Command Unification（验收清单草案）

> 本清单用于 011 的实现验收；在实现阶段补齐具体命令与期望输出。

## Acceptance Checklist

- [x] raw 入队只有一个推荐入口（`write advanced ops`），默认 `notify/ensure-daemon` 策略一致（不让 Agent 走“写完不发”的长链路）。
- [x] 对 `write md` / `write bullet` / `write replace text`：失败时返回稳定错误码 + 可行动 `hint` + 英文 `nextActions[]`；成功时返回可闭环 ids。
- [x] 对写入类命令：支持 `--wait/--timeout-ms` 在同一次调用中等待 txn 终态；超时/失败不会诱导重复写入，而是返回稳定错误码 + `nextActions[]` 引导排障。
- [x] `--json` 与 `--ids` 输出纯净（stdout 只有约定格式）。

> Evidence: `specs/011-write-command-unification/acceptance.md`
