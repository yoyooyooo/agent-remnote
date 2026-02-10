import { describe, expect, it } from 'vitest';

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { enqueueTxn, openQueueDb } from '../../src/internal/queue/index.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { StatusLineFileLive } from '../../src/services/StatusLineFile.js';
import { WsBridgeServerLive } from '../../src/services/WsBridgeServer.js';
import { WsBridgeStateFileLive } from '../../src/services/WsBridgeStateFile.js';

import { StatusLineController } from '../../src/runtime/status-line/StatusLineController.js';
import { runWsBridgeRuntime } from '../../src/runtime/ws-bridge/runWsBridgeRuntime.js';

function makeTestConfig(params: { readonly storeDb: string; readonly wsUrl: string; readonly wsStateFilePath: string }): ResolvedConfig {
  return {
    format: 'md',
    quiet: true,
    debug: false,
    remnoteDb: undefined,
    storeDb: params.storeDb,
    wsUrl: params.wsUrl,
    wsScheduler: true,
    wsDispatchMaxBytes: 2048,
    wsDispatchMaxOpBytes: 2048,
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

function estimateBatchBytes(params: {
  readonly opBytesSum: number;
  readonly opCount: number;
  readonly budget: unknown;
  readonly skipped: unknown;
}): number {
  const budgetJson = JSON.stringify(params.budget ?? {});
  const skippedJson = JSON.stringify(params.skipped ?? {});
  const opsBytes = params.opCount <= 0 ? 2 : 2 + params.opBytesSum + (params.opCount - 1);
  return (
    Buffer.byteLength('{"type":"OpDispatchBatch","budget":', 'utf8') +
    Buffer.byteLength(budgetJson, 'utf8') +
    Buffer.byteLength(',"skipped":', 'utf8') +
    Buffer.byteLength(skippedJson, 'utf8') +
    Buffer.byteLength(',"ops":', 'utf8') +
    opsBytes +
    Buffer.byteLength('}', 'utf8')
  );
}

function findTextLenForBudget(maxBytes: number): number {
  const UUID_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
  const LEASE_EXPIRES_AT_PLACEHOLDER = 1700000000000;
  const safetyMarginBytes = 256;

  const budget = {
    maxOpsRequested: 2,
    maxOpsEffective: 2,
    maxBytesRequested: maxBytes,
    maxBytesEffective: maxBytes,
    maxOpBytesRequested: maxBytes,
    maxOpBytesEffective: maxBytes,
    approxBytes: 0,
    scanLimit: 50,
  };
  const skipped = { overBudget: 0, oversizeOp: 0, conflict: 0, txnBusy: 0 };

  for (let len = 50; len <= 5000; len += 25) {
    const text = 'a'.repeat(len);
    const op = {
      op_id: UUID_PLACEHOLDER,
      attempt_id: UUID_PLACEHOLDER,
      txn_id: UUID_PLACEHOLDER,
      op_seq: 1,
      op_type: 'update_text',
      payload: { rem_id: 'A', text },
      idempotency_key: null,
      lease_expires_at: LEASE_EXPIRES_AT_PLACEHOLDER,
    };
    const opBytes = Buffer.byteLength(JSON.stringify(op), 'utf8');
    const one = estimateBatchBytes({ opBytesSum: opBytes, opCount: 1, budget, skipped });
    const two = estimateBatchBytes({ opBytesSum: opBytes * 2, opCount: 2, budget, skipped });
    if (one + safetyMarginBytes <= maxBytes && two + safetyMarginBytes > maxBytes) return len;
  }

  return 0;
}

describe('ws protocol contract: RequestOps budget boxing', () => {
  it('caps OpDispatchBatch within maxBytes and reports overBudget skips', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ws-budget-'));
    try {
      const port = await getFreePort();
      const wsUrl = `ws://127.0.0.1:${port}/ws`;
      const storeDbPath = path.join(tmpDir, 'store.sqlite');
      const cfg = makeTestConfig({ storeDb: storeDbPath, wsUrl, wsStateFilePath: path.join(tmpDir, 'ws.bridge.state.json') });

      const textLen = findTextLenForBudget(cfg.wsDispatchMaxBytes);
      expect(textLen).toBeGreaterThan(0);

      const seedDb = openQueueDb(cfg.storeDb);
      try {
        const bigText = 'a'.repeat(textLen);
        enqueueTxn(seedDb as any, [{ type: 'update_text', payload: { rem_id: 'A', text: bigText } }]);
        enqueueTxn(seedDb as any, [{ type: 'update_text', payload: { rem_id: 'B', text: bigText } }]);
      } finally {
        seedDb.close();
      }

      const cfgLayer = Layer.succeed(AppConfig, cfg);
      const statusLineStub = Layer.succeed(StatusLineController, { invalidate: () => Effect.void });
      const live = Layer.mergeAll(cfgLayer, WsBridgeServerLive, WsBridgeStateFileLive, StatusLineFileLive, statusLineStub);

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
                maxOps: 2,
                maxBytes: cfg.wsDispatchMaxBytes,
                maxOpBytes: cfg.wsDispatchMaxOpBytes,
              }),
            );

            const batch = await q.next((m) => m?.type === 'OpDispatchBatch' && Array.isArray(m?.ops) && m.ops.length > 0);
            expect(Array.isArray(batch.ops)).toBe(true);
            expect(batch.ops.length).toBe(1);

            expect(batch.budget?.maxBytesEffective).toBe(cfg.wsDispatchMaxBytes);
            expect(batch.budget?.maxOpBytesEffective).toBe(cfg.wsDispatchMaxOpBytes);
            expect(Number(batch.budget?.approxBytes ?? 0)).toBeGreaterThan(0);
            expect(Number(batch.budget?.approxBytes ?? 0)).toBeLessThanOrEqual(cfg.wsDispatchMaxBytes);

            expect(Number(batch.skipped?.overBudget ?? 0)).toBeGreaterThan(0);
          } finally {
            q.close();
            try {
              ws.terminate();
            } catch {}
          }
        });
      }).pipe(Effect.provide(live));

      await Effect.runPromise(Effect.scoped(program));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
