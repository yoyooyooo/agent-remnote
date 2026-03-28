import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Either from 'effect/Either';
import path from 'node:path';

import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles, type WsPidFile } from '../../services/DaemonFiles.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Process } from '../../services/Process.js';
import { SupervisorState, type SupervisorStateFile } from '../../services/SupervisorState.js';
import { WsClient } from '../../services/WsClient.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { requireTrustedPidRecord } from '../../lib/pidTrust.js';
import { currentRuntimeBuildInfo } from '../../lib/runtimeBuildInfo.js';
import { assertMayUseCanonicalWsUrl } from '../../lib/runtime-ownership/claim.js';
import type { RuntimeOwnerDescriptor } from '../../lib/runtime-ownership/ownerDescriptor.js';
import { resolveRuntimeOwnershipContext } from '../../lib/runtime-ownership/profile.js';
import { currentRuntimeOwnerDescriptor } from '../../lib/runtime-ownership/ownerDescriptor.js';

export const WS_HEALTH_TIMEOUT_MS = 2000;
export const WS_START_WAIT_DEFAULT_MS = 15_000;
export const WS_STOP_WAIT_DEFAULT_MS = 5_000;

export type WsDaemonStartResult = {
  readonly started: boolean;
  readonly pid?: number;
  readonly pid_file: string;
  readonly log_file: string;
};

export type WsSupervisorStartParams = {
  readonly waitMs: number;
  readonly pidFile?: string | undefined;
  readonly logFile?: string | undefined;
  readonly wsUrlOverride?: string | undefined;
  readonly ownerOverride?: RuntimeOwnerDescriptor | undefined;
  readonly envOverride?: NodeJS.ProcessEnv | undefined;
};

function childCommandLine(params: { readonly wsUrl: string; readonly storeDb: string }): {
  command: string;
  args: string[];
} {
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
  return {
    command,
    args: [...execArgv, script, '--daemon-url', params.wsUrl, '--store-db', params.storeDb, 'daemon', 'serve'],
  };
}

function supervisorCommandLine(params: {
  readonly wsUrl: string;
  readonly storeDb: string;
  readonly pidFile: string;
  readonly logFile: string;
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
  return {
    command,
    args: [
      ...execArgv,
      script,
      '--daemon-url',
      params.wsUrl,
      '--store-db',
      params.storeDb,
      'daemon',
      'supervisor',
      '--pid-file',
      params.pidFile,
      '--log-file',
      params.logFile,
      '--state-file',
      params.stateFile,
    ],
  };
}

function toPidFileValue(params: {
  readonly pid: number;
  readonly startedAt: number;
  readonly wsUrl: string;
  readonly logFile: string;
  readonly cmd: readonly string[];
  readonly wsBridgeStateFile: string;
  readonly statusLineFile: string;
  readonly statusLineJsonFile: string;
  readonly owner?: RuntimeOwnerDescriptor | undefined;
}): WsPidFile {
  return {
    pid: params.pid,
    build: currentRuntimeBuildInfo(),
    owner: params.owner ?? currentRuntimeOwnerDescriptor(),
    started_at: params.startedAt,
    ws_url: params.wsUrl,
    log_file: params.logFile,
    cmd: params.cmd,
    ws_bridge_state_file: params.wsBridgeStateFile,
    status_line_file: params.statusLineFile,
    status_line_json_file: params.statusLineJsonFile,
  };
}

export function waitForHealth(url: string, waitMs: number): Effect.Effect<void, CliError, WsClient> {
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

    const ws = yield* WsClient;
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now());
      const res = yield* ws
        .health({ url, timeoutMs: Math.min(WS_HEALTH_TIMEOUT_MS, Math.max(1, remaining)) })
        .pipe(Effect.either);

      if (Either.isRight(res)) return;

      yield* Effect.sleep(Duration.millis(300));
    }

    return yield* Effect.fail(
      new CliError({
        code: 'WS_TIMEOUT',
        message: `Timed out waiting for WS to become available (${waitMs}ms)`,
        exitCode: 1,
        details: { url, wait_ms: waitMs },
        hint: ['agent-remnote daemon status', 'agent-remnote daemon logs', 'agent-remnote daemon health --json'],
      }),
    );
  });
}

export function startWsDaemon(params: {
  readonly waitMs: number;
  readonly pidFile?: string | undefined;
  readonly logFile?: string | undefined;
  readonly wsUrlOverride?: string | undefined;
}): Effect.Effect<WsDaemonStartResult, CliError, AppConfig | WsClient | DaemonFiles | Process> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const proc = yield* Process;
    const ws = yield* WsClient;

    const wsUrl = params.wsUrlOverride ?? cfg.wsUrl;
    const pidFilePath = resolveUserFilePath(params.pidFile ?? daemonFiles.defaultPidFile());
    const logFilePath = resolveUserFilePath(params.logFile ?? daemonFiles.defaultLogFile());
    yield* Effect.try({
      try: () => assertMayUseCanonicalWsUrl({ ctx: resolveRuntimeOwnershipContext(), wsUrl }),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'INTERNAL',
              message: 'Failed to validate canonical daemon ws url policy',
              exitCode: 1,
              details: { error: String((error as any)?.message || error) },
            }),
    });

    const existingPidFile = yield* daemonFiles.readPidFile(pidFilePath);
    if (existingPidFile) {
      const alive = yield* proc.isPidRunning(existingPidFile.pid);
      if (!alive) {
        yield* daemonFiles.deletePidFile(pidFilePath);
      } else {
        yield* requireTrustedPidRecord({ record: existingPidFile, pidFilePath });
        return {
          started: false,
          pid: existingPidFile.pid,
          pid_file: pidFilePath,
          log_file: existingPidFile.log_file ?? logFilePath,
        };
      }
    }

    const pre = yield* ws.health({ url: wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    if (Either.isRight(pre)) {
      return { started: false, pid_file: pidFilePath, log_file: logFilePath };
    }

    const cmd = yield* Effect.try({
      try: () => childCommandLine({ wsUrl: cfg.wsUrl, storeDb: cfg.storeDb }),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INTERNAL',
              message: 'Failed to start daemon',
              exitCode: 1,
              details: { error: String((e as any)?.message || e) },
            }),
    });
    const pid = yield* proc.spawnDetached({ command: cmd.command, args: cmd.args, logFile: logFilePath });

    yield* daemonFiles.writePidFile(
      pidFilePath,
      toPidFileValue({
        pid,
        startedAt: Date.now(),
        wsUrl: cfg.wsUrl,
        logFile: logFilePath,
        cmd: [cmd.command, ...cmd.args],
        wsBridgeStateFile: cfg.wsStateFile.path,
        statusLineFile: cfg.statusLineFile,
        statusLineJsonFile: cfg.statusLineJsonFile,
      }),
    );

    yield* waitForHealth(cfg.wsUrl, params.waitMs);

    return { started: true, pid, pid_file: pidFilePath, log_file: logFilePath };
  });
}

export function ensureWsDaemon(params: {
  readonly waitMs: number;
  readonly pidFile?: string | undefined;
  readonly logFile?: string | undefined;
}): Effect.Effect<WsDaemonStartResult, CliError, AppConfig | WsClient | DaemonFiles | Process> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const pre = yield* ws.health({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    if (Either.isRight(pre)) {
      const daemonFiles = yield* DaemonFiles;
      const proc = yield* Process;
      const pidFilePath = resolveUserFilePath(params.pidFile ?? daemonFiles.defaultPidFile());
      const logFilePath = resolveUserFilePath(params.logFile ?? daemonFiles.defaultLogFile());
      const existingPidFile = yield* daemonFiles.readPidFile(pidFilePath);
      if (existingPidFile) {
        const alive = yield* proc.isPidRunning(existingPidFile.pid);
        if (alive) {
          yield* requireTrustedPidRecord({ record: existingPidFile, pidFilePath });
          return {
            started: false,
            pid: existingPidFile.pid,
            pid_file: pidFilePath,
            log_file: existingPidFile.log_file ?? logFilePath,
          };
        }
      }
      return {
        started: false,
        pid_file: pidFilePath,
        log_file: logFilePath,
      };
    }
    return yield* startWsDaemon(params);
  });
}

function toInitialSupervisorState(now: number): SupervisorStateFile {
  return {
    status: 'running',
    restart_count: 0,
    restart_window_started_at: now,
    backoff_until: null,
    last_exit: null,
    failed_reason: null,
  };
}

function defaultStateFilePathFromPidFile(pidFilePath: string): string {
  // Keep state co-located with pidfile when user overrides pidfile path.
  // This also avoids multiple instances clobbering each other when using different pidfiles.
  return path.join(path.dirname(pidFilePath), 'ws.state.json');
}

export function startWsSupervisor(
  params: WsSupervisorStartParams,
): Effect.Effect<WsDaemonStartResult, CliError, AppConfig | WsClient | DaemonFiles | Process | SupervisorState> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const supervisorState = yield* SupervisorState;
    const proc = yield* Process;
    const ws = yield* WsClient;
    const wsUrl = params.wsUrlOverride ?? cfg.wsUrl;

    const pidFilePath = resolveUserFilePath(params.pidFile ?? daemonFiles.defaultPidFile());
    const logFilePath = resolveUserFilePath(params.logFile ?? daemonFiles.defaultLogFile());
    const stateFilePath = defaultStateFilePathFromPidFile(pidFilePath);
    yield* Effect.try({
      try: () => assertMayUseCanonicalWsUrl({ ctx: resolveRuntimeOwnershipContext(), wsUrl }),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'INTERNAL',
              message: 'Failed to validate canonical daemon ws url policy',
              exitCode: 1,
              details: { error: String((error as any)?.message || error) },
            }),
    });

    const existingPidFile = yield* daemonFiles.readPidFile(pidFilePath);
    if (existingPidFile) {
      const alive = yield* proc.isPidRunning(existingPidFile.pid);
      if (!alive) {
        yield* daemonFiles.deletePidFile(pidFilePath);
        yield* supervisorState.deleteStateFile(stateFilePath);
      } else {
        yield* requireTrustedPidRecord({ record: existingPidFile, pidFilePath });
        return {
          started: false,
          pid: existingPidFile.pid,
          pid_file: pidFilePath,
          log_file: existingPidFile.log_file ?? logFilePath,
        };
      }
    }

    const pre = yield* ws.health({ url: wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    if (Either.isRight(pre)) {
      return { started: false, pid_file: pidFilePath, log_file: logFilePath };
    }

    const cmd = yield* Effect.try({
      try: () =>
        supervisorCommandLine({
          wsUrl,
          storeDb: cfg.storeDb,
          pidFile: pidFilePath,
          logFile: logFilePath,
          stateFile: stateFilePath,
        }),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INTERNAL',
              message: 'Failed to start supervisor',
              exitCode: 1,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    const pid = yield* proc.spawnDetached({
      command: cmd.command,
      args: cmd.args,
      logFile: logFilePath,
      env: params.envOverride ? { ...process.env, ...params.envOverride } : undefined,
    });

    const now = Date.now();
    yield* daemonFiles.writePidFile(pidFilePath, {
      ...toPidFileValue({
        pid,
        startedAt: now,
        wsUrl,
        logFile: logFilePath,
        cmd: [cmd.command, ...cmd.args],
        wsBridgeStateFile: cfg.wsStateFile.path,
        statusLineFile: cfg.statusLineFile,
        statusLineJsonFile: cfg.statusLineJsonFile,
        owner: params.ownerOverride,
      }),
      mode: 'supervisor',
      child_pid: null,
      state_file: stateFilePath,
    });
    yield* supervisorState.writeStateFile(stateFilePath, toInitialSupervisorState(now));

    yield* waitForHealth(wsUrl, params.waitMs);

    return { started: true, pid, pid_file: pidFilePath, log_file: logFilePath };
  });
}

export function ensureWsSupervisor(
  params: WsSupervisorStartParams,
): Effect.Effect<WsDaemonStartResult, CliError, AppConfig | WsClient | DaemonFiles | Process | SupervisorState> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const wsUrl = params.wsUrlOverride ?? cfg.wsUrl;
    const pre = yield* ws.health({ url: wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    if (Either.isRight(pre)) {
      const daemonFiles = yield* DaemonFiles;
      const proc = yield* Process;
      const pidFilePath = resolveUserFilePath(params.pidFile ?? daemonFiles.defaultPidFile());
      const logFilePath = resolveUserFilePath(params.logFile ?? daemonFiles.defaultLogFile());
      const existingPidFile = yield* daemonFiles.readPidFile(pidFilePath);
      if (existingPidFile) {
        const alive = yield* proc.isPidRunning(existingPidFile.pid);
        if (alive) {
          yield* requireTrustedPidRecord({ record: existingPidFile, pidFilePath });
          return {
            started: false,
            pid: existingPidFile.pid,
            pid_file: pidFilePath,
            log_file: existingPidFile.log_file ?? logFilePath,
          };
        }
      }
      return {
        started: false,
        pid_file: pidFilePath,
        log_file: logFilePath,
      };
    }
    return yield* startWsSupervisor(params);
  });
}
