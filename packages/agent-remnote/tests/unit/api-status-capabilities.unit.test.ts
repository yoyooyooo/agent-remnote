import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { collectApiStatusUseCase } from '../../src/lib/hostApiUseCases.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { Queue } from '../../src/services/Queue.js';
import { WorkspaceBindingsLive } from '../../src/services/WorkspaceBindings.js';
import { WsClient } from '../../src/services/WsClient.js';

function makeConfig(tmpHome: string, storeDbPath: string, wsStateFilePath: string): ResolvedConfig {
  return {
    format: 'json',
    quiet: true,
    debug: false,
    configFile: path.join(tmpHome, '.agent-remnote', 'config.json'),
    remnoteDb: undefined,
    storeDb: storeDbPath,
    wsUrl: 'ws://127.0.0.1:6789/ws',
    wsScheduler: true,
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    repo: undefined,
    wsStateFile: { disabled: false, path: wsStateFilePath },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: path.join(tmpHome, '.agent-remnote', 'status-line.txt'),
    statusLineMinIntervalMs: 250,
    statusLineDebug: false,
    statusLineJsonFile: path.join(tmpHome, '.agent-remnote', 'status-line.json'),
    apiBaseUrl: undefined,
    apiHost: '127.0.0.1',
    apiPort: 3000,
    apiBasePath: '/v1',
    apiPidFile: path.join(tmpHome, '.agent-remnote', 'api.pid'),
    apiLogFile: path.join(tmpHome, '.agent-remnote', 'api.log'),
    apiStateFile: path.join(tmpHome, '.agent-remnote', 'api.state.json'),
  };
}

async function touchDbFile(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, '', 'utf8');
}

async function writeWsState(wsStateFilePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(wsStateFilePath), { recursive: true });
  await fs.writeFile(wsStateFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

describe('api status capabilities (unit)', () => {
  it('returns unresolved workspace diagnostics without failing status', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-status-unresolved-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const previousHome = process.env.HOME;

    try {
      process.env.HOME = tmpHome;
      await touchDbFile(path.join(tmpHome, 'remnote', 'remnote-ws-1', 'remnote.db'));
      await touchDbFile(path.join(tmpHome, 'remnote', 'remnote-ws-2', 'remnote.db'));
      await writeWsState(wsStateFilePath, { updatedAt: Date.now(), clients: [] });

      const layer = Layer.mergeAll(
        Layer.succeed(AppConfig, makeConfig(tmpHome, storeDbPath, wsStateFilePath)),
        WorkspaceBindingsLive,
        Layer.succeed(WsClient, {
          health: () => Effect.succeed({ url: 'ws://127.0.0.1:6789/ws', rtt_ms: 1 }),
          queryClients: () => Effect.succeed({ clients: [], activeWorkerConnId: undefined }),
        } as any),
        Layer.succeed(Queue, {
          stats: () => Effect.succeed({ pending: 0, in_flight: 0 }),
        } as any),
      );

      const data = await Effect.runPromise(
        collectApiStatusUseCase({
          pid: 123,
          host: '127.0.0.1',
          port: 3000,
          basePath: '/v1',
          startedAt: 1_000,
        }).pipe(Effect.provide(layer)),
      );

      expect(data.workspace.resolved).toBe(false);
      expect(data.workspace.candidateWorkspaces).toHaveLength(2);
      expect(data.capabilities.db_read_ready).toBe(false);
      expect(data.capabilities.plugin_rpc_ready).toBe(false);
      expect(data.capabilities.write_ready).toBe(false);
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports ready capabilities when live uiContext can establish a binding', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-status-live-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const previousHome = process.env.HOME;
    const workspaceId = 'ws-live';
    const now = Date.now();

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

      const layer = Layer.mergeAll(
        Layer.succeed(AppConfig, makeConfig(tmpHome, storeDbPath, wsStateFilePath)),
        WorkspaceBindingsLive,
        Layer.succeed(WsClient, {
          health: () => Effect.succeed({ url: 'ws://127.0.0.1:6789/ws', rtt_ms: 1 }),
          queryClients: () => Effect.succeed({ clients: [{ connId: 'conn-live' }], activeWorkerConnId: 'conn-live' }),
        } as any),
        Layer.succeed(Queue, {
          stats: () => Effect.succeed({ pending: 0, in_flight: 0 }),
        } as any),
      );

      const data = await Effect.runPromise(
        collectApiStatusUseCase({
          pid: 123,
          host: '127.0.0.1',
          port: 3000,
          basePath: '/v1',
          startedAt: 1_000,
        }).pipe(Effect.provide(layer)),
      );

      expect(data.workspace.resolved).toBe(true);
      expect(data.workspace.currentWorkspaceId).toBe(workspaceId);
      expect(data.workspace.bindingSource).toBe('live_ui_context');
      expect(data.capabilities.db_read_ready).toBe(true);
      expect(data.capabilities.plugin_rpc_ready).toBe(true);
      expect(data.capabilities.write_ready).toBe(true);
      expect(data.capabilities.ui_session_ready).toBe(true);
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats explicit remnoteDb config as db_read_ready even without a resolved workspace', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-api-status-config-db-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const explicitDbPath = path.join(tmpDir, 'explicit-remnote.db');
    const previousHome = process.env.HOME;

    try {
      process.env.HOME = tmpHome;
      await touchDbFile(explicitDbPath);
      await writeWsState(wsStateFilePath, { updatedAt: Date.now(), clients: [] });

      const layer = Layer.mergeAll(
        Layer.succeed(AppConfig, { ...makeConfig(tmpHome, storeDbPath, wsStateFilePath), remnoteDb: explicitDbPath }),
        WorkspaceBindingsLive,
        Layer.succeed(WsClient, {
          health: () => Effect.succeed({ url: 'ws://127.0.0.1:6789/ws', rtt_ms: 1 }),
          queryClients: () => Effect.succeed({ clients: [], activeWorkerConnId: undefined }),
        } as any),
        Layer.succeed(Queue, {
          stats: () => Effect.succeed({ pending: 0, in_flight: 0 }),
        } as any),
      );

      const data = await Effect.runPromise(
        collectApiStatusUseCase({
          pid: 123,
          host: '127.0.0.1',
          port: 3000,
          basePath: '/v1',
          startedAt: 1_000,
        }).pipe(Effect.provide(layer)),
      );

      expect(data.capabilities.db_read_ready).toBe(true);
      expect(data.workspace.currentDbPath).toBe(explicitDbPath);
      expect(data.workspace.bindingSource).toBe('config');
      expect(data.workspace.resolutionSource).toBe('config');
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
