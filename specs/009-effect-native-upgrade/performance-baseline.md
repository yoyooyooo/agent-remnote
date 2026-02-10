# 009 NFR-004 Performance Baseline

- Date: 2026-01-25T14:28:39.123Z
- Node: v22.21.1
- Platform: darwin arm64
- CPU: 12 x Apple M2 Max

## Benchmarks (CLI)

| Case | Runs | p50 (ms) | p95 (ms) | Max (ms) |
|---|---:|---:|---:|---:|
| cli_help | 10 | 913.94 | 942.34 | 942.34 |
| enqueue_write_bullet | 15 | 936.55 | 1017.04 | 1017.04 |
| daemon_health_stub | 15 | 927.45 | 994.09 | 994.09 |
| daemon_status_stub | 15 | 912.5 | 937.49 | 937.49 |
| read_search_plugin_stub | 15 | 934.78 | 988.75 | 988.75 |

## Daemon (ws-bridge)

- ws_url: ws://localhost:62621/ws
- ready_ms: 1188.206625
- ws_state_file: <tmp>/agent-remnote-bench-009/.../ws.bridge.state.json
- ws_state_file_first_seen_ms: 0
- ws_state_file_mtime_changes_in_2s: 3

## How to Reproduce

```bash
npm run build --workspace agent-remnote
npm run bench:nfr-004 --workspace agent-remnote
```

## Optional: Hard Gate (default off)

This repository does not run performance gates by default to avoid false positives across machines / background load.

To enable an optional hard gate on the current machine (compares against `performance-baseline.json`):

```bash
npm run build --workspace agent-remnote
npm run gate:nfr-004 --workspace agent-remnote
```

Thresholds can be tuned via env vars (defaults are intentionally loose):

- `REMNOTE_NFR_004_GATE_P95_RATIO` (default `0.25`)
- `REMNOTE_NFR_004_GATE_P95_MS` (default `200`)
- `REMNOTE_NFR_004_GATE_READY_RATIO` (default `0.25`)
- `REMNOTE_NFR_004_GATE_READY_MS` (default `300`)

Notes: This is a baseline for detecting observable regressions on key paths.
