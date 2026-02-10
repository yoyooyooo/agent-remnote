import { describe, expect, it } from 'vitest';

import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

import { enqueueTxn, openQueueDb } from '../../src/adapters/core.js';
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
  readonly statusLineFile: string;
  readonly statusLineJsonFile: string;
}): ResolvedConfig {
  return {
    format: 'md',
    quiet: true,
    debug: false,
    remnoteDb: undefined,
    storeDb: params.storeDb,
    wsUrl: params.wsUrl,
    wsScheduler: true,
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    repo: undefined,
    wsStateFile: { disabled: false, path: params.wsStateFilePath },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: params.statusLineFile,
    statusLineMinIntervalMs: 250,
    statusLineDebug: false,
    statusLineJsonFile: params.statusLineJsonFile,
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
      // ignore non-json
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

async function waitForStateFile(
  filePath: string,
  predicate: (json: any) => boolean,
  timeoutMs = 2000,
): Promise<any> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const json = JSON.parse(raw);
      if (predicate(json)) return json;
    } catch {
      // ignore (ENOENT / invalid json while writing)
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout waiting for state file (${timeoutMs}ms): ${filePath}`);
}

describe('WsBridgeRuntime (integration)', () => {
  it('handles handshake + TriggerStartSync + SearchRequest forwarding + state file snapshot', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ws-bridge-'));

    try {
      const port = await getFreePort();
      const wsUrl = `ws://127.0.0.1:${port}/ws`;
      const cfg = makeTestConfig({
        storeDb: path.join(tmpDir, 'store.sqlite'),
        wsUrl,
        wsStateFilePath: path.join(tmpDir, 'ws.bridge.state.json'),
        statusLineFile: path.join(tmpDir, 'status-line.txt'),
        statusLineJsonFile: path.join(tmpDir, 'status-line.json'),
      });

      const cfgLayer = Layer.succeed(AppConfig, cfg);
      const statusLineStub = Layer.succeed(StatusLineController, { invalidate: () => Effect.void });
      const live = Layer.mergeAll(cfgLayer, WsBridgeServerLive, WsBridgeStateFileLive, StatusLineFileLive, statusLineStub);

      const program = Effect.gen(function* () {
        yield* runWsBridgeRuntime({ host: '127.0.0.1', port, path: '/ws' }).pipe(Effect.forkScoped);

        yield* Effect.promise(async () => {
            const cli = await connectWsWithRetry(wsUrl, 3000);
            const plugin = await connectWsWithRetry(wsUrl, 3000);
            const cliQ = createJsonQueue(cli);
            const pluginQ = createJsonQueue(plugin);

            try {
              cli.send(JSON.stringify({ type: 'Hello' }));
              const cliHello = await cliQ.next((m) => m?.type === 'HelloAck' && m?.ok === true);
              expect(typeof cliHello.connId).toBe('string');

              // No active worker yet.
              cli.send(JSON.stringify({ type: 'TriggerStartSync' }));
              const noActive = await cliQ.next((m) => m?.type === 'StartSyncTriggered');
              expect(noActive.sent).toBe(0);
              expect(noActive.reason).toBe('no_active_worker');

              plugin.send(JSON.stringify({ type: 'Hello' }));
              const pluginHello = await pluginQ.next((m) => m?.type === 'HelloAck' && m?.ok === true);
              const pluginConnId = String(pluginHello.connId);

              plugin.send(
                JSON.stringify({
                  type: 'Register',
                  protocolVersion: 2,
                  clientType: 'remnote-plugin',
                  clientInstanceId: 'test',
                  capabilities: { control: true, worker: true, readRpc: true, batchPull: true },
                }),
              );
              await pluginQ.next((m) => m?.type === 'Registered');

              // Trigger sync: should notify the active worker.
              cli.send(JSON.stringify({ type: 'TriggerStartSync' }));
              const [startSyncMsg, triggered] = await Promise.all([
                pluginQ.next((m) => m?.type === 'StartSync'),
                cliQ.next((m) => m?.type === 'StartSyncTriggered' && m?.sent === 1),
              ]);
              expect(startSyncMsg.type).toBe('StartSync');
              expect(triggered.activeConnId).toBe(pluginConnId);

              // SearchRequest: forward to plugin with a different requestId, then map back to caller.
              const originalRequestId = 'req-1';
              cli.send(
                JSON.stringify({
                  type: 'SearchRequest',
                  requestId: originalRequestId,
                  queryText: 'hello world',
                  limit: 20,
                  timeoutMs: 1000,
                }),
              );
              const forwarded = await pluginQ.next((m) => m?.type === 'SearchRequest' && typeof m?.requestId === 'string');
              expect(forwarded.requestId).not.toBe(originalRequestId);

              plugin.send(
                JSON.stringify({
                  type: 'SearchResponse',
                  requestId: forwarded.requestId,
                  ok: true,
                  budget: { maxPreviewChars: 200 },
                  results: [],
                }),
              );
              const okResp = await cliQ.next((m) => m?.type === 'SearchResponse' && m?.requestId === originalRequestId);
              expect(okResp.ok).toBe(true);
              expect(Array.isArray(okResp.results)).toBe(true);

              // Timeout behavior (clamped by runtime): plugin receives request, but we don't respond.
              const originalTimeoutId = 'req-timeout';
              cli.send(
                JSON.stringify({
                  type: 'SearchRequest',
                  requestId: originalTimeoutId,
                  queryText: 'timeout-test',
                  limit: 10,
                  timeoutMs: 50,
                }),
              );
              await pluginQ.next((m) => m?.type === 'SearchRequest' && m?.queryText === 'timeout-test');
              const timeoutResp = await cliQ.next((m) => m?.type === 'SearchResponse' && m?.requestId === originalTimeoutId, 2000);
              expect(timeoutResp.ok).toBe(false);
              expect(timeoutResp.error?.code).toBe('TIMEOUT');

              // State file snapshot should eventually reflect the active worker.
              const snap = await waitForStateFile(cfg.wsStateFile.path, (j) => j?.activeWorkerConnId === pluginConnId, 2000);
              expect(snap.server?.port).toBe(port);
              expect(Array.isArray(snap.clients)).toBe(true);
              expect(snap.queue?.dbPath).toBe(cfg.storeDb);
              expect(typeof snap.queue?.stats?.pending).toBe('number');
              expect(typeof snap.queue?.stats?.in_flight).toBe('number');

              // QueryClients should return the same activeWorkerConnId.
              cli.send(JSON.stringify({ type: 'QueryClients' }));
              const clientsMsg = await cliQ.next((m) => m?.type === 'Clients' && Array.isArray(m?.clients));
              expect(clientsMsg.activeWorkerConnId).toBe(pluginConnId);
            } finally {
              cliQ.close();
              pluginQ.close();
              try {
                cli.terminate();
              } catch {}
              try {
                plugin.terminate();
              } catch {}
            }
          });
      }).pipe(Effect.provide(live));

      await Effect.runPromise(Effect.scoped(program));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects stale OpAck (attempt_id/CAS) and prevents terminal rollback', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ws-bridge-ack-'));

    try {
      const port = await getFreePort();
      const wsUrl = `ws://127.0.0.1:${port}/ws`;
      const cfg = makeTestConfig({
        storeDb: path.join(tmpDir, 'store.sqlite'),
        wsUrl,
        wsStateFilePath: path.join(tmpDir, 'ws.bridge.state.json'),
        statusLineFile: path.join(tmpDir, 'status-line.txt'),
        statusLineJsonFile: path.join(tmpDir, 'status-line.json'),
      });

      // Seed one op into the queue.
      const seedDb = openQueueDb(cfg.storeDb);
      try {
        enqueueTxn(seedDb as any, [{ type: 'create_rem', payload: { parentId: 'dummy-parent', text: 'hello' } }]);
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
          heartbeatIntervalMs: 50,
          kickConfig: { enabled: false, intervalMs: 0, cooldownMs: 0, noProgressWarnMs: 0, noProgressEscalateMs: 0 },
        }).pipe(Effect.forkScoped);

        yield* Effect.promise(async () => {
          const w1 = await connectWsWithRetry(wsUrl, 3000);
          const w2 = await connectWsWithRetry(wsUrl, 3000);
          const q1 = createJsonQueue(w1);
          const q2 = createJsonQueue(w2);

          try {
            w1.send(JSON.stringify({ type: 'Hello' }));
            await q1.next((m) => m?.type === 'HelloAck' && m?.ok === true);
            w1.send(
              JSON.stringify({
                type: 'Register',
                protocolVersion: 2,
                clientType: 'remnote-plugin',
                clientInstanceId: 'w1',
                capabilities: { control: true, worker: true, readRpc: false, batchPull: true },
              }),
            );
            await q1.next((m) => m?.type === 'Registered');
            w1.send(JSON.stringify({ type: 'SelectionChanged', kind: 'none', selectionType: 'None', ts: Date.now() }));
            await q1.next((m) => m?.type === 'SelectionAck');

            // Claim op as worker 1 with a short lease.
            w1.send(JSON.stringify({ type: 'RequestOps', leaseMs: 80, maxOps: 1 }));
            const batch1 = await q1.next((m) => m?.type === 'OpDispatchBatch' && Array.isArray(m?.ops) && m.ops.length > 0);
            const op1 = (batch1 as any).ops[0];
            const opId = String(op1.op_id);
            const attempt1 = String(op1.attempt_id);
            expect(attempt1.length).toBeGreaterThan(0);

            w2.send(JSON.stringify({ type: 'Hello' }));
            await q2.next((m) => m?.type === 'HelloAck' && m?.ok === true);
            w2.send(
              JSON.stringify({
                type: 'Register',
                protocolVersion: 2,
                clientType: 'remnote-plugin',
                clientInstanceId: 'w2',
                capabilities: { control: true, worker: true, readRpc: false, batchPull: true },
              }),
            );
            await q2.next((m) => m?.type === 'Registered');

            // Make worker 2 the active worker via a newer selection event.
            await sleep(20);
            w2.send(JSON.stringify({ type: 'SelectionChanged', kind: 'none', selectionType: 'None', ts: Date.now() }));
            await q2.next((m) => m?.type === 'SelectionAck');

            // Wait for lease recovery + re-claim by worker 2 (new attempt_id).
            let op2: any = null;
            const startedAt = Date.now();
            while (!op2 && Date.now() - startedAt < 3000) {
              w2.send(JSON.stringify({ type: 'RequestOps', leaseMs: 200, maxOps: 1 }));
              const msg = await q2
                .next((m) => m?.type === 'OpDispatchBatch' || m?.type === 'NoWork', 2000)
                .catch(() => null);
              if (msg?.type === 'OpDispatchBatch' && Array.isArray((msg as any).ops) && (msg as any).ops.length > 0) {
                const first = (msg as any).ops[0];
                if (String(first.op_id) === opId) {
                  op2 = first;
                  break;
                }
              }
              await sleep(50);
            }
            const attempt2 = String(op2.attempt_id);
            expect(attempt2).not.toBe(attempt1);

            // Late ack from worker 1 must be rejected and must not affect the current attempt.
            w1.send(JSON.stringify({ type: 'OpAck', op_id: opId, attempt_id: attempt1, status: 'success', result: { ok: true } }));
            const rej1 = await q1.next((m) => m?.type === 'AckRejected' && m?.op_id === opId);
            expect(rej1.reason).toBe('stale_attempt');

            // Current worker ack should succeed.
            w2.send(JSON.stringify({ type: 'OpAck', op_id: opId, attempt_id: attempt2, status: 'success', result: { ok: true } }));
            const ok2 = await q2.next((m) => m?.type === 'AckOk' && m?.op_id === opId);
            expect(ok2.ok).toBe(true);
            expect(ok2.attempt_id).toBe(attempt2);

            // Stale retry must not roll back a terminal op.
            w1.send(
              JSON.stringify({
                type: 'OpAck',
                op_id: opId,
                attempt_id: attempt1,
                status: 'retry',
                error_code: 'EXEC_ERROR',
                error_message: 'late retry',
              }),
            );
            const rej2 = await q1.next((m) => m?.type === 'AckRejected' && m?.op_id === opId);
            expect(rej2.reason).toBe('stale_attempt');

            const db = openQueueDb(cfg.storeDb);
            try {
              const row = db.prepare(`SELECT status, attempt_id FROM queue_ops WHERE op_id=?`).get(opId) as any;
              expect(String(row.status)).toBe('succeeded');
              expect(String(row.attempt_id)).toBe(attempt2);
              const attempts = db
                .prepare(`SELECT status FROM queue_op_attempts WHERE op_id=? ORDER BY created_at ASC`)
                .all(opId) as any[];
              expect(attempts.some((a) => String(a.status) === 'lease_expired')).toBe(true);
              expect(attempts.some((a) => String(a.status) === 'succeeded')).toBe(true);
            } finally {
              db.close();
            }
          } finally {
            q1.close();
            q2.close();
            try {
              w1.terminate();
            } catch {}
            try {
              w2.terminate();
            } catch {}
          }
        });
      }).pipe(Effect.provide(live));

      await Effect.runPromise(Effect.scoped(program));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('extends leases via LeaseExtend and rejects stale extends', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ws-bridge-lease-extend-'));

    try {
      const port = await getFreePort();
      const wsUrl = `ws://127.0.0.1:${port}/ws`;
      const cfg = makeTestConfig({
        storeDb: path.join(tmpDir, 'store.sqlite'),
        wsUrl,
        wsStateFilePath: path.join(tmpDir, 'ws.bridge.state.json'),
        statusLineFile: path.join(tmpDir, 'status-line.txt'),
        statusLineJsonFile: path.join(tmpDir, 'status-line.json'),
      });

      // Seed one op into the queue.
      const seedDb = openQueueDb(cfg.storeDb);
      try {
        enqueueTxn(seedDb as any, [{ type: 'create_rem', payload: { parentId: 'dummy-parent', text: 'hello' } }]);
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
          heartbeatIntervalMs: 50,
          kickConfig: { enabled: false, intervalMs: 0, cooldownMs: 0, noProgressWarnMs: 0, noProgressEscalateMs: 0 },
        }).pipe(Effect.forkScoped);

        yield* Effect.promise(async () => {
          const w1 = await connectWsWithRetry(wsUrl, 3000);
          const w2 = await connectWsWithRetry(wsUrl, 3000);
          const q1 = createJsonQueue(w1);
          const q2 = createJsonQueue(w2);

          try {
            w1.send(JSON.stringify({ type: 'Hello' }));
            await q1.next((m) => m?.type === 'HelloAck' && m?.ok === true);
            w1.send(
              JSON.stringify({
                type: 'Register',
                protocolVersion: 2,
                clientType: 'remnote-plugin',
                clientInstanceId: 'w1',
                capabilities: { control: true, worker: true, readRpc: false, batchPull: true },
              }),
            );
            await q1.next((m) => m?.type === 'Registered');
            w1.send(JSON.stringify({ type: 'SelectionChanged', kind: 'none', selectionType: 'None', ts: Date.now() }));
            await q1.next((m) => m?.type === 'SelectionAck');

            // Claim op as worker 1 with a short lease, then extend it.
            w1.send(JSON.stringify({ type: 'RequestOps', leaseMs: 200, maxOps: 1, maxBytes: 2048, maxOpBytes: 2048 }));
            const batch1 = await q1.next((m) => m?.type === 'OpDispatchBatch' && Array.isArray(m?.ops) && m.ops.length === 1);
            const op1 = (batch1 as any).ops[0];
            const opId = String(op1.op_id);
            const attempt1 = String(op1.attempt_id);

            w1.send(JSON.stringify({ type: 'LeaseExtend', op_id: opId, attempt_id: attempt1, extendMs: 2000 }));
            const ok = await q1.next((m) => m?.type === 'LeaseExtendOk' && m?.op_id === opId);
            expect(ok.ok).toBe(true);
            expect(Number(ok.lease_expires_at ?? 0)).toBeGreaterThan(Date.now());

            w2.send(JSON.stringify({ type: 'Hello' }));
            await q2.next((m) => m?.type === 'HelloAck' && m?.ok === true);
            w2.send(
              JSON.stringify({
                type: 'Register',
                protocolVersion: 2,
                clientType: 'remnote-plugin',
                clientInstanceId: 'w2',
                capabilities: { control: true, worker: true, readRpc: false, batchPull: true },
              }),
            );
            await q2.next((m) => m?.type === 'Registered');

            // Make worker 2 the active worker.
            await sleep(20);
            w2.send(JSON.stringify({ type: 'SelectionChanged', kind: 'none', selectionType: 'None', ts: Date.now() }));
            await q2.next((m) => m?.type === 'SelectionAck');

            // Wait beyond the original lease; the op should not be recovered due to the extension.
            await sleep(400);

            w2.send(JSON.stringify({ type: 'RequestOps', leaseMs: 200, maxOps: 1, maxBytes: 2048, maxOpBytes: 2048 }));
            const msg = await q2.next((m) => m?.type === 'OpDispatchBatch' || m?.type === 'NoWork', 2000);
            expect(msg.type).toBe('NoWork');

            // Stale/non-owner extend must be rejected.
            w2.send(JSON.stringify({ type: 'LeaseExtend', op_id: opId, attempt_id: attempt1, extendMs: 2000 }));
            const rej1 = await q2.next((m) => m?.type === 'LeaseExtendRejected' && m?.op_id === opId);
            expect(rej1.reason).toBe('stale_attempt');

            // Wrong attempt id must be rejected.
            w1.send(JSON.stringify({ type: 'LeaseExtend', op_id: opId, attempt_id: `${attempt1}-wrong`, extendMs: 2000 }));
            const rej2 = await q1.next((m) => m?.type === 'LeaseExtendRejected' && m?.op_id === opId);
            expect(rej2.reason).toBe('stale_attempt');

            // After success ack, further extends are rejected as not_in_flight.
            w1.send(JSON.stringify({ type: 'OpAck', op_id: opId, attempt_id: attempt1, status: 'success', result: { ok: true } }));
            const ackOk = await q1.next((m) => m?.type === 'AckOk' && m?.op_id === opId);
            expect(ackOk.ok).toBe(true);

            w1.send(JSON.stringify({ type: 'LeaseExtend', op_id: opId, attempt_id: attempt1, extendMs: 2000 }));
            const rej3 = await q1.next((m) => m?.type === 'LeaseExtendRejected' && m?.op_id === opId);
            expect(rej3.reason).toBe('not_in_flight');
          } finally {
            q1.close();
            q2.close();
            try {
              w1.terminate();
            } catch {}
            try {
              w2.terminate();
            } catch {}
          }
        });
      }).pipe(Effect.provide(live));

      await Effect.runPromise(Effect.scoped(program));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('substitutes temp ids via id_map before dispatch (dispatch-time substitution)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ws-bridge-idmap-'));

    try {
      const port = await getFreePort();
      const wsUrl = `ws://127.0.0.1:${port}/ws`;
      const cfg = makeTestConfig({
        storeDb: path.join(tmpDir, 'store.sqlite'),
        wsUrl,
        wsStateFilePath: path.join(tmpDir, 'ws.bridge.state.json'),
        statusLineFile: path.join(tmpDir, 'status-line.txt'),
        statusLineJsonFile: path.join(tmpDir, 'status-line.json'),
      });

      const tempId = 'tmp:test-1';
      const remoteId = 'rem:remote-1';

      // Seed 2 ops in one txn:
      // 1) create_rem produces created(client_temp_id -> remote_id)
      // 2) update_text consumes that temp id in rem_id, expecting substitution before dispatch.
      const seedDb = openQueueDb(cfg.storeDb);
      try {
        enqueueTxn(seedDb as any, [
          { type: 'create_rem', payload: { parent_id: 'dummy-parent', text: 'hello', client_temp_id: tempId } },
          { type: 'update_text', payload: { rem_id: tempId, text: 'world' } },
        ]);
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
          heartbeatIntervalMs: 50,
          kickConfig: { enabled: false, intervalMs: 0, cooldownMs: 0, noProgressWarnMs: 0, noProgressEscalateMs: 0 },
        }).pipe(Effect.forkScoped);

        yield* Effect.promise(async () => {
          const plugin = await connectWsWithRetry(wsUrl, 3000);
          const q = createJsonQueue(plugin);

          try {
            plugin.send(JSON.stringify({ type: 'Hello' }));
            await q.next((m) => m?.type === 'HelloAck' && m?.ok === true);
            plugin.send(
              JSON.stringify({
                type: 'Register',
                protocolVersion: 2,
                clientType: 'remnote-plugin',
                clientInstanceId: 'idmap-test',
                capabilities: { control: true, worker: true, readRpc: false, batchPull: true },
              }),
            );
            await q.next((m) => m?.type === 'Registered');
            plugin.send(JSON.stringify({ type: 'SelectionChanged', kind: 'none', selectionType: 'None', ts: Date.now() }));
            await q.next((m) => m?.type === 'SelectionAck');

            // Pull and ack op1 (create_rem).
            plugin.send(JSON.stringify({ type: 'RequestOps', leaseMs: 5000, maxOps: 1 }));
            const batch1 = await q.next((m) => m?.type === 'OpDispatchBatch' && Array.isArray(m?.ops) && m.ops.length === 1);
            const op1 = (batch1 as any).ops[0];
            plugin.send(
              JSON.stringify({
                type: 'OpAck',
                op_id: op1.op_id,
                attempt_id: op1.attempt_id,
                status: 'success',
                result: { ok: true, created: { client_temp_id: tempId, remote_id: remoteId, remote_type: 'rem' } },
              }),
            );
            await q.next((m) => m?.type === 'AckOk' && m?.op_id === op1.op_id);

            // Pull op2; payload.rem_id must be substituted to remoteId.
            plugin.send(JSON.stringify({ type: 'RequestOps', leaseMs: 5000, maxOps: 1 }));
            const batch2 = await q.next((m) => m?.type === 'OpDispatchBatch' && Array.isArray(m?.ops) && m.ops.length === 1);
            const op2 = (batch2 as any).ops[0];
            expect(op2.op_type).toBe('update_text');
            expect(op2.payload?.rem_id).toBe(remoteId);
          } finally {
            try {
              q.close();
            } catch {}
            try {
              plugin.close();
            } catch {}
          }
        });
      }).pipe(Effect.provide(live));

      await Effect.runPromise(Effect.scoped(program));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
