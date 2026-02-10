import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeListRemReferences } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const maxDepth = Options.integer('max-depth').pipe(Options.optional, Options.map(optionToUndefined));
const inboundMaxDepth = Options.integer('inbound-max-depth').pipe(Options.optional, Options.map(optionToUndefined));

export const readReferencesCommand = Command.make(
  'references',
  {
    id: Options.text('id'),
    includeDescendants: Options.boolean('include-descendants'),
    maxDepth,
    includeOccurrences: Options.boolean('include-occurrences'),
    resolveText: Options.boolean('resolve-text'),
    includeInbound: Options.boolean('include-inbound'),
    inboundMaxDepth,
  },
  ({ id, includeDescendants, maxDepth, includeOccurrences, resolveText, includeInbound, inboundMaxDepth }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const payload = yield* Effect.tryPromise({
        try: async () => {
          const { payload } = await executeListRemReferences({
            id,
            dbPath: cfg.remnoteDb,
            includeDescendants,
            maxDepth: maxDepth as any,
            includeOccurrences,
            resolveText: resolveText === false ? false : undefined,
            includeInbound,
            inboundMaxDepth: inboundMaxDepth as any,
          } as any);
          return payload;
        },
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });
      yield* writeSuccess({ data: payload, md: (payload as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
