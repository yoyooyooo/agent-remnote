import * as Effect from 'effect/Effect';
import * as Either from 'effect/Either';

import { checkPluginServerHealth, waitForPluginServerHealth } from '../../lib/pluginServerHealth.js';
import type { RuntimeOwnerDescriptor } from '../../lib/runtime-ownership/ownerDescriptor.js';
import { PluginServerFiles, type PluginServerPidFile } from '../../services/PluginServerFiles.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { requireTrustedPidRecord } from '../../lib/pidTrust.js';
import { currentRuntimeBuildInfo } from '../../lib/runtimeBuildInfo.js';
import { validateCanonicalPortUsage } from '../../lib/runtime-ownership/claim.js';
import { currentRuntimeOwnerDescriptor } from '../../lib/runtime-ownership/ownerDescriptor.js';
import { resolveRuntimeOwnershipContext } from '../../lib/runtime-ownership/profile.js';
import { defaultPluginPortForContext } from '../../lib/runtime-ownership/portClass.js';

export const PLUGIN_SERVER_HEALTH_TIMEOUT_MS = 2000;
export const PLUGIN_SERVER_START_WAIT_DEFAULT_MS = 15_000;
export const PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS = 5_000;
export const PLUGIN_SERVER_DEFAULT_HOST = '127.0.0.1';
export const PLUGIN_SERVER_DEFAULT_PORT = 8080;

export type PluginServerStartResult = {
  readonly started: boolean;
  readonly pid?: number;
  readonly pid_file: string;
  readonly log_file: string;
  readonly state_file: string;
  readonly base_url: string;
};

export type PluginServerStartParams = {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly waitMs: number;
  readonly pidFile?: string | undefined;
  readonly logFile?: string | undefined;
  readonly stateFile?: string | undefined;
  readonly ownerOverride?: RuntimeOwnerDescriptor | undefined;
  readonly envOverride?: NodeJS.ProcessEnv | undefined;
};

export function pluginServerLocalBaseUrl(host: string, port: number): string {
  const normalizedHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${normalizedHost}:${port}`;
}

function childCommandLine(params: {
  readonly host: string;
  readonly port: number;
  readonly stateFile: string;
}): { command: string; args: string[] } {
  const command = process.argv[0];
  const script = process.argv[1];
  if (!command || !script) {
    throw new CliError({
      code: 'INTERNAL',
      message: 'Unable to determine the current executable entrypoint (process.argv is incomplete)',
      exitCode: 1,
      details: { argv: process.argv },
    });
  }
  const execArgv = Array.isArray(process.execArgv) ? process.execArgv : [];
  const args = [...execArgv, script, 'plugin', 'serve', '--host', params.host, '--port', String(params.port), '--state-file', params.stateFile];
  return { command, args };
}

function toPidFileValue(params: {
  readonly pid: number;
  readonly startedAt: number;
  readonly host: string;
  readonly port: number;
  readonly logFile: string;
  readonly stateFile: string;
  readonly cmd: readonly string[];
  readonly owner?: RuntimeOwnerDescriptor | undefined;
}): PluginServerPidFile {
  return {
    pid: params.pid,
    build: currentRuntimeBuildInfo(),
    owner: params.owner ?? currentRuntimeOwnerDescriptor(),
    started_at: params.startedAt,
    host: params.host,
    port: params.port,
    log_file: params.logFile,
    state_file: params.stateFile,
    cmd: params.cmd,
  };
}

export function startPluginServer(
  params: PluginServerStartParams,
): Effect.Effect<PluginServerStartResult, CliError, PluginServerFiles | Process> {
  return Effect.gen(function* () {
    const files = yield* PluginServerFiles;
    const proc = yield* Process;
    const ownership = resolveRuntimeOwnershipContext();

    const host = params.host ?? PLUGIN_SERVER_DEFAULT_HOST;
    const port = params.port ?? defaultPluginPortForContext(ownership);
    yield* validateCanonicalPortUsage({ ctx: ownership, service: 'plugin', requestedPort: port });
    const pidFilePath = resolveUserFilePath(params.pidFile ?? files.defaultPidFile());
    const logFilePath = resolveUserFilePath(params.logFile ?? files.defaultLogFile());
    const stateFilePath = resolveUserFilePath(params.stateFile ?? files.defaultStateFile());
    const baseUrl = pluginServerLocalBaseUrl(host, port);

    const existing = yield* files.readPidFile(pidFilePath);
    if (existing) {
      const alive = yield* proc.isPidRunning(existing.pid);
      if (!alive) {
        yield* files.deletePidFile(pidFilePath);
      } else {
        yield* requireTrustedPidRecord({ record: existing, pidFilePath });
        return {
          started: false,
          pid: existing.pid,
          pid_file: pidFilePath,
          log_file: existing.log_file ?? logFilePath,
          state_file: existing.state_file ?? stateFilePath,
          base_url: baseUrl,
        };
      }
    }

    const pre = yield* checkPluginServerHealth(baseUrl, PLUGIN_SERVER_HEALTH_TIMEOUT_MS).pipe(Effect.either);
    if (Either.isRight(pre)) {
      return {
        started: false,
        pid_file: pidFilePath,
        log_file: logFilePath,
        state_file: stateFilePath,
        base_url: baseUrl,
      };
    }

    const cmd = yield* Effect.try({
      try: () => childCommandLine({ host, port, stateFile: stateFilePath }),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'INTERNAL',
              message: 'Failed to start plugin server',
              exitCode: 1,
              details: { error: String((error as any)?.message || error) },
            }),
    });

    const pid = yield* proc.spawnDetached({
      command: cmd.command,
      args: cmd.args,
      logFile: logFilePath,
      env: params.envOverride ? { ...process.env, ...params.envOverride } : undefined,
    });
    yield* files.writePidFile(
      pidFilePath,
      toPidFileValue({
        pid,
        startedAt: Date.now(),
        host,
        port,
        logFile: logFilePath,
        stateFile: stateFilePath,
        cmd: [cmd.command, ...cmd.args],
        owner: params.ownerOverride,
      }),
    );

    yield* waitForPluginServerHealth(baseUrl, params.waitMs, PLUGIN_SERVER_HEALTH_TIMEOUT_MS);
    return {
      started: true,
      pid,
      pid_file: pidFilePath,
      log_file: logFilePath,
      state_file: stateFilePath,
      base_url: baseUrl,
    };
  });
}

export function ensurePluginServer(
  params: PluginServerStartParams,
): Effect.Effect<PluginServerStartResult, CliError, PluginServerFiles | Process> {
  return Effect.gen(function* () {
    const files = yield* PluginServerFiles;
    const proc = yield* Process;
    const ownership = resolveRuntimeOwnershipContext();

    const host = params.host ?? PLUGIN_SERVER_DEFAULT_HOST;
    const port = params.port ?? defaultPluginPortForContext(ownership);
    yield* validateCanonicalPortUsage({ ctx: ownership, service: 'plugin', requestedPort: port });
    const pidFilePath = resolveUserFilePath(params.pidFile ?? files.defaultPidFile());
    const logFilePath = resolveUserFilePath(params.logFile ?? files.defaultLogFile());
    const stateFilePath = resolveUserFilePath(params.stateFile ?? files.defaultStateFile());
    const baseUrl = pluginServerLocalBaseUrl(host, port);

    const pre = yield* checkPluginServerHealth(baseUrl, PLUGIN_SERVER_HEALTH_TIMEOUT_MS).pipe(Effect.either);
    if (Either.isRight(pre)) {
      const existing = yield* files.readPidFile(pidFilePath);
      if (existing) {
        const alive = yield* proc.isPidRunning(existing.pid);
        if (alive) {
          yield* requireTrustedPidRecord({ record: existing, pidFilePath });
          return {
            started: false,
            pid: existing.pid,
            pid_file: pidFilePath,
            log_file: existing.log_file ?? logFilePath,
            state_file: existing.state_file ?? stateFilePath,
            base_url: baseUrl,
          };
        }
      }
      return {
        started: false,
        pid_file: pidFilePath,
        log_file: logFilePath,
        state_file: stateFilePath,
        base_url: baseUrl,
      };
    }

    return yield* startPluginServer(params);
  });
}
