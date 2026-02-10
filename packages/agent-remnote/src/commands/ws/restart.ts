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
import { resolveUserFilePath } from '../../lib/paths.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../../lib/statuslineArtifacts.js';
import { refreshTmuxStatusLine } from '../../lib/tmux.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { WS_START_WAIT_DEFAULT_MS, WS_STOP_WAIT_DEFAULT_MS, startWsSupervisor } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
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

      const stateFilePath = resolveUserFilePath(
        existing?.state_file ?? path.join(path.dirname(pidFilePath), 'ws.state.json'),
      );

      if (existing) {
        const alive = yield* proc.isPidRunning(existing.pid);
        if (!alive) {
          yield* daemonFiles.deletePidFile(pidFilePath);
          yield* supervisorState.deleteStateFile(stateFilePath);
          stopResult = { stopped: true, stale: true, pid: existing.pid, pid_file: pidFilePath };
        } else {
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

      const cleanup = yield* cleanupStatuslineArtifacts(resolveStatuslineArtifactPaths({ cfg, pidInfo: existing }));
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
