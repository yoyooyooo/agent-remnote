import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { CliError } from '../../services/Errors.js';
import { FsAccess } from '../../services/FsAccess.js';
import { Subprocess } from '../../services/Subprocess.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const file = Options.text('file').pipe(Options.optional, Options.map(optionToUndefined));

export const wsLogsCommand = Command.make(
  'logs',
  {
    pidFile,
    file,
    lines: Options.integer('lines').pipe(Options.withDefault(200)),
    follow: Options.boolean('follow'),
  },
  ({ pidFile, file, lines, follow }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const daemonFiles = yield* DaemonFiles;
      const fsAccess = yield* FsAccess;
      const subprocess = yield* Subprocess;

      if (!Number.isFinite(lines) || lines <= 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--lines must be a positive integer',
            exitCode: 2,
            details: { lines },
          }),
        );
      }

      if (cfg.format === 'ids') {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'This command does not support --ids output', exitCode: 2 }),
        );
      }

      const pidFilePath = resolveUserFilePath(pidFile ?? daemonFiles.defaultPidFile());
      const pidInfo = yield* daemonFiles.readPidFile(pidFilePath);

      const logFilePath = resolveUserFilePath(file ?? pidInfo?.log_file ?? daemonFiles.defaultLogFile());

      if (follow) {
        if (cfg.format === 'json') {
          return yield* Effect.fail(
            new CliError({ code: 'INVALID_ARGS', message: '--follow is not compatible with --json', exitCode: 2 }),
          );
        }
        const exists = yield* fsAccess.isFile(logFilePath);
        if (!exists) {
          return yield* Effect.fail(
            new CliError({
              code: 'INTERNAL',
              message: `Log file not found: ${logFilePath}`,
              exitCode: 1,
              hint: ['agent-remnote daemon start', 'agent-remnote daemon status'],
            }),
          );
        }

        yield* subprocess.runInherit({ command: 'tail', args: ['-n', String(lines), '-f', logFilePath] });
        return;
      }

      const exists = yield* fsAccess.isFile(logFilePath);
      if (!exists) {
        return yield* Effect.fail(
          new CliError({
            code: 'INTERNAL',
            message: `Log file not found: ${logFilePath}`,
            exitCode: 1,
            hint: ['agent-remnote daemon start', 'agent-remnote daemon status'],
          }),
        );
      }

      const res = yield* subprocess.run({ command: 'tail', args: ['-n', String(lines), logFilePath], timeoutMs: 10_000 });
      if (res.exitCode !== 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INTERNAL',
            message: 'Failed to read log file',
            exitCode: 1,
            details: { file: logFilePath, exitCode: res.exitCode, stderr: res.stderr.trim() },
          }),
        );
      }

      const tailLines = res.stdout.trimEnd();

      yield* writeSuccess({
        data: { file: logFilePath, lines, content: tailLines },
        md: tailLines.length > 0 ? `${tailLines}\n` : '',
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
