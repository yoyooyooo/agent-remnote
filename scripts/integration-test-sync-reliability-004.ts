import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import WebSocket from 'ws';

type Json = Record<string, unknown>;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data));
        if (!predicate(msg)) return;
        cleanup();
        resolve(msg);
      } catch {}
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed'));
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error'));
    };
    const cleanup = () => {
      ws.off('message', onMessage);
      ws.off('close', onClose);
      ws.off('error', onError);
      clearTimeout(timer);
    };
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

async function connectWorker(params: {
  url: string;
  name: string;
  clientInstanceId: string;
  onStartSync: (ws: WebSocket) => void;
  onOpDispatch: (ws: WebSocket, msg: any) => void;
}): Promise<{ ws: WebSocket; connId: string; startSyncCount: number; opDispatchCount: number }> {
  const ws = new WebSocket(params.url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e));
  });

  const client = { ws, connId: '', startSyncCount: 0, opDispatchCount: 0 };

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg?.type === 'StartSync') {
        client.startSyncCount += 1;
        params.onStartSync(ws);
        return;
      }
      if (msg?.type === 'OpDispatchBatch') {
        const ops = Array.isArray(msg?.ops) ? msg.ops : [];
        client.opDispatchCount += ops.length;
        for (const op of ops) params.onOpDispatch(ws, op);
        return;
      }
      if (msg?.type === 'OpDispatch') {
        client.opDispatchCount += 1;
        params.onOpDispatch(ws, msg);
        return;
      }
    } catch {}
  });

  ws.send(JSON.stringify({ type: 'Hello' }));
  const hello = await waitForMessage(ws, (m) => m?.type === 'HelloAck' && m?.ok === true, 2000);
  const connId = typeof hello?.connId === 'string' ? hello.connId : '';
  if (!connId) throw new Error('HelloAck missing connId');
  client.connId = connId;

  ws.send(
    JSON.stringify({
      type: 'Register',
      protocolVersion: 2,
      clientType: params.name,
      clientInstanceId: params.clientInstanceId,
      capabilities: { control: true, worker: true, readRpc: true, batchPull: true },
    }),
  );
  await waitForMessage(ws, (m) => m?.type === 'Registered' && m?.connId === connId, 2000).catch(() => {});

  return client;
}

async function queryClients(url: string): Promise<{ activeWorkerConnId?: string; clients: any[] }> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e));
  });

  ws.send(JSON.stringify({ type: 'QueryClients' }));
  const msg = await waitForMessage(ws, (m) => m?.type === 'Clients' && Array.isArray(m?.clients), 2000);
  try {
    ws.close();
  } catch {}
  return {
    activeWorkerConnId: typeof msg?.activeWorkerConnId === 'string' ? msg.activeWorkerConnId : undefined,
    clients: Array.isArray(msg?.clients) ? msg.clients : [],
  };
}

async function main() {
  let bridge:
    | undefined
    | {
        wss: unknown;
        close: () => Promise<void>;
      };
  let workerA: { ws: WebSocket; connId: string; startSyncCount: number; opDispatchCount: number } | undefined;
  let workerB: { ws: WebSocket; connId: string; startSyncCount: number; opDispatchCount: number } | undefined;

  try {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'agent-remnote-004-'));
  process.env.REMNOTE_STORE_DB = path.join(tmp, 'store.sqlite');
  process.env.REMNOTE_WS_STATE_FILE = path.join(tmp, 'ws.bridge.state.json');
  process.env.REMNOTE_TMUX_REFRESH = '0';

  // Make the kick loop and lease recovery fast enough for a <3s e2e script.
  process.env.REMNOTE_WS_KICK_INTERVAL_MS = '100';
  process.env.REMNOTE_WS_KICK_COOLDOWN_MS = '0';
  process.env.REMNOTE_WS_KICK_NO_PROGRESS_WARN_MS = '300';
  process.env.REMNOTE_WS_KICK_NO_PROGRESS_ESCALATE_MS = '600';
  process.env.REMNOTE_WS_ACTIVE_STALE_MS = '5000';

  const core = await import('../packages/agent-remnote/src/internal/public.js');
  bridge = core.startWebSocketBridge({ port: 0, host: '127.0.0.1', path: '/ws', heartbeatIntervalMs: 100 });
  if (!bridge) throw new Error('failed to start websocket bridge');

  let port = 0;
  for (let i = 0; i < 40; i += 1) {
    const addr = (bridge.wss as any).address?.();
    const candidate = typeof addr === 'object' && addr ? addr.port : 0;
    if (typeof candidate === 'number' && candidate > 0) {
      port = candidate;
      break;
    }
    await sleep(25);
  }
  if (!port) throw new Error('unable to resolve ws port');
  const url = `ws://127.0.0.1:${port}/ws`;

  workerB = await connectWorker({
    url,
    name: 'worker-B',
    clientInstanceId: 'test-worker-b',
    onStartSync: (ws) => {
      ws.send(JSON.stringify({ type: 'RequestOps', leaseMs: 250, maxOps: 1 }));
    },
    onOpDispatch: (ws, msg) => {
      // Ack success to establish "progress" after takeover.
      ws.send(JSON.stringify({ type: 'OpAck', op_id: msg.op_id, attempt_id: msg.attempt_id, status: 'success', result: { ok: true } }));
    },
  });
  if (!workerB) throw new Error('failed to connect workerB');
  // Older activity for B.
  workerB.ws.send(
    JSON.stringify({
      type: 'UiContextChanged',
      url: 'about:blank',
      paneId: 'p1',
      pageRemId: 'page-b',
      focusedRemId: 'focus-b',
      focusedPortalId: 'portal-b',
      source: 'test',
      ts: Date.now(),
    }),
  );

  let workerARequested = false;
  workerA = await connectWorker({
    url,
    name: 'worker-A',
    clientInstanceId: 'test-worker-a',
    onStartSync: (ws) => {
      // Simulate a stuck executor: request at most once, then ignore further StartSync.
      if (workerARequested) return;
      workerARequested = true;
      ws.send(JSON.stringify({ type: 'RequestOps', leaseMs: 250, maxOps: 1 }));
    },
    onOpDispatch: (_ws, _msg) => {
      // Simulate a stuck executor: no OpAck.
    },
  });
  if (!workerA) throw new Error('failed to connect workerA');
  // Newer activity for A => should become active worker initially.
  workerA.ws.send(
    JSON.stringify({
      type: 'UiContextChanged',
      url: 'about:blank',
      paneId: 'p1',
      pageRemId: 'page-a',
      focusedRemId: 'focus-a',
      focusedPortalId: 'portal-a',
      source: 'test',
      ts: Date.now(),
    }),
  );

  const initial = await queryClients(url);
  if (initial.activeWorkerConnId !== workerA.connId) {
    throw new Error(`expected workerA to be active (got ${initial.activeWorkerConnId || 'none'})`);
  }

  const db = core.openQueueDb(process.env.REMNOTE_STORE_DB);
  const txnId = core.enqueueTxn(db, [{ type: 'delete_rem', payload: { remId: 'dummy' } }]);

  // Wait until kick triggers StartSync and A receives it.
  const start = Date.now();
  while (workerA.startSyncCount < 1 && Date.now() - start < 2500) {
    await sleep(50);
  }
  if (workerA.startSyncCount < 1) throw new Error('expected StartSync to be delivered to initial active worker');

  // Wait for no-progress escalation -> quarantine A -> B becomes active.
  let after: { activeWorkerConnId?: string } | null = null;
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const st = await queryClients(url);
    if (st.activeWorkerConnId === workerB.connId) {
      after = st;
      break;
    }
    await sleep(80);
  }
  if (!after) throw new Error('expected active worker to switch to workerB after no-progress escalation');

  // Give B a chance to receive StartSync and claim + ack the recovered lease.
  await sleep(800);

  const summary: Json = {
    ok: true,
    url,
    txn_id: txnId,
    active_initial: workerA.connId,
    active_after: workerB.connId,
    start_sync: { workerA: workerA.startSyncCount, workerB: workerB.startSyncCount },
    op_dispatch: { workerA: workerA.opDispatchCount, workerB: workerB.opDispatchCount },
    state_dir: tmp,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);

  } catch (e) {
    process.stderr.write(`integration test failed: ${String((e as any)?.message || e)}\n`);
    process.exitCode = 1;
  } finally {
    try {
      workerA?.ws.close();
    } catch {}
    try {
      workerB?.ws.close();
    } catch {}
    try {
      await bridge?.close();
    } catch {}
  }
}

void main();
