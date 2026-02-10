import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import WebSocket from 'ws';

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

async function connectActiveReadRpcWorker(params: {
  readonly url: string;
  readonly clientInstanceId: string;
}): Promise<{ readonly ws: WebSocket; readonly connId: string }> {
  const ws = new WebSocket(params.url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e));
  });

  ws.send(JSON.stringify({ type: 'Hello' }));
  const hello = await waitForMessage(ws, (m) => m?.type === 'HelloAck' && m?.ok === true, 2000);
  const connId = typeof hello?.connId === 'string' ? hello.connId : '';
  if (!connId) throw new Error('HelloAck missing connId');

  ws.send(
    JSON.stringify({
      type: 'Register',
      protocolVersion: 2,
      clientType: 'test-worker',
      clientInstanceId: params.clientInstanceId,
      capabilities: { control: true, worker: true, readRpc: true, batchPull: true },
    }),
  );
  await waitForMessage(ws, (m) => m?.type === 'Registered' && m?.connId === connId, 2000).catch(() => {});

  // Mark as "recently active" to become active worker.
  ws.send(
    JSON.stringify({
      type: 'UiContextChanged',
      url: 'about:blank',
      paneId: 'p1',
      pageRemId: 'page',
      focusedRemId: 'focus',
      focusedPortalId: 'portal',
      source: 'test',
    }),
  );

  return { ws, connId };
}

async function main() {
  let bridge:
    | undefined
    | {
        wss: unknown;
        close: () => Promise<void>;
      };
  let worker: { ws: WebSocket; connId: string } | undefined;
  let caller: WebSocket | undefined;

  try {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'agent-remnote-003-'));
    process.env.REMNOTE_STORE_DB = path.join(tmp, 'store.sqlite');
    process.env.REMNOTE_WS_STATE_FILE = path.join(tmp, 'ws.bridge.state.json');
    process.env.REMNOTE_TMUX_REFRESH = '0';
    process.env.REMNOTE_WS_KICK_DISABLED = '1';

    const core = await import('../packages/agent-remnote/src/internal/public.js');
    bridge = core.startWebSocketBridge({ port: 0, host: '127.0.0.1', path: '/ws', heartbeatIntervalMs: 50 });
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

    worker = await connectActiveReadRpcWorker({ url, clientInstanceId: 'test-worker-003' });

    const workerConnId = worker.connId;
    worker.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type !== 'SearchRequest') return;
        const forwardedId = String(msg.requestId || '');
        const q = String(msg.queryText || '');
        const delay = q.includes('alpha') ? 200 : 50;
        setTimeout(() => {
          try {
            worker!.ws.send(
              JSON.stringify({
                type: 'SearchResponse',
                requestId: forwardedId,
                ok: true,
                budget: { maxPreviewChars: 200 },
                results: [{ remId: 'r', title: 't', snippet: q, truncated: false }],
              }),
            );
          } catch {}
        }, delay);
      } catch {}
    });

    caller = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      caller!.once('open', () => resolve());
      caller!.once('error', (e) => reject(e));
    });

    const p1 = waitForMessage(caller, (m) => m?.type === 'SearchResponse' && m?.requestId === 'req-1', 2000);
    const p2 = waitForMessage(caller, (m) => m?.type === 'SearchResponse' && m?.requestId === 'req-2', 2000);

    caller.send(JSON.stringify({ type: 'SearchRequest', requestId: 'req-1', queryText: 'alpha', limit: 20, timeoutMs: 500 }));
    caller.send(JSON.stringify({ type: 'SearchRequest', requestId: 'req-2', queryText: 'beta', limit: 20, timeoutMs: 500 }));

    const [r1, r2] = await Promise.all([p1, p2]);

    const snippet1 = r1?.results?.[0]?.snippet;
    const snippet2 = r2?.results?.[0]?.snippet;
    if (snippet1 !== 'alpha') throw new Error(`unexpected snippet for req-1: ${String(snippet1)}`);
    if (snippet2 !== 'beta') throw new Error(`unexpected snippet for req-2: ${String(snippet2)}`);

    console.log(JSON.stringify({ ok: true, url, active_worker_conn_id: workerConnId }));
  } finally {
    try {
      caller?.close();
    } catch {}
    try {
      worker?.ws.close();
    } catch {}
    try {
      await bridge?.close();
    } catch {}
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String((e as any)?.message || e) }));
  process.exit(1);
});
