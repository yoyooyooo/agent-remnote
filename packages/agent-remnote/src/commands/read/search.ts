import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeSearchRemOverview } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { CliError } from '../../services/Errors.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

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
        : yield* Effect.tryPromise({
            try: async () =>
              await executeSearchRemOverview({
                query,
                dbPath: cfg.remnoteDb,
                timeRange: timeRange as any,
                parentId,
                pagesOnly,
                excludePages,
                limit: limit as any,
                offset: offset as any,
                timeoutMs: effectiveTimeoutMs,
              } as any),
            catch: (e) => {
              if ((e as any)?.code === 'TIMEOUT') {
                return new CliError({
                  code: 'TIMEOUT',
                  message: `DB query timed out after ${effectiveTimeoutMs}ms`,
                  exitCode: 1,
                  details: { timeoutMs: effectiveTimeoutMs },
                  hint: [
                    'Narrow the search scope (e.g. add --time 30d, or --parent <remId>)',
                    'Reduce the result count (e.g. --limit 10)',
                    'Try plugin candidates: agent-remnote plugin search --query "<keywords>"',
                  ],
                });
              }
              return cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' });
            },
          });
      yield* writeSuccess({ data: result, md: (result as any).markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
