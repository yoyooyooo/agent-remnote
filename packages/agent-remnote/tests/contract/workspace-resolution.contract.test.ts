import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  resolveWorkspaceSnapshot,
  requireResolvedWorkspace,
} from '../../src/lib/workspaceResolver.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { WorkspaceBindingsLive } from '../../src/services/WorkspaceBindings.js';

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

async function writeWsState(
  wsStateFilePath: string,
  payload:
    | {
        readonly updatedAt: number;
        readonly activeWorkerConnId?: string | undefined;
        readonly clients: readonly unknown[];
      }
    | undefined,
): Promise<void> {
  await fs.mkdir(path.dirname(wsStateFilePath), { recursive: true });
  if (!payload) {
    await fs.rm(wsStateFilePath, { force: true });
    return;
  }
  await fs.writeFile(wsStateFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

describe('workspace resolution contract', () => {
  it('auto-binds the live uiContext workspace and reuses it after the ui session disappears', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-workspace-resolution-live-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const workspaceId = 'ws-live';
    const dbPath = path.join(tmpHome, 'remnote', `remnote-${workspaceId}`, 'remnote.db');
    const previousHome = process.env.HOME;
    const now = Date.now();

    try {
      process.env.HOME = tmpHome;
      await touchDbFile(dbPath);
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
              updatedAt: now,
            },
          },
        ],
      });

      const cfg = makeConfig(tmpHome, storeDbPath, wsStateFilePath);
      const layer = Layer.mergeAll(Layer.succeed(AppConfig, cfg), WorkspaceBindingsLive);

      const first = await Effect.runPromise(
        resolveWorkspaceSnapshot({}).pipe(Effect.provide(layer)),
      );
      expect(first.resolved).toBe(true);
      expect(first.source).toBe('live_ui_context');
      expect(first.workspaceId).toBe(workspaceId);
      expect(first.dbPath).toBe(dbPath);

      await writeWsState(wsStateFilePath, undefined);

      const second = await Effect.runPromise(
        requireResolvedWorkspace({}).pipe(Effect.provide(layer)),
      );
      expect(second.source).toBe('binding');
      expect(second.workspaceId).toBe(workspaceId);
      expect(second.dbPath).toBe(dbPath);
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails with WORKSPACE_UNRESOLVED when multiple primary candidates exist without stronger signals', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-workspace-resolution-unresolved-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDbPath = path.join(tmpDir, 'store.sqlite');
    const wsStateFilePath = path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json');
    const previousHome = process.env.HOME;

    try {
      process.env.HOME = tmpHome;
      await touchDbFile(path.join(tmpHome, 'remnote', 'remnote-ws-1', 'remnote.db'));
      await touchDbFile(path.join(tmpHome, 'remnote', 'remnote-ws-2', 'remnote.db'));
      await writeWsState(wsStateFilePath, undefined);

      const cfg = makeConfig(tmpHome, storeDbPath, wsStateFilePath);
      const layer = Layer.mergeAll(Layer.succeed(AppConfig, cfg), WorkspaceBindingsLive);

      const result = await Effect.runPromise(
        Effect.either(requireResolvedWorkspace({}).pipe(Effect.provide(layer))),
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.code).toBe('WORKSPACE_UNRESOLVED');
        expect(Array.isArray((result.left.details as any)?.candidates)).toBe(true);
        expect((result.left.details as any)?.candidates).toHaveLength(2);
      }
    } finally {
      process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
