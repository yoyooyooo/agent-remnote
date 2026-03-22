import * as Effect from 'effect/Effect';

import { resolveWorkspaceSnapshot } from '../workspaceResolver.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { RemDb } from '../../services/RemDb.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(raw: string | undefined): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : undefined;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function pickTitle(kt: unknown, ke: unknown, r: unknown): string {
  const combined = [kt, ke].map(normalizeString).filter(Boolean).join(' | ');
  const raw = combined || normalizeString(r);
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const title = normalized.split(/\n| - |——|。|！|？|\.|: /)[0]?.trim() || normalized;
  return truncateText(title, 80);
}

function fetchRemTitleMap(db: any, ids: readonly string[]): Map<string, string> {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT id,
            json_extract(doc, '$.kt') AS kt,
            json_extract(doc, '$.ke') AS ke,
            json_extract(doc, '$.r') AS r
       FROM remsSearchInfos
      WHERE id IN (${placeholders})`,
  );
  const rows = stmt.all(...unique) as Array<{ id: string; kt: unknown; ke: unknown; r: unknown }>;

  const map = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    map.set(id, pickTitle(row.kt, row.ke, row.r));
  }
  return map;
}

export function readSingleRemTitle(params: {
  readonly ids: readonly string[];
  readonly selectionTitle?: string | undefined;
}): Effect.Effect<string | undefined, CliError, AppConfig | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const ids = Array.from(new Set(params.ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
    if (ids.length !== 1) return undefined;

    const selectionTitle = normalizeOptionalText(params.selectionTitle);
    if (selectionTitle) return selectionTitle;

    const cfg = yield* AppConfig;
    if (cfg.apiBaseUrl) return undefined;

    const remDb = yield* RemDb;
    const workspace = cfg.remnoteDb
      ? undefined
      : yield* resolveWorkspaceSnapshot({}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const dbPath = cfg.remnoteDb ?? (workspace?.resolved ? workspace.dbPath : undefined);
    if (!dbPath) return undefined;

    const titleMap = yield* remDb.withDb(dbPath, async (db) => fetchRemTitleMap(db, ids)).pipe(
      Effect.map((value) => value.result),
      Effect.catchAll(() => Effect.succeed(new Map<string, string>())),
    );

    return normalizeOptionalText(titleMap.get(ids[0]!));
  });
}
