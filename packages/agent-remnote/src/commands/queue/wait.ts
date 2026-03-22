import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export const queueWaitCommand = Command.make(
  'wait',
  {
    txn: Options.text('txn'),
    timeoutMs: Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined)),
    pollMs: Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined)),
  },
  ({ txn, timeoutMs, pollMs }) =>
    Effect.gen(function* () {
      const data: any = yield* invokeWave1Capability('queue.wait', { txnId: txn, timeoutMs, pollMs });
      yield* writeSuccess({
        data,
        md: [
          `- txn_id: ${data.txn_id}`,
          `- status: ${data.status}`,
          `- score: ${data.score}`,
          `- ops_total: ${data.ops_total}`,
          `- ops_succeeded: ${data.ops_succeeded}`,
          `- ops_failed: ${data.ops_failed}`,
          `- ops_dead: ${data.ops_dead}`,
          `- ops_in_flight: ${data.ops_in_flight}`,
          `- elapsed_ms: ${data.elapsed_ms}`,
        ].join('\n'),
        ids: [data.txn_id],
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
