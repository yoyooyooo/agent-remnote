import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runHttpApiRuntime } from '../../src/runtime/http-api/runHttpApiRuntime.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { ApiDaemonFiles, type ApiStateFile } from '../../src/services/ApiDaemonFiles.js';
import { HostApiClient } from '../../src/services/HostApiClient.js';
import { Payload } from '../../src/services/Payload.js';
import { Queue } from '../../src/services/Queue.js';
import { RefResolver } from '../../src/services/RefResolver.js';
import { RemDb } from '../../src/services/RemDb.js';
import { WsClient } from '../../src/services/WsClient.js';
import { StatusLineController } from '../../src/runtime/status-line/StatusLineController.js';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForPort(port: number, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for port ${port}`);
}

function makeConfig(tmpDir: string, port: number): ResolvedConfig {
  return {
    format: 'json',
    quiet: true,
    debug: false,
    configFile: path.join(tmpDir, 'config.json'),
    remnoteDb: undefined,
    storeDb: path.join(tmpDir, 'store.sqlite'),
    wsUrl: 'ws://127.0.0.1:6789/ws',
    wsScheduler: true,
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    repo: undefined,
    wsStateFile: { disabled: false, path: path.join(tmpDir, 'ws.bridge.state.json') },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: path.join(tmpDir, 'status-line.txt'),
    statusLineMinIntervalMs: 250,
    statusLineDebug: false,
    statusLineJsonFile: path.join(tmpDir, 'status-line.json'),
    apiBaseUrl: undefined,
    apiHost: '127.0.0.1',
    apiPort: port,
    apiBasePath: '/v1',
    apiPidFile: path.join(tmpDir, 'api.pid'),
    apiLogFile: path.join(tmpDir, 'api.log'),
    apiStateFile: path.join(tmpDir, 'api.state.json'),
  };
}

describe('runtime contract: http api write markdown', () => {
  it('injects status line service for /v1/write/markdown', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-http-api-'));
    const port = await getFreePort();
    const cfg = makeConfig(tmpDir, port);
    const states: ApiStateFile[] = [];

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* runHttpApiRuntime({ host: '127.0.0.1', port, stateFile: cfg.apiStateFile }).pipe(Effect.forkScoped);
            yield* Effect.promise(() => waitForPort(port));

            const res = yield* Effect.promise(() =>
              fetch(`http://127.0.0.1:${port}/v1/write/markdown`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  parent: 'dummy-parent',
                  markdown: '- hello from api',
                  bulk: 'never',
                  notify: false,
                  ensureDaemon: false,
                }),
              }),
            );
            const json = yield* Effect.promise(() => res.json() as Promise<any>);

            expect(res.status).toBe(200);
            expect(json.ok).toBe(true);
            expect(json.data.txn_id).toBe('txn-1');
            expect(json.data.op_ids).toEqual(['op-1']);
            expect(states.at(-1)?.port).toBe(port);
          }).pipe(
            Effect.provideService(AppConfig, cfg),
            Effect.provideService(ApiDaemonFiles, {
              defaultPidFile: () => cfg.apiPidFile!,
              defaultLogFile: () => cfg.apiLogFile!,
              defaultStateFile: () => cfg.apiStateFile!,
              readPidFile: () => Effect.succeed(undefined),
              writePidFile: () => Effect.void,
              deletePidFile: () => Effect.void,
              readStateFile: () => Effect.succeed(undefined),
              writeStateFile: (_stateFilePath, value) => Effect.sync(() => {
                states.push(value);
              }),
              deleteStateFile: () => Effect.void,
            }),
            Effect.provideService(WsClient, {
              health: () => Effect.succeed({ ok: true }),
              triggerStartSync: () => Effect.succeed({ ok: true, sent: 0 }),
              queryClients: () => Effect.succeed({ clients: [], activeWorkerConnId: undefined }),
              search: () => Effect.fail(new Error('unexpected ws search call')),
            } as any),
            Effect.provideService(Queue, {
              enqueue: () => Effect.succeed({ txn_id: 'txn-1', op_ids: ['op-1'] }),
            } as any),
            Effect.provideService(Payload, {
              normalizeKeys: (value: unknown) => value,
              readJson: () => Effect.fail(new Error('unexpected payload read')),
            } as any),
            Effect.provideService(RefResolver, {
              resolve: () => Effect.fail(new Error('unexpected ref resolve')),
            } as any),
            Effect.provideService(HostApiClient, {} as any),
            Effect.provideService(RemDb, {} as any),
            Effect.provideService(StatusLineController, {
              invalidate: () => Effect.void,
            }),
          ),
        ),
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
