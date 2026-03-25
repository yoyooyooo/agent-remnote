import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import path from 'node:path';

import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { CliError } from '../../services/Errors.js';
import { Process } from '../../services/Process.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { requireTrustedPidRecord } from '../../lib/pidTrust.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../../lib/statuslineArtifacts.js';
import { refreshTmuxStatusLine } from '../../lib/tmux.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { WS_START_WAIT_DEFAULT_MS, WS_STOP_WAIT_DEFAULT_MS, startWsSupervisor } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function resolveManagedStateFile(params: {
  readonly pidFilePath: string;
  readonly defaultStateFilePath: string;
  readonly candidate?: string | undefined;
}): string {
  const candidate = params.candidate ? resolveUserFilePath(params.candidate) : undefined;
  if (!candidate) return resolveUserFilePath(params.defaultStateFilePath);
  if (candidate === resolveUserFilePath(params.defaultStateFilePath)) return candidate;
  return path.dirname(candidate) === path.dirname(params.pidFilePath)
    ? candidate
    : resolveUserFilePath(params.defaultStateFilePath);
}

function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(rootDir, targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sanitizePidInfoForArtifacts(params: {
  readonly pidFilePath: string;
  readonly pidInfo: any;
}) {
  const rootDir = path.dirname(params.pidFilePath);
  const normalizeMaybe = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const resolved = resolveUserFilePath(value);
    return isWithinRoot(rootDir, resolved) ? resolved : undefined;
  };
  return {
    ...params.pidInfo,
    ws_bridge_state_file: normalizeMaybe((params.pidInfo as any).ws_bridge_state_file),
    status_line_file: normalizeMaybe((params.pidInfo as any).status_line_file),
    status_line_json_file: normalizeMaybe((params.pidInfo as any).status_line_json_file),
  };
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const logFile = Options.text('log-file').pipe(Options.optional, Options.map(optionToUndefined));

export const wsRestartCommand = Command.make(
  'restart',
  {
    force: Options.boolean('force'),
    wait: Options.integer('wait').pipe(Options.withDefault(WS_START_WAIT_DEFAULT_MS)),
    pidFile,
    logFile,
  },
  ({ force, wait, pidFile, logFile }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const daemonFiles = yield* DaemonFiles;
      const proc = yield* Process;
      const supervisorState = yield* SupervisorState;

      const pidFilePath = resolveUserFilePath(pidFile ?? daemonFiles.defaultPidFile());
      const existing = yield* daemonFiles.readPidFile(pidFilePath);

      let stopResult: any = { stopped: true, pid_file: pidFilePath };

      const stateFilePath = resolveManagedStateFile({
        pidFilePath,
        defaultStateFilePath: supervisorState.defaultStateFile(),
        candidate: existing?.state_file,
      });

      if (existing) {
        const alive = yield* proc.isPidRunning(existing.pid);
        if (!alive) {
          yield* daemonFiles.deletePidFile(pidFilePath);
          yield* supervisorState.deleteStateFile(stateFilePath);
          stopResult = { stopped: true, stale: true, pid: existing.pid, pid_file: pidFilePath };
        } else {
          yield* requireTrustedPidRecord({ record: existing, pidFilePath });
          yield* proc.kill(existing.pid, 'SIGTERM');
          const exited = yield* proc.waitForExit({ pid: existing.pid, timeoutMs: WS_STOP_WAIT_DEFAULT_MS });
          if (!exited) {
            if (!force) {
              return yield* Effect.fail(
                new CliError({
                  code: 'INTERNAL',
                  message: `Daemon did not exit within ${WS_STOP_WAIT_DEFAULT_MS}ms; use --force`,
                  exitCode: 1,
                  details: { pid: existing.pid, pid_file: pidFilePath },
                }),
              );
            }
            yield* proc.kill(existing.pid, 'SIGKILL');
            const killed = yield* proc.waitForExit({ pid: existing.pid, timeoutMs: WS_STOP_WAIT_DEFAULT_MS });
            if (!killed) {
              return yield* Effect.fail(
                new CliError({
                  code: 'INTERNAL',
                  message: 'Force stop failed (process is still alive)',
                  exitCode: 1,
                  details: { pid: existing.pid, pid_file: pidFilePath },
                }),
              );
            }
          }
          yield* daemonFiles.deletePidFile(pidFilePath);
          yield* supervisorState.deleteStateFile(stateFilePath);
          stopResult = { stopped: true, pid: existing.pid, pid_file: pidFilePath };
        }
      }

      const cleanup = yield* cleanupStatuslineArtifacts(
        resolveStatuslineArtifactPaths({
          cfg,
          pidInfo: existing ? sanitizePidInfoForArtifacts({ pidFilePath, pidInfo: existing }) : undefined,
        }),
      );
      yield* Effect.sync(() => refreshTmuxStatusLine());
      stopResult = { ...stopResult, cleanup };

      const startResult = yield* startWsSupervisor({ waitMs: wait, pidFile, logFile });

      const data = { stop: stopResult, start: startResult };
      const md = [
        `# daemon restart`,
        `- stop_stopped: ${stopResult.stopped}`,
        `- stop_pid: ${stopResult.pid ?? ''}`,
        `- stop_stale: ${stopResult.stale ?? ''}`,
        `- stop_pid_file: ${stopResult.pid_file}`,
        `- start_started: ${startResult.started}`,
        `- start_pid: ${startResult.pid ?? ''}`,
        `- start_pid_file: ${startResult.pid_file}`,
        `- start_log_file: ${startResult.log_file}`,
      ].join('\n');

      yield* writeSuccess({ data, md });
    }).pipe(Effect.catchAll(writeFailure)),
);
