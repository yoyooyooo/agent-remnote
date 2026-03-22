import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';

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
      const payload: any = yield* invokeWave1Capability('read.references', {
        id,
        includeDescendants,
        maxDepth,
        includeOccurrences,
        resolveText: resolveText === false ? false : undefined,
        includeInbound,
        inboundMaxDepth,
      });
      yield* writeSuccess({ data: payload, md: (payload as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
