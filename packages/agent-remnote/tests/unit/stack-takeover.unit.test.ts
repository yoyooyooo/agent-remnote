import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const mocks = vi.hoisted(() => ({
  ensureWsSupervisor: vi.fn(),
  ensureApiDaemon: vi.fn(),
  ensurePluginServer: vi.fn(),
  stopStackBundle: vi.fn(),
  writeFixedOwnerClaim: vi.fn(),
}));

vi.mock('../../src/commands/ws/_shared.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/ws/_shared.js')>('../../src/commands/ws/_shared.js');
  return {
    ...actual,
    ensureWsSupervisor: mocks.ensureWsSupervisor,
  };
});

vi.mock('../../src/commands/api/_shared.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/api/_shared.js')>('../../src/commands/api/_shared.js');
  return {
    ...actual,
    ensureApiDaemon: mocks.ensureApiDaemon,
  };
});

vi.mock('../../src/commands/plugin/_shared.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/plugin/_shared.js')>('../../src/commands/plugin/_shared.js');
  return {
    ...actual,
    ensurePluginServer: mocks.ensurePluginServer,
  };
});

vi.mock('../../src/commands/stack/stop.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/stack/stop.js')>('../../src/commands/stack/stop.js');
  return {
    ...actual,
    stopStackBundle: mocks.stopStackBundle,
  };
});

vi.mock('../../src/lib/runtime-ownership/claim.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/runtime-ownership/claim.js')>('../../src/lib/runtime-ownership/claim.js');
  return {
    ...actual,
    writeFixedOwnerClaim: mocks.writeFixedOwnerClaim,
  };
});

import { runStackTakeover } from '../../src/commands/stack/takeover.js';
import { ApiDaemonFiles } from '../../src/services/ApiDaemonFiles.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import { CliError } from '../../src/services/Errors.js';
import { DaemonFiles } from '../../src/services/DaemonFiles.js';
import { HostApiClient } from '../../src/services/HostApiClient.js';
import { PluginServerFiles } from '../../src/services/PluginServerFiles.js';
import { Process } from '../../src/services/Process.js';
import { SupervisorState } from '../../src/services/SupervisorState.js';
import { WsClient } from '../../src/services/WsClient.js';

describe('stack takeover (unit)', () => {
  beforeEach(() => {
    mocks.ensureWsSupervisor.mockReset();
    mocks.ensureApiDaemon.mockReset();
    mocks.ensurePluginServer.mockReset();
    mocks.stopStackBundle.mockReset();
    mocks.writeFixedOwnerClaim.mockReset();
  });

  it('does not persist the dev claim when bundle startup fails', async () => {
    const tmpHome = path.join(os.tmpdir(), `agent-remnote-takeover-${Date.now()}`);
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = tmpHome;

      mocks.ensureWsSupervisor.mockReturnValue(Effect.succeed({ started: true, pid: 1, pid_file: 'a', log_file: 'b' }));
      mocks.ensureApiDaemon.mockReturnValue(
        Effect.succeed({ started: true, pid: 2, pid_file: 'a', log_file: 'b', state_file: 'c', base_url: 'http://127.0.0.1:3000/v1' }),
      );
      mocks.ensurePluginServer.mockReturnValue(
        Effect.fail(
          new CliError({
            code: 'PLUGIN_UNAVAILABLE',
            message: 'boom',
            exitCode: 1,
          }),
        ),
      );
      mocks.writeFixedOwnerClaim.mockImplementation(() => {
        throw new Error('writeFixedOwnerClaim should not run before dev bundle succeeds');
      });

      const layer = Layer.mergeAll(
        Layer.succeed(Process, {
          isPidRunning: () => Effect.succeed(false),
          getCommandLine: () => Effect.succeed(undefined),
          spawnDetached: () => Effect.succeed(1),
          kill: () => Effect.void,
          waitForExit: () => Effect.succeed(true),
        } as any),
        Layer.succeed(AppConfig, {} as any),
        Layer.succeed(DaemonFiles, {} as any),
        Layer.succeed(SupervisorState, {} as any),
        Layer.succeed(ApiDaemonFiles, {} as any),
        Layer.succeed(PluginServerFiles, {} as any),
        Layer.succeed(WsClient, {} as any),
        Layer.succeed(HostApiClient, {} as any),
      );

      const exit = await Effect.runPromiseExit(runStackTakeover('dev').pipe(Effect.provide(layer)));
      expect(exit._tag).toBe('Failure');
      expect(mocks.writeFixedOwnerClaim).not.toHaveBeenCalled();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it('restores the previous claim when stable launcher spawn fails', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-takeover-stable-rollback-'));
    const tmpHome = path.join(tmpDir, 'home');
    const previousHome = process.env.HOME;
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');
    const claimFile = path.join(controlPlaneRoot, 'fixed-owner-claim.json');

    try {
      process.env.HOME = tmpHome;
      await fs.mkdir(controlPlaneRoot, { recursive: true });
      await fs.writeFile(
        claimFile,
        JSON.stringify(
          {
            claimed_channel: 'dev',
            claimed_owner_id: 'dev',
            runtime_root: path.join(controlPlaneRoot, 'dev', 'fixture'),
            control_plane_root: controlPlaneRoot,
            port_class: 'canonical',
            updated_by: 'stack_takeover',
            updated_at: 1,
            worktree_root: '/tmp/example-worktree',
            launcher_ref: 'source:/tmp/example-worktree',
          },
          null,
          2,
        ),
      );

      mocks.stopStackBundle.mockReturnValue(
        Effect.succeed({
          daemon_stopped: true,
          api_stopped: true,
          plugin_stopped: true,
        }),
      );
      mocks.writeFixedOwnerClaim.mockImplementation(() => undefined);

      const layer = Layer.mergeAll(
        Layer.succeed(Process, {
          isPidRunning: () => Effect.succeed(false),
          getCommandLine: () => Effect.succeed(undefined),
          spawnDetached: () =>
            Effect.fail(
              new CliError({
                code: 'INTERNAL',
                message: 'launcher boom',
                exitCode: 1,
              }),
            ),
          kill: () => Effect.void,
          waitForExit: () => Effect.succeed(true),
        } as any),
        Layer.succeed(AppConfig, {} as any),
        Layer.succeed(DaemonFiles, {} as any),
        Layer.succeed(SupervisorState, {} as any),
        Layer.succeed(ApiDaemonFiles, {} as any),
        Layer.succeed(PluginServerFiles, {} as any),
        Layer.succeed(WsClient, {} as any),
        Layer.succeed(HostApiClient, {} as any),
      );

      const exit = await Effect.runPromiseExit(runStackTakeover('stable').pipe(Effect.provide(layer)));
      expect(exit._tag).toBe('Failure');
      expect(mocks.stopStackBundle).toHaveBeenCalledTimes(1);
      expect(mocks.writeFixedOwnerClaim).toHaveBeenCalledTimes(2);
      expect(mocks.writeFixedOwnerClaim.mock.calls[0]?.[0]?.claim).toMatchObject({ claimed_channel: 'stable' });
      expect(mocks.writeFixedOwnerClaim.mock.calls[1]?.[0]?.claim).toMatchObject({ claimed_channel: 'dev' });
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
