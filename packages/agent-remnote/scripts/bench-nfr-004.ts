import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

type BenchStats = {
  readonly runs: number;
  readonly min_ms: number;
  readonly p50_ms: number;
  readonly p90_ms: number;
  readonly p95_ms: number;
  readonly max_ms: number;
  readonly mean_ms: number;
};

type Nfr004Payload = {
  readonly spec: string;
  readonly nfr: string;
  readonly date: string;
  readonly machine: {
    readonly platform: string;
    readonly arch: string;
    readonly node: string;
    readonly cpus: number;
    readonly cpu_model: string;
  };
  readonly params: {
    readonly warmupRuns: number;
    readonly runs: number;
    readonly timeoutMs: number;
  };
  readonly cli: {
    readonly node: string;
    readonly cli_js: string;
  };
  readonly stub: {
    readonly ws_url: string;
  };
  readonly cases: ReadonlyArray<{
    readonly name: string;
    readonly args: readonly string[];
    readonly samples_ms: readonly number[];
    readonly stats: BenchStats;
  }>;
  readonly daemon: {
    readonly ws_url: string;
    readonly ready_ms: number | null;
    readonly lifetime_ms: number;
    readonly ws_state_file: string;
    readonly ws_state_file_first_seen_ms: number | null;
    readonly ws_state_file_mtime_changes_in_2s: number | null;
    readonly stderr: string;
  };
};

type BenchCase = {
  readonly name: string;
  readonly args: readonly string[];
  readonly warmupRuns: number;
  readonly runs: number;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly captureStdout?: boolean | undefined;
};

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(ns: bigint): number {
  return Number(ns) / 1e6;
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function mean(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((acc, v) => acc + v, 0) / samples.length;
}

function computeStats(samples: readonly number[]): BenchStats {
  const minMs = samples.length > 0 ? Math.min(...samples) : 0;
  const maxMs = samples.length > 0 ? Math.max(...samples) : 0;
  const meanMs = mean(samples);
  return {
    runs: samples.length,
    min_ms: Number(minMs.toFixed(2)),
    p50_ms: Number(percentile(samples, 50).toFixed(2)),
    p90_ms: Number(percentile(samples, 90).toFixed(2)),
    p95_ms: Number(percentile(samples, 95).toFixed(2)),
    max_ms: Number(maxMs.toFixed(2)),
    mean_ms: Number(meanMs.toFixed(2)),
  };
}

function envNumber(key: string): number | null {
  const raw = process.env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

function readJsonFile<T>(filePath: string): Promise<T> {
  return fs.readFile(filePath, 'utf8').then((raw) => JSON.parse(raw) as T);
}

async function runNodeCliOnce(params: {
  readonly nodePath: string;
  readonly cliPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly captureStdout: boolean;
}): Promise<{ readonly duration_ms: number; readonly exitCode: number; readonly stderr: string }> {
  const startedAt = nowNs();

  return await new Promise((resolve, reject) => {
    const child = spawn(params.nodePath, [params.cliPath, ...params.args], {
      cwd: params.cwd,
      env: params.env,
      stdio: ['ignore', params.captureStdout ? 'pipe' : 'ignore', 'pipe'],
    });

    let stderr = '';
    let timeout: NodeJS.Timeout | null = null;

    const finish = (exitCode: number) => {
      if (timeout) clearTimeout(timeout);
      const durationMs = nsToMs(nowNs() - startedAt);
      resolve({ duration_ms: durationMs, exitCode, stderr });
    };

    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.length > 16_384) stderr = `${stderr.slice(0, 16_384)}…`;
      });
    }

    timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 200).unref();
    }, Math.max(1, params.timeoutMs)).unref();

    child.on('close', (code) => finish(typeof code === 'number' ? code : 1));
  });
}

async function benchCase(params: {
  readonly nodePath: string;
  readonly cliPath: string;
  readonly cwd: string;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly c: BenchCase;
}): Promise<{
  readonly name: string;
  readonly args: readonly string[];
  readonly samples_ms: readonly number[];
  readonly stats: BenchStats;
}> {
  const env = { ...params.baseEnv, ...(params.c.env ?? {}) };
  const captureStdout = params.c.captureStdout ?? false;

  for (let i = 0; i < params.c.warmupRuns; i++) {
    const r = await runNodeCliOnce({
      nodePath: params.nodePath,
      cliPath: params.cliPath,
      args: params.c.args,
      cwd: params.cwd,
      env,
      timeoutMs: params.c.timeoutMs,
      captureStdout,
    });
    if (r.exitCode !== 0) {
      throw new Error(`Warmup failed for ${params.c.name}: exitCode=${r.exitCode} stderr=${JSON.stringify(r.stderr)}`);
    }
    if (r.stderr.trim()) {
      throw new Error(`Warmup produced stderr for ${params.c.name}: ${JSON.stringify(r.stderr)}`);
    }
  }

  const samples: number[] = [];
  for (let i = 0; i < params.c.runs; i++) {
    const r = await runNodeCliOnce({
      nodePath: params.nodePath,
      cliPath: params.cliPath,
      args: params.c.args,
      cwd: params.cwd,
      env,
      timeoutMs: params.c.timeoutMs,
      captureStdout,
    });
    if (r.exitCode !== 0) {
      throw new Error(`Run failed for ${params.c.name}: exitCode=${r.exitCode} stderr=${JSON.stringify(r.stderr)}`);
    }
    if (r.stderr.trim()) {
      throw new Error(`Run produced stderr for ${params.c.name}: ${JSON.stringify(r.stderr)}`);
    }
    samples.push(Number(r.duration_ms.toFixed(2)));
  }

  return {
    name: params.c.name,
    args: params.c.args,
    samples_ms: samples,
    stats: computeStats(samples),
  };
}

async function startStubWsServer(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/ws' });

  await new Promise<void>((resolve) => {
    wss.on('listening', () => resolve());
  });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let msg: any;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      const send = (payload: unknown) => {
        try {
          ws.send(JSON.stringify(payload));
        } catch {}
      };

      if (msg?.type === 'Hello') {
        send({ type: 'HelloAck', ok: true });
        return;
      }

      if (msg?.type === 'QueryClients') {
        send({ type: 'Clients', clients: [], activeWorkerConnId: undefined });
        return;
      }

      if (msg?.type === 'TriggerStartSync') {
        send({ type: 'StartSyncTriggered', sent: 0, activeConnId: undefined, reason: 'no_active_worker', nextActions: [] });
        return;
      }

      if (msg?.type === 'SearchRequest') {
        const requestId = typeof msg?.requestId === 'string' ? msg.requestId : '';
        send({
          type: 'SearchResponse',
          requestId,
          ok: true,
          budget: { timeoutMs: msg?.timeoutMs ?? null, limitRequested: msg?.limit ?? null, durationMs: 0 },
          results: [],
          nextActions: [],
        });
      }
    });
  });

  const addr = wss.address();
  if (typeof addr !== 'object' || !addr) throw new Error('Failed to bind stub WS server');
  const url = `ws://${addr.address}:${addr.port}/ws`;

  return {
    url,
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, 'localhost', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        server.close(() => reject(new Error('Failed to resolve free port')));
        return;
      }
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function helloHandshake(url: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;

    const finishOk = () => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      resolve();
    };

    const finishErr = (err: unknown) => {
      if (done) return;
      done = true;
      try {
        ws.terminate();
      } catch {}
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const t = setTimeout(() => finishErr(new Error(`timeout after ${timeoutMs}ms`)), Math.max(1, timeoutMs)).unref();

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ type: 'Hello' }));
      } catch (e) {
        finishErr(e);
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
        clearTimeout(t);
        finishOk();
      }
    });

    ws.on('error', (e) => {
      clearTimeout(t);
      finishErr(e);
    });
    ws.on('close', () => {
      if (done) return;
      clearTimeout(t);
      finishErr(new Error('connection closed'));
    });
  });
}

async function waitForDaemon(url: string, timeoutMs: number): Promise<number> {
  const start = nowNs();
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let lastErr: unknown = null;

  while (Date.now() < deadline) {
    try {
      await helloHandshake(url, 1000);
      return nsToMs(nowNs() - start);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  throw new Error(`Daemon did not become ready within ${timeoutMs}ms: ${String((lastErr as any)?.message || lastErr)}`);
}

async function pollFileMtime(params: {
  readonly filePath: string;
  readonly intervalMs: number;
  readonly windowMs: number;
}): Promise<{ readonly changes: number; readonly firstSeenMs: number | null }> {
  let changes = 0;
  let lastMtime: number | null = null;
  let firstSeenMs: number | null = null;

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1, params.windowMs);
  while (Date.now() < deadline) {
    const st = await fs.stat(params.filePath).catch(() => null);
    if (st) {
      if (firstSeenMs === null) firstSeenMs = Date.now() - startedAt;
      const mtime = st.mtimeMs;
      if (lastMtime !== null && mtime !== lastMtime) changes++;
      lastMtime = mtime;
    }
    await new Promise((r) => setTimeout(r, Math.max(1, params.intervalMs)));
  }

  return { changes, firstSeenMs };
}

async function main() {
  const mode: 'record' | 'check' = process.argv.includes('--check') ? 'check' : 'record';

  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptPath);
  const packageRoot = path.resolve(scriptDir, '..');
  const repoRoot = path.resolve(packageRoot, '..', '..');
  const specDir = path.join(repoRoot, 'specs', '009-effect-native-upgrade');

  const baselinePath = path.join(specDir, 'performance-baseline.json');
  const baseline =
    mode === 'check'
      ? await readJsonFile<Nfr004Payload>(baselinePath).catch(() => {
          throw new Error(`Baseline not found: ${baselinePath}. Run \`npm run bench:nfr-004 --workspace agent-remnote\` first.`);
        })
      : null;

  const distMain = path.join(packageRoot, 'dist', 'main.js');
  const distOk = await fs
    .stat(distMain)
    .then((st) => st.isFile())
    .catch(() => false);
  if (!distOk) {
    console.error(`dist/main.js not found: ${distMain}`);
    console.error('Run `npm run build --workspace agent-remnote` first.');
    process.exitCode = 2;
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-bench-009-'));
  const tmpHome = path.join(tmpDir, 'home');
  const queueDb = path.join(tmpDir, 'queue.sqlite');
  await fs.mkdir(tmpHome, { recursive: true });

  const nodePath = process.execPath;
  const cliPath = path.join(packageRoot, 'cli.js');

  const stub = await startStubWsServer();

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tmpHome,
    REMNOTE_QUEUE_DB: queueDb,
    REMNOTE_TMUX_REFRESH: '0',
    REMNOTE_DAEMON_URL: stub.url,
  };

  const benchConfig = {
    warmupRuns: 3,
    runs: 15,
    timeoutMs: 10_000,
  } as const;

  const cases: readonly BenchCase[] = [
    {
      name: 'cli_help',
      args: ['--help'],
      warmupRuns: 2,
      runs: 10,
      timeoutMs: 10_000,
      captureStdout: false,
    },
    {
      name: 'enqueue_write_bullet',
      args: ['--json', 'write', 'bullet', '--parent', 'dummy-parent', '--text', 'hello', '--no-notify', '--no-ensure-daemon'],
      warmupRuns: benchConfig.warmupRuns,
      runs: benchConfig.runs,
      timeoutMs: benchConfig.timeoutMs,
      captureStdout: false,
    },
    {
      name: 'daemon_health_stub',
      args: ['--json', 'daemon', 'health'],
      warmupRuns: benchConfig.warmupRuns,
      runs: benchConfig.runs,
      timeoutMs: benchConfig.timeoutMs,
      captureStdout: false,
    },
    {
      name: 'daemon_status_stub',
      args: ['--json', 'daemon', 'status'],
      warmupRuns: benchConfig.warmupRuns,
      runs: benchConfig.runs,
      timeoutMs: benchConfig.timeoutMs,
      captureStdout: false,
    },
    {
      name: 'read_search_plugin_stub',
      args: ['--json', 'read', 'search-plugin', '--query', 'hello', '--timeout-ms', '250', '--no-ensure-daemon'],
      warmupRuns: benchConfig.warmupRuns,
      runs: benchConfig.runs,
      timeoutMs: benchConfig.timeoutMs,
      captureStdout: false,
    },
  ];

  const results: any[] = [];
  for (const c of cases) {
    console.log(`Benchmarking ${c.name} (warmup=${c.warmupRuns}, runs=${c.runs})...`);
    results.push(await benchCase({ nodePath, cliPath, cwd: packageRoot, baseEnv, c }));
  }

  console.log('Benchmarking daemon serve state file writes...');
  const daemonPort = await getFreePort();
  const daemonUrl = `ws://localhost:${daemonPort}/ws`;
  const wsStatePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');

  const daemonEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tmpHome,
    REMNOTE_QUEUE_DB: queueDb,
    REMNOTE_TMUX_REFRESH: '0',
    REMNOTE_WS_PORT: String(daemonPort),
  };

  const daemon = spawn(nodePath, [cliPath, 'daemon', 'serve'], {
    cwd: packageRoot,
    env: daemonEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let daemonStderr = '';
  if (daemon.stderr) {
    daemon.stderr.setEncoding('utf8');
    daemon.stderr.on('data', (chunk: string) => {
      daemonStderr += chunk;
      if (daemonStderr.length > 16_384) daemonStderr = `${daemonStderr.slice(0, 16_384)}…`;
    });
  }

  const daemonStartedAt = nowNs();

  let daemonReadyMs: number | null = null;
  let stateWrite: { readonly changes: number; readonly firstSeenMs: number | null } | null = null;
  try {
    daemonReadyMs = await waitForDaemon(daemonUrl, 10_000);

    const pollPromise = pollFileMtime({ filePath: wsStatePath, intervalMs: 50, windowMs: 2_000 });
    const churn = 12;
    for (let i = 0; i < churn; i++) {
      await helloHandshake(daemonUrl, 2000).catch(() => {});
    }
    stateWrite = await pollPromise;
  } finally {
    try {
      daemon.kill('SIGTERM');
    } catch {}
    const exited = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 1500).unref();
      daemon.on('close', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
    if (!exited) {
      try {
        daemon.kill('SIGKILL');
      } catch {}
    }
  }

  const daemonLifetimeMs = nsToMs(nowNs() - daemonStartedAt);

  const machine = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model ?? '',
  };

  const payload: Nfr004Payload = {
    spec: '009-effect-native-upgrade',
    nfr: 'NFR-004',
    date: new Date().toISOString(),
    machine,
    params: {
      warmupRuns: benchConfig.warmupRuns,
      runs: benchConfig.runs,
      timeoutMs: benchConfig.timeoutMs,
    },
    cli: {
      node: nodePath,
      cli_js: cliPath,
    },
    stub: {
      ws_url: stub.url,
    },
    cases: results,
    daemon: {
      ws_url: daemonUrl,
      ready_ms: daemonReadyMs,
      lifetime_ms: Number(daemonLifetimeMs.toFixed(2)),
      ws_state_file: wsStatePath,
      ws_state_file_first_seen_ms: stateWrite?.firstSeenMs ?? null,
      ws_state_file_mtime_changes_in_2s: stateWrite?.changes ?? null,
      stderr: daemonStderr.trim() ? daemonStderr : '',
    },
  };

  if (mode === 'check') {
    const p95Ratio = envNumber('REMNOTE_NFR_004_GATE_P95_RATIO') ?? 0.25;
    const p95Ms = envNumber('REMNOTE_NFR_004_GATE_P95_MS') ?? 200;
    const readyRatio = envNumber('REMNOTE_NFR_004_GATE_READY_RATIO') ?? 0.25;
    const readyMs = envNumber('REMNOTE_NFR_004_GATE_READY_MS') ?? 300;

    const baselineCases = new Map(baseline?.cases.map((c) => [c.name, c]) ?? []);
    const currentCases = new Map(payload.cases.map((c) => [c.name, c]));

    const regressions: Array<{
      readonly name: string;
      readonly metric: 'p95_ms' | 'ready_ms';
      readonly baseline: number;
      readonly current: number;
      readonly limit: number;
    }> = [];

    for (const [name, b] of baselineCases) {
      const cur = currentCases.get(name);
      if (!cur) {
        regressions.push({ name, metric: 'p95_ms', baseline: b.stats.p95_ms, current: Infinity, limit: b.stats.p95_ms });
        continue;
      }
      const limit = b.stats.p95_ms * (1 + p95Ratio) + p95Ms;
      if (cur.stats.p95_ms > limit) {
        regressions.push({ name, metric: 'p95_ms', baseline: b.stats.p95_ms, current: cur.stats.p95_ms, limit });
      }
    }

    const bReady = baseline?.daemon.ready_ms;
    const cReady = payload.daemon.ready_ms;
    if (typeof bReady === 'number' && Number.isFinite(bReady) && typeof cReady === 'number' && Number.isFinite(cReady)) {
      const limit = bReady * (1 + readyRatio) + readyMs;
      if (cReady > limit) {
        regressions.push({ name: 'daemon_ready', metric: 'ready_ms', baseline: bReady, current: cReady, limit });
      }
    }

    const pass = regressions.length === 0;
    if (!pass) {
      const lines: string[] = [];
      lines.push('NFR-004 gate failed: observable performance regression detected.');
      lines.push(`- Baseline: ${baselinePath}`);
      lines.push(
        `- Thresholds: p95<=baseline*(1+${p95Ratio})+${p95Ms}ms; ready<=baseline*(1+${readyRatio})+${readyMs}ms`,
      );
      lines.push('');
      for (const r of regressions) {
        lines.push(
          `- ${r.name} ${r.metric}: current=${r.current.toFixed(2)}ms baseline=${r.baseline.toFixed(
            2,
          )}ms limit=${r.limit.toFixed(2)}ms`,
        );
      }
      console.error(lines.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('NFR-004 gate passed.');
    }

    await stub.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    return;
  }

  const jsonPath = baselinePath;
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const mdPath = path.join(specDir, 'performance-baseline.md');
  const mdLines: string[] = [];
  mdLines.push('# 009 NFR-004 Performance Baseline');
  mdLines.push('');
  mdLines.push(`- Date: ${payload.date}`);
  mdLines.push(`- Node: ${machine.node}`);
  mdLines.push(`- Platform: ${machine.platform} ${machine.arch}`);
  mdLines.push(`- CPU: ${machine.cpus} x ${machine.cpu_model}`);
  mdLines.push('');
  mdLines.push('## Benchmarks (CLI)');
  mdLines.push('');
  mdLines.push('| Case | Runs | p50 (ms) | p95 (ms) | Max (ms) |');
  mdLines.push('|---|---:|---:|---:|---:|');
  for (const r of results) {
    mdLines.push(`| ${r.name} | ${r.stats.runs} | ${r.stats.p50_ms} | ${r.stats.p95_ms} | ${r.stats.max_ms} |`);
  }
  mdLines.push('');
  mdLines.push('## Daemon (ws-bridge)');
  mdLines.push('');
  mdLines.push(`- ws_url: ${daemonUrl}`);
  mdLines.push(`- ready_ms: ${daemonReadyMs ?? ''}`);
  mdLines.push(`- ws_state_file: ${wsStatePath}`);
  mdLines.push(`- ws_state_file_first_seen_ms: ${stateWrite?.firstSeenMs ?? ''}`);
  mdLines.push(`- ws_state_file_mtime_changes_in_2s: ${stateWrite?.changes ?? ''}`);
  mdLines.push('');
  mdLines.push('## How to Reproduce');
  mdLines.push('');
  mdLines.push('```bash');
  mdLines.push('npm run build --workspace agent-remnote');
  mdLines.push('npm run bench:nfr-004 --workspace agent-remnote');
  mdLines.push('```');
  mdLines.push('');
  mdLines.push('Notes: This is a non-gating baseline for detecting observable regressions on key paths.');
  mdLines.push('');
  await fs.writeFile(mdPath, `${mdLines.join('\n')}\n`, 'utf8');

  await stub.close();
  await fs.rm(tmpDir, { recursive: true, force: true });

  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, mdPath)}`);
}

main().catch((e) => {
  console.error(String((e as any)?.message || e));
  process.exitCode = 1;
});
