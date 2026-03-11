import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeSummarizeDailyNotes } from '../../../adapters/core.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { failInRemoteMode } from '../../_remoteMode.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { cliErrorFromUnknown } from '../../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const days = Options.integer('days').pipe(Options.optional, Options.map(optionToUndefined));
const maxLines = Options.integer('max-lines').pipe(Options.optional, Options.map(optionToUndefined));

export const dailySummaryCommand = Command.make('summary', { days, maxLines }, ({ days, maxLines }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    yield* failInRemoteMode({
      command: 'daily summary',
      reason: 'this command still summarizes Daily Notes from the local RemNote database',
    });
    const result = yield* Effect.tryPromise({
      try: async () =>
        await executeSummarizeDailyNotes({
          dbPath: cfg.remnoteDb,
          days: days as any,
          maxLines: maxLines as any,
        } as any),
      catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
    });
    yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
  }).pipe(Effect.catchAll(writeFailure)),
);
