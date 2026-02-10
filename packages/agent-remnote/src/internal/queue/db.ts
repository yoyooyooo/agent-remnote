import path from 'node:path';

import { homeDir, resolveUserFilePath } from '../../lib/paths.js';
import { ensureDir as ensureDirStore, openStoreDb, StoreSchemaError } from '../store/index.js';
import type { StoreDB } from '../store/db.js';

export type QueueDB = StoreDB;

export class QueueSchemaError extends Error {
  readonly _tag = 'QueueSchemaError';
  readonly code: 'QUEUE_SCHEMA_NEWER' | 'QUEUE_SCHEMA_UNKNOWN' | 'QUEUE_SCHEMA_INVALID';
  readonly details: Record<string, unknown>;
  readonly nextActions: readonly string[];

  constructor(params: {
    readonly code: QueueSchemaError['code'];
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly nextActions?: readonly string[] | undefined;
  }) {
    super(params.message);
    this.name = 'QueueSchemaError';
    this.code = params.code;
    this.details = params.details;
    this.nextActions = params.nextActions ?? ['agent-remnote doctor', 'agent-remnote config print'];
  }
}

export function defaultQueuePath() {
  const env = process.env.REMNOTE_QUEUE_DB || process.env.QUEUE_DB;
  if (typeof env === 'string' && env.trim()) return resolveUserFilePath(env);
  return path.join(homeDir(), '.agent-remnote', 'queue.sqlite');
}

export function ensureDir(filePath: string) {
  ensureDirStore(filePath);
}

function queueErrorFromStoreSchema(dbPath: string, error: StoreSchemaError): QueueSchemaError {
  const code =
    error.code === 'STORE_SCHEMA_NEWER'
      ? 'QUEUE_SCHEMA_NEWER'
      : error.code === 'STORE_SCHEMA_INVALID'
        ? 'QUEUE_SCHEMA_INVALID'
        : 'QUEUE_SCHEMA_UNKNOWN';

  return new QueueSchemaError({
    code,
    message: error.message,
    details: { db_path: dbPath, ...(error.details || {}) },
    nextActions: error.nextActions,
  });
}

export function openQueueDb(dbPath = defaultQueuePath()): QueueDB {
  const resolvedPath = resolveUserFilePath(dbPath);
  ensureDir(resolvedPath);
  try {
    return openStoreDb(resolvedPath);
  } catch (e) {
    if (e instanceof StoreSchemaError) throw queueErrorFromStoreSchema(resolvedPath, e);
    throw e;
  }
}
