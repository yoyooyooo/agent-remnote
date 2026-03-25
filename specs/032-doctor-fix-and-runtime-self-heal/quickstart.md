# Quickstart

```bash
agent-remnote --json doctor
agent-remnote --json doctor --fix
agent-remnote --json search --query "keyword"
```

Expected:

- `doctor --json` returns structured checks
- `doctor --fix` returns checks, fixes, and restart summary, and may auto-restart trusted live mismatched runtimes
- `search --json` prints one JSON envelope and keeps stdout machine-readable
