import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { CliError } from '../../services/Errors.js';
import { executeDbSearchUseCase } from '../../lib/hostApiUseCases.js';
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
      const cfg = yield* AppConfig;
      const hostApi = yield* HostApiClient;
      const effectiveTimeoutMs = clampInt(timeoutMs, 1, 30_000);

      const result = cfg.apiBaseUrl
        ? yield* hostApi.searchDb({
            baseUrl: cfg.apiBaseUrl,
            query,
            timeRange,
            parentId,
            pagesOnly,
            excludePages,
            limit,
            offset,
            timeoutMs: effectiveTimeoutMs,
          })
        : yield* executeDbSearchUseCase({
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
