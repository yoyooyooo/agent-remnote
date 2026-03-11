import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeReadRemTable } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const limit = Options.integer('limit').pipe(Options.withDefault(50));
const offset = Options.integer('offset').pipe(Options.withDefault(0));

export const tableShowCommand = Command.make(
  'show',
  {
    id: Options.text('id'),
    includeOptions: Options.boolean('include-options'),
    limit,
    offset,
  },
  ({ id, includeOptions, limit, offset }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'table show',
        reason: 'this command still reads local table metadata from the RemNote database',
      });
      const payload = yield* Effect.tryPromise({
        try: async () =>
          await executeReadRemTable({
            tagId: id,
            dbPath: cfg.remnoteDb,
            includeOptions,
            limit: limit as any,
            offset: offset as any,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });
      yield* writeSuccess({ data: payload, md: (payload as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
