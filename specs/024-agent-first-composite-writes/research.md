# 研究记录：024-agent-first-composite-writes

日期：2026-03-19

## Decision 1：Only add the missing atomic action

### Decision

本特性只给 `apply` 增加缺失的 portal atomic action。

### Rationale

- 这是真正缺的能力
- 再往上封装 workflow command 会扩大 CLI surface

## Decision 2：Use one canonical action name

### Decision

只保留一个 canonical action name：`portal.create`。

### Rationale

- 双名字会增加 action vocabulary
- minimal surface 优先于语义同义词

## Decision 3：Keep composition in parameters, not in new commands

### Decision

组合能力来自 actions + alias + 参数，不来自新命令。

### Rationale

- 这符合 agent-first 的原子能力暴露原则
- Skill 可以在此之上拼出具体场景

## Decision 4：Skills own scenario recipes

### Decision

像周报、页面装配、总结卡片这类场景，保留在 Skill / examples 层。

### Rationale

- CLI 负责 primitive
- Skill 负责 scene composition
