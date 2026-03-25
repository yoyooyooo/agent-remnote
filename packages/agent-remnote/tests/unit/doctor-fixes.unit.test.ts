import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  startWsSupervisor: vi.fn(),
  startApiDaemon: vi.fn(),
  startPluginServer: vi.fn(),
  currentExpectedPluginBuildInfo: vi.fn(),
}));

vi.mock('../../src/commands/ws/_shared.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/ws/_shared.js')>('../../src/commands/ws/_shared.js');
  return {
    ...actual,
    startWsSupervisor: mocks.startWsSupervisor,
  };
});

vi.mock('../../src/commands/api/_shared.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/api/_shared.js')>('../../src/commands/api/_shared.js');
  return {
    ...actual,
    startApiDaemon: mocks.startApiDaemon,
  };
});

vi.mock('../../src/commands/plugin/_shared.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/commands/plugin/_shared.js')>('../../src/commands/plugin/_shared.js');
  return {
    ...actual,
    startPluginServer: mocks.startPluginServer,
  };
});

vi.mock('../../src/lib/pluginBuildInfo.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/pluginBuildInfo.js')>('../../src/lib/pluginBuildInfo.js');
  return {
    ...actual,
    currentExpectedPluginBuildInfo: mocks.currentExpectedPluginBuildInfo,
  };
});

import { applyDoctorFixes } from '../../src/lib/doctor/fixes.js';
import { collectDoctorChecks } from '../../src/lib/doctor/checks.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import { ApiDaemonFiles } from '../../src/services/ApiDaemonFiles.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { DaemonFiles } from '../../src/services/DaemonFiles.js';
import { FsAccess } from '../../src/services/FsAccess.js';
import { HostApiClient } from '../../src/services/HostApiClient.js';
import { PluginServerFiles } from '../../src/services/PluginServerFiles.js';
import { Process } from '../../src/services/Process.js';
import { StatusLineFile } from '../../src/services/StatusLineFile.js';
import { SupervisorState } from '../../src/services/SupervisorState.js';
import { UserConfigFile } from '../../src/services/UserConfigFile.js';
import { WsClient } from '../../src/services/WsClient.js';

function makeConfig(tmpHome: string): ResolvedConfig {
  return {
    format: 'json',
    quiet: true,
    debug: false,
    configFile: path.join(tmpHome, '.agent-remnote', 'config.json'),
    remnoteDb: path.join(tmpHome, 'remnote.db'),
    storeDb: path.join(tmpHome, '.agent-remnote', 'store.sqlite'),
    wsUrl: 'ws://127.0.0.1:6789/ws',
    wsScheduler: true,
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    repo: undefined,
    wsStateFile: { disabled: false, path: path.join(tmpHome, '.agent-remnote', 'ws.bridge.state.json') },
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

describe('doctor fixes (unit)', () => {
  beforeEach(() => {
    mocks.startWsSupervisor.mockReset();
    mocks.startApiDaemon.mockReset();
    mocks.startPluginServer.mockReset();
    mocks.currentExpectedPluginBuildInfo.mockReset();
  });

  it('auto-restarts trusted live runtime mismatches inside doctor --fix', async () => {
    const tmpHome = path.join(os.tmpdir(), `agent-remnote-doctor-fixes-${Date.now()}`);
    const cfg = makeConfig(tmpHome);
    const wsPid = path.join(tmpHome, '.agent-remnote', 'ws.pid');
    const apiPid = path.join(tmpHome, '.agent-remnote', 'api.pid');
    const pluginPid = path.join(tmpHome, '.agent-remnote', 'plugin-server.pid');
    const stateFile = path.join(tmpHome, '.agent-remnote', 'plugin-server.state.json');

    const deletedPidFiles: string[] = [];
    const deletedStateFiles: string[] = [];

    mocks.startWsSupervisor.mockReturnValue(Effect.succeed({ started: true, pid: 1001, pid_file: wsPid, log_file: path.join(tmpHome, '.agent-remnote', 'ws.log') }));
    mocks.startApiDaemon.mockReturnValue(
      Effect.succeed({
        started: true,
        pid: 1002,
        pid_file: apiPid,
        log_file: path.join(tmpHome, '.agent-remnote', 'api.log'),
        state_file: path.join(tmpHome, '.agent-remnote', 'api.state.json'),
        base_url: 'http://127.0.0.1:3000/v1',
      }),
    );
    mocks.startPluginServer.mockReturnValue(
      Effect.succeed({
        started: true,
        pid: 1003,
        pid_file: pluginPid,
        log_file: path.join(tmpHome, '.agent-remnote', 'plugin-server.log'),
        state_file: stateFile,
        base_url: 'http://127.0.0.1:8080',
      }),
    );
    mocks.currentExpectedPluginBuildInfo.mockReturnValue({
      name: '@remnote/plugin',
      version: '0.0.2',
      build_id: 'expected-plugin',
      built_at: 1,
      source_stamp: 1,
      mode: 'dist',
    });

    const layer = Layer.mergeAll(
      Layer.succeed(AppConfig, cfg),
      Layer.succeed(DaemonFiles, {
        defaultPidFile: () => wsPid,
        defaultLogFile: () => path.join(tmpHome, '.agent-remnote', 'ws.log'),
        readPidFile: () =>
          Effect.succeed({
            pid: 101,
            mode: 'supervisor',
            state_file: path.join(tmpHome, '.agent-remnote', 'ws.state.json'),
            log_file: path.join(tmpHome, '.agent-remnote', 'ws.log'),
            build: { name: 'agent-remnote', version: '0.0.0', build_id: 'old-daemon', built_at: 1, source_stamp: 1, mode: 'dist' },
            cmd: [process.execPath, '--import', 'tsx', path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts'), 'daemon', 'supervisor'],
            ws_bridge_state_file: cfg.wsStateFile.path,
            status_line_file: cfg.statusLineFile,
            status_line_json_file: cfg.statusLineJsonFile,
          } as any),
        writePidFile: () => Effect.void,
        deletePidFile: (filePath: string) =>
          Effect.sync(() => {
            deletedPidFiles.push(filePath);
          }),
      } as any),
      Layer.succeed(ApiDaemonFiles, {
        defaultPidFile: () => apiPid,
        defaultLogFile: () => path.join(tmpHome, '.agent-remnote', 'api.log'),
        defaultStateFile: () => path.join(tmpHome, '.agent-remnote', 'api.state.json'),
        readPidFile: () =>
          Effect.succeed({
            pid: 202,
            host: '127.0.0.1',
            port: 3000,
            base_path: '/v1',
            log_file: path.join(tmpHome, '.agent-remnote', 'api.log'),
            state_file: path.join(tmpHome, '.agent-remnote', 'api.state.json'),
            build: { name: 'agent-remnote', version: '0.0.0', build_id: 'old-api', built_at: 1, source_stamp: 1, mode: 'dist' },
            cmd: [process.execPath, '--import', 'tsx', path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts'), 'api', 'serve'],
          } as any),
        writePidFile: () => Effect.void,
        deletePidFile: (filePath: string) =>
          Effect.sync(() => {
            deletedPidFiles.push(filePath);
          }),
        readStateFile: () => Effect.succeed(undefined),
        writeStateFile: () => Effect.void,
        deleteStateFile: (filePath: string) =>
          Effect.sync(() => {
            deletedStateFiles.push(filePath);
          }),
      } as any),
      Layer.succeed(PluginServerFiles, {
        defaultPidFile: () => pluginPid,
        defaultLogFile: () => path.join(tmpHome, '.agent-remnote', 'plugin-server.log'),
        defaultStateFile: () => stateFile,
        readPidFile: () =>
          Effect.succeed({
            pid: 303,
            host: '127.0.0.1',
            port: 8080,
            log_file: path.join(tmpHome, '.agent-remnote', 'plugin-server.log'),
            state_file: stateFile,
            build: { name: 'agent-remnote', version: '0.0.0', build_id: 'old-plugin', built_at: 1, source_stamp: 1, mode: 'dist' },
            cmd: [process.execPath, '--import', 'tsx', path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts'), 'plugin', 'serve'],
          } as any),
        writePidFile: () => Effect.void,
        deletePidFile: (filePath: string) =>
          Effect.sync(() => {
            deletedPidFiles.push(filePath);
          }),
        readStateFile: () =>
          Effect.succeed({
            running: true,
            pid: 303,
            build: { name: 'agent-remnote', version: '0.0.0', build_id: 'old-plugin', built_at: 1, source_stamp: 1, mode: 'dist' },
            plugin_build: { name: '@remnote/plugin', version: '0.0.2', build_id: 'old-artifact', built_at: 1, source_stamp: 1, mode: 'dist' },
            host: '127.0.0.1',
            port: 8080,
            startedAt: 1,
            localBaseUrl: 'http://127.0.0.1:8080',
            distPath: path.join(tmpHome, 'dist'),
          } as any),
        writeStateFile: () => Effect.void,
        deleteStateFile: (filePath: string) =>
          Effect.sync(() => {
            deletedStateFiles.push(filePath);
          }),
      } as any),
      Layer.succeed(SupervisorState, {
        defaultStateFile: () => path.join(tmpHome, '.agent-remnote', 'ws.state.json'),
        readStateFile: () => Effect.succeed(undefined),
        writeStateFile: () => Effect.void,
        deleteStateFile: (filePath: string) =>
          Effect.sync(() => {
            deletedStateFiles.push(filePath);
          }),
      } as any),
      Layer.succeed(Process, {
        isPidRunning: () => Effect.succeed(true),
        getCommandLine: (pid: number) => {
          if (pid === 101) return Effect.succeed(`${process.execPath} --import tsx ${path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts')} daemon supervisor`);
          if (pid === 202) return Effect.succeed(`${process.execPath} --import tsx ${path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts')} api serve`);
          return Effect.succeed(`${process.execPath} --import tsx ${path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts')} plugin serve`);
        },
        spawnDetached: () => Effect.succeed(999),
        kill: () => Effect.void,
        waitForExit: () => Effect.succeed(true),
      } as any),
      Layer.succeed(UserConfigFile, {
        repair: () =>
          Effect.succeed({
            configFile: cfg.configFile,
            changed: false,
            before: { valid: true },
            after: { valid: true },
          }),
        previewRepair: () =>
          Effect.succeed({
            configFile: cfg.configFile,
            exists: true,
            changed: false,
            before: { valid: true },
            after: { valid: true },
            nextDoc: {},
          }),
      } as any),
      Layer.succeed(StatusLineFile, {
        write: () => Effect.succeed({ wrote: true, textFilePath: cfg.statusLineFile }),
      } as any),
      Layer.succeed(FsAccess, {
        canWritePath: () => Effect.succeed(true),
        checkWritableFile: () => Effect.succeed({ ok: true }),
      } as any),
      Layer.succeed(WsClient, {
        health: () =>
          Effect.fail({
            _tag: 'CliError',
            code: 'WS_UNAVAILABLE',
            message: 'offline',
            exitCode: 1,
          } as any),
        queryClients: () => Effect.succeed({ clients: [], activeWorkerConnId: undefined }),
      } as any),
      Layer.succeed(HostApiClient, {
        health: () =>
          Effect.fail({
            _tag: 'CliError',
            code: 'API_UNAVAILABLE',
            message: 'offline',
            exitCode: 1,
          } as any),
      } as any),
    );

    const result = await Effect.runPromise(applyDoctorFixes().pipe(Effect.provide(layer)));

    const restartFix = result.fixes.find((item) => item.id === 'runtime.restart_mismatched_services');
    expect(result.changed).toBe(true);
    expect(restartFix?.changed).toBe(true);
    expect((restartFix?.details as any)?.restarted).toEqual(expect.arrayContaining(['daemon', 'api', 'plugin']));
    expect((restartFix?.details as any)?.failed).toEqual([]);
    expect(deletedPidFiles).toEqual(expect.arrayContaining([wsPid, apiPid, pluginPid]));
    expect(deletedStateFiles).toEqual(
      expect.arrayContaining([
        path.join(tmpHome, '.agent-remnote', 'ws.state.json'),
        path.join(tmpHome, '.agent-remnote', 'api.state.json'),
        stateFile,
      ]),
    );
  });

  it('uses plugin state build info for plugin artifact mismatch checks', async () => {
    const tmpHome = path.join(os.tmpdir(), `agent-remnote-doctor-checks-${Date.now()}`);
    const cfg = makeConfig(tmpHome);
    const pluginPid = path.join(tmpHome, '.agent-remnote', 'plugin-server.pid');
    const pluginState = path.join(tmpHome, '.agent-remnote', 'plugin-server.state.json');
    mocks.currentExpectedPluginBuildInfo.mockReturnValue({
      name: '@remnote/plugin',
      version: '0.0.2',
      build_id: 'expected-plugin',
      built_at: 1,
      source_stamp: 1,
      mode: 'dist',
    });

    const checks = await Effect.runPromise(
      collectDoctorChecks().pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AppConfig, cfg),
            Layer.succeed(DaemonFiles, {
              defaultPidFile: () => path.join(tmpHome, '.agent-remnote', 'ws.pid'),
              defaultLogFile: () => path.join(tmpHome, '.agent-remnote', 'ws.log'),
              readPidFile: () => Effect.succeed(undefined),
              writePidFile: () => Effect.void,
              deletePidFile: () => Effect.void,
            } as any),
            Layer.succeed(ApiDaemonFiles, {
              defaultPidFile: () => path.join(tmpHome, '.agent-remnote', 'api.pid'),
              defaultLogFile: () => path.join(tmpHome, '.agent-remnote', 'api.log'),
              defaultStateFile: () => path.join(tmpHome, '.agent-remnote', 'api.state.json'),
              readPidFile: () => Effect.succeed(undefined),
              writePidFile: () => Effect.void,
              deletePidFile: () => Effect.void,
              readStateFile: () => Effect.succeed(undefined),
              writeStateFile: () => Effect.void,
              deleteStateFile: () => Effect.void,
            } as any),
            Layer.succeed(PluginServerFiles, {
              defaultPidFile: () => pluginPid,
              defaultLogFile: () => path.join(tmpHome, '.agent-remnote', 'plugin-server.log'),
              defaultStateFile: () => pluginState,
              readPidFile: () =>
                Effect.succeed({
                  pid: 303,
                  state_file: pluginState,
                  build: { name: 'agent-remnote', version: '1.5.0', build_id: 'current-runtime', built_at: 1, source_stamp: 1, mode: 'dist' },
                  cmd: [process.execPath, '--import', 'tsx', path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts'), 'plugin', 'serve'],
                } as any),
              writePidFile: () => Effect.void,
              deletePidFile: () => Effect.void,
              readStateFile: () =>
                Effect.succeed({
                  running: true,
                  pid: 303,
                  plugin_build: { name: '@remnote/plugin', version: '0.0.2', build_id: 'expected-plugin', built_at: 1, source_stamp: 1, mode: 'dist' },
                  host: '127.0.0.1',
                  port: 8080,
                  startedAt: 1,
                  localBaseUrl: 'http://127.0.0.1:8080',
                  distPath: path.join(tmpHome, 'dist'),
                } as any),
              writeStateFile: () => Effect.void,
              deleteStateFile: () => Effect.void,
            } as any),
            Layer.succeed(Process, {
              isPidRunning: () => Effect.succeed(true),
              getCommandLine: () => Effect.succeed(`${process.execPath} --import tsx ${path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts')} plugin serve`),
              spawnDetached: () => Effect.succeed(999),
              kill: () => Effect.void,
              waitForExit: () => Effect.succeed(true),
            } as any),
            Layer.succeed(UserConfigFile, {
              previewRepair: () =>
                Effect.succeed({
                  configFile: cfg.configFile,
                  exists: true,
                  changed: false,
                  before: { valid: true },
                  after: { valid: true },
                  nextDoc: {},
                }),
            } as any),
            Layer.succeed(FsAccess, {
              canWritePath: () => Effect.succeed(true),
              checkWritableFile: () => Effect.succeed({ ok: true }),
            } as any),
          ),
        ),
      ),
    );

    const pluginMismatch = checks.find((item) => item.id === 'runtime.version_mismatch');
    expect(JSON.stringify(pluginMismatch?.details ?? [])).not.toContain('plugin-artifact');
  });
});
