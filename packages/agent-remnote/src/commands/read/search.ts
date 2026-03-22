import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const timeRange = Options.text('time').pipe(Options.optional, Options.map(optionToUndefined));
const parentId = Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined));
const limit = Options.integer('limit').pipe(Options.withDefault(10));
const offset = Options.integer('offset').pipe(Options.withDefault(0));
const timeoutMs = Options.integer('timeout-ms').pipe(Options.withDefault(30_000));

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const readSearchCommand = Command.make(
  'search',
  {
    query: Options.text('query'),
    timeRange,
    parentId,
    pagesOnly: Options.boolean('pages-only'),
    excludePages: Options.boolean('exclude-pages'),
    limit,
    offset,
    timeoutMs,
  },
  ({ query, timeRange, parentId, pagesOnly, excludePages, limit, offset, timeoutMs }) =>
    Effect.gen(function* () {
      const effectiveTimeoutMs = clampInt(timeoutMs, 1, 30_000);

      const result: any = yield* invokeWave1Capability('search.db', {
        query,
        timeRange,
        parentId,
        pagesOnly,
        excludePages,
        limit,
        offset,
        timeoutMs: effectiveTimeoutMs,
      });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
