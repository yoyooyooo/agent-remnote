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
import { WS_STOP_WAIT_DEFAULT_MS } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));

export const wsStopCommand = Command.make('stop', { force: Options.boolean('force'), pidFile }, ({ force, pidFile }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const proc = yield* Process;
    const supervisorState = yield* SupervisorState;

    const pidFilePath = resolveUserFilePath(pidFile ?? daemonFiles.defaultPidFile());
    const existing = yield* daemonFiles.readPidFile(pidFilePath);

    const cleanupDisplayArtifacts = (pidInfo?: typeof existing) =>
      Effect.gen(function* () {
        const paths = resolveStatuslineArtifactPaths({ cfg, pidInfo });
        const cleanup = yield* cleanupStatuslineArtifacts(paths);
        yield* Effect.sync(() => refreshTmuxStatusLine());
        return cleanup;
      });

    if (!existing) {
      const cleanup = yield* cleanupDisplayArtifacts();
      yield* writeSuccess({
        data: { stopped: true, pid_file: pidFilePath, cleanup },
        md: `- stopped: true\n- pid_file: ${pidFilePath}\n`,
      });
      return;
    }

    const stateFilePath = resolveUserFilePath(
      existing.state_file ?? path.join(path.dirname(pidFilePath), 'ws.state.json'),
    );

    const alive = yield* proc.isPidRunning(existing.pid);
    if (!alive) {
      yield* daemonFiles.deletePidFile(pidFilePath);
      yield* supervisorState.deleteStateFile(stateFilePath);
      const cleanup = yield* cleanupDisplayArtifacts(existing);
      yield* writeSuccess({
        data: { stopped: true, stale: true, pid: existing.pid, pid_file: pidFilePath, cleanup },
        md: `- stopped: true\n- stale: true\n- pid: ${existing.pid}\n- pid_file: ${pidFilePath}\n`,
      });
      return;
    }

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
    const cleanup = yield* cleanupDisplayArtifacts(existing);
    yield* writeSuccess({
      data: { stopped: true, pid: existing.pid, pid_file: pidFilePath, cleanup },
      md: `- stopped: true\n- pid: ${existing.pid}\n- pid_file: ${pidFilePath}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
