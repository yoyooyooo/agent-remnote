import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { WorkspaceBindings, WorkspaceBindingsLive } from '../../src/services/WorkspaceBindings.js';

async function runWithWorkspaceBindings<A>(
  fn: (svc: typeof WorkspaceBindings.Service) => Effect.Effect<A, any>,
): Promise<A> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* WorkspaceBindings;
      return yield* fn(svc);
    }).pipe(Effect.provide(WorkspaceBindingsLive)),
  );
}

describe('WorkspaceBindings (unit)', () => {
  it('persists and refreshes a binding while preserving firstSeenAt', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-workspace-bindings-'));
    const storeDbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const initial = await runWithWorkspaceBindings((svc) =>
        svc.upsert({
          storeDbPath,
          workspaceId: 'ws-1',
          kbName: 'KB One',
          dbPath: '/tmp/remnote-ws-1/remnote.db',
          source: 'live_ui_context',
          makeCurrent: true,
          recordedAt: 1_000,
          verifiedAt: 1_000,
          lastUiContextAt: 1_000,
        }),
      );

      const refreshed = await runWithWorkspaceBindings((svc) =>
        svc.upsert({
          storeDbPath,
          workspaceId: 'ws-1',
          kbName: 'KB One Renamed',
          dbPath: '/tmp/remnote-ws-1-new/remnote.db',
          source: 'explicit',
          makeCurrent: true,
          recordedAt: 2_000,
          verifiedAt: 2_000,
        }),
      );

      expect(initial.workspaceId).toBe('ws-1');
      expect(initial.isCurrent).toBe(true);
      expect(initial.firstSeenAt).toBe(1_000);
      expect(initial.lastUiContextAt).toBe(1_000);

      expect(refreshed.workspaceId).toBe('ws-1');
      expect(refreshed.kbName).toBe('KB One Renamed');
      expect(refreshed.dbPath).toBe('/tmp/remnote-ws-1-new/remnote.db');
      expect(refreshed.source).toBe('explicit');
      expect(refreshed.isCurrent).toBe(true);
      expect(refreshed.firstSeenAt).toBe(1_000);
      expect(refreshed.lastVerifiedAt).toBe(2_000);
      expect(refreshed.lastUiContextAt).toBe(1_000);
      expect(refreshed.updatedAt).toBe(2_000);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps only one current binding at a time', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-workspace-bindings-current-'));
    const storeDbPath = path.join(tmpDir, 'store.sqlite');

    try {
      await runWithWorkspaceBindings((svc) =>
        svc.upsert({
          storeDbPath,
          workspaceId: 'ws-1',
          kbName: 'KB One',
          dbPath: '/tmp/remnote-ws-1/remnote.db',
          source: 'single_candidate_auto',
          makeCurrent: true,
          recordedAt: 1_000,
          verifiedAt: 1_000,
        }),
      );

      await runWithWorkspaceBindings((svc) =>
        svc.upsert({
          storeDbPath,
          workspaceId: 'ws-2',
          kbName: 'KB Two',
          dbPath: '/tmp/remnote-ws-2/remnote.db',
          source: 'deep_link',
          makeCurrent: true,
          recordedAt: 2_000,
          verifiedAt: 2_000,
        }),
      );

      const current = await runWithWorkspaceBindings((svc) => svc.getCurrent({ storeDbPath }));
      const first = await runWithWorkspaceBindings((svc) => svc.getByWorkspaceId({ storeDbPath, workspaceId: 'ws-1' }));
      const second = await runWithWorkspaceBindings((svc) => svc.getByWorkspaceId({ storeDbPath, workspaceId: 'ws-2' }));
      const all = await runWithWorkspaceBindings((svc) => svc.list({ storeDbPath }));

      expect(current?.workspaceId).toBe('ws-2');
      expect(first?.isCurrent).toBe(false);
      expect(second?.isCurrent).toBe(true);
      expect(all.map((item) => item.workspaceId)).toEqual(['ws-2', 'ws-1']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
