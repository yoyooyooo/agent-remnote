import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../../services/AppConfig.js';
import { RemDb } from '../../../services/RemDb.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const query = Options.text('query').pipe(Options.optional, Options.map(optionToUndefined));
const limit = Options.integer('limit').pipe(Options.withDefault(50));
const offset = Options.integer('offset').pipe(Options.withDefault(0));

function safeJsonParse<T>(input: unknown): T | null {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function summarizeTitle(doc: Record<string, unknown> | null | undefined): string {
  const key = (doc as any)?.key;
  if (!Array.isArray(key) || key.length === 0) return '';
  const first = key[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as any).text === 'string') return (first as any).text;
  return '';
}

function normalizeQuery(q: string | undefined): string | null {
  const normalized = String(q ?? '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function toIso(ms: number | null): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

type PowerupItem = {
  readonly id: string;
  readonly title: string;
  readonly rcrt: string;
  readonly createdAt: number | null;
};

function buildMarkdown(items: readonly PowerupItem[]): string {
  if (items.length === 0) return 'No powerups found.\n';
  const lines: string[] = [];
  lines.push('## Powerups', '');
  for (const item of items) {
    const iso = toIso(item.createdAt);
    const meta = [`rcrt=${item.rcrt}`, iso ? `createdAt=${iso}` : null].filter(Boolean).join(' ');
    lines.push(`- ${item.title} \`${item.id}\`${meta ? ` (${meta})` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

export const readPowerupListCommand = Command.make(
  'list',
  { query, limit, offset },
  ({ query, limit, offset }) =>
    Effect.gen(function* () {
      const q = normalizeQuery(query);
      const effectiveLimit = limit ?? 200;
      const effectiveOffset = offset ?? 0;

      const cfg = yield* AppConfig;
      const remDb = yield* RemDb;

      const { result, info } = yield* remDb.withDb(cfg.remnoteDb, (db) => {
        const rows = db
          .prepare(
            `SELECT _id AS id, doc
               FROM quanta
              WHERE json_extract(doc, '$.parent') IS NULL
                AND json_extract(doc, '$.rcrt') IS NOT NULL
              ORDER BY COALESCE(CAST(json_extract(doc, '$.createdAt') AS INTEGER), 0) ASC`,
          )
          .all() as Array<{ id: string; doc: string }>;

        const items: PowerupItem[] = [];
        for (const row of rows) {
          const doc = safeJsonParse<Record<string, unknown>>(row.doc) ?? {};
          const title = summarizeTitle(doc) || row.id;
          const rcrt = typeof (doc as any).rcrt === 'string' ? ((doc as any).rcrt as string) : String((doc as any).rcrt);
          const createdAt = typeof (doc as any).createdAt === 'number' ? ((doc as any).createdAt as number) : null;
          const item: PowerupItem = { id: row.id, title, rcrt, createdAt };
          if (q) {
            if (!item.title.toLowerCase().includes(q) && !item.rcrt.toLowerCase().includes(q)) continue;
          }
          items.push(item);
        }

        const total = items.length;
        const visible = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);
        const hasMore = effectiveOffset + effectiveLimit < total;
        const nextOffset = hasMore ? effectiveOffset + effectiveLimit : null;
        const guidance = q
          ? `Matched ${total} powerups (query="${q}"). Showing ${visible.length} (offset=${effectiveOffset}, limit=${effectiveLimit}).`
          : `Found ${total} powerups. Showing ${visible.length} (offset=${effectiveOffset}, limit=${effectiveLimit}).`;

        return {
          guidance,
          query: query ?? null,
          limit: effectiveLimit,
          offset: effectiveOffset,
          total,
          hasMore,
          nextOffset,
          items: visible,
          markdown: buildMarkdown(visible),
        };
      });

      const payload = {
        dbPath: info.dbPath,
        resolution: info.source,
        dirName: info.dirName,
        ...result,
      };

      yield* writeSuccess({ data: payload, md: payload.markdown ?? '' });
    }).pipe(Effect.catchAll(writeFailure)),
);
