import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { Queue } from '../../services/Queue.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const txn = Options.text('txn').pipe(Options.optional, Options.map(optionToUndefined));
const op = Options.text('op').pipe(Options.optional, Options.map(optionToUndefined));

export const queueInspectCommand = Command.make('inspect', { txn, op }, ({ txn, op }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;

    if (txn && op) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Choose only one of --txn or --op',
          exitCode: 2,
        }),
      );
    }

    const result = yield* queue.inspect({ dbPath: cfg.storeDb, txnId: txn, opId: op });
    yield* writeSuccess({
      data: result,
      md: `- txn_id: ${String((result as any)?.txn?.txn_id ?? '')}\n- ops: ${(result as any)?.ops?.length ?? 0}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
