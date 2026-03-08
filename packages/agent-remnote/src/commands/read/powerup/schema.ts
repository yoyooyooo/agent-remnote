import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeReadRemTable } from '../../../adapters/core.js';

import { resolvePowerup, normalizeRemIdInput } from '../../_powerup.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { cliErrorFromUnknown } from '../../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const powerup = Options.text('powerup').pipe(Options.optional, Options.map(optionToUndefined));
const id = Options.text('id').pipe(Options.optional, Options.map(optionToUndefined));

const limit = Options.integer('limit').pipe(Options.withDefault(50));
const offset = Options.integer('offset').pipe(Options.withDefault(0));

export const readPowerupSchemaCommand = Command.make(
  'schema',
  { powerup, id, includeOptions: Options.boolean('include-options'), limit, offset },
  ({ powerup, id, includeOptions, limit, offset }) =>
    Effect.gen(function* () {
      if (!powerup && !id) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Provide --powerup or --id',
            exitCode: 2,
          }),
        );
      }
      if (powerup && id) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --powerup or --id',
            exitCode: 2,
          }),
        );
      }

      const cfg = yield* AppConfig;
      const resolved = powerup ? yield* resolvePowerup(powerup) : null;
      const tagId = resolved ? resolved.id : normalizeRemIdInput(id!);

      const payload = yield* Effect.tryPromise({
        try: async () =>
          await executeReadRemTable({
            tagId,
            dbPath: cfg.remnoteDb,
            includeOptions,
            limit: limit as any,
            offset: offset as any,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });

      const out = resolved
        ? {
            powerup: {
              query: resolved.query,
              matchedBy: resolved.matchedBy,
              id: resolved.id,
              title: resolved.title,
              code: resolved.rcrt,
            },
            ...(payload as any),
          }
        : payload;

      yield* writeSuccess({ data: out, md: (payload as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
