import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { CliError } from '../../services/Errors.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const date = Options.text('date').pipe(Options.optional, Options.map(optionToUndefined));
const offsetDays = Options.integer('offset-days').pipe(Options.optional, Options.map(optionToUndefined));

export const dailyRemIdCommand = Command.make('rem-id', { date, offsetDays }, ({ date, offsetDays }) =>
  Effect.gen(function* () {
    if (date && offsetDays !== undefined) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --date or --offset-days', exitCode: 2 }),
      );
    }

    const data: any = yield* invokeWave1Capability('daily.rem-id', { date, offsetDays });

    yield* writeSuccess({
      data,
      ids: [data.remId],
      md: `- ref: ${data.ref}\n- rem_id: ${data.remId}${data.dateString ? `\n- date_string: ${data.dateString}` : ''}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
