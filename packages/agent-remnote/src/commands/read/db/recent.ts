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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function msToLocalStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function cleanTitle(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.split(/\s+/).join(' ').trim();
}

type RecentRow = {
  readonly id: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly preview: string;
  readonly parent_id: string;
  readonly parent_preview: string;
  readonly edited_after_create: boolean;
};

type RecentGroup = {
  readonly parent_id: string;
  readonly parent_title: string;
  readonly items: RecentRow[];
};

function asInt(value: any): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(n) ? n : 0;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function scalar(db: any, sql: string, params: readonly any[]): number {
  const row = db.prepare(sql).get(...params) as any;
  return asInt(row?.c ?? row?.count ?? row?.['count(*)']);
}

const days = Options.integer('days').pipe(Options.optional, Options.map(optionToUndefined));
const maxParents = Options.integer('max-parents').pipe(Options.optional, Options.map(optionToUndefined));
const perParent = Options.integer('per-parent').pipe(Options.optional, Options.map(optionToUndefined));

export const dbRecentCommand = Command.make(
  'recent',
  {
    days,
    maxParents,
    perParent,
    noParentGroup: Options.boolean('no-parent-group'),
  },
  ({ days, maxParents, perParent, noParentGroup }) =>
    Effect.gen(function* () {
      const d = clampInt(days ?? 15, 1, 3650);
      const maxP = clampInt(maxParents ?? 20, 1, 500);
      const perP = clampInt(perParent ?? 10, 1, 500);

      const cutoffMs = Date.now() - d * 86400 * 1000;

      const cfg = yield* AppConfig;
      const remDb = yield* RemDb;

      const result = yield* remDb.withDb(cfg.remnoteDb, (db) => {
        const counts = {
          quanta_created: scalar(db, "select count(*) as c from quanta where json_extract(doc,'$.createdAt') >= ?", [
            cutoffMs,
          ]),
          quanta_touched: scalar(db, "select count(*) as c from quanta where json_extract(doc,'$.m') >= ?", [cutoffMs]),
          rem_created: scalar(
            db,
            `
              select count(*) as c
              from quanta q
              join remsSearchInfos r on r.id=q._id
              where json_extract(q.doc,'$.createdAt') >= ?
            `,
            [cutoffMs],
          ),
          rem_created_and_edited: scalar(
            db,
            `
              select count(*) as c
              from quanta q
              join remsSearchInfos r on r.id=q._id
              where json_extract(q.doc,'$.createdAt') >= ?
                and json_extract(q.doc,'$.m') > json_extract(q.doc,'$.createdAt')
            `,
            [cutoffMs],
          ),
          rem_modified_old: scalar(
            db,
            `
              select count(*) as c
              from quanta q
              join remsSearchInfos r on r.id=q._id
              where json_extract(q.doc,'$.m') >= ?
                and json_extract(q.doc,'$.createdAt') < ?
            `,
            [cutoffMs, cutoffMs],
          ),
        };

        const rows = db
          .prepare(
            `
              select
                q._id as id,
                cast(json_extract(q.doc,'$.createdAt') as integer) as createdAt,
                cast(json_extract(q.doc,'$.m') as integer) as updatedAt,
                json_extract(r.doc,'$.r') as preview,
                json_extract(q.doc,'$.parent') as parentId,
                json_extract(pr.doc,'$.r') as parentPreview
              from quanta q
              join remsSearchInfos r on r.id=q._id
              left join remsSearchInfos pr on pr.id = json_extract(q.doc,'$.parent')
              where cast(json_extract(q.doc,'$.createdAt') as integer) >= ?
              order by createdAt desc
            `,
          )
          .all(cutoffMs) as any[];

        const items: RecentRow[] = rows.map((row) => {
          const createdAt = asInt(row.createdAt);
          const updatedAt = asInt(row.updatedAt);
          const preview = cleanTitle(row.preview) || '<no preview>';
          const parentId = typeof row.parentId === 'string' ? row.parentId : row.parentId ? String(row.parentId) : '';
          const parentPreview = cleanTitle(row.parentPreview) || '<unknown parent>';
          return {
            id: String(row.id),
            created_at: createdAt,
            updated_at: updatedAt,
            preview,
            parent_id: parentId,
            parent_preview: parentPreview,
            edited_after_create: createdAt > 0 && updatedAt > createdAt,
          };
        });

        return { counts, items };
      });

      const dbPath = result.info.dbPath;
      const cutoffText = msToLocalStr(cutoffMs);

      const header = [
        `# RemNote Overview (last ${d} days)`,
        ``,
        `- db: \`${dbPath}\``,
        `- cutoff: \`${cutoffText}\``,
        `- rem (index): created \`${result.result.counts.rem_created}\`; created+edited \`${result.result.counts.rem_created_and_edited}\`; edited existing \`${result.result.counts.rem_modified_old}\``,
        `- quanta (raw): createdAt>=cutoff \`${result.result.counts.quanta_created}\`; m>=cutoff \`${result.result.counts.quanta_touched}\``,
        ``,
      ].join('\n');

      const ids: string[] = [];
      const mdLines: string[] = [header.trimEnd()];

      if (result.result.items.length > 0) {
        if (noParentGroup) {
          mdLines.push('## New Rems (newest first)', '');
          const take = Math.min(result.result.items.length, maxP * perP);
          for (const row of result.result.items.slice(0, take)) {
            ids.push(row.id);
            const marker = row.edited_after_create ? ' (edited after creation)' : '';
            mdLines.push(`- \`${msToLocalStr(row.created_at)}\` ${row.preview} \`${row.id}\`${marker}`);
          }
        } else {
          const groups = new Map<string, RecentGroup>();
          for (const row of result.result.items) {
            const key = row.parent_id;
            const existing = groups.get(key);
            if (existing) {
              existing.items.push(row);
            } else {
              groups.set(key, { parent_id: key, parent_title: row.parent_preview, items: [row] });
            }
          }

          const ordered = Array.from(groups.values())
            .sort((a, b) => {
              const aMax = Math.max(...a.items.map((r) => r.created_at));
              const bMax = Math.max(...b.items.map((r) => r.created_at));
              return bMax - aMax;
            })
            .slice(0, maxP);

          mdLines.push(`## New Rems (grouped by parent, up to ${maxP} groups × ${perP} each)`, '');

          for (const group of ordered) {
            const items = [...group.items].sort((a, b) => b.created_at - a.created_at);
            mdLines.push(`### ${group.parent_title} (${group.items.length})`, '');
            for (const row of items.slice(0, perP)) {
              ids.push(row.id);
              const marker = row.edited_after_create ? ' (edited after creation)' : '';
              mdLines.push(`- \`${msToLocalStr(row.created_at)}\` ${row.preview} \`${row.id}\`${marker}`);
            }
            mdLines.push('');
          }
        }
      }

      const data = {
        db_path: dbPath,
        resolution: result.info.source,
        days: d,
        cutoff_ms: cutoffMs,
        counts: result.result.counts,
        items: result.result.items,
      };

      yield* writeSuccess({ data, ids, md: mdLines.join('\n').trimEnd() + '\n' });
    }).pipe(Effect.catchAll(writeFailure)),
);
