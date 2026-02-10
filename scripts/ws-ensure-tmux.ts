import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

type HealthcheckResult = { ok: true; url: string; rtt_ms: number } | { ok: false; url: string; error: string };

function formatError(e: unknown): string {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  const anyErr = e as any;
  if (anyErr?.errors && Array.isArray(anyErr.errors)) {
    const parts = anyErr.errors
      .map((inner: any) => {
        const code = inner?.code ? String(inner.code) : '';
        const msg = inner?.message ? String(inner.message) : String(inner);
        return code ? `${code}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length > 0) return `AggregateError(${parts.join('; ')})`;
  }
  if (typeof anyErr?.message === 'string') return anyErr.message;
  return String(e);
}

function parseTimeoutMs(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

async function healthcheckWsBridge(url: string, timeoutMs: number): Promise<HealthcheckResult> {
  const startedAt = Date.now();

  return await new Promise<HealthcheckResult>((resolve) => {
    const ws = new WebSocket(url);

    let done = false;
    const finish = (result: HealthcheckResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, url, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ type: 'Hello' }));
      } catch (e: any) {
        finish({ ok: false, url, error: String(e?.message || e || 'failed to send Hello') });
      }
    });

    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg?.type === 'HelloAck' && msg?.ok === true) {
        finish({ ok: true, url, rtt_ms: Date.now() - startedAt });
      }
    });

    ws.on('error', (e: any) => {
      finish({ ok: false, url, error: formatError(e) });
    });

    ws.on('close', () => {
      finish({ ok: false, url, error: 'connection closed' });
    });
  });
}

function tmuxInstalled(): boolean {
  const res = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if ((res as any).error?.code === 'ENOENT') return false;
  return res.status === 0;
}

function tmuxHasSession(session: string): boolean {
  const res = spawnSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' });
  return res.status === 0;
}

function tmuxKillSession(session: string) {
  spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' });
}

function tmuxStartSession(params: { session: string; cwd: string; cmd: string }) {
  const res = spawnSync('tmux', ['new-session', '-d', '-s', params.session, '-n', 'ws', '-c', params.cwd, params.cmd], {
    encoding: 'utf8',
  });
  if ((res as any).error) {
    throw new Error(String((res as any).error?.message || (res as any).error));
  }
  if (res.status !== 0) {
    throw new Error(String(res.stderr || res.stdout || `tmux exited with ${res.status}`));
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function envOrArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) {
    const v = process.argv[idx + 1];
    if (v && !v.startsWith('--')) return v;
  }
  return undefined;
}

function shQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\\\''`)}'`;
}

function normalizePort(value: string | undefined): number | undefined {
  const n = value ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const port = Math.floor(n);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function wsUrlFromPort(port: number): string {
  return `ws://localhost:${port}/ws`;
}

async function main() {
  const urlArg = envOrArg('--url') || process.argv[2] || process.env.REMNOTE_DAEMON_URL || process.env.DAEMON_URL;
  const port =
    normalizePort(envOrArg('--port')) ||
    normalizePort(process.env.REMNOTE_WS_PORT) ||
    normalizePort(process.env.WS_PORT) ||
    6789;
  const url = urlArg || wsUrlFromPort(port);
  const session =
    envOrArg('--session') || process.env.REMNOTE_WS_TMUX_SESSION || process.env.WS_TMUX_SESSION || 'agent-remnote-ws';

  const startCmd =
    envOrArg('--cmd') || process.env.REMNOTE_WS_START_CMD || process.env.WS_START_CMD || 'npm run dev:ws';

  const connectTimeoutMs = parseTimeoutMs(process.env.WS_TIMEOUT_MS, 1500);
  const maxWaitMs = parseTimeoutMs(process.env.WS_START_TIMEOUT_MS, 15_000);

  // Pre-flight healthcheck: if already running, exit early.
  const pre = await healthcheckWsBridge(url, connectTimeoutMs);
  if (pre.ok) {
    console.log(`OK ws bridge already running: ${pre.url}`);
    return;
  }

  if (!tmuxInstalled()) {
    console.error('tmux is not installed or not available; cannot auto-start the ws bridge.');
    console.error(`healthcheck failed: ${pre.url} (${pre.error})`);
    process.exit(1);
  }

  // Pass env vars into the start command to keep it consistent with the resolved URL/port.
  let envPrefix = '';
  try {
    if (urlArg) {
      envPrefix += `REMNOTE_DAEMON_URL=${shQuote(url)} `;
    } else {
      envPrefix += `REMNOTE_WS_PORT=${shQuote(String(port))} `;
    }
    envPrefix += 'REMNOTE_WS_ENABLED=1 ';
  } catch {
    // ignore
  }

  const fullCmd = `${envPrefix}${startCmd}`.trim();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = (envOrArg('--repo') || process.env.AGENT_REMNOTE_REPO || path.resolve(__dirname, '..')).trim();

  // If the session exists but the service is unreachable, rebuild it (dedicated session name to avoid collateral).
  if (tmuxHasSession(session)) {
    tmuxKillSession(session);
  }

  console.log(`Starting ws bridge in tmux session '${session}'...`);
  tmuxStartSession({ session, cwd: repoRoot, cmd: fullCmd });

  // Wait for startup and retry healthchecks.
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await healthcheckWsBridge(url, connectTimeoutMs);
    if (res.ok) {
      console.log(`OK ws bridge started: ${res.url}`);
      return;
    }
    await sleep(300);
  }

  console.error(`ws bridge still unreachable after startup: ${url}`);
  console.error(`check: tmux attach -t ${session}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(String((e as any)?.message || e));
  process.exit(1);
});
