# agent-remnote

A CLI + Host API for reading local RemNote data and writing safely through queue -> WS bridge -> RemNote plugin.

## Install

```bash
npm i -g agent-remnote
```

## Quick start

```bash
agent-remnote --json doctor
agent-remnote --json daemon status
agent-remnote --json plugin current --compact
```

## Remote mode

```bash
agent-remnote --api-base-url http://host.docker.internal:3000 search --query "keyword"
agent-remnote --api-base-url http://host.docker.internal:3000 plugin current --compact
```

## Docs

See the repository root `README.md` and `README.zh-CN.md` for full documentation.
