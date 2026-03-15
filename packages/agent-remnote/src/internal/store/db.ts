import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { homeDir, resolveUserFilePath } from '../../lib/paths.js';
import { migrationSpecs, type MigrationSpec } from './migrations/index.js';

export type StoreDB = Database.Database;

export class StoreSchemaError extends Error {
  readonly _tag = 'StoreSchemaError';
  readonly code: 'STORE_SCHEMA_NEWER' | 'STORE_SCHEMA_UNKNOWN' | 'STORE_SCHEMA_INVALID';
  readonly details: Record<string, unknown>;
  readonly nextActions: readonly string[];

  constructor(params: {
    readonly code: StoreSchemaError['code'];
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly nextActions?: readonly string[] | undefined;
  }) {
    super(params.message);
    this.name = 'StoreSchemaError';
    this.code = params.code;
    this.details = params.details;
    this.nextActions = params.nextActions ?? ['agent-remnote doctor', 'agent-remnote config print'];
  }
}

// NOTE: This file is bundled into the `agent-remnote` CLI via `bun build` which flattens modules into a single output file.
// Using `new URL('./schema.sql', import.meta.url)` would then resolve to `<dist>/schema.sql` which doesn't exist.
// We keep `schema.sql` as the canonical source-of-truth, but fall back to an embedded copy when bundling breaks relative URLs.
const FALLBACK_SCHEMA_SQL = `-- PRAGMAs
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS store_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  INTEGER NOT NULL,
  app_version TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS queue_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_txns (
  txn_id           TEXT PRIMARY KEY,
  status           TEXT NOT NULL CHECK (status IN ('pending','ready','in_progress','succeeded','failed','aborted')),
  dispatch_mode    TEXT NOT NULL DEFAULT 'serial' CHECK (dispatch_mode IN ('serial','conflict_parallel')),
  priority         INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT UNIQUE,
  client_id        TEXT,
  meta_json        TEXT NOT NULL DEFAULT '{}',
  op_count         INTEGER NOT NULL DEFAULT 0,
  next_seq         INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  committed_at     INTEGER,
  finished_at      INTEGER
);

CREATE TABLE IF NOT EXISTS queue_ops (
  op_id            TEXT PRIMARY KEY,
  txn_id           TEXT NOT NULL,
  op_seq           INTEGER NOT NULL,
  type             TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','in_flight','succeeded','failed','dead')),
  idempotency_key  TEXT,
  op_hash          TEXT NOT NULL,
  attempt_id       TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 10,
  deliver_after    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  locked_by        TEXT,
  locked_at        INTEGER,
  lease_expires_at INTEGER,
  dead_reason      TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CONSTRAINT fk_ops_txn FOREIGN KEY (txn_id) REFERENCES queue_txns(txn_id) ON DELETE CASCADE,
  CONSTRAINT uq_txn_seq UNIQUE (txn_id, op_seq)
);

CREATE INDEX IF NOT EXISTS idx_ops_status_next ON queue_ops(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ops_locked_by ON queue_ops(locked_by);
CREATE INDEX IF NOT EXISTS idx_ops_hash ON queue_ops(op_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_idem ON queue_ops(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS queue_op_dependencies (
  op_id             TEXT NOT NULL,
  depends_on_op_id  TEXT NOT NULL,
  PRIMARY KEY (op_id, depends_on_op_id),
  FOREIGN KEY (op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_op_results (
  op_id         TEXT PRIMARY KEY,
  result_json   TEXT,
  error_code    TEXT,
  error_message TEXT,
  finished_at   INTEGER,
  FOREIGN KEY (op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_op_attempts (
  op_id       TEXT NOT NULL,
  attempt_id  TEXT NOT NULL,
  conn_id     TEXT,
  status      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (op_id, attempt_id),
  FOREIGN KEY (op_id) REFERENCES queue_ops(op_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_id_map (
  client_temp_id  TEXT PRIMARY KEY,
  remote_id       TEXT,
  remote_type     TEXT,
  source_txn      TEXT,
  updated_at      INTEGER
);

CREATE TABLE IF NOT EXISTS queue_consumers (
  consumer_id   TEXT PRIMARY KEY,
  last_seen_at  INTEGER NOT NULL,
  meta_json     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workspace_bindings (
  workspace_id       TEXT PRIMARY KEY,
  kb_name            TEXT,
  db_path            TEXT NOT NULL,
  source             TEXT NOT NULL CHECK (source IN ('explicit','live_ui_context','single_candidate_auto','deep_link')),
  is_current         INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  first_seen_at      INTEGER NOT NULL,
  last_verified_at   INTEGER NOT NULL,
  last_ui_context_at INTEGER,
  updated_at         INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_bindings_current
  ON workspace_bindings(is_current)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS idx_workspace_bindings_updated_at
  ON workspace_bindings(updated_at DESC);

CREATE TABLE IF NOT EXISTS backup_artifacts (
  source_op_id      TEXT PRIMARY KEY,
  source_txn        TEXT NOT NULL,
  source_op_type    TEXT NOT NULL CHECK (source_op_type IN ('replace_children_with_markdown','replace_selection_with_markdown')),
  backup_kind       TEXT NOT NULL CHECK (backup_kind IN ('children_replace','selection_replace')),
  cleanup_policy    TEXT NOT NULL CHECK (cleanup_policy IN ('auto','visible')),
  cleanup_state     TEXT NOT NULL CHECK (cleanup_state IN ('pending','orphan','retained','cleaned')),
  backup_rem_id     TEXT,
  source_parent_id  TEXT,
  source_anchor_id  TEXT,
  result_json       TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  cleaned_at        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_backup_artifacts_state
  ON backup_artifacts(cleanup_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_backup_artifacts_kind
  ON backup_artifacts(backup_kind, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_artifacts_backup_rem_id
  ON backup_artifacts(backup_rem_id)
  WHERE backup_rem_id IS NOT NULL;
`;

// Test-only export to prevent the embedded fallback snapshot from drifting away from `schema.sql`.
export const __TEST_FALLBACK_SCHEMA_SQL = FALLBACK_SCHEMA_SQL;

function absoluteDefaultStorePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'store.sqlite');
}

export function defaultStorePath(): string {
  const env = process.env.REMNOTE_STORE_DB || process.env.STORE_DB;
  if (typeof env === 'string' && env.trim()) return resolveUserFilePath(env);
  return absoluteDefaultStorePath();
}

export function defaultLegacyQueuePath(): string {
  const env = process.env.REMNOTE_QUEUE_DB || process.env.QUEUE_DB;
  if (typeof env === 'string' && env.trim()) return resolveUserFilePath(env);
  return path.join(homeDir(), '.agent-remnote', 'queue.sqlite');
}

export function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

export function openStoreDb(dbPath = defaultStorePath()): StoreDB {
  const resolvedPath = resolveUserFilePath(dbPath);
  ensureDir(resolvedPath);
  maybeInitializeDefaultStoreFromLegacy(resolvedPath, { callerProvidedPath: dbPath });
  const db = new Database(resolvedPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db, resolvedPath);
  return db;
}

type Migration = MigrationSpec & { readonly checksum: string };

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function migrationChecksum(spec: Pick<MigrationSpec, 'version' | 'name' | 'checksumInput'>): string {
  return sha256Hex(`${spec.version}\n${spec.name}\n${spec.checksumInput}\n`);
}

function buildMigrationPlan(specs: readonly MigrationSpec[]): {
  readonly migrations: readonly Migration[];
  readonly latestVersion: number;
} {
  if (specs.length === 0) {
    throw new StoreSchemaError({
      code: 'STORE_SCHEMA_UNKNOWN',
      message: 'Store migrations are misconfigured (no migrations defined)',
      details: {},
      nextActions: ['Report this as a bug'],
    });
  }

  const sorted = [...specs].sort((a, b) => a.version - b.version);
  const versions = new Set<number>();
  for (const s of sorted) {
    if (!Number.isInteger(s.version) || s.version <= 0) {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_UNKNOWN',
        message: 'Store migrations are misconfigured (invalid migration version)',
        details: { version: s.version, name: s.name },
        nextActions: ['Report this as a bug'],
      });
    }
    if (versions.has(s.version)) {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_UNKNOWN',
        message: 'Store migrations are misconfigured (duplicate migration version)',
        details: { version: s.version, name: s.name },
        nextActions: ['Report this as a bug'],
      });
    }
    versions.add(s.version);
    if (typeof s.name !== 'string' || s.name.trim().length === 0) {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_UNKNOWN',
        message: 'Store migrations are misconfigured (missing migration name)',
        details: { version: s.version },
        nextActions: ['Report this as a bug'],
      });
    }
    if (typeof s.checksumInput !== 'string') {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_UNKNOWN',
        message: 'Store migrations are misconfigured (missing checksum input)',
        details: { version: s.version, name: s.name },
        nextActions: ['Report this as a bug'],
      });
    }
  }

  if (sorted[0]!.version !== 1) {
    throw new StoreSchemaError({
      code: 'STORE_SCHEMA_UNKNOWN',
      message: 'Store migrations are misconfigured (baseline migration must be version 1)',
      details: { first_version: sorted[0]!.version },
      nextActions: ['Report this as a bug'],
    });
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.version !== prev.version + 1) {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_UNKNOWN',
        message: 'Store migrations are misconfigured (migration versions must be contiguous)',
        details: { prev_version: prev.version, next_version: cur.version },
        nextActions: ['Report this as a bug'],
      });
    }
  }

  const migrations: Migration[] = sorted.map((s) => ({ ...s, checksum: migrationChecksum(s) }));
  const latestVersion = migrations[migrations.length - 1]!.version;
  return { migrations, latestVersion };
}

const MIGRATION_PLAN = buildMigrationPlan(migrationSpecs);
const LATEST_USER_VERSION = MIGRATION_PLAN.latestVersion;

function readUserVersion(db: StoreDB): number {
  const v = db.pragma('user_version', { simple: true }) as any;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return -1;
  return Math.floor(n);
}

function setUserVersion(db: StoreDB, version: number): void {
  db.pragma(`user_version = ${Math.max(0, Math.floor(version))}`);
}

function tableExists(db: StoreDB, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name=@name LIMIT 1`)
    .get({ name }) as any;
  return !!row?.ok;
}

function sleepSync(ms: number): void {
  const dur = Math.max(0, Math.floor(ms));
  if (dur <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, dur);
}

function isSqliteBusy(error: unknown): boolean {
  const code = String((error as any)?.code || '');
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_BUSY_SNAPSHOT' ||
    code === 'SQLITE_BUSY_RECOVERY' ||
    code === 'SQLITE_LOCKED'
  );
}

function withMigrationWriteLock<T>(db: StoreDB, fn: () => T): T {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        throw e;
      }
    } catch (e) {
      const retry = isSqliteBusy(e) && attempt < maxAttempts;
      if (!retry) throw e;
      sleepSync(Math.min(800, 25 * 2 ** (attempt - 1)));
    }
  }
  throw new Error('unreachable');
}

const MIGRATIONS_AUDIT_TABLE_DDL = `CREATE TABLE IF NOT EXISTS store_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  INTEGER NOT NULL,
  app_version TEXT NOT NULL DEFAULT 'unknown'
)`;

function ensureMigrationAuditTable(db: StoreDB): void {
  db.exec(MIGRATIONS_AUDIT_TABLE_DDL);
}

function appVersionForAudit(): string {
  const v = process.env.AGENT_REMNOTE_VERSION;
  if (typeof v === 'string' && v.trim()) return v.trim();
  return 'unknown';
}

type AppliedMigration = { readonly version: number; readonly name: string; readonly checksum: string };

function readAppliedMigrations(db: StoreDB): Map<number, AppliedMigration> {
  try {
    const rows = db.prepare(`SELECT version, name, checksum FROM store_migrations ORDER BY version ASC`).all() as any[];
    const out = new Map<number, AppliedMigration>();
    for (const r of rows) {
      const version = Number(r?.version);
      if (!Number.isInteger(version) || version <= 0) continue;
      out.set(version, {
        version,
        name: typeof r?.name === 'string' ? r.name : String(r?.name ?? ''),
        checksum: typeof r?.checksum === 'string' ? r.checksum : String(r?.checksum ?? ''),
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

function ensureMigrationRecorded(db: StoreDB, migration: Migration, appliedAt: number, appVersion: string): void {
  const existing = db
    .prepare(`SELECT name, checksum FROM store_migrations WHERE version=?`)
    .get(migration.version) as any;
  if (existing) {
    const actualChecksum =
      typeof existing?.checksum === 'string' ? existing.checksum : String(existing?.checksum ?? '');
    if (actualChecksum !== migration.checksum) {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_INVALID',
        message: 'Store database migration drift detected',
        details: {
          version: migration.version,
          expected: { name: migration.name, checksum: migration.checksum },
          actual: { name: String(existing?.name ?? ''), checksum: actualChecksum },
        },
        nextActions: ['Upgrade `agent-remnote` to a newer version', 'agent-remnote doctor'],
      });
    }
    return;
  }

  try {
    db.prepare(
      `INSERT INTO store_migrations(version, name, checksum, applied_at, app_version)
       VALUES(@version, @name, @checksum, @applied_at, @app_version)`,
    ).run({
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      applied_at: appliedAt,
      app_version: appVersion,
    });
  } catch (e) {
    const code = String((e as any)?.code || '');
    if (code !== 'SQLITE_CONSTRAINT' && code !== 'SQLITE_CONSTRAINT_PRIMARYKEY' && code !== 'SQLITE_CONSTRAINT_UNIQUE')
      throw e;

    const again = db
      .prepare(`SELECT name, checksum FROM store_migrations WHERE version=?`)
      .get(migration.version) as any;
    const actualChecksum = typeof again?.checksum === 'string' ? again.checksum : String(again?.checksum ?? '');
    if (actualChecksum !== migration.checksum) {
      throw new StoreSchemaError({
        code: 'STORE_SCHEMA_INVALID',
        message: 'Store database migration drift detected',
        details: {
          version: migration.version,
          expected: { name: migration.name, checksum: migration.checksum },
          actual: { name: String(again?.name ?? ''), checksum: actualChecksum },
        },
        nextActions: ['Upgrade `agent-remnote` to a newer version', 'agent-remnote doctor'],
      });
    }
  }
}

function ensureAuditUpTo(db: StoreDB, version: number): void {
  const appliedAt = Date.now();
  const appVersion = appVersionForAudit();
  const applied = readAppliedMigrations(db);

  for (const m of MIGRATION_PLAN.migrations) {
    if (m.version > version) break;
    const existing = applied.get(m.version);
    if (existing) {
      if (existing.checksum !== m.checksum) {
        throw new StoreSchemaError({
          code: 'STORE_SCHEMA_INVALID',
          message: 'Store database migration drift detected',
          details: {
            version: m.version,
            expected: { name: m.name, checksum: m.checksum },
            actual: { name: existing.name, checksum: existing.checksum },
          },
          nextActions: ['Upgrade `agent-remnote` to a newer version', 'agent-remnote doctor'],
        });
      }
      continue;
    }
    ensureMigrationRecorded(db, m, appliedAt, appVersion);
  }
}

function applyMigration(db: StoreDB, targetVersion: number): void {
  const migration = MIGRATION_PLAN.migrations[targetVersion - 1];
  if (!migration || migration.version !== targetVersion) {
    throw new StoreSchemaError({
      code: 'STORE_SCHEMA_UNKNOWN',
      message: `Unknown store migration target: ${targetVersion}`,
      details: { target_version: targetVersion, supported_version: LATEST_USER_VERSION },
      nextActions: ['Report this as a bug'],
    });
  }
  migration.apply(db);
  ensureMigrationRecorded(db, migration, Date.now(), appVersionForAudit());
}

function migrate(db: StoreDB, resolvedPath: string) {
  const initial = readUserVersion(db);
  if (initial < 0) {
    throw new StoreSchemaError({
      code: 'STORE_SCHEMA_INVALID',
      message: 'Store database has an invalid schema version',
      details: { db_path: resolvedPath },
      nextActions: ['agent-remnote doctor', 'agent-remnote config print'],
    });
  }

  if (initial > LATEST_USER_VERSION) {
    throw new StoreSchemaError({
      code: 'STORE_SCHEMA_NEWER',
      message: 'Store database schema is newer than this CLI',
      details: { db_path: resolvedPath, current_version: initial, supported_version: LATEST_USER_VERSION },
      nextActions: ['Upgrade `agent-remnote` to a newer version', 'agent-remnote doctor'],
    });
  }

  // Brand new DB: create the full schema snapshot (includes PRAGMAs).
  if (
    initial === 0 &&
    !tableExists(db, 'queue_ops') &&
    !tableExists(db, 'queue_txns') &&
    !tableExists(db, 'ops') &&
    !tableExists(db, 'txns')
  ) {
    db.exec(loadSchemaSql());
    setUserVersion(db, LATEST_USER_VERSION);
    ensureMigrationAuditTable(db);
    ensureAuditUpTo(db, LATEST_USER_VERSION);
    return;
  }

  withMigrationWriteLock(db, () => {
    ensureMigrationAuditTable(db);

    // Legacy DBs (created before we introduced PRAGMA user_version) default to 0.
    // If the schema already exists, treat it as v1.
    if (readUserVersion(db) === 0) {
      setUserVersion(db, 1);
    }

    let v = readUserVersion(db);
    ensureAuditUpTo(db, v);
    while (v < LATEST_USER_VERSION) {
      const next = v + 1;
      applyMigration(db, next);
      setUserVersion(db, next);
      v = next;
    }
  });

  // Ensure the latest snapshot creates any missing tables/indexes (includes PRAGMAs).
  db.exec(loadSchemaSql());
}

function loadSchemaSql(): string {
  try {
    return readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  } catch {
    return FALLBACK_SCHEMA_SQL;
  }
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function maybeInitializeDefaultStoreFromLegacy(
  resolvedStorePath: string,
  params: { readonly callerProvidedPath: string },
): void {
  const envStore = process.env.REMNOTE_STORE_DB || process.env.STORE_DB;
  const defaultStore = absoluteDefaultStorePath();
  const isDefaultTarget = resolveUserFilePath(params.callerProvidedPath) === resolveUserFilePath(defaultStore);

  if (typeof envStore === 'string' && envStore.trim()) return;
  if (!isDefaultTarget) return;
  if (existsSync(resolvedStorePath)) return;

  const legacyPath = defaultLegacyQueuePath();
  if (!existsSync(legacyPath)) return;

  const tmpPath = `${resolvedStorePath}.tmp.${process.pid}.${randomUUID()}`;
  ensureDir(tmpPath);
  try {
    const source = new Database(legacyPath, { readonly: true });
    try {
      source.exec(`VACUUM INTO ${sqliteStringLiteral(tmpPath)}`);
    } finally {
      try {
        source.close();
      } catch {}
    }

    copyFileSync(tmpPath, resolvedStorePath, constants.COPYFILE_EXCL);
  } catch (e) {
    const code = String((e as any)?.code || '');
    if (code !== 'EEXIST') throw e;
  } finally {
    try {
      rmSync(tmpPath, { force: true });
    } catch {}
  }
}
