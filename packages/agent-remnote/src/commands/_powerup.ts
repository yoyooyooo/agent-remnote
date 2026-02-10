import * as Effect from 'effect/Effect';

import { tryParseRemnoteLink } from '../lib/remnote.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError } from '../services/Errors.js';
import { RemDb } from '../services/RemDb.js';

export type PowerupMatchBy = 'id' | 'code' | 'title' | 'fuzzy';

export type ResolvedPowerup = {
  readonly query: string;
  readonly matchedBy: PowerupMatchBy;
  readonly id: string;
  readonly title: string;
  readonly rcrt: string;
  readonly createdAt: number | null;
  readonly dbPath: string;
  readonly resolution: string;
  readonly dirName?: string;
};

type PowerupItem = {
  readonly id: string;
  readonly title: string;
  readonly rcrt: string;
  readonly createdAt: number | null;
};

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

function normalizeLoose(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
}

function parsePowerupSpec(spec: string): { readonly mode: 'auto' | 'id' | 'code' | 'title'; readonly value: string } {
  const raw = spec.trim();
  const m = raw.match(/^(id|code|title)\s*:\s*(.*)$/i);
  if (m) {
    const mode = normalizeLoose(m[1] ?? '');
    const value = String(m[2] ?? '').trim();
    if (mode === 'id') return { mode: 'id', value };
    if (mode === 'code') return { mode: 'code', value };
    if (mode === 'title') return { mode: 'title', value };
  }
  return { mode: 'auto', value: raw };
}

function pickUnique(
  matches: readonly PowerupItem[],
): { readonly item: PowerupItem | null; readonly ambiguous: readonly PowerupItem[] } {
  if (matches.length === 1) return { item: matches[0]!, ambiguous: [] };
  if (matches.length > 1) return { item: null, ambiguous: matches };
  return { item: null, ambiguous: [] };
}

function formatCandidates(items: readonly PowerupItem[]): string {
  const lines: string[] = [];
  for (const it of items.slice(0, 10)) {
    lines.push(`- ${it.title} (${it.id}) [code=${it.rcrt}]`);
  }
  if (items.length > 10) lines.push(`- ... (${items.length - 10} more)`);
  return lines.join('\n');
}

export function resolvePowerup(specRaw: string): Effect.Effect<ResolvedPowerup, CliError, AppConfig | RemDb> {
  return Effect.gen(function* () {
    const spec = parsePowerupSpec(specRaw);
    const q = spec.value.trim();
    if (!q) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Powerup spec must not be empty',
          exitCode: 2,
          hint: [
            'Provide a powerup id, code, or title',
            'Examples: --powerup Todo, --powerup code:t, --powerup id:ExWWcna6cyLPRSy3W',
          ],
        }),
      );
    }

    const cfg = yield* AppConfig;
    const remDb = yield* RemDb;

    const { result, info } = yield* remDb.withDb(cfg.remnoteDb, (db) => {
      // id:... or deep link
      if (spec.mode === 'id') {
        const id = normalizeRemIdInput(q);
        const row = db
          .prepare(
            `SELECT _id AS id,
                    doc,
                    json_extract(doc, '$.rcrt') AS rcrt,
                    json_extract(doc, '$.createdAt') AS createdAt
               FROM quanta
              WHERE _id = ?
                AND json_extract(doc, '$.parent') IS NULL
                AND json_extract(doc, '$.rcrt') IS NOT NULL
              LIMIT 1`,
          )
          .get(id) as { id: string; doc: string; rcrt: unknown; createdAt: unknown } | undefined;
        if (!row) {
          throw new CliError({
            code: 'INVALID_ARGS',
            message: `Powerup not found by id: ${id}`,
            exitCode: 2,
            hint: ['Use `agent-remnote powerup list` to list available powerups'],
          });
        }
        const doc = safeJsonParse<Record<string, unknown>>(row.doc) ?? {};
        const title = summarizeTitle(doc) || row.id;
        const rcrt = typeof row.rcrt === 'string' ? row.rcrt : String(row.rcrt ?? '');
        const createdAt = typeof row.createdAt === 'number' ? (row.createdAt as number) : null;
        return { query: q, matchedBy: 'id' as const, id: row.id, title, rcrt, createdAt };
      }

      const qLink = tryParseRemnoteLink(q);
      if (qLink?.remId) {
        const id = qLink.remId;
        const row = db
          .prepare(
            `SELECT _id AS id,
                    doc,
                    json_extract(doc, '$.rcrt') AS rcrt,
                    json_extract(doc, '$.createdAt') AS createdAt
               FROM quanta
              WHERE _id = ?
                AND json_extract(doc, '$.parent') IS NULL
                AND json_extract(doc, '$.rcrt') IS NOT NULL
              LIMIT 1`,
          )
          .get(id) as { id: string; doc: string; rcrt: unknown; createdAt: unknown } | undefined;
        if (!row) {
          throw new CliError({
            code: 'INVALID_ARGS',
            message: `Powerup not found by id: ${id}`,
            exitCode: 2,
            hint: ['Use `agent-remnote powerup list` to list available powerups'],
          });
        }
        const doc = safeJsonParse<Record<string, unknown>>(row.doc) ?? {};
        const title = summarizeTitle(doc) || row.id;
        const rcrt = typeof row.rcrt === 'string' ? row.rcrt : String(row.rcrt ?? '');
        const createdAt = typeof row.createdAt === 'number' ? (row.createdAt as number) : null;
        return { query: q, matchedBy: 'id' as const, id: row.id, title, rcrt, createdAt };
      }

      const rows = db
        .prepare(
          `SELECT _id AS id, doc
             FROM quanta
            WHERE json_extract(doc, '$.parent') IS NULL
              AND json_extract(doc, '$.rcrt') IS NOT NULL
            ORDER BY COALESCE(CAST(json_extract(doc, '$.createdAt') AS INTEGER), 0) ASC`,
        )
        .all() as Array<{ id: string; doc: string }>;

      const items: PowerupItem[] = rows.map((r) => {
        const doc = safeJsonParse<Record<string, unknown>>(r.doc) ?? {};
        const title = summarizeTitle(doc) || r.id;
        const rcrt = typeof (doc as any).rcrt === 'string' ? ((doc as any).rcrt as string) : String((doc as any).rcrt);
        const createdAt = typeof (doc as any).createdAt === 'number' ? ((doc as any).createdAt as number) : null;
        return { id: r.id, title, rcrt, createdAt };
      });

      const qLoose = normalizeLoose(q);
      const byCode = items.filter((p) => normalizeLoose(p.rcrt) === qLoose);
      const byTitle = items.filter((p) => normalizeLoose(p.title) === qLoose);

      if (spec.mode === 'code') {
        const picked = pickUnique(byCode);
        if (picked.item) return { query: q, matchedBy: 'code' as const, ...picked.item };
        if (picked.ambiguous.length > 0) {
          throw new CliError({
            code: 'INVALID_ARGS',
            message: `Ambiguous powerup code: ${q}`,
            exitCode: 2,
            details: { matches: picked.ambiguous.map((x) => x.id) },
            hint: ['Disambiguate with `--powerup id:<id>`', 'Candidates:', formatCandidates(picked.ambiguous)],
          });
        }
        throw new CliError({
          code: 'INVALID_ARGS',
          message: `Powerup not found by code: ${q}`,
          exitCode: 2,
          hint: ['Use `agent-remnote powerup list --query <text>` to search'],
        });
      }

      if (spec.mode === 'title') {
        const picked = pickUnique(byTitle);
        if (picked.item) return { query: q, matchedBy: 'title' as const, ...picked.item };
        if (picked.ambiguous.length > 0) {
          throw new CliError({
            code: 'INVALID_ARGS',
            message: `Ambiguous powerup title: ${q}`,
            exitCode: 2,
            details: { matches: picked.ambiguous.map((x) => x.id) },
            hint: ['Disambiguate with `--powerup id:<id>`', 'Candidates:', formatCandidates(picked.ambiguous)],
          });
        }
        throw new CliError({
          code: 'INVALID_ARGS',
          message: `Powerup not found by title: ${q}`,
          exitCode: 2,
          hint: ['Use `agent-remnote powerup list --query <text>` to search'],
        });
      }

      // auto: exact title > exact code > fuzzy contains
      const exactTitle = pickUnique(byTitle);
      if (exactTitle.item) return { query: q, matchedBy: 'title' as const, ...exactTitle.item };
      if (exactTitle.ambiguous.length > 0) {
        throw new CliError({
          code: 'INVALID_ARGS',
          message: `Ambiguous powerup title: ${q}`,
          exitCode: 2,
          details: { matches: exactTitle.ambiguous.map((x) => x.id) },
          hint: ['Disambiguate with `--powerup id:<id>`', 'Candidates:', formatCandidates(exactTitle.ambiguous)],
        });
      }

      const exactCode = pickUnique(byCode);
      if (exactCode.item) return { query: q, matchedBy: 'code' as const, ...exactCode.item };
      if (exactCode.ambiguous.length > 0) {
        throw new CliError({
          code: 'INVALID_ARGS',
          message: `Ambiguous powerup code: ${q}`,
          exitCode: 2,
          details: { matches: exactCode.ambiguous.map((x) => x.id) },
          hint: ['Disambiguate with `--powerup id:<id>`', 'Candidates:', formatCandidates(exactCode.ambiguous)],
        });
      }

      const fuzzy = items.filter(
        (p) => normalizeLoose(p.title).includes(qLoose) || normalizeLoose(p.rcrt).includes(qLoose),
      );
      const picked = pickUnique(fuzzy);
      if (picked.item) return { query: q, matchedBy: 'fuzzy' as const, ...picked.item };
      if (picked.ambiguous.length > 0) {
        throw new CliError({
          code: 'INVALID_ARGS',
          message: `Ambiguous powerup query: ${q}`,
          exitCode: 2,
          details: { matches: picked.ambiguous.map((x) => x.id) },
          hint: ['Disambiguate with `--powerup id:<id>`', 'Candidates:', formatCandidates(picked.ambiguous)],
        });
      }

      throw new CliError({
        code: 'INVALID_ARGS',
        message: `Powerup not found: ${q}`,
        exitCode: 2,
        hint: ['Use `agent-remnote powerup list --query <text>` to search'],
      });
    });

    return {
      ...result,
      dbPath: info.dbPath,
      resolution: info.source,
      dirName: info.dirName,
    };
  });
}
