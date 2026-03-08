import { describe, expect, it } from 'vitest';

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { openQueueDb } from '../../src/internal/queue/index.js';
import { enqueueTxn } from '../../src/internal/queue/index.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { StatusLineFileLive } from '../../src/services/StatusLineFile.js';
import { WsBridgeServerLive } from '../../src/services/WsBridgeServer.js';
import { WsBridgeStateFileLive } from '../../src/services/WsBridgeStateFile.js';

import { StatusLineController } from '../../src/runtime/status-line/StatusLineController.js';
import { runWsBridgeRuntime } from '../../src/runtime/ws-bridge/runWsBridgeRuntime.js';

function makeTestConfig(params: {
  readonly storeDb: string;
  readonly wsUrl: string;
  readonly wsStateFilePath: string;
}): ResolvedConfig {
  return {
    format: 'md',
    quiet: true,
    debug: false,
    remnoteDb: undefined,
    storeDb: params.storeDb,
    wsUrl: params.wsUrl,
    wsScheduler: true,
    wsDispatchMaxBytes: 4096,
    wsDispatchMaxOpBytes: 1024,
    repo: undefined,
    wsStateFile: { disabled: false, path: params.wsStateFilePath },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: path.join(path.dirname(params.wsStateFilePath), 'status-line.txt'),
    statusLineMinIntervalMs: 250,
    statusLineDebug: false,
    statusLineJsonFile: path.join(path.dirname(params.wsStateFilePath), 'status-line.json'),
  };
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string' || typeof address.port !== 'number') {
          reject(new Error('Failed to allocate a free port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function connectWs(url: string, timeoutMs = 2000): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      reject(new Error(`timeout connecting ws (${timeoutMs}ms): ${url}`));
    }, timeoutMs);

    ws.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectWsWithRetry(url: string, timeoutMs = 2000): Promise<WebSocket> {
  const startedAt = Date.now();
  let lastError: unknown = undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await connectWs(url, 250);
    } catch (e) {
      lastError = e;
      await sleep(50);
    }
  }

  throw lastError ?? new Error(`timeout connecting ws (${timeoutMs}ms): ${url}`);
}

function createJsonQueue(ws: WebSocket) {
  const buffer: any[] = [];
  const waiters: Array<{
    readonly predicate: (msg: any) => boolean;
    readonly resolve: (msg: any) => void;
    readonly reject: (error: unknown) => void;
    readonly timer: NodeJS.Timeout;
  }> = [];

  const flush = (msg: any) => {
    const idx = waiters.findIndex((w) => w.predicate(msg));
    if (idx >= 0) {
      const w = waiters.splice(idx, 1)[0]!;
      clearTimeout(w.timer);
      w.resolve(msg);
      return;
    }
    buffer.push(msg);
  };

  const onMessage = (data: any) => {
    try {
      flush(JSON.parse(String(data)));
    } catch {
      // ignore
    }
  };

  const onCloseOrError = (error: unknown) => {
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(error);
    }
  };

  ws.on('message', onMessage);
  ws.on('close', () => onCloseOrError(new Error('ws closed')));
  ws.on('error', (e) => onCloseOrError(e));

  const next = (predicate: (msg: any) => boolean, timeoutMs = 2000) => {
    const bufferedIdx = buffer.findIndex(predicate);
    if (bufferedIdx >= 0) {
      const msg = buffer.splice(bufferedIdx, 1)[0]!;
      return Promise.resolve(msg);
    }

    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`timeout waiting for ws message (${timeoutMs}ms)`));
      }, timeoutMs);

      waiters.push({ predicate, resolve, reject, timer });
    });
  };

  const close = () => {
    ws.removeListener('message', onMessage);
    ws.removeAllListeners('close');
    ws.removeAllListeners('error');
    onCloseOrError(new Error('queue closed'));
  };

  return { next, close };
}

describe('ws protocol contract: oversize op fails fast', () => {
  it('returns OP_PAYLOAD_TOO_LARGE and marks the op dead', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ws-oversize-'));
    try {
      const port = await getFreePort();
      const wsUrl = `ws://127.0.0.1:${port}/ws`;
      const storeDbPath = path.join(tmpDir, 'store.sqlite');
      const cfg = makeTestConfig({
        storeDb: storeDbPath,
        wsUrl,
        wsStateFilePath: path.join(tmpDir, 'ws.bridge.state.json'),
      });

      const seedDb = openQueueDb(cfg.storeDb);
      let opId: string = '';
      try {
        enqueueTxn(seedDb as any, [
          {
            type: 'update_text',
            payload: { rem_id: 'A', text: 'x'.repeat(5000) },
          },
        ]);
        const row = seedDb.prepare(`SELECT op_id FROM queue_ops ORDER BY created_at ASC LIMIT 1`).get() as any;
        opId = String(row?.op_id ?? '');
      } finally {
        seedDb.close();
      }
      expect(opId.length).toBeGreaterThan(0);

      const cfgLayer = Layer.succeed(AppConfig, cfg);
      const statusLineStub = Layer.succeed(StatusLineController, { invalidate: () => Effect.void });
      const live = Layer.mergeAll(
        cfgLayer,
        WsBridgeServerLive,
        WsBridgeStateFileLive,
        StatusLineFileLive,
        statusLineStub,
      );

      const program = Effect.gen(function* () {
        yield* runWsBridgeRuntime({
          host: '127.0.0.1',
          port,
          path: '/ws',
          kickConfig: { enabled: false, intervalMs: 0, cooldownMs: 0, noProgressWarnMs: 0, noProgressEscalateMs: 0 },
        }).pipe(Effect.forkScoped);

        yield* Effect.promise(async () => {
          const ws = await connectWsWithRetry(wsUrl, 3000);
          const q = createJsonQueue(ws);

          try {
            ws.send(JSON.stringify({ type: 'Hello' }));
            await q.next((m) => m?.type === 'HelloAck' && m?.ok === true);

            ws.send(
              JSON.stringify({
                type: 'Register',
                protocolVersion: 2,
                clientType: 'remnote-plugin',
                clientInstanceId: 'test',
                capabilities: { control: true, worker: true, readRpc: false, batchPull: true },
              }),
            );
            await q.next((m) => m?.type === 'Registered');

            ws.send(JSON.stringify({ type: 'SelectionChanged', kind: 'none', selectionType: 'None', ts: Date.now() }));
            await q.next((m) => m?.type === 'SelectionAck');

            ws.send(
              JSON.stringify({
                type: 'RequestOps',
                leaseMs: 5000,
                maxOps: 1,
                maxBytes: 4096,
                maxOpBytes: 1024,
              }),
            );

            const err = await q.next((m) => m?.type === 'Error' && m?.code === 'OP_PAYLOAD_TOO_LARGE');
            expect(String(err.message || '')).toBe('Operation payload is too large for dispatch');
            expect(err.details?.opId).toBe(opId);
            expect(Array.isArray(err.nextActions)).toBe(true);
            expect(String(err.nextActions?.[0] ?? '')).toContain(`agent-remnote queue inspect --op ${opId}`);
          } finally {
            q.close();
            try {
              ws.terminate();
            } catch {}
          }
        });
      }).pipe(Effect.provide(live));

      await Effect.runPromise(Effect.scoped(program));

      const db = openQueueDb(cfg.storeDb);
      try {
        const row = db.prepare(`SELECT status FROM queue_ops WHERE op_id=?`).get(opId) as any;
        expect(String(row?.status ?? '')).toBe('dead');
        const res = db.prepare(`SELECT error_code FROM queue_op_results WHERE op_id=?`).get(opId) as any;
        expect(String(res?.error_code ?? '')).toBe('OP_PAYLOAD_TOO_LARGE');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
