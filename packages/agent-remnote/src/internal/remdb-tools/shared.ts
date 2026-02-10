import BetterSqlite3 from 'better-sqlite3';
import type { Dirent } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { format as formatDate } from 'date-fns';
import type { ZodIssue, ZodTypeAny, output } from 'zod';

import { homeDir, resolveUserFilePath } from '../../lib/paths.js';

export const REMNOTE_RELATIVE_DIR = 'remnote';
export const REMNOTE_DB_NAME = 'remnote.db';
export const REMNOTE_DIR_PREFIX = 'remnote-';

const SECONDARY_DIRS = new Set(['remnote-browser', 'lnotes']);

export type BetterSqliteInstance = BetterSqlite3.Database;

const quantaDocByIdStmtCache = new WeakMap<BetterSqliteInstance, ReturnType<BetterSqliteInstance['prepare']>>();

function getQuantaDocByIdStmt(db: BetterSqliteInstance) {
  const existing = quantaDocByIdStmtCache.get(db);
  if (existing) return existing;
  const stmt = db.prepare('SELECT doc FROM quanta WHERE _id = ?');
  quantaDocByIdStmtCache.set(db, stmt);
  return stmt;
}

export const SYSTEM_REM_IDS = new Set<string>([
  'u71eGVAt1upM7uwC6', // Date String
  'DikxdKKfeGh52AP7p', // timestamp
  'SLg5kZsuzw3GyN6Kh', // Status
]);

export const SYSTEM_REM_KEYS = new Set<string>(['Date String', 'timestamp', 'Status']);

export interface DbResolution {
  dbPath: string;
  source: 'explicit' | 'auto';
  dirName?: string;
  baseDir: string;
}

export interface BackupInfo {
  accountDir: string;
  file: string;
  fullPath: string;
  size: number;
  mtime: string;
  type: 'db' | 'zip';
}

export async function withResolvedDatabase<T>(
  dbPath: string | undefined,
  fn: (db: BetterSqliteInstance) => Promise<T> | T,
): Promise<{ result: T; info: DbResolution }> {
  const info = await resolveDatabasePath(dbPath);
  let db: BetterSqliteInstance | undefined;
  try {
    db = new BetterSqlite3(info.dbPath, { readonly: true });
  } catch (error) {
    const normalized = String(error ?? '');
    if (/\b(SQLITE_(BUSY|LOCKED|CANTOPEN))\b/i.test(normalized) || /busy/i.test(normalized)) {
      throw new Error(
        `Unable to open database ${info.dbPath} (it may be locked by RemNote or not fully written yet).` +
          ' Ensure RemNote has finished syncing, or retry later. For immediate use, explicitly set a backup path via dbPath=....',
      );
    }
    throw error;
  }
  try {
    try {
      const result = await fn(db);
      return { result, info };
    } catch (inner) {
      const message = String(inner ?? '');
      if (/no such table: (remsSearchInfos|remsContents)/i.test(message)) {
        throw new Error(
          'Database is missing search index tables remsSearchInfos/remsContents. Build the index in RemNote or use a newer backup and retry.',
        );
      }
      if (/no such table: quanta/i.test(message)) {
        throw new Error(
          'Database schema mismatch (missing quanta table). Ensure dbPath points to RemNote remnote.db, or choose the correct account DB/backup.',
        );
      }
      if (/malformed MATCH/i.test(message) || /no such tokenizer/i.test(message)) {
        throw new Error(
          `FTS full-text search is currently unavailable (tokenizer not loaded or syntax incompatible). Try mode="like", or rebuild the index in RemNote and retry. Original error: ${message}`,
        );
      }
      throw inner;
    }
  } finally {
    db?.close();
  }
}

export async function resolveDatabasePath(dbPath?: string): Promise<DbResolution> {
  if (dbPath) {
    const expanded = expandHome(dbPath.trim());
    const stat = await fs.stat(expanded);
    if (!stat.isFile()) {
      throw new Error(`${expanded} is not a file`);
    }
    return {
      dbPath: expanded,
      source: 'explicit',
      baseDir: path.dirname(expanded),
    };
  }

  const baseDir = path.join(homeDir(), REMNOTE_RELATIVE_DIR);
  const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => {
    throw new Error(`RemNote directory ${baseDir} not found – please specify dbPath manually`);
  });

  type Candidate = {
    dbPath: string;
    dirName: string;
    mtimeMs: number;
    priority: number;
  };

  const candidates: Candidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'backups') continue;

    const isPrimary = entry.name.startsWith(REMNOTE_DIR_PREFIX);
    const isSecondary = SECONDARY_DIRS.has(entry.name);

    if (!isPrimary && !isSecondary) continue;

    const candidatePath = path.join(baseDir, entry.name, REMNOTE_DB_NAME);
    try {
      const stat = await fs.stat(candidatePath);
      candidates.push({
        dbPath: candidatePath,
        dirName: entry.name,
        mtimeMs: stat.mtimeMs,
        priority: isPrimary ? 0 : 1,
      });
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No ${REMNOTE_DB_NAME} found under ${baseDir}. Specify dbPath manually or ensure RemNote has run.`);
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.mtimeMs - a.mtimeMs;
  });

  const best = candidates[0];
  return {
    dbPath: best.dbPath,
    source: 'auto',
    dirName: best.dirName,
    baseDir,
  };
}

export async function discoverBackups(basePath: string): Promise<BackupInfo[]> {
  const backups: BackupInfo[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(basePath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unable to read ${basePath}: ${String(error)}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const accountDir = path.join(basePath, entry.name);
    const backupDir = path.join(accountDir, 'backups');
    let backupFiles: Dirent[];
    try {
      backupFiles = await fs.readdir(backupDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const file of backupFiles) {
      if (!file.isFile()) continue;
      if (!file.name.endsWith('.db') && !file.name.endsWith('.db.zip')) continue;
      const fullPath = path.join(backupDir, file.name);
      const stat = await fs.stat(fullPath);
      backups.push({
        accountDir: entry.name,
        file: file.name,
        fullPath,
        size: stat.size,
        mtime: new Date(stat.mtimeMs).toISOString(),
        type: file.name.endsWith('.zip') ? 'zip' : 'db',
      });
    }
  }

  backups.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  return backups;
}

export function expandHome(targetPath: string): string {
  const raw = targetPath.trim();
  if (!raw) return raw;
  return resolveUserFilePath(raw);
}

export function safeJsonParse<T>(input: unknown): T | null {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

export function summarizeKey(
  rawKey: unknown,
  db: BetterSqliteInstance | undefined,
  options: { expand: boolean; maxDepth: number },
): { text: string; references: string[] } {
  const fragments: string[] = [];
  const references = new Set<string>();
  const visited = new Set<string>();
  const stmt = db ? getQuantaDocByIdStmt(db) : undefined;

  const helper = (key: unknown, depth: number) => {
    if (!Array.isArray(key)) return;
    for (const item of key) {
      if (typeof item === 'string') {
        fragments.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const maybeObj = item as Record<string, unknown>;
        if (maybeObj.i === 'q' && typeof maybeObj._id === 'string') {
          const refId = maybeObj._id;
          references.add(refId);
          let expanded = false;
          if (options.expand && depth < options.maxDepth && stmt && !visited.has(refId)) {
            visited.add(refId);
            try {
              const row = stmt.get(refId) as { doc: string } | undefined;
              if (row) {
                const refDoc = safeJsonParse<{ key?: unknown }>(row.doc);
                helper(refDoc?.key, depth + 1);
                expanded = true;
              }
            } finally {
              // keep visited entry to prevent cycles
            }
          }
          if (!expanded) {
            fragments.push(`{ref:${refId}}`);
          }
          continue;
        }

        const richText = extractRichText(maybeObj);
        if (richText) {
          fragments.push(richText);
          continue;
        }

        if (typeof maybeObj.t === 'string') {
          fragments.push(maybeObj.t);
          continue;
        }

        fragments.push(JSON.stringify(item));
        continue;
      }
      if (item != null) {
        fragments.push(String(item));
      }
    }
  };

  helper(rawKey, 0);
  const text = fragments.join('').replace(/\s+/g, ' ').trim();

  return {
    text,
    references: Array.from(references),
  };
}

function extractRichText(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.text === 'string' && obj.text.trim()) {
    return obj.text;
  }

  if (typeof obj.title === 'string' && obj.title.trim()) {
    const suffix = typeof obj.text === 'string' && obj.text.trim() ? ` ${obj.text}` : '';
    return `${obj.title}${suffix}`.trim();
  }

  if (Array.isArray(obj.children)) {
    const nested = obj.children
      .map((child) => {
        if (typeof child === 'string') return child;
        if (child && typeof child === 'object') {
          return extractRichText(child as Record<string, unknown>) ?? '';
        }
        return '';
      })
      .filter(Boolean)
      .join('');
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

export function parseOrThrow<Schema extends ZodTypeAny>(
  schema: Schema,
  input: unknown,
  options?: { label?: string },
): output<Schema> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const issues = res.error.issues;
  const lines = issues.map((i) => formatZodIssueEN(i));
  const prefix = options?.label ? `Invalid arguments (${options.label}): ` : 'Invalid arguments: ';
  throw new Error(prefix + lines.join('; '));
}

function formatZodIssueEN(issue: ZodIssue): string {
  const path = issue.path && issue.path.length > 0 ? issue.path.join('.') : undefined;
  const where = path ? `field ${path}: ` : '';
  switch (issue.code) {
    case 'invalid_type': {
      const expected = toENType(issue.expected);
      const received = toENType(issue.received);
      return `${where}expected ${expected}, got ${received}`;
    }
    case 'too_small': {
      if (issue.type === 'string') {
        return `${where}length must be >= ${issue.minimum}`;
      }
      if (issue.type === 'number') {
        return `${where}value must be >= ${issue.minimum}`;
      }
      if (issue.type === 'array') {
        return `${where}must contain at least ${issue.minimum} items`;
      }
      return `${where}value is too small`;
    }
    case 'too_big': {
      if (issue.type === 'string') {
        return `${where}length must be <= ${issue.maximum}`;
      }
      if (issue.type === 'number') {
        return `${where}value must be <= ${issue.maximum}`;
      }
      if (issue.type === 'array') {
        return `${where}must contain at most ${issue.maximum} items`;
      }
      return `${where}value is too large`;
    }
    case 'invalid_string': {
      return `${where}invalid string`;
    }
    case 'invalid_enum_value': {
      const opts = Array.isArray(issue.options) ? issue.options.join('/') : String(issue.options);
      return `${where}must be one of (${opts})`;
    }
    case 'invalid_union':
    case 'invalid_union_discriminator': {
      return `${where}does not match any allowed schema`;
    }
    case 'custom': {
      return `${where}${issue.message || 'constraint failed'}`;
    }
    default: {
      return `${where}${issue.message || 'invalid value'}`;
    }
  }
}

function toENType(t: unknown): string {
  const map: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    bigint: 'bigint',
    date: 'date',
    undefined: 'undefined',
    null: 'null',
    object: 'object',
    array: 'array',
  };
  return map[String(t)] ?? String(t);
}

export async function getUserSetting<T = unknown>(db: BetterSqliteInstance, key: string): Promise<T | undefined> {
  const row = db
    .prepare("SELECT json_extract(doc, '$.value') AS value FROM user_data WHERE json_extract(doc, '$.key') = ?")
    .get(key) as { value: unknown } | undefined;
  if (!row) return undefined;
  if (typeof row.value === 'string') {
    return safeJsonParse<T>(row.value) ?? (row.value as unknown as T);
  }
  return row.value as T;
}

export async function getDateFormatting(db: BetterSqliteInstance): Promise<string | undefined> {
  const format = await getUserSetting<string>(db, 'dateFormatting');
  if (typeof format === 'string' && format.trim()) {
    return normalizeDateFormat(format.trim());
  }
  return undefined;
}

export function formatDateWithPattern(date: Date, pattern: string): string {
  try {
    return formatDate(date, pattern);
  } catch {
    return formatDate(date, 'yyyy/MM/dd');
  }
}

function normalizeDateFormat(format: string): string {
  return format.replace(/YYYY/g, 'yyyy').replace(/YY/g, 'yy').replace(/DD/g, 'dd');
}
