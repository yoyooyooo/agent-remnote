import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { writeFailure, writeSuccess } from '../_shared.js';
import { WS_START_WAIT_DEFAULT_MS, ensureWsSupervisor } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const logFile = Options.text('log-file').pipe(Options.optional, Options.map(optionToUndefined));

export const wsEnsureCommand = Command.make(
  'ensure',
  {
    wait: Options.integer('wait').pipe(Options.withDefault(WS_START_WAIT_DEFAULT_MS)),
    pidFile,
    logFile,
  },
  ({ wait, pidFile, logFile }) =>
    Effect.gen(function* () {
      const result = yield* ensureWsSupervisor({ waitMs: wait, pidFile, logFile });
      yield* writeSuccess({
        data: result,
        md: `- started: ${result.started}\n- pid: ${result.pid ?? ''}\n- pid_file: ${result.pid_file}\n- log_file: ${result.log_file}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
