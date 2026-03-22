import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError } from '../../services/Errors.js';
import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const depth = Options.integer('depth').pipe(Options.optional, Options.map(optionToUndefined));
const offset = Options.integer('offset').pipe(Options.optional, Options.map(optionToUndefined));
const nodes = Options.integer('nodes').pipe(Options.optional, Options.map(optionToUndefined));
const format = Options.choice('format', ['md', 'json'] as const).pipe(Options.optional, Options.map(optionToUndefined));
const id = Options.text('id').pipe(Options.optional, Options.map(optionToUndefined));
const ref = Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined));

export const readOutlineCommand = Command.make(
  'outline',
  {
    id,
    ref,
    depth,
    offset,
    nodes,
    format,
    excludeProperties: Options.boolean('exclude-properties'),
    includeEmpty: Options.boolean('include-empty'),
    expandReferences: Options.boolean('expand-references'),
    maxReferenceDepth: Options.integer('max-reference-depth').pipe(Options.optional, Options.map(optionToUndefined)),
    detail: Options.boolean('detail'),
  },
  ({
    id,
    ref,
    depth,
    offset,
    nodes,
    format,
    excludeProperties,
    includeEmpty,
    expandReferences,
    maxReferenceDepth,
    detail,
    }) =>
    Effect.gen(function* () {
      if (id && ref) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --id or --ref', exitCode: 2 }),
        );
      }
      if (!id && !ref) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'You must provide --id or --ref', exitCode: 2 }),
        );
      }

      const result: any = yield* invokeWave1Capability('read.outline', {
        id,
        ref,
        depth,
        offset,
        nodes,
        format: format === 'json' ? 'json' : format === 'md' ? 'md' : undefined,
        excludeProperties,
        includeEmpty,
        expandReferences,
        maxReferenceDepth,
        detail,
      });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
