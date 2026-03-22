# Quickstart: 030-remnote-business-command-mode-parity

日期：2026-03-22

## 目标

给实现完成后的最小验收路径，重点验证：

- authoritative inventory 已明确
- Wave 1 executable registry 已与 inventory 对齐
- Wave 1 business commands 在 local/remote 下保持 mode parity
- Wave 1 command files 不再直接做 mode switch
- 默认 `/v1` 和非默认 `/remnote/v1` 都可工作
- success / stable-failure comparison 都可重复

## 验收模式

### A. Deterministic Gate

用于 CI / premerge / 本地稳定复现。

要求：

- 使用确定性 fixture builders
- 不依赖人工宿主环境
- 覆盖 inventory -> contract -> test mapping

### B. Manual Host Smoke

用于在真实宿主环境做最后抽查。

要求：

- 真实 API runtime
- 真实 workspace / plugin / selection context

## A. Deterministic Gate 步骤

1. 跑 command inventory drift checks。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/remnote-business-command-classification.contract.test.ts
```

2. 跑 inventory -> executable registry 对齐检查。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/remnote-business-command-contracts.contract.test.ts
```

3. 跑 Wave 1 command-layer architecture guards。

```bash
npm test --workspace agent-remnote -- \
  tests/contract/remnote-business-command-architecture.contract.test.ts
```

4. 跑 default `/v1` remote-first gate。

```bash
REMNOTE_PARITY_BASE_PATH=/v1 \
npm test --workspace agent-remnote -- \
  tests/integration/remnote-business-command-mode-parity.integration.test.ts \
  tests/contract/remnote-business-command-parity.contract.test.ts
```

5. 跑 non-default `/remnote/v1` remote-first gate。

```bash
REMNOTE_PARITY_BASE_PATH=/remnote/v1 \
npm test --workspace agent-remnote -- \
  tests/integration/remnote-business-command-mode-parity.integration.test.ts \
  tests/contract/remnote-business-command-parity.contract.test.ts
```

## B. Manual Host Smoke 步骤

1. 启动 API，使用默认 `/v1`。

```bash
agent-remnote api start
```

2. 抽查一轮 Wave 1 business commands。

```bash
export REMNOTE_API_BASE_URL="http://127.0.0.1:3000/v1"
```

3. 再启动一轮非默认 base path。

```bash
agent-remnote --api-base-path /remnote/v1 api restart
export REMNOTE_API_BASE_URL="http://127.0.0.1:3000/remnote/v1"
```

4. 重跑 Wave 1 关键命令子集。

建议至少抽查：

- `search`
- `rem outline`
- `plugin current`
- `plugin selection current`
- `daily write`
- `rem create`
- `rem move`
- `portal create`
- `rem children append`
- `tag add`

## 通过标准

- authoritative inventory 与 code mirror 无漂移
- Wave 1 executable registry 与 inventory 无漂移
- Wave 1 command files 通过 architecture guard，无直接 mode 分支
- Wave 1 每条 command 都至少命中一条 remote-first case
- default `/v1` 全绿
- non-default `/remnote/v1` 全绿
- success comparison 无 contract drift
- defined stable-failure comparison 无 contract drift
- docs/skill 对 business vs operational boundary、registry、runtime 的叙述一致
