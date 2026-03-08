import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeSearchRemOverview, formatDateWithPattern, getDateFormatting } from '../../adapters/core.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { RefResolver } from '../../services/RefResolver.js';
import { RemDb } from '../../services/RemDb.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function parseDateInput(raw: string): Date {
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid date: ${raw}`, exitCode: 2 });
  }
  return value;
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
    const refs = yield* RefResolver;
    const remDb = yield* RemDb;

    let ref = `daily:${offsetDays ?? 0}`;
    let remId = '';
    let dateString: string | undefined;

    if (date) {
      const target = parseDateInput(date);
      dateString = yield* remDb
        .withDb(cfg.remnoteDb, async (db) => {
          const format = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';
          return formatDateWithPattern(target, format);
        })
        .pipe(
          Effect.map((r) => r.result),
          Effect.catchAll(() => Effect.succeed(formatDateWithPattern(target, 'yyyy/MM/dd'))),
        );

      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeSearchRemOverview({
            query: dateString,
            dbPath: cfg.remnoteDb,
            limit: 1,
            preferExact: true,
            exactFirstSingle: true,
            excludePages: true,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });
      const first = Array.isArray((result as any).matches) ? (result as any).matches[0] : undefined;
      remId = first?.id ? String(first.id) : '';
      ref = `daily:${date}`;
      if (!remId) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: `No Daily Rem found for date: ${date}`, exitCode: 2 }),
        );
      }
    } else {
      remId = yield* refs.resolve(ref);
    }

    yield* writeSuccess({
      data: { ref, remId, dateString },
      ids: [remId],
      md: `- ref: ${ref}\n- rem_id: ${remId}${dateString ? `\n- date_string: ${dateString}` : ''}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
