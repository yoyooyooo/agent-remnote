import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const searchContextRemId = Options.text('context-rem-id').pipe(Options.optional, Options.map(optionToUndefined));
const limit = Options.integer('limit').pipe(Options.withDefault(20));
const timeoutMs = Options.integer('timeout-ms').pipe(Options.withDefault(3000));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const pluginSearchCommand = Command.make(
  'search',
  { query: Options.text('query'), searchContextRemId, limit, timeoutMs, ensureDaemon },
  ({ query, searchContextRemId, limit, timeoutMs, ensureDaemon }) =>
    Effect.gen(function* () {
      const limitEffective = clampInt(limit, 1, 100);
      const rpcTimeoutMs = clampInt(timeoutMs, 1, 5000);

      const result: any = yield* invokeWave1Capability('search.plugin', {
        query,
        searchContextRemId,
        limit: limitEffective,
        timeoutMs: rpcTimeoutMs,
        ensureDaemon,
      });

      const results = Array.isArray((result as any).results) ? ((result as any).results as any[]) : [];
      const mdLines = [`- ok: ${(result as any).ok === true ? 'true' : 'false'}`, `- results: ${results.length}`];
      for (const r of results) {
        const remId = typeof r?.remId === 'string' ? r.remId : '';
        const title = typeof r?.title === 'string' ? r.title : '';
        const snippet = typeof r?.snippet === 'string' ? r.snippet : '';
        mdLines.push(`- ${title || remId}`);
        if (remId) mdLines.push(`  - id: ${remId}`);
        if (snippet) mdLines.push(`  - snippet: ${snippet}`);
      }

      yield* writeSuccess({ data: result, md: mdLines.join('\n') });
    }).pipe(Effect.catchAll(writeFailure)),
);
