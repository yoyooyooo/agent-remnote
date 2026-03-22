import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';

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
      const result: any = yield* invokeWave1Capability('read.resolve-ref', {
        ids,
        expandReferences: expandReferences === false ? false : undefined,
        maxReferenceDepth,
        detail,
      });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
