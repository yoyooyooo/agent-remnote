# agent-remnote

English | [简体中文](README.zh-CN.md)

> Programmable RemNote for AI agents: **read locally**, **search via the UI**, **write safely**.

`agent-remnote` is a CLI + RemNote plugin that turns your RemNote knowledge base into a safe automation surface:

- **Read (DB Pull)**: deterministic, read-only queries against local `remnote.db`.
- **Read (Plugin RPC)**: fast Top‑K candidate search (with snippets) via the RemNote plugin over WebSocket.
- **Write (Queue → WS → Plugin)**: safe persistence via an operation queue + WS bridge + plugin executor (official SDK).
- **Agent-friendly I/O**: clean stdout, diagnostics to stderr, and a stable `--json` envelope.

This repo is optimized for the “agent calls CLI” workflow, not for humans clicking around.

## Safety boundaries

- Never modify RemNote’s official database (`remnote.db`) directly.
- All writes must go through the “queue → WS → plugin executor” pipeline.

## Why this exists

- RemNote data is local, but not easily scriptable.
- Direct DB writes are unsafe (indexes / sync / upgrades).
- Agents need reliable, machine-friendly interfaces (stable JSON, predictable fallbacks).

## Documentation

- Docs index: `docs/README.md`
- Protocols & contracts (SSoT): `docs/ssot/agent-remnote/README.md`
- Guides (debugging, tmux, etc.): `docs/guides/`
- Contribution guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`

## Use cases (RemNote workflows)

- Find TODOs quickly (read-only): `agent-remnote --json todo list --status unfinished --sort updatedAtDesc --limit 20`
- List built-in powerups (read-only): `agent-remnote --json powerup list`
- Resolve a powerup (read-only): `agent-remnote --json powerup resolve --powerup "Todo"`
- Mark a Rem as Todo (safe write): `agent-remnote --json todo add --rem "<rem_id>" --wait`
- Dump everything into one place (safe write): `agent-remnote --json import markdown --ref "page:Inbox" --file ./note.md`
- Process external info → summarize → auto-file into RemNote: generate `./summary.md` then `agent-remnote --json import markdown --ref "page:Reading" --file ./summary.md`

## Installation (users)

### Prerequisites

- RemNote Desktop (for the plugin executor).
- Node.js 20+ (for the CLI).

### CLI

```bash
npm i -g agent-remnote
agent-remnote --help
```

### RemNote plugin (Executor)

You need the plugin for **writes** and **Plugin RPC** reads.

1) Download `PluginZip.zip` (from Releases, if available), or build it from source (see “Development & debugging”).  
2) In RemNote → Settings → Plugins → Developer → Install From Zip → select `PluginZip.zip`.

### WS bridge (daemon)

```bash
agent-remnote daemon ensure
agent-remnote --json daemon health
```

### Verify everything is connected

```bash
agent-remnote --json daemon status
```

You should see a `remnote-plugin` client and an `activeWorkerConnId`.

## Quick start (users)

Plugin RPC (fast candidates, requires an active RemNote window + plugin):

```bash
agent-remnote --json plugin search --query "keyword" --timeout-ms 3000
```

DB Pull (deterministic fallback, works without the plugin):

```bash
agent-remnote --json search --query "keyword" --timeout-ms 30000
```

Safety defaults: most list-like read commands are paginated with a default `--limit` (and an enforced max) to avoid scanning huge vaults.

Safe write + progress tracking:

```bash
agent-remnote --json import markdown --ref "page:Inbox" --file ./note.md --idempotency-key "inbox:note:2026-01-25"
agent-remnote --json queue wait --txn "<txn_id>"
```

## Real-world recipes

All write recipes require a connected RemNote window + plugin (active worker) and a running daemon. Check: `agent-remnote --json daemon status`.

### 1) Research summary → Reading page (Markdown import)

```bash
agent-remnote --json import markdown --ref "page:Reading" --file ./summary.md --idempotency-key "reading:summary:2026-01-26"
agent-remnote --json queue wait --txn "<txn_id>"
```

### 2) Daily Notes journaling (append or prepend)

```bash
agent-remnote --json daily write --md-file ./daily.md --create-if-missing --idempotency-key "daily:2026-01-26:journal"
agent-remnote --json queue wait --txn "<txn_id>"
```

### 3) Import a WeChat article as an outline (optional)

Requires a Chromium-based browser with CDP enabled (e.g. Chrome with `--remote-debugging-port=9222`).

```bash
agent-remnote --json import wechat outline --url "<wechat_url>" --ref "page:Inbox" --cdp-port 9222 --idempotency-key "wechat:<id>"
agent-remnote --json queue wait --txn "<txn_id>"
```

### 4) Multi-step writes with dependencies (`plan apply`)

Create `plan.json`:

```json
{
  "version": 1,
  "steps": [
    { "as": "idea", "action": "write.bullet", "input": { "parent_id": "id:<parentRemId>", "text": "First bullet" } },
    { "action": "tag.add", "input": { "rem_id": "@idea", "tag_id": "id:<tagId>" } }
  ]
}
```

```bash
agent-remnote --json plan apply --payload @plan.json --idempotency-key "plan:demo:2026-01-26"
agent-remnote --json queue wait --txn "<txn_id>"
```

## Usage with AI agents

### Read: two complementary channels

1) **Plugin RPC (fast candidates)**  
Requires a connected RemNote window + plugin (active worker). Returns Top‑K candidates with snippets.

```bash
agent-remnote --json plugin search --query "keyword" --timeout-ms 3000
```

2) **DB Pull (deterministic fallback)**  
Read-only query against `remnote.db` (works without the plugin).

```bash
agent-remnote --json search --query "keyword" --timeout-ms 30000
```

If Plugin RPC is unavailable, the command returns `ok=false` with `error.code` and `nextActions` (you can always fall back to DB Pull).

### Write: queue + plugin executor

Writes never touch `remnote.db` directly. They go through the operation queue and are applied by the plugin via the official SDK.

```bash
agent-remnote --json import markdown --ref "page:Inbox" --file ./note.md --idempotency-key "inbox:note:2026-01-25"
agent-remnote --json queue wait --txn "<txn_id>"
```

Tip: always pass a stable `--idempotency-key` for “the same logical write” so retries don’t create duplicate Rems.

### Bulk-safe writes (bundle)

When writing large content, injecting hundreds of Rems directly under an existing page is risky and hard to clean up.

`import markdown` and `daily write` support a **bundle mode**: large inputs (default: ≥80 lines or ≥5000 chars) are wrapped into a single “container Rem”, and the container Rem text is the bundle title.

- Disable bundling: `--bulk never`
- Force bundling: `--bulk always`
- Customize the container: `--bundle-title ...`
- Reduce UI “waterfall” flicker: `--staged` (imports under a temporary container, then moves roots into place once)

Example:

```bash
agent-remnote --json import markdown --ref "page:Reading" --file ./big.md \
  --bundle-title "X thread: Remotion workflow — Remotion + skills pipeline; align cuts to TTS segment lengths" \
  --idempotency-key "reading:x:2015245301603549328"
agent-remnote --json queue wait --txn "<txn_id>"
```

### Targeting the right window: active worker

Only the most recently active RemNote window is elected as the **active worker**:

- It is the only connection allowed to consume queued ops.
- It is also the target for Plugin RPC (e.g. `plugin search`).

If you have multiple RemNote windows: click the one you want to target.

### Agent integration (Skill) — Claude Code / Codex

This repo ships a `remnote` Skill (Agent Skills spec). Install it via https://github.com/vercel-labs/add-skill :

```bash
npx add-skill https://github.com/yoyooyooo/agent-renmote -g -a codex -a claude-code -y --skill remnote
```

## Command cheat sheet

| Goal | Command |
| --- | --- |
| Health / liveness | `agent-remnote --json daemon health` |
| Inspect daemon + clients + active worker | `agent-remnote --json daemon status` |
| Plugin candidate search (Top‑K) | `agent-remnote --json plugin search --query "..."` |
| DB search (fallback) | `agent-remnote --json search --query "..."` |
| UI context snapshot (IDs) | `agent-remnote --json plugin ui-context snapshot` |
| Write Markdown to a page | `agent-remnote --json import markdown --ref "page:..." --file ./note.md` |
| Write Markdown (insert at top) | `agent-remnote --json import markdown --ref "page:..." --file ./note.md --position 0` |
| Write Markdown (staged insert) | `agent-remnote --json import markdown --ref "page:..." --file ./note.md --staged` |
| Create a Portal | `agent-remnote --json portal create --parent "<parent_id>" --target "<rem_id>" --wait` |
| Create a Rem | `agent-remnote --json rem create --parent "<parent_id>" --text "..." --wait` |
| Move a Rem | `agent-remnote --json rem move --rem "<rem_id>" --parent "<parent_id>" --position 0 --wait` |
| Update Rem text | `agent-remnote --json rem text --rem "<rem_id>" --text "..." --wait` |
| Tag a Rem | `agent-remnote --json tag add --rem "<rem_id>" --tag "<tag_id>"` |
| Un-tag a Rem | `agent-remnote --json tag remove --rem "<rem_id>" --tag "<tag_id>"` |
| Powerup schema (Tag + properties) | `agent-remnote --json powerup schema --powerup "Todo" --include-options` |
| Powerup apply (tag + set values) | `agent-remnote --json powerup apply --rem "<rem_id>" --powerup "Todo" --values '[{\"propertyName\":\"Status\",\"value\":\"Unfinished\"}]' --wait` |
| Todo: mark done | `agent-remnote --json todo done --rem "<rem_id>" --wait` |
| Table: create a table | `agent-remnote --json table create --table-tag "<tag_id>" --parent "<parent_id>" --wait` |
| Table: add a row | `agent-remnote --json table record add --table-tag "<tag_id>" --parent "<parent_id>" --text "..."` |
| Delete a Rem | `agent-remnote --json rem delete --rem "<rem_id>"` |
| Batch write plan (multi-step) | `agent-remnote --json plan apply --payload @plan.json` |
| Raw ops enqueue (advanced) | `agent-remnote --json apply --payload @ops.json` |
| Wait for completion | `agent-remnote --json queue wait --txn "<txn_id>"` |
| Queue stats | `agent-remnote --json queue stats` |
| Queue stats (+ conflict summary) | `agent-remnote --json queue stats --include-conflicts` |
| Conflict surface report | `agent-remnote --json queue conflicts` |
| Debug logs | `agent-remnote daemon logs --lines 200` |

Most write commands also support `--wait --timeout-ms <ms> --poll-ms <ms>` to close the loop in a single call.

## Optional: tmux statusline (RN segment)

If you use tmux, this repo includes a small helper for a right-side `RN` segment that reflects daemon liveness and UI selection:

- Hidden when the daemon is down/off/stale (shows nothing).
- Grey background when the daemon is up but no clients are connected.
- Warm background when at least one client is connected (and the label follows selection: `RN` / `TXT` / `N rems`).
- Appends `↓N` when there are queued ops (`pending` + `in_flight`).

It is implemented by reading the daemon state file (`~/.agent-remnote/ws.bridge.state.json`) + store DB, so tmux does not need to spawn Node on every redraw.

- tmux-friendly script: `scripts/tmux/remnote-right-segment.tmux.sh`
- Advanced value script (returns `"<bg>\t<value>"`): `scripts/tmux/remnote-right-value.sh`

Fast path dependency: `jq` (recommended) and `sqlite3` (optional, for `↓N`). Without `jq`, it degrades to a best-effort CLI fallback.

See `docs/guides/tmux-statusline.md` for wiring and knobs.

## Architecture (high level)

```mermaid
flowchart LR
  subgraph Read
    DB[(remnote.db<br/>read-only)] -->|DB Pull| CLI[agent-remnote CLI]
    CLI -->|SearchRequest| WS[WS bridge / daemon]
    WS -->|SearchRequest| PLG[RemNote plugin]
    PLG -->|SearchResponse (Top‑K + snippets)| WS
    WS -->|SearchResponse| CLI
  end

  subgraph Write
    CLI -->|enqueue ops| S[(store.sqlite)]
    CLI -->|notify/kick (StartSync)| WS
    WS -->|OpDispatchBatch / StartSync| PLG
    PLG -->|OpAck| WS
    WS -->|update txn/op status| S
  end
```

## Troubleshooting

- `agent-remnote daemon ensure` prints `started: false`: it can mean “already healthy, nothing to start”; use `agent-remnote --json daemon status` to confirm.
- No `remnote-plugin` client in `daemon status`: reinstall the plugin zip and keep a RemNote window open.
- Plugin RPC fails / no `activeWorkerConnId`: click inside the target RemNote window to refresh UI activity.

## Configuration

- RemNote DB (read-only): `--remnote-db` / `REMNOTE_DB`
- Store DB: `--store-db` / `REMNOTE_STORE_DB` / `STORE_DB` (default: `~/.agent-remnote/store.sqlite`; legacy: `--queue-db` / `REMNOTE_QUEUE_DB` / `QUEUE_DB`)
- WS endpoint: `--daemon-url` / `REMNOTE_DAEMON_URL` / `DAEMON_URL` (or `--ws-port` / `REMNOTE_WS_PORT` / `WS_PORT`, default port 6789)
- WS state file: `REMNOTE_WS_STATE_FILE` / `WS_STATE_FILE` (default: `~/.agent-remnote/ws.bridge.state.json`)
- Daemon pidfile (env-only): `REMNOTE_DAEMON_PID_FILE` / `DAEMON_PID_FILE` (default: `~/.agent-remnote/ws.pid`)
- Daemon log file (env-only): `REMNOTE_DAEMON_LOG_FILE` / `DAEMON_LOG_FILE` (default: `~/.agent-remnote/ws.log`)
- Active worker (auto): determined by recent RemNote UI activity (selection/uiContext); inspect via `agent-remnote daemon status --json` (`activeWorkerConnId`)
- repo: `--repo` / `AGENT_REMNOTE_REPO`
- WS scheduler (env-only): `REMNOTE_WS_SCHEDULER` (set to `0` to disable conflict-aware scheduling; debug only)
- tmux refresh (env-only): `REMNOTE_TMUX_REFRESH` / `REMNOTE_TMUX_REFRESH_MIN_INTERVAL_MS`
- status line file mode (env-only): `REMNOTE_STATUS_LINE_FILE` / `REMNOTE_STATUS_LINE_MIN_INTERVAL_MS` / `REMNOTE_STATUS_LINE_DEBUG` / `REMNOTE_STATUS_LINE_JSON_FILE`
- tmux statusline (RN segment): see `docs/guides/tmux-statusline.md`

Useful: `agent-remnote config print` shows the resolved values (including derived/default file paths).

## Development & debugging (from source)

### 1) Install dependencies

```bash
bun install
```

### 2) Start the WS bridge (daemon)

```bash
npm run dev:ws
```

Default WS endpoint: `ws://localhost:6789/ws`

### 3) Build the plugin zip

```bash
cd packages/plugin
npm run build
```

Output: `packages/plugin/PluginZip.zip`

### 4) Run the CLI from source

```bash
npm run dev -- --help
```

### 5) Quality gate

```bash
npm run check
```

## Contributing

PRs and issues are welcome. Please read `CONTRIBUTING.md` first for setup, style, and validation expectations.

## Security

If you discover a vulnerability, please follow `SECURITY.md` instead of opening a public issue.

## License

MIT. See `LICENSE`.
