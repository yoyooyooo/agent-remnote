import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { writeFailure, writeSuccess } from '../_shared.js';
import { API_START_WAIT_DEFAULT_MS, ensureApiDaemon } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const host = Options.text('host').pipe(Options.optional, Options.map(optionToUndefined));
const port = Options.integer('port').pipe(Options.optional, Options.map(optionToUndefined));
const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const logFile = Options.text('log-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const apiEnsureCommand = Command.make(
  'ensure',
  {
    host,
    port,
    wait: Options.integer('wait').pipe(Options.withDefault(API_START_WAIT_DEFAULT_MS)),
    pidFile,
    logFile,
    stateFile,
  },
  ({ host, port, wait, pidFile, logFile, stateFile }) =>
    Effect.gen(function* () {
      const result = yield* ensureApiDaemon({ host, port, waitMs: wait, pidFile, logFile, stateFile });
      yield* writeSuccess({
        data: result,
        md: `- started: ${result.started}\n- pid: ${result.pid ?? ''}\n- pid_file: ${result.pid_file}\n- log_file: ${result.log_file}\n- state_file: ${result.state_file}\n- base_url: ${result.base_url}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
