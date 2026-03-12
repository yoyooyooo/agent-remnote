import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { executeDailyRemIdUseCase } from '../../lib/hostApiUseCases.js';
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

    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;

    if (cfg.apiBaseUrl) {
      const data = yield* hostApi.dailyRemId({
        baseUrl: cfg.apiBaseUrl,
        date,
        offsetDays,
      });
      yield* writeSuccess({
        data,
        ids: [data.remId],
        md: `- ref: ${data.ref}\n- rem_id: ${data.remId}${data.dateString ? `\n- date_string: ${data.dateString}` : ''}\n`,
      });
      return;
    }
    const data = yield* executeDailyRemIdUseCase({ date, offsetDays });

    yield* writeSuccess({
      data,
      ids: [data.remId],
      md: `- ref: ${data.ref}\n- rem_id: ${data.remId}${data.dateString ? `\n- date_string: ${data.dateString}` : ''}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
