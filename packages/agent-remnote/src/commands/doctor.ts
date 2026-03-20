import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../services/AppConfig.js';
import { DaemonFiles } from '../services/DaemonFiles.js';
import { FsAccess } from '../services/FsAccess.js';
import { Queue } from '../services/Queue.js';
import { RemDb } from '../services/RemDb.js';
import { WsClient } from '../services/WsClient.js';
import { openStoreDb, readStoreSchemaStatus } from '../internal/store/index.js';
import { writeFailure, writeSuccess } from './_shared.js';
import { WS_HEALTH_TIMEOUT_MS } from './ws/_shared.js';

export const doctorCommand = Command.make('doctor', {}, () =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;
    const remDb = yield* RemDb;
    const ws = yield* WsClient;
    const daemonFiles = yield* DaemonFiles;
    const fsAccess = yield* FsAccess;

    const queueStats = yield* queue.stats({ dbPath: cfg.storeDb }).pipe(Effect.either);
    const remnote = yield* remDb
      .withDb(cfg.remnoteDb, (db) => {
        db.prepare('SELECT 1 FROM quanta LIMIT 1').get();
        const hasSearchInfos = !!db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='remsSearchInfos' LIMIT 1`)
          .get();
        const hasContents = !!db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='remsContents' LIMIT 1`)
          .get();
        return { has_search_index: hasSearchInfos && hasContents };
      })
      .pipe(Effect.either);
    const schema = yield* Effect.try({
      try: () => {
        const db = openStoreDb(cfg.storeDb);
        try {
          return readStoreSchemaStatus(db);
        } finally {
          db.close();
        }
      },
      catch: () => null as any,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));

    const wsHealth = yield* ws.health({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    const wsClients = yield* ws.queryClients({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);

    const pidFilePath = daemonFiles.defaultPidFile();
    const logFilePath = daemonFiles.defaultLogFile();
    const pidWritable = yield* fsAccess.canWritePath(pidFilePath);
    const logWritable = yield* fsAccess.canWritePath(logFilePath);

    const storeDbWritable = yield* fsAccess.checkWritableFile(cfg.storeDb);

    const data = {
      queue: {
        ok: queueStats._tag === 'Right',
        db_path: cfg.storeDb,
        schema,
        writable: storeDbWritable.ok,
        writable_reason: storeDbWritable.reason,
        stats: queueStats._tag === 'Right' ? queueStats.right : undefined,
        error: queueStats._tag === 'Left' ? queueStats.left.message : undefined,
      },
      remnote_db: {
        ok: remnote._tag === 'Right',
        db_path: remnote._tag === 'Right' ? remnote.right.info.dbPath : cfg.remnoteDb,
        resolution: remnote._tag === 'Right' ? remnote.right.info.source : undefined,
        has_search_index: remnote._tag === 'Right' ? remnote.right.result.has_search_index : undefined,
        error: remnote._tag === 'Left' ? remnote.left.message : undefined,
      },
      ws: {
        ok: wsHealth._tag === 'Right',
        url: cfg.wsUrl,
        rtt_ms: wsHealth._tag === 'Right' ? wsHealth.right.rtt_ms : undefined,
        error: wsHealth._tag === 'Left' ? wsHealth.left.message : undefined,
        clients: wsClients._tag === 'Right' ? wsClients.right.clients : [],
      },
      daemon_files: {
        pid_file: pidFilePath,
        log_file: logFilePath,
        pid_writable: pidWritable,
        log_writable: logWritable,
      },
    };

    const overallOk =
      data.queue.ok &&
      data.remnote_db.ok &&
      data.ws.ok &&
      data.daemon_files.pid_writable &&
      data.daemon_files.log_writable;

    const hints: string[] = [];
    if (!data.ws.ok) hints.push('Try: agent-remnote daemon ensure / agent-remnote daemon status');
    if (data.ws.ok && data.ws.clients.length === 0)
      hints.push('WS is reachable but no plugin is connected; ensure the plugin is enabled and connected');
    if (!data.queue.ok) hints.push('Store DB is unavailable; check --store-db or REMNOTE_STORE_DB path permissions');
    if (!data.queue.writable)
      hints.push('Store DB path is not writable; fix permissions or choose a different --store-db');
    if (!data.remnote_db.ok)
      hints.push('RemNote DB is unavailable; check --remnote-db or run agent-remnote db backups to pick a backup path');
    if (!data.remnote_db.has_search_index && data.remnote_db.ok) {
      hints.push(
        'RemNote DB is missing search index tables; read search/query may not work. Build the index in RemNote or use a newer backup.',
      );
    }
    if (!data.daemon_files.pid_writable || !data.daemon_files.log_writable) {
      hints.push(
        'Daemon files are not writable; check HOME directory permissions or override via daemon start --pid-file/--log-file',
      );
    }

    const md = [
      `# doctor`,
      `- overall_ok: ${overallOk}`,
      `- queue_ok: ${data.queue.ok}`,
      `- store_db: ${data.queue.db_path}`,
      `- store_schema_current_user_version: ${data.queue.schema?.current_user_version ?? ''}`,
      `- store_schema_latest_supported_version: ${data.queue.schema?.latest_supported_version ?? ''}`,
      `- store_schema_applied_migrations: ${data.queue.schema?.applied_migrations ?? ''}`,
      `- remnote_db_ok: ${data.remnote_db.ok}`,
      `- remnote_db: ${data.remnote_db.db_path ?? ''}`,
      `- remnote_db_resolution: ${data.remnote_db.resolution ?? ''}`,
      `- remnote_search_index_ok: ${data.remnote_db.has_search_index ?? ''}`,
      `- ws_ok: ${data.ws.ok}`,
      `- ws_url: ${data.ws.url}`,
      `- ws_rtt_ms: ${data.ws.rtt_ms ?? ''}`,
      `- ws_clients: ${data.ws.clients.length}`,
      `- pid_file_writable: ${data.daemon_files.pid_writable}`,
      `- pid_file: ${data.daemon_files.pid_file}`,
      `- log_file_writable: ${data.daemon_files.log_writable}`,
      `- log_file: ${data.daemon_files.log_file}`,
      hints.length > 0 ? `\n## Hint` : '',
      ...hints.map((h) => `- ${h}`),
    ]
      .filter(Boolean)
      .join('\n');

    yield* writeSuccess({ data: { overall_ok: overallOk, ...data, hints }, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
