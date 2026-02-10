# Contributing

Thanks for contributing to `agent-remnote`.

## Before you start

- Read `README.md` (or `README.zh-CN.md`) for architecture and safety boundaries.
- Read `docs/ssot/agent-remnote/README.md` before changing protocol, schema, or CLI behavior.
- Never write directly to RemNote official DB (`remnote.db`). All writes must go through queue → WS → plugin executor.

## Development setup

- Runtime: Node.js 20+
- Install dependencies: `bun install`
- Start daemon (dev): `npm run dev:ws`
- Run CLI help: `node --import tsx packages/agent-remnote/src/main.ts --help`

## Quality checks

Run these before opening a PR:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`

## Pull request guidelines

- Keep changes focused and minimal.
- Update docs when behavior/contracts change (`README.md`, `README.zh-CN.md`, and related `docs/ssot/**`).
- Prefer forward-only evolution: no long-term compatibility layers.
- Ensure user-visible CLI outputs remain English.

## Commit messages

Use clear, scoped messages that explain intent and impact.
