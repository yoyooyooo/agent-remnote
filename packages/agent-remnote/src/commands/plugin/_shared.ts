import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Either from 'effect/Either';

import { PluginServerFiles, type PluginServerPidFile } from '../../services/PluginServerFiles.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';

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
}): PluginServerPidFile {
  return {
    pid: params.pid,
    started_at: params.startedAt,
    host: params.host,
    port: params.port,
    log_file: params.logFile,
    state_file: params.stateFile,
    cmd: params.cmd,
  };
}

export function checkPluginServerHealth(
  baseUrl: string,
  timeoutMs: number,
): Effect.Effect<{ readonly base_url: string }, CliError> {
  return Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/manifest.json`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Unexpected response status: ${res.status}`);
        }
        return { base_url: baseUrl };
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (error) =>
      new CliError({
        code: 'PLUGIN_UNAVAILABLE',
        message: 'Plugin server is unavailable',
        exitCode: 1,
        details: { base_url: baseUrl, error: String((error as any)?.message || error) },
      }),
  });
}

export function waitForPluginServerHealth(baseUrl: string, waitMs: number): Effect.Effect<void, CliError> {
  return Effect.gen(function* () {
    if (!Number.isFinite(waitMs) || waitMs < 0) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: '--wait must be a non-negative integer (ms)',
          exitCode: 2,
          details: { wait_ms: waitMs },
        }),
      );
    }
    if (waitMs === 0) return;

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now());
      const res = yield* checkPluginServerHealth(
        baseUrl,
        Math.min(PLUGIN_SERVER_HEALTH_TIMEOUT_MS, Math.max(1, remaining)),
      ).pipe(Effect.either);
      if (Either.isRight(res)) return;
      yield* Effect.sleep(Duration.millis(300));
    }

    return yield* Effect.fail(
      new CliError({
        code: 'PLUGIN_UNAVAILABLE',
        message: `Timed out waiting for plugin server to become available (${waitMs}ms)`,
        exitCode: 1,
        details: { base_url: baseUrl, wait_ms: waitMs },
        hint: ['agent-remnote plugin status --json', 'agent-remnote plugin logs --lines 200'],
      }),
    );
  });
}

export function startPluginServer(
  params: PluginServerStartParams,
): Effect.Effect<PluginServerStartResult, CliError, PluginServerFiles | Process> {
  return Effect.gen(function* () {
    const files = yield* PluginServerFiles;
    const proc = yield* Process;

    const host = params.host ?? PLUGIN_SERVER_DEFAULT_HOST;
    const port = params.port ?? PLUGIN_SERVER_DEFAULT_PORT;
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

    const pid = yield* proc.spawnDetached({ command: cmd.command, args: cmd.args, logFile: logFilePath });
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
      }),
    );

    yield* waitForPluginServerHealth(baseUrl, params.waitMs);
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

    const host = params.host ?? PLUGIN_SERVER_DEFAULT_HOST;
    const port = params.port ?? PLUGIN_SERVER_DEFAULT_PORT;
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
