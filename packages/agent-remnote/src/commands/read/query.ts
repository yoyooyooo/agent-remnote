import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeSearchQuery } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { Payload } from '../../services/Payload.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { cliErrorFromUnknown } from '../_tool.js';

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
const text = Options.text('text').pipe(Options.optional, Options.map(optionToUndefined));
const tag = Options.text('tag').pipe(Options.repeated);

const limit = Options.integer('limit').pipe(Options.withDefault(20));
const offset = Options.integer('offset').pipe(Options.withDefault(0));
const snippetLength = Options.integer('snippet-length').pipe(Options.withDefault(200));

const sort = Options.choice('sort', ['rank', 'updatedAt', 'createdAt'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const sortDirection = Options.choice('sort-direction', ['asc', 'desc'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

export const readQueryCommand = Command.make(
  'query',
  { payload, text, tag, limit, offset, snippetLength, sort, sortDirection },
  ({ payload, text, tag, limit, offset, snippetLength, sort, sortDirection }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'query',
        reason: 'this command still executes structured queries against the local RemNote database',
      });
      const payloadSvc = yield* Payload;

      const queryObj: any = {};

      if (payload) {
        const raw = yield* payloadSvc.readJson(payload);
        if (raw && typeof raw === 'object' && (raw as any).query && (raw as any).query.root) {
          Object.assign(queryObj, raw);
        } else if (raw && typeof raw === 'object' && (raw as any).root) {
          Object.assign(queryObj, { query: raw });
        } else {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid payload shape: expected { query: { root: ... } } or { root: ... }',
              exitCode: 2,
            }),
          );
        }
      } else {
        const nodes: any[] = [];
        if (text && text.trim()) {
          nodes.push({ type: 'text', value: text.trim(), mode: 'contains' });
        }
        for (const t of tag ?? []) {
          const v = t.trim();
          if (v) nodes.push({ type: 'tag', id: v });
        }
        if (nodes.length === 0) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: 'Provide --payload or at least one filter (e.g. --text / --tag)',
              exitCode: 2,
            }),
          );
        }
        queryObj.query = {
          root: nodes.length === 1 ? nodes[0] : { type: 'and', nodes },
          sort:
            sort === 'rank'
              ? { mode: 'rank' }
              : sort === 'updatedAt'
                ? { mode: 'updatedAt', direction: sortDirection ?? 'desc' }
                : sort === 'createdAt'
                  ? { mode: 'createdAt', direction: sortDirection ?? 'desc' }
                  : undefined,
        };
      }

      const { payload: result } = yield* Effect.tryPromise({
        try: async () =>
          await executeSearchQuery({
            ...queryObj,
            dbPath: cfg.remnoteDb,
            limit: limit as any,
            offset: offset as any,
            snippetLength: snippetLength as any,
          } as any),
        catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
      });

      yield* writeSuccess({
        data: result,
        md: buildMarkdown((result as any).items ?? [], Number((result as any).totalMatched ?? 0)),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
