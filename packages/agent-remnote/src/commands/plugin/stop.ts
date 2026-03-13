import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { CliError } from '../../services/Errors.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const pluginStopCommand = Command.make(
  'stop',
  { force: Options.boolean('force'), pidFile, stateFile },
  ({ force, pidFile, stateFile }) =>
    Effect.gen(function* () {
      const files = yield* PluginServerFiles;
      const proc = yield* Process;

      const pidFilePath = resolveUserFilePath(pidFile ?? files.defaultPidFile());
      const stateFilePath = resolveUserFilePath(stateFile ?? files.defaultStateFile());
      const existing = yield* files.readPidFile(pidFilePath);

      if (!existing) {
        yield* files.deleteStateFile(stateFilePath).pipe(Effect.catchAll(() => Effect.void));
        yield* writeSuccess({
          data: { stopped: true, pid_file: pidFilePath },
          md: `- stopped: true\n- pid_file: ${pidFilePath}\n`,
        });
        return;
      }

      const alive = yield* proc.isPidRunning(existing.pid);
      if (!alive) {
        yield* files.deletePidFile(pidFilePath);
        yield* files.deleteStateFile(existing.state_file ?? stateFilePath).pipe(Effect.catchAll(() => Effect.void));
        yield* writeSuccess({
          data: { stopped: true, stale: true, pid: existing.pid, pid_file: pidFilePath },
          md: `- stopped: true\n- stale: true\n- pid: ${existing.pid}\n- pid_file: ${pidFilePath}\n`,
        });
        return;
      }

      yield* proc.kill(existing.pid, 'SIGTERM');
      const exited = yield* proc.waitForExit({ pid: existing.pid, timeoutMs: PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS });
      if (!exited) {
        if (!force) {
          return yield* Effect.fail(
            new CliError({
              code: 'INTERNAL',
              message: `Plugin server did not exit within ${PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS}ms; use --force`,
              exitCode: 1,
              details: { pid: existing.pid, pid_file: pidFilePath },
            }),
          );
        }
        yield* proc.kill(existing.pid, 'SIGKILL');
        const killed = yield* proc.waitForExit({ pid: existing.pid, timeoutMs: PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS });
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

      yield* files.deletePidFile(pidFilePath);
      yield* files.deleteStateFile(existing.state_file ?? stateFilePath).pipe(Effect.catchAll(() => Effect.void));
      yield* writeSuccess({
        data: { stopped: true, pid: existing.pid, pid_file: pidFilePath },
        md: `- stopped: true\n- pid: ${existing.pid}\n- pid_file: ${pidFilePath}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
