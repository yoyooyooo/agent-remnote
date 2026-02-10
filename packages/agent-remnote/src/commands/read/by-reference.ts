import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeFindRemsByReference } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const reference = Options.text('reference').pipe(Options.repeated);
const timeRange = Options.text('time').pipe(Options.optional, Options.map(optionToUndefined));
const maxDepth = Options.integer('max-depth').pipe(Options.optional, Options.map(optionToUndefined));
const limit = Options.integer('limit').pipe(Options.withDefault(40));
const offset = Options.integer('offset').pipe(Options.withDefault(0));

export const readByReferenceCommand = Command.make(
  'by-reference',
  { reference, timeRange, maxDepth, limit, offset },
  ({ reference, timeRange, maxDepth, limit, offset }) =>
    Effect.gen(function* () {
      if (!reference || reference.length === 0) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Provide at least one Rem ID via --reference', exitCode: 2 }),
        );
      }

      const cfg = yield* AppConfig;
      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeFindRemsByReference({
            targetIds: reference,
            dbPath: cfg.remnoteDb,
            timeRange: timeRange as any,
            maxDepth: maxDepth as any,
            limit: limit as any,
            offset: offset as any,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
