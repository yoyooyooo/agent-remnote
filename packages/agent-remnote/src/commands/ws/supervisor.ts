import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { writeFailure } from '../_shared.js';
import type { SupervisorRestartConfig } from '../../kernel/supervisor/model.js';
import { runSupervisorRuntime } from '../../runtime/supervisor/runSupervisorRuntime.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const logFile = Options.text('log-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

const maxRestarts = Options.integer('max-restarts').pipe(Options.withDefault(10));
const restartWindowMs = Options.integer('restart-window-ms').pipe(Options.withDefault(60_000));
const baseBackoffMs = Options.integer('backoff-ms').pipe(Options.withDefault(500));
const maxBackoffMs = Options.integer('max-backoff-ms').pipe(Options.withDefault(10_000));

// Default to no rotation: during active development it's more useful to keep a single growing log file,
// especially when tailing it (rotation would break `tail -f`).
// You can re-enable rotation by passing `--log-max-bytes <n>` (e.g. 20971520) and `--log-keep <k>`.
const logMaxBytes = Options.integer('log-max-bytes').pipe(Options.withDefault(0));
const logKeep = Options.integer('log-keep').pipe(Options.withDefault(5));

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

export const wsSupervisorCommand = Command.make(
  'supervisor',
  { pidFile, logFile, stateFile, maxRestarts, restartWindowMs, baseBackoffMs, maxBackoffMs, logMaxBytes, logKeep },
  ({ pidFile, logFile, stateFile, maxRestarts, restartWindowMs, baseBackoffMs, maxBackoffMs, logMaxBytes, logKeep }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const daemonFiles = yield* DaemonFiles;
      const supervisorState = yield* SupervisorState;

      const pidFilePath = resolveUserFilePath(pidFile ?? daemonFiles.defaultPidFile());
      const logFilePath = resolveUserFilePath(logFile ?? daemonFiles.defaultLogFile());
      const stateFilePath = resolveUserFilePath(stateFile ?? supervisorState.defaultStateFile());

      const childCmd = yield* Effect.try({
        try: () => childCommandLine({ wsUrl: cfg.wsUrl, storeDb: cfg.storeDb }),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INTERNAL',
                message: 'Failed to build child command line',
                exitCode: 1,
                details: { error: String((e as any)?.message || e) },
              }),
      });

      const restartConfig: SupervisorRestartConfig = { maxRestarts, restartWindowMs, baseBackoffMs, maxBackoffMs };

      yield* runSupervisorRuntime({
        pidFilePath,
        logFilePath,
        stateFilePath,
        logWriter: { maxBytes: logMaxBytes, keep: logKeep },
        restart: restartConfig,
        child: { command: childCmd.command, args: childCmd.args, env: process.env },
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
