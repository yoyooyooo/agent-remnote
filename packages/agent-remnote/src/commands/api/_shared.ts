import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Either from 'effect/Either';

import { AppConfig } from '../../services/AppConfig.js';
import { ApiDaemonFiles, type ApiPidFile } from '../../services/ApiDaemonFiles.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { apiLocalBaseUrl } from '../../lib/apiUrls.js';
import { currentRuntimeBuildInfo } from '../../lib/runtimeBuildInfo.js';

export const API_HEALTH_TIMEOUT_MS = 2000;
export const API_START_WAIT_DEFAULT_MS = 15_000;
export const API_STOP_WAIT_DEFAULT_MS = 5_000;

export type ApiDaemonStartResult = {
  readonly started: boolean;
  readonly pid?: number;
  readonly pid_file: string;
  readonly log_file: string;
  readonly state_file: string;
  readonly base_url: string;
};

export type ApiStartParams = {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly waitMs: number;
  readonly pidFile?: string | undefined;
  readonly logFile?: string | undefined;
  readonly stateFile?: string | undefined;
};

function childCommandLine(params: {
  readonly wsUrl: string;
  readonly storeDb: string;
  readonly remnoteDb?: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly basePath: string;
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
  const args = [...execArgv, script, '--daemon-url', params.wsUrl, '--store-db', params.storeDb];
  if (params.remnoteDb) args.push('--remnote-db', params.remnoteDb);
  args.push('--api-base-path', params.basePath);
  args.push('api', 'serve', '--host', params.host, '--port', String(params.port), '--state-file', params.stateFile);
  return { command, args };
}

function toPidFileValue(params: {
  readonly pid: number;
  readonly startedAt: number;
  readonly host: string;
  readonly port: number;
  readonly basePath: string;
  readonly logFile: string;
  readonly stateFile: string;
  readonly cmd: readonly string[];
}): ApiPidFile {
  return {
    pid: params.pid,
    build: currentRuntimeBuildInfo(),
    started_at: params.startedAt,
    host: params.host,
    port: params.port,
    base_path: params.basePath,
    log_file: params.logFile,
    state_file: params.stateFile,
    cmd: params.cmd,
  };
}

export function waitForApiHealth(baseUrl: string, waitMs: number): Effect.Effect<void, CliError, HostApiClient> {
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

    const api = yield* HostApiClient;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now());
      const res = yield* api
        .health({ baseUrl, timeoutMs: Math.min(API_HEALTH_TIMEOUT_MS, Math.max(1, remaining)) })
        .pipe(Effect.either);
      if (Either.isRight(res)) return;
      yield* Effect.sleep(Duration.millis(300));
    }

    return yield* Effect.fail(
      new CliError({
        code: 'API_TIMEOUT',
        message: `Timed out waiting for host API to become available (${waitMs}ms)`,
        exitCode: 1,
        details: { base_url: baseUrl, wait_ms: waitMs },
        hint: ['agent-remnote api status --json', 'agent-remnote api logs', 'agent-remnote stack status --json'],
      }),
    );
  });
}

export function startApiDaemon(
  params: ApiStartParams,
): Effect.Effect<ApiDaemonStartResult, CliError, AppConfig | HostApiClient | ApiDaemonFiles | Process> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const api = yield* HostApiClient;
    const apiFiles = yield* ApiDaemonFiles;
    const proc = yield* Process;

    const host = params.host ?? cfg.apiHost ?? '0.0.0.0';
    const port = params.port ?? cfg.apiPort ?? 3000;
    const basePath = cfg.apiBasePath ?? '/v1';
    const pidFilePath = resolveUserFilePath(params.pidFile ?? apiFiles.defaultPidFile());
    const logFilePath = resolveUserFilePath(params.logFile ?? apiFiles.defaultLogFile());
    const stateFilePath = resolveUserFilePath(params.stateFile ?? apiFiles.defaultStateFile());
    const localBaseUrl = apiLocalBaseUrl(port, basePath);

    const existing = yield* apiFiles.readPidFile(pidFilePath);
    if (existing) {
      const alive = yield* proc.isPidRunning(existing.pid);
      if (!alive) {
        yield* apiFiles.deletePidFile(pidFilePath);
      } else {
        return {
          started: false,
          pid: existing.pid,
          pid_file: pidFilePath,
          log_file: logFilePath,
          state_file: stateFilePath,
          base_url: localBaseUrl,
        };
      }
    }

    const pre = yield* api.health({ baseUrl: localBaseUrl, timeoutMs: API_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    if (Either.isRight(pre)) {
      return {
        started: false,
        pid_file: pidFilePath,
        log_file: logFilePath,
        state_file: stateFilePath,
        base_url: localBaseUrl,
      };
    }

    const cmd = yield* Effect.try({
      try: () =>
        childCommandLine({
          wsUrl: cfg.wsUrl,
          storeDb: cfg.storeDb,
          remnoteDb: cfg.remnoteDb,
          host,
          port,
          basePath,
          stateFile: stateFilePath,
        }),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INTERNAL',
              message: 'Failed to start host api',
              exitCode: 1,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    const pid = yield* proc.spawnDetached({ command: cmd.command, args: cmd.args, logFile: logFilePath });
    yield* apiFiles.writePidFile(
      pidFilePath,
      toPidFileValue({
        pid,
        startedAt: Date.now(),
        host,
        port,
        basePath,
        logFile: logFilePath,
        stateFile: stateFilePath,
        cmd: [cmd.command, ...cmd.args],
      }),
    );

    yield* waitForApiHealth(localBaseUrl, params.waitMs);
    return {
      started: true,
      pid,
      pid_file: pidFilePath,
      log_file: logFilePath,
      state_file: stateFilePath,
      base_url: localBaseUrl,
    };
  });
}

export function ensureApiDaemon(
  params: ApiStartParams,
): Effect.Effect<ApiDaemonStartResult, CliError, AppConfig | HostApiClient | ApiDaemonFiles | Process> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const api = yield* HostApiClient;
    const apiFiles = yield* ApiDaemonFiles;
    const proc = yield* Process;

    const port = params.port ?? cfg.apiPort ?? 3000;
    const basePath = cfg.apiBasePath ?? '/v1';
    const pidFilePath = resolveUserFilePath(params.pidFile ?? apiFiles.defaultPidFile());
    const logFilePath = resolveUserFilePath(params.logFile ?? apiFiles.defaultLogFile());
    const stateFilePath = resolveUserFilePath(params.stateFile ?? apiFiles.defaultStateFile());
    const localBaseUrl = apiLocalBaseUrl(port, basePath);

    const pre = yield* api.health({ baseUrl: localBaseUrl, timeoutMs: API_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    if (Either.isRight(pre)) {
      const existing = yield* apiFiles.readPidFile(pidFilePath);
      if (existing) {
        const alive = yield* proc.isPidRunning(existing.pid);
        if (alive) {
          return {
            started: false,
            pid: existing.pid,
            pid_file: pidFilePath,
            log_file: existing.log_file ?? logFilePath,
            state_file: existing.state_file ?? stateFilePath,
            base_url: localBaseUrl,
          };
        }
      }
      return {
        started: false,
        pid_file: pidFilePath,
        log_file: logFilePath,
        state_file: stateFilePath,
        base_url: localBaseUrl,
      };
    }

    return yield* startApiDaemon(params);
  });
}
