import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runHttpApiRuntime } from '../../src/runtime/http-api/runHttpApiRuntime.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { ApiDaemonFiles } from '../../src/services/ApiDaemonFiles.js';
import { DaemonFiles } from '../../src/services/DaemonFiles.js';
import { CliError } from '../../src/services/Errors.js';
import { HostApiClient } from '../../src/services/HostApiClient.js';
import { Payload } from '../../src/services/Payload.js';
import { Process } from '../../src/services/Process.js';
import { Queue } from '../../src/services/Queue.js';
import { RefResolver } from '../../src/services/RefResolver.js';
import { RemDb } from '../../src/services/RemDb.js';
import { SupervisorState } from '../../src/services/SupervisorState.js';
import { WorkspaceBindingsLive } from '../../src/services/WorkspaceBindings.js';
import { WsClient } from '../../src/services/WsClient.js';
import { StatusLineController } from '../../src/runtime/status-line/StatusLineController.js';
import { makeConfig, waitForPort } from '../helpers/httpApiTestUtils.js';

describe('runtime contract: endpoint binding scope', () => {
  it('keeps no_binding endpoints available while db endpoints fail with WORKSPACE_UNRESOLVED', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-binding-scope-'));
    const tmpHome = path.join(tmpDir, 'home');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    let actualPort: number | null = null;
    const cfg = makeConfig(tmpHome, storeDbPath, wsStateFilePath, 0);
    const previousHome = process.env.HOME;

    try {
      process.env.HOME = tmpHome;
      await fs.mkdir(path.dirname(wsStateFilePath), { recursive: true });
      await fs.writeFile(wsStateFilePath, `${JSON.stringify({ updatedAt: Date.now(), clients: [] }, null, 2)}\n`, 'utf8');

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* runHttpApiRuntime({ host: '127.0.0.1', port: 0, stateFile: cfg.apiStateFile }).pipe(Effect.forkScoped);
            yield* Effect.promise(async () => {
              const startedAt = Date.now();
              while (Date.now() - startedAt < 3000) {
                if (typeof actualPort === 'number' && actualPort > 0) {
                  await waitForPort(actualPort);
                  return;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              throw new Error('timeout waiting for api runtime to publish its actual port');
            });

            const port = actualPort!;

            const healthRes = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/v1/health`));
            const healthJson = yield* Effect.promise(() => healthRes.json() as Promise<any>);
            expect(healthRes.status).toBe(200);
            expect(healthJson.ok).toBe(true);

            const waitRes = yield* Effect.promise(() =>
              fetch(`http://127.0.0.1:${port}/v1/queue/wait`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ txnId: 'txn-missing', timeoutMs: 1, pollMs: 1 }),
              }),
            );
            const waitJson = yield* Effect.promise(() => waitRes.json() as Promise<any>);
            expect(waitRes.status).toBe(400);
            expect(waitJson.ok).toBe(false);
            expect(waitJson.error.code).toBe('INVALID_ARGS');

            const txnRes = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/v1/queue/txns/txn-missing`));
            const txnJson = yield* Effect.promise(() => txnRes.json() as Promise<any>);
            expect(txnRes.status).toBe(400);
            expect(txnJson.ok).toBe(false);
            expect(txnJson.error.code).toBe('INVALID_ARGS');

            const searchRes = yield* Effect.promise(() =>
              fetch(`http://127.0.0.1:${port}/v1/search/db`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: 'keyword' }),
              }),
            );
            const searchJson = yield* Effect.promise(() => searchRes.json() as Promise<any>);
            expect(searchRes.status).toBe(409);
            expect(searchJson.ok).toBe(false);
            expect(searchJson.error.code).toBe('WORKSPACE_UNRESOLVED');

            const outlineRes = yield* Effect.promise(() =>
              fetch(`http://127.0.0.1:${port}/v1/read/outline`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: 'rem-1' }),
              }),
            );
            const outlineJson = yield* Effect.promise(() => outlineRes.json() as Promise<any>);
            expect(outlineRes.status).toBe(409);
            expect(outlineJson.ok).toBe(false);
            expect(outlineJson.error.code).toBe('WORKSPACE_UNRESOLVED');

            const dailyRes = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/v1/daily/rem-id?offsetDays=0`));
            const dailyJson = yield* Effect.promise(() => dailyRes.json() as Promise<any>);
            expect(dailyRes.status).toBe(409);
            expect(dailyJson.ok).toBe(false);
            expect(dailyJson.error.code).toBe('WORKSPACE_UNRESOLVED');
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
              writeStateFile: (_stateFilePath, value) =>
                Effect.sync(() => {
                  actualPort = value.port;
                }),
              deleteStateFile: () => Effect.void,
            }),
            Effect.provideService(DaemonFiles, {
              defaultPidFile: () => path.join(tmpDir, 'ws.pid'),
              defaultLogFile: () => path.join(tmpDir, 'ws.log'),
              readPidFile: () => Effect.succeed(undefined),
              writePidFile: () => Effect.void,
              deletePidFile: () => Effect.void,
            }),
            Effect.provideService(WsClient, {
              health: () =>
                Effect.fail(
                  new CliError({
                    code: 'WS_UNAVAILABLE',
                    message: 'daemon not ready',
                    exitCode: 1,
                  }),
                ),
              queryClients: () => Effect.succeed({ clients: [], activeWorkerConnId: undefined }),
              triggerStartSync: () => Effect.succeed({ sent: 1 }),
              search: () => Effect.fail(new Error('unexpected ws search call')),
            } as any),
            Effect.provideService(Queue, {
              stats: () => Effect.succeed({ pending: 0, in_flight: 0 }),
              inspect: () =>
                Effect.fail(
                  new CliError({
                    code: 'INVALID_ARGS',
                    message: 'Transaction not found: txn-missing',
                    exitCode: 2,
                  }),
                ),
            } as any),
            Effect.provideService(Payload, {} as any),
            Effect.provideService(RefResolver, {} as any),
            Effect.provideService(HostApiClient, {} as any),
            Effect.provide(WorkspaceBindingsLive),
            Effect.provideService(RemDb, {} as any),
            Effect.provideService(Process, {
              isPidRunning: () => Effect.succeed(false),
              spawnDetached: () => Effect.succeed(12345),
              kill: () => Effect.void,
              waitForExit: () => Effect.succeed(true),
            }),
            Effect.provideService(SupervisorState, {
              defaultStateFile: () => path.join(tmpDir, 'ws.state.json'),
              readStateFile: () => Effect.succeed(undefined),
              writeStateFile: () => Effect.void,
              deleteStateFile: () => Effect.void,
            }),
            Effect.provideService(StatusLineController, {
              invalidate: () => Effect.void,
            }),
          ),
        ),
      );
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
