import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { CliError } from '../../services/Errors.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { requireTrustedPidRecord } from '../../lib/pidTrust.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import {
  PLUGIN_SERVER_START_WAIT_DEFAULT_MS,
  PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS,
  startPluginServer,
} from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const host = Options.text('host').pipe(Options.optional, Options.map(optionToUndefined));
const port = Options.integer('port').pipe(Options.optional, Options.map(optionToUndefined));
const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const logFile = Options.text('log-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const pluginRestartCommand = Command.make(
  'restart',
  {
    force: Options.boolean('force'),
    host,
    port,
    wait: Options.integer('wait').pipe(Options.withDefault(PLUGIN_SERVER_START_WAIT_DEFAULT_MS)),
    pidFile,
    logFile,
    stateFile,
  },
  ({ force, host, port, wait, pidFile, logFile, stateFile }) =>
    Effect.gen(function* () {
      const files = yield* PluginServerFiles;
      const proc = yield* Process;
      const pidFilePath = resolveUserFilePath(pidFile ?? files.defaultPidFile());
      const existing = yield* files.readPidFile(pidFilePath);
      let stoppedPid: number | undefined;

      if (existing) {
        const alive = yield* proc.isPidRunning(existing.pid);
        if (alive) {
          yield* requireTrustedPidRecord({ record: existing, pidFilePath });
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
          stoppedPid = existing.pid;
        }
        yield* files.deletePidFile(pidFilePath).pipe(Effect.catchAll(() => Effect.void));
        yield* files
          .deleteStateFile(resolveUserFilePath(stateFile ?? files.defaultStateFile()))
          .pipe(Effect.catchAll(() => Effect.void));
      }

      const started = yield* startPluginServer({ host, port, waitMs: wait, pidFile, logFile, stateFile });
      yield* writeSuccess({
        data: { stopped_pid: stoppedPid, ...started },
        md: `- stopped_pid: ${stoppedPid ?? ''}\n- started: ${started.started}\n- pid: ${started.pid ?? ''}\n- pid_file: ${started.pid_file}\n- base_url: ${started.base_url}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
