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
import { makeConfig, touchDbFile, waitForPort, writeWsState } from '../helpers/httpApiTestUtils.js';

describe('runtime contract: api status capabilities', () => {
  it('exposes resolved workspace and ready capabilities from the status endpoint', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-status-ready-'));
    const tmpHome = path.join(tmpDir, 'home');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    let actualPort: number | null = null;
    const cfg = makeConfig(tmpHome, storeDbPath, wsStateFilePath, 0);
    const workspaceId = 'ws-live';
    const now = Date.now();
    const previousHome = process.env.HOME;

    try {
      process.env.HOME = tmpHome;
      await touchDbFile(path.join(tmpHome, 'remnote', `remnote-${workspaceId}`, 'remnote.db'));
      await writeWsState(wsStateFilePath, {
        updatedAt: now,
        activeWorkerConnId: 'conn-live',
        clients: [
          {
            connId: 'conn-live',
            isActiveWorker: true,
            uiContext: {
              kbId: workspaceId,
              kbName: 'Live KB',
              pageRemId: 'page-1',
              updatedAt: now,
            },
          },
        ],
      });

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

            const res = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/v1/status`));
            const json = yield* Effect.promise(() => res.json() as Promise<any>);

            expect(res.status).toBe(200);
            expect(json.ok).toBe(true);
            expect(json.data.capabilities.db_read_ready).toBe(true);
            expect(json.data.capabilities.plugin_rpc_ready).toBe(true);
            expect(json.data.capabilities.write_ready).toBe(true);
            expect(json.data.capabilities.ui_session_ready).toBe(true);
            expect(json.data.workspace.resolved).toBe(true);
            expect(json.data.workspace.currentWorkspaceId).toBe(workspaceId);
            expect(json.data.workspace.bindingSource).toBe('live_ui_context');
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
              health: () => Effect.succeed({ url: cfg.wsUrl, rtt_ms: 1 }),
              queryClients: () => Effect.succeed({ clients: [{ connId: 'conn-live' }], activeWorkerConnId: 'conn-live' }),
              triggerStartSync: () => Effect.succeed({ sent: 1 }),
              search: () => Effect.fail(new Error('unexpected ws search call')),
            } as any),
            Effect.provideService(Queue, {
              stats: () => Effect.succeed({ pending: 0, in_flight: 0 }),
              inspect: () => Effect.fail(new Error('unexpected queue inspect call')),
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

  it('returns unresolved workspace diagnostics instead of failing the status endpoint', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-status-unresolved-'));
    const tmpHome = path.join(tmpDir, 'home');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    let actualPort: number | null = null;
    const cfg = makeConfig(tmpHome, storeDbPath, wsStateFilePath, 0);
    const previousHome = process.env.HOME;

    try {
      process.env.HOME = tmpHome;
      await touchDbFile(path.join(tmpHome, 'remnote', 'remnote-ws-1', 'remnote.db'));
      await touchDbFile(path.join(tmpHome, 'remnote', 'remnote-ws-2', 'remnote.db'));
      await writeWsState(wsStateFilePath, { updatedAt: Date.now(), clients: [] });

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

            const res = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/v1/status`));
            const json = yield* Effect.promise(() => res.json() as Promise<any>);

            expect(res.status).toBe(200);
            expect(json.ok).toBe(true);
            expect(json.data.capabilities.db_read_ready).toBe(false);
            expect(json.data.capabilities.plugin_rpc_ready).toBe(false);
            expect(json.data.capabilities.write_ready).toBe(false);
            expect(json.data.workspace.resolved).toBe(false);
            expect(json.data.workspace.candidateWorkspaces).toHaveLength(2);
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
              inspect: () => Effect.fail(new Error('unexpected queue inspect call')),
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
