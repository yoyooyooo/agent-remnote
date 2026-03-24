import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import {
  buildCanonicalQueryFromFilters,
  normalizeCanonicalQuery,
  normalizeCanonicalQueryRequest,
  resolveQueryPowerupByName,
} from '../../lib/queryV2.js';
import { executeListTodos } from '../../adapters/core.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { Payload } from '../../services/Payload.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { cliErrorFromUnknown } from '../_tool.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function buildMarkdown(items: readonly any[], total: number) {
  const lines: string[] = [`# Query Results (${items.length}/${total})`];
  for (const item of items) {
    const title = (item?.title && String(item.title).trim()) || '';
    const head = title ? `${title} (${item.id})` : String(item.id);
    lines.push(`- ${head}`);
    if (item?.snippet) lines.push(`  - ${String(item.snippet)}`);
  }
  return lines.join('\n');
}

const payload = Options.text('payload').pipe(Options.optional, Options.map(optionToUndefined));
const preset = Options.text('preset').pipe(Options.optional, Options.map(optionToUndefined));
const text = Options.text('text').pipe(Options.optional, Options.map(optionToUndefined));
const tag = Options.text('tag').pipe(Options.repeated);
const powerup = Options.text('powerup').pipe(Options.optional, Options.map(optionToUndefined));
const status = Options.choice('status', ['unfinished', 'finished', 'all'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

const limit = Options.integer('limit').pipe(Options.withDefault(20));
const offset = Options.integer('offset').pipe(Options.withDefault(0));
const snippetLength = Options.integer('snippet-length').pipe(Options.withDefault(200));

const sort = Options.choice(
  'sort',
  ['rank', 'updatedAt', 'createdAt', 'dueAsc', 'dueDesc', 'updatedAtAsc', 'updatedAtDesc', 'createdAtAsc', 'createdAtDesc'] as const,
).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const sortDirection = Options.choice('sort-direction', ['asc', 'desc'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

export const readQueryCommand = Command.make(
  'query',
  { payload, preset, text, tag, powerup, status, limit, offset, snippetLength, sort, sortDirection },
  ({ payload, preset, text, tag, powerup, status, limit, offset, snippetLength, sort, sortDirection }) =>
    Effect.gen(function* () {
      const payloadSvc = yield* Payload;
      const cfg = yield* AppConfig;

      if (preset) {
        if (preset !== 'todos.list') {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: `Unknown query preset: ${preset}`,
              exitCode: 2,
            }),
          );
        }

        yield* failInRemoteMode({
          command: 'query --preset todos.list',
          reason: 'this preset still derives todo state from the local RemNote database',
        });

        const todoSort = sort
          ? (sort as
              | 'dueAsc'
              | 'dueDesc'
              | 'updatedAtAsc'
              | 'updatedAtDesc'
              | 'createdAtAsc'
              | 'createdAtDesc')
          : undefined;

        const data = yield* Effect.tryPromise({
          try: async () =>
            await executeListTodos({
              dbPath: cfg.remnoteDb,
              status: status as any,
              sort: todoSort as any,
              limit: limit as any,
              offset: offset as any,
              snippetLength: snippetLength as any,
            } as any),
          catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
        });

        yield* writeSuccess({ data, md: (data as any).markdown ?? '' });
        return;
      }

      if (status) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--status requires --preset todos.list',
            exitCode: 2,
          }),
        );
      }

      if (sort === 'dueAsc' || sort === 'dueDesc') {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--sort dueAsc|dueDesc requires --preset todos.list',
            exitCode: 2,
          }),
        );
      }

      const queryRequest: Record<string, unknown> = payload
        ? normalizeCanonicalQueryRequest(yield* payloadSvc.readJson(payload))
        : {
            query: buildCanonicalQueryFromFilters(
              {
                payload,
                text,
                tags: tag ?? [],
                powerup,
                sort:
                  sort === 'updatedAtAsc' || sort === 'updatedAtDesc'
                    ? 'updatedAt'
                    : sort === 'createdAtAsc' || sort === 'createdAtDesc'
                      ? 'createdAt'
                      : (sort as 'rank' | 'updatedAt' | 'createdAt' | undefined),
                sortDirection:
                  sort === 'updatedAtAsc' || sort === 'createdAtAsc'
                    ? 'asc'
                    : sort === 'updatedAtDesc' || sort === 'createdAtDesc'
                      ? 'desc'
                      : sortDirection,
              },
              powerup ? yield* resolveQueryPowerupByName(powerup) : undefined,
            ),
          };
      const query = normalizeCanonicalQuery(queryRequest.query);

      const result: any = yield* invokeWave1Capability('read.query', {
        query,
        limit,
        offset,
        snippetLength,
      });

      yield* writeSuccess({
        data: result,
        md: buildMarkdown((result as any).items ?? [], Number((result as any).totalMatched ?? 0)),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
