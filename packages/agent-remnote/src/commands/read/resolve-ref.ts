import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeResolveRemReference } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

const ids = Options.text('ids').pipe(Options.repeated);

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const maxReferenceDepth = Options.integer('max-reference-depth').pipe(Options.optional, Options.map(optionToUndefined));

export const readResolveRefCommand = Command.make(
  'resolve-ref',
  {
    ids,
    expandReferences: Options.boolean('expand-references'),
    maxReferenceDepth,
    detail: Options.boolean('detail'),
  },
  ({ ids, expandReferences, maxReferenceDepth, detail }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeResolveRemReference({
            ids,
            dbPath: cfg.remnoteDb,
            expandReferences: expandReferences === false ? false : undefined,
            maxReferenceDepth: maxReferenceDepth as any,
            detail,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
