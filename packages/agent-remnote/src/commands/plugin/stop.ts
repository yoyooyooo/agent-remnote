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
import { PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

function isEsrch(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  const code = (error.details as any)?.code;
  const message = String((error.details as any)?.error ?? error.message ?? '');
  return code === 'ESRCH' || message.includes('ESRCH');
}

export function stopPluginServer(params: {
  readonly force: boolean;
  readonly pidFilePath: string;
  readonly stateFilePath: string;
}): Effect.Effect<
  { readonly stopped: true; readonly stale?: true; readonly pid?: number; readonly pid_file: string },
  CliError,
  PluginServerFiles | Process
> {
  return Effect.gen(function* () {
    const files = yield* PluginServerFiles;
    const proc = yield* Process;

    const existing = yield* files.readPidFile(params.pidFilePath);

    if (!existing) {
      yield* files.deleteStateFile(params.stateFilePath).pipe(Effect.catchAll(() => Effect.void));
      return {
        stopped: true as const,
        pid_file: params.pidFilePath,
      };
    }

    const cleanupStale = () =>
      Effect.gen(function* () {
        yield* files.deletePidFile(params.pidFilePath);
        yield* files.deleteStateFile(params.stateFilePath).pipe(Effect.catchAll(() => Effect.void));
        return {
          stopped: true as const,
          stale: true as const,
          pid: existing.pid,
          pid_file: params.pidFilePath,
        };
      });

    const alive = yield* proc.isPidRunning(existing.pid);
    if (!alive) {
      return yield* cleanupStale();
    }

    yield* requireTrustedPidRecord({ record: existing, pidFilePath: params.pidFilePath });
    const termResult = yield* proc.kill(existing.pid, 'SIGTERM').pipe(Effect.either);
    if (termResult._tag === 'Left') {
      if (isEsrch(termResult.left)) {
        return yield* cleanupStale();
      }
      return yield* Effect.fail(termResult.left);
    }

    const exited = yield* proc.waitForExit({ pid: existing.pid, timeoutMs: PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS });
    if (!exited) {
      if (!params.force) {
        return yield* Effect.fail(
          new CliError({
            code: 'INTERNAL',
            message: `Plugin server did not exit within ${PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS}ms; use --force`,
            exitCode: 1,
            details: { pid: existing.pid, pid_file: params.pidFilePath },
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
            details: { pid: existing.pid, pid_file: params.pidFilePath },
          }),
        );
      }
    }

    yield* files.deletePidFile(params.pidFilePath);
    yield* files.deleteStateFile(params.stateFilePath).pipe(Effect.catchAll(() => Effect.void));
    return {
      stopped: true as const,
      pid: existing.pid,
      pid_file: params.pidFilePath,
    };
  });
}

export const pluginStopCommand = Command.make(
  'stop',
  { force: Options.boolean('force'), pidFile, stateFile },
  ({ force, pidFile, stateFile }) =>
    Effect.gen(function* () {
      const files = yield* PluginServerFiles;
      const pidFilePath = resolveUserFilePath(pidFile ?? files.defaultPidFile());
      const stateFilePath = resolveUserFilePath(stateFile ?? files.defaultStateFile());
      const result = yield* stopPluginServer({ force, pidFilePath, stateFilePath });
      yield* writeSuccess({
        data: result,
        md:
          result.stale === true
            ? `- stopped: true\n- stale: true\n- pid: ${result.pid ?? ''}\n- pid_file: ${pidFilePath}\n`
            : result.pid
              ? `- stopped: true\n- pid: ${result.pid}\n- pid_file: ${pidFilePath}\n`
              : `- stopped: true\n- pid_file: ${pidFilePath}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
