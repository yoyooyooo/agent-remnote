import * as Effect from 'effect/Effect';

import { executeOutlineRemSubtree, executeSearchRemOverview, type BetterSqliteInstance } from '../adapters/core.js';
import { loadBridgeSelectionSnapshot, requireOkRemSelection } from '../commands/read/selection/_shared.js';
import { loadBridgeUiContextSnapshot, requireOkUiContext } from '../commands/read/uiContext/_shared.js';
import { enqueueOps, normalizeOp, normalizeOps, parseEnqueuePayload } from '../commands/_enqueue.js';
import { waitForTxn } from '../commands/_waitTxn.js';
import { WS_START_WAIT_DEFAULT_MS, ensureWsSupervisor } from '../commands/ws/_shared.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError, isCliError } from '../services/Errors.js';
import { Payload } from '../services/Payload.js';
import { RemDb } from '../services/RemDb.js';
import { Queue } from '../services/Queue.js';
import { RefResolver } from '../services/RefResolver.js';
import { WsClient } from '../services/WsClient.js';
import { apiContainerBaseUrl, apiLocalBaseUrl } from './apiUrls.js';
import { remnoteDbPathForWorkspaceId } from './remnote.js';
import { dropBlankLinesOutsideFences, trimBoundaryBlankLines } from './text.js';
import { cliErrorFromUnknown } from '../commands/_tool.js';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function executeDbSearchUseCase(params: {
  readonly query: string;
  readonly timeRange?: string | undefined;
  readonly parentId?: string | undefined;
  readonly pagesOnly?: boolean | undefined;
  readonly excludePages?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly timeoutMs?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const effectiveTimeoutMs = clampInt(params.timeoutMs ?? 30_000, 1, 30_000);
    return yield* Effect.tryPromise({
      try: async () =>
        await executeSearchRemOverview({
          query: params.query,
          dbPath: cfg.remnoteDb,
          timeRange: params.timeRange as any,
          parentId: params.parentId,
          pagesOnly: params.pagesOnly,
          excludePages: params.excludePages,
          limit: (params.limit ?? 10) as any,
          offset: (params.offset ?? 0) as any,
          timeoutMs: effectiveTimeoutMs,
        } as any),
      catch: (e) => {
        if ((e as any)?.code === 'TIMEOUT') {
          return new CliError({
            code: 'TIMEOUT',
            message: `DB query timed out after ${effectiveTimeoutMs}ms`,
            exitCode: 1,
            details: { timeoutMs: effectiveTimeoutMs },
            hint: [
              'Narrow the search scope (e.g. add --time 30d, or --parent <remId>)',
              'Reduce the result count (e.g. --limit 10)',
              'Try plugin candidates: agent-remnote plugin search --query "<keywords>"',
            ],
          });
        }
        return cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' });
      },
    });
  });
}

export function executePluginSearchUseCase(params: {
  readonly query: string;
  readonly searchContextRemId?: string | undefined;
  readonly limit?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly ensureDaemon?: boolean | undefined;
}): Effect.Effect<any, CliError, AppConfig | WsClient | Queue | Payload | RefResolver | any> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const limitEffective = clampInt(params.limit ?? 20, 1, 100);
    const rpcTimeoutMs = clampInt(params.timeoutMs ?? 3000, 1, 5000);
    const wsTimeoutMs = clampInt(rpcTimeoutMs + 2000, 2000, 15_000);

    if (params.ensureDaemon !== false) {
      yield* ensureWsSupervisor({ waitMs: WS_START_WAIT_DEFAULT_MS });
    }

    return yield* ws.search({
      url: cfg.wsUrl,
      timeoutMs: wsTimeoutMs,
      queryText: params.query,
      searchContextRemId: params.searchContextRemId,
      limit: limitEffective,
      rpcTimeoutMs,
    });
  });
}

export function executeWriteOpsUseCase(params: {
  readonly raw: unknown;
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly meta?: unknown;
  readonly notify?: boolean | undefined;
  readonly ensureDaemon?: boolean | undefined;
}): Effect.Effect<any, CliError, AppConfig | Queue | Payload | WsClient | RefResolver | any> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => parseEnqueuePayload(params.raw),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid payload shape: expected an ops array, or { ops: [...] }',
              exitCode: 2,
            }),
    });

    const rawOps = parsed.ops;
    if (rawOps.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_PAYLOAD', message: 'ops must not be empty', exitCode: 2 }),
      );
    }
    if (rawOps.length > 500) {
      return yield* Effect.fail(
        new CliError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `Too many ops (${rawOps.length}); split the request and try again`,
          exitCode: 2,
          details: { ops: rawOps.length, max_ops: 500 },
        }),
      );
    }

    const ops = yield* normalizeOps(rawOps);
    return yield* enqueueOps({
      ops,
      priority: params.priority ?? parsed.priority,
      clientId: params.clientId ?? parsed.clientId,
      idempotencyKey: params.idempotencyKey ?? parsed.idempotencyKey,
      meta: params.meta ?? parsed.meta,
      notify: params.notify ?? true,
      ensureDaemon: params.ensureDaemon ?? true,
    });
  });
}

export function executeImportMarkdownUseCase(params: {
  readonly parent?: string | undefined;
  readonly ref?: string | undefined;
  readonly markdown: string;
  readonly mode?: 'indent' | 'native' | undefined;
  readonly indentSize?: number | undefined;
  readonly position?: number | undefined;
  readonly bulk?: 'auto' | 'always' | 'never' | undefined;
  readonly bundleTitle?: string | undefined;
  readonly staged?: boolean | undefined;
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly meta?: unknown;
  readonly notify?: boolean | undefined;
  readonly ensureDaemon?: boolean | undefined;
  readonly wait?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | Payload | RefResolver | Queue | WsClient | any> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;

    if (params.parent && params.ref) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of parent or ref', exitCode: 2 }),
      );
    }
    if (!params.parent && !params.ref) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'You must provide parent or ref', exitCode: 2 }),
      );
    }
    if (params.position !== undefined && (!Number.isFinite(params.position) || params.position < 0)) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: '--position must be a non-negative integer',
          exitCode: 2,
          details: { position: params.position },
        }),
      );
    }

    const markdownValue = dropBlankLinesOutsideFences(trimBoundaryBlankLines(params.markdown));
    const bulkMode = params.bulk ?? 'auto';
    const bundleTitleValue = typeof params.bundleTitle === 'string' ? params.bundleTitle.trim() : '';
    const hasBundleTitle = Boolean(bundleTitleValue);
    if (bulkMode === 'never' && hasBundleTitle) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Cannot specify bundleTitle when bulk=never', exitCode: 2 }),
      );
    }

    const parentId = params.ref
      ? yield* Effect.gen(function* () {
          const refs = yield* RefResolver;
          return yield* refs.resolve(params.ref!);
        })
      : params.parent!;

    const payload: Record<string, unknown> = { parentId, markdown: markdownValue };
    const resolvedMode: 'indent' | 'native' = params.mode ?? (params.indentSize !== undefined ? 'indent' : 'native');
    if (resolvedMode === 'native') payload.indentMode = false;
    if (params.indentSize !== undefined) payload.indentSize = params.indentSize;
    if (params.position !== undefined) payload.position = params.position;
    if (params.staged) payload.staged = true;

    const lines = markdownValue.split('\n').length;
    const chars = markdownValue.length;
    const shouldBundle =
      bulkMode === 'always' || (bulkMode === 'auto' && (hasBundleTitle || lines >= 80 || chars >= 5000));
    if (shouldBundle) {
      const title = bundleTitleValue || `Imported (bundle) (${lines} lines, ${chars} chars)`;
      payload.bundle = { enabled: true, title };
    }

    const op = yield* Effect.try({
      try: () => normalizeOp({ type: 'create_tree_with_markdown', payload }, payloadSvc.normalizeKeys),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Failed to generate op',
              exitCode: 2,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    const data = yield* enqueueOps({
      ops: [op],
      priority: params.priority,
      clientId: params.clientId,
      idempotencyKey: params.idempotencyKey,
      meta: params.meta,
      notify: params.notify ?? true,
      ensureDaemon: params.ensureDaemon ?? true,
    });

    if (!params.wait) return data;
    const waited = yield* waitForTxn({ txnId: data.txn_id, timeoutMs: params.timeoutMs, pollMs: params.pollMs });
    return { ...data, ...waited };
  });
}

export function executeQueueTxnUseCase(params: {
  readonly txnId: string;
}): Effect.Effect<any, CliError, AppConfig | Queue> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;
    return yield* queue.inspect({ dbPath: cfg.storeDb, txnId: params.txnId });
  });
}

export function executeTriggerSyncUseCase(): Effect.Effect<any, CliError, AppConfig | WsClient> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    return yield* ws.triggerStartSync({ url: cfg.wsUrl, timeoutMs: 2000 });
  });
}

export function collectApiHealthUseCase(params: {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly basePath: string;
  readonly startedAt: number;
}): Effect.Effect<any, CliError, AppConfig | WsClient | Queue> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const queue = yield* Queue;

    const wsHealth = yield* ws.health({ url: cfg.wsUrl, timeoutMs: 2000 }).pipe(Effect.either);
    const clientsRes = yield* ws.queryClients({ url: cfg.wsUrl, timeoutMs: 2000 }).pipe(Effect.either);
    const queueStats = yield* queue.stats({ dbPath: cfg.storeDb }).pipe(Effect.either);

    return {
      api: { running: true, healthy: true, pid: params.pid, startedAt: params.startedAt },
      daemon: {
        running: wsHealth._tag === 'Right',
        healthy: wsHealth._tag === 'Right',
        wsUrl: cfg.wsUrl,
      },
      activeWorkerConnId: clientsRes._tag === 'Right' ? (clientsRes.right.activeWorkerConnId ?? null) : null,
      queue:
        queueStats._tag === 'Right'
          ? { pending: (queueStats.right as any).pending ?? 0, in_flight: (queueStats.right as any).in_flight ?? 0 }
          : { pending: 0, in_flight: 0 },
      localBaseUrl: apiLocalBaseUrl(params.port),
      containerBaseUrl: apiContainerBaseUrl(params.port),
      basePath: params.basePath,
      host: params.host,
      port: params.port,
    };
  });
}

export function collectApiStatusUseCase(params: {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly basePath: string;
  readonly startedAt: number;
}): Effect.Effect<any, CliError, AppConfig | WsClient | Queue> {
  return Effect.gen(function* () {
    const health = yield* collectApiHealthUseCase(params);
    const uiContext = loadBridgeUiContextSnapshot({ stateFile: undefined, staleMs: undefined, connId: undefined });
    const selection = loadBridgeSelectionSnapshot({ stateFile: undefined, staleMs: undefined, connId: undefined });

    return {
      ...health,
      uiContext,
      selection,
    };
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function pickTitle(kt: unknown, ke: unknown, r: unknown): string {
  const combined = [kt, ke].map(normalizeText).filter(Boolean).join(' | ');
  const raw = combined || normalizeText(r);
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const title = normalized.split(/\n| - |——|。|！|？|\.|: /)[0]?.trim() || normalized;
  return truncateText(title, 80);
}

function uniqueNonEmpty(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function fetchRemTitleMap(db: BetterSqliteInstance, ids: readonly string[]): Map<string, string> {
  const unique = uniqueNonEmpty(ids);
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT id, json_extract(doc, '$.kt') AS kt, json_extract(doc, '$.ke') AS ke, json_extract(doc, '$.r') AS r
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

type PortalKind = 'page' | 'portal' | 'unknown';

function computePortalKind(pageRemId: string, focusedPortalId: string): PortalKind {
  const pageId = pageRemId.trim();
  const portalId = focusedPortalId.trim();
  if (pageId && portalId && pageId === portalId) return 'page';
  if (portalId) return 'portal';
  if (pageId) return 'page';
  return 'unknown';
}

export function collectUiContextSnapshotUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, never> {
  return Effect.sync(() => loadBridgeUiContextSnapshot(params));
}

export function collectUiContextPageUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, CliError> {
  return Effect.gen(function* () {
    const snapshot = loadBridgeUiContextSnapshot(params);
    const ui = yield* requireOkUiContext(snapshot);
    const pageRemId = (ui.pageRemId || '').trim();
    if (!pageRemId) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'UI context has no pageRemId (not in page view, or the SDK did not provide it)',
          exitCode: 2,
          details: snapshot,
        }),
      );
    }
    return { page_rem_id: pageRemId, ui_context: ui, snapshot };
  });
}

export function collectUiContextFocusedRemUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, CliError> {
  return Effect.gen(function* () {
    const snapshot = loadBridgeUiContextSnapshot(params);
    const ui = yield* requireOkUiContext(snapshot);
    const focusedRemId = (ui.focusedRemId || '').trim();
    if (!focusedRemId) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'UI context has no focusedRemId (no Rem is currently focused)',
          exitCode: 2,
          details: snapshot,
        }),
      );
    }
    return { focused_rem_id: focusedRemId, ui_context: ui, snapshot };
  });
}

export function collectSelectionSnapshotUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, never> {
  return Effect.sync(() => loadBridgeSelectionSnapshot(params));
}

export function collectSelectionRootsUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, CliError> {
  return Effect.gen(function* () {
    const snapshot = loadBridgeSelectionSnapshot(params);
    const selection = yield* requireOkRemSelection(snapshot);
    const ids = selection.remIds.map(String);
    if (ids.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'No Rem is currently selected', exitCode: 2, details: snapshot }),
      );
    }
    return {
      selection_type: selection.selectionType,
      total_count: selection.totalCount,
      truncated: selection.truncated,
      ids,
    };
  });
}

export function collectPluginCurrentUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly selectionLimit?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | RemDb> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const remDb = yield* RemDb;

    const uiSnapshot = loadBridgeUiContextSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const selectionSnapshot = loadBridgeSelectionSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const ui = uiSnapshot.ui_context;
    const selection = selectionSnapshot.selection;

    const pageRemId = normalizeText(ui?.pageRemId);
    const focusedRemId = normalizeText(ui?.focusedRemId);
    const selectionKind = selection?.kind ?? 'none';
    const selectionIds =
      selection?.kind === 'rem'
        ? uniqueNonEmpty(selection.remIds.map(String))
        : selection?.kind === 'text'
          ? uniqueNonEmpty([selection.remId])
          : [];
    const selectionTotalCountRaw = selection?.kind === 'rem' ? Number(selection.totalCount ?? 0) : selection?.kind === 'text' ? 1 : 0;
    const selectionTotalCount = Number.isFinite(selectionTotalCountRaw) && selectionTotalCountRaw >= 0 ? Math.floor(selectionTotalCountRaw) : 0;
    const selectionTruncated = selection?.kind === 'rem' ? selection.truncated === true : false;

    const currentSource: 'selection' | 'focus' | 'page' | 'none' = selectionIds.length > 0 ? 'selection' : focusedRemId ? 'focus' : pageRemId ? 'page' : 'none';
    const currentId = currentSource === 'selection' ? selectionIds[0] ?? '' : currentSource === 'focus' ? focusedRemId : currentSource === 'page' ? pageRemId : '';

    const selectionLimitEffective = clampInt(params.selectionLimit ?? 5, 1, 20);
    const selectionShownIds = selectionIds.slice(0, selectionLimitEffective);
    const idsToResolve = uniqueNonEmpty([currentId, pageRemId, focusedRemId, ...selectionShownIds]);

    const warnings: string[] = [];
    const dbPathCandidate =
      cfg.remnoteDb ||
      (() => {
        const kbId = normalizeText(ui?.kbId);
        return kbId ? remnoteDbPathForWorkspaceId(kbId) : undefined;
      })();

    const titles = yield* Effect.gen(function* () {
      if (!dbPathCandidate || idsToResolve.length === 0) return new Map<string, string>();
      return yield* remDb.withDb(dbPathCandidate, async (db) => fetchRemTitleMap(db, idsToResolve)).pipe(
        Effect.map((r) => r.result),
        Effect.catchAll((e: CliError) =>
          Effect.sync(() => {
            warnings.push(e.message);
            return new Map<string, string>();
          }),
        ),
      );
    });

    return {
      page: pageRemId ? { id: pageRemId, title: titles.get(pageRemId) || undefined } : null,
      focus: focusedRemId ? { id: focusedRemId, title: titles.get(focusedRemId) || undefined } : null,
      current: currentId ? { source: currentSource, id: currentId, title: titles.get(currentId) || undefined } : { source: 'none', id: '', title: undefined },
      selection: {
        kind: selectionKind,
        total_count: selectionTotalCount,
        truncated: selectionTruncated,
        ids: selectionIds,
        shown: selectionShownIds.map((id) => ({ id, title: titles.get(id) || undefined })),
      },
      ui_snapshot: uiSnapshot,
      selection_snapshot: selectionSnapshot,
      ...(dbPathCandidate ? { remnote_db: dbPathCandidate } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
}

export function collectSelectionCurrentUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | RemDb> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const remDb = yield* RemDb;

    const selectionSnapshot = loadBridgeSelectionSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const selection = yield* requireOkRemSelection(selectionSnapshot);
    const ids = selection.remIds.map(String);
    if (ids.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'No Rem is currently selected', exitCode: 2, details: selectionSnapshot }),
      );
    }

    const uiSnapshot = loadBridgeUiContextSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const ui = uiSnapshot.ui_context;
    const pageRemId = normalizeText(ui?.pageRemId);
    const focusedRemId = normalizeText(ui?.focusedRemId);
    const currentId = ids[0] ?? '';

    const idsToResolve = uniqueNonEmpty([currentId, pageRemId, focusedRemId]);
    const warnings: string[] = [];
    const dbPathCandidate =
      cfg.remnoteDb ||
      (() => {
        const kbId = normalizeText(ui?.kbId);
        return kbId ? remnoteDbPathForWorkspaceId(kbId) : undefined;
      })();

    const titles = yield* Effect.gen(function* () {
      if (!dbPathCandidate || idsToResolve.length === 0) return new Map<string, string>();
      return yield* remDb.withDb(dbPathCandidate, async (db) => fetchRemTitleMap(db, idsToResolve)).pipe(
        Effect.map((r) => r.result),
        Effect.catchAll((e: CliError) =>
          Effect.sync(() => {
            warnings.push(e.message);
            return new Map<string, string>();
          }),
        ),
      );
    });

    return {
      selection_kind: selection.kind,
      selection_type: selection.selectionType,
      total_count: selection.totalCount,
      truncated: selection.truncated,
      ids,
      current: { id: currentId, title: titles.get(currentId) || undefined },
      page: pageRemId ? { id: pageRemId, title: titles.get(pageRemId) || undefined } : null,
      focus: focusedRemId ? { id: focusedRemId, title: titles.get(focusedRemId) || undefined } : null,
      selection_snapshot: selectionSnapshot,
      ui_snapshot: uiSnapshot,
      ...(dbPathCandidate ? { remnote_db: dbPathCandidate } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
}

export function collectSelectionOutlineUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly maxNodes?: number | undefined;
  readonly excludeProperties?: boolean | undefined;
  readonly includeEmpty?: boolean | undefined;
  readonly expandReferences?: boolean | undefined;
  readonly maxReferenceDepth?: number | undefined;
  readonly detail?: boolean | undefined;
}): Effect.Effect<any, CliError, AppConfig> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const snapshot = loadBridgeSelectionSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const selection = yield* requireOkRemSelection(snapshot);
    const rootIds = selection.remIds.map(String);

    if (rootIds.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'No Rem is currently selected', exitCode: 2, details: snapshot }),
      );
    }

    const maxTotalNodes =
      Number.isFinite(params.maxNodes) && typeof params.maxNodes === 'number' && params.maxNodes > 0
        ? Math.floor(params.maxNodes)
        : 1000;
    const maxDepthValue =
      Number.isFinite(params.maxDepth) && typeof params.maxDepth === 'number' && params.maxDepth >= 0
        ? Math.floor(params.maxDepth)
        : 10;

    let remaining = maxTotalNodes;
    let exported = 0;
    const roots: any[] = [];

    for (const rootId of rootIds) {
      if (remaining <= 0) break;
      const perRootMax = Math.max(1, Math.min(remaining, maxTotalNodes));
      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeOutlineRemSubtree({
            id: rootId,
            dbPath: cfg.remnoteDb,
            maxDepth: maxDepthValue as any,
            startOffset: 0,
            maxNodes: perRootMax as any,
            format: 'json',
            excludeProperties: params.excludeProperties === true,
            includeEmpty: params.includeEmpty === true,
            expandReferences: params.expandReferences === false ? false : undefined,
            maxReferenceDepth: params.maxReferenceDepth as any,
            detail: params.detail === true,
          } as any),
        catch: (e) =>
          cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE', details: { root_id: rootId, db_path: cfg.remnoteDb } }),
      });
      const nodeCount = Number((result as any).nodeCount ?? 0);
      const n = Number.isFinite(nodeCount) && nodeCount >= 0 ? Math.floor(nodeCount) : 0;
      exported += n;
      remaining -= n;
      roots.push(result);
    }

    const truncatedBySelection = selection.truncated || selection.totalCount > rootIds.length;
    const truncatedByBudget = exported >= maxTotalNodes && rootIds.length > roots.length;
    const truncatedByRoots = roots.some((r) => !!(r as any)?.hasMore);
    const truncated = truncatedBySelection || truncatedByBudget || truncatedByRoots;

    return {
      selection,
      params: {
        max_depth: maxDepthValue,
        max_nodes: maxTotalNodes,
        exclude_properties: params.excludeProperties === true,
        include_empty: params.includeEmpty === true,
        expand_references: params.expandReferences === false ? false : true,
        max_reference_depth: params.maxReferenceDepth,
        detail: params.detail === true,
      },
      exported_node_count: exported,
      truncated,
      roots,
    };
  });
}

export function collectUiContextDescribeUseCase(params: {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly selectionLimit?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | RemDb> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const remDb = yield* RemDb;

    const uiSnapshot = loadBridgeUiContextSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const selectionSnapshot = loadBridgeSelectionSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const ui = uiSnapshot.ui_context;
    const selection = selectionSnapshot.selection;

    const pageRemId = normalizeText(ui?.pageRemId);
    const focusedPortalId = normalizeText(ui?.focusedPortalId);
    const focusedRemId = normalizeText(ui?.focusedRemId);
    const kind = computePortalKind(pageRemId, focusedPortalId);

    const selectionKind = selection?.kind ?? 'none';
    const selectionIds = uniqueNonEmpty(selection?.kind === 'rem' ? selection.remIds.map(String) : []);
    const selectionTotalCountRaw =
      selection?.kind === 'rem' ? Number(selection.totalCount ?? 0) : selection?.kind === 'text' ? 1 : 0;
    const selectionTotalCount =
      Number.isFinite(selectionTotalCountRaw) && selectionTotalCountRaw >= 0 ? Math.floor(selectionTotalCountRaw) : 0;
    const selectionTruncated = selection?.kind === 'rem' ? selection.truncated === true : false;
    const selectionTextRemId = selection?.kind === 'text' ? normalizeText(selection.remId) : '';

    const anchorSource: 'focus' | 'selection' | 'none' = focusedRemId
      ? 'focus'
      : selection?.kind === 'rem' && selectionIds.length > 0
        ? 'selection'
        : selection?.kind === 'text' && selectionTextRemId
          ? 'selection'
          : 'none';
    const anchorRemId =
      anchorSource === 'focus'
        ? focusedRemId
        : anchorSource === 'selection'
          ? selection?.kind === 'rem'
            ? (selectionIds[0] ?? '')
            : selectionTextRemId
          : '';
    const selectionLimitEffective = clampInt(params.selectionLimit ?? 5, 1, 50);
    const selectionShownIds = selectionIds.slice(0, selectionLimitEffective);
    const idsToResolve = uniqueNonEmpty([pageRemId, focusedPortalId, focusedRemId, anchorRemId, ...selectionShownIds]);

    const warnings: string[] = [];
    const dbPathCandidate =
      cfg.remnoteDb ||
      (() => {
        const kbId = normalizeText(ui?.kbId);
        return kbId ? remnoteDbPathForWorkspaceId(kbId) : undefined;
      })();

    const titles = yield* Effect.gen(function* () {
      if (!dbPathCandidate || idsToResolve.length === 0) return new Map<string, string>();
      return yield* remDb
        .withDb(dbPathCandidate, async (db) => fetchRemTitleMap(db, idsToResolve))
        .pipe(
          Effect.map((r) => r.result),
          Effect.catchAll((e: CliError) =>
            Effect.sync(() => {
              warnings.push(e.message);
              return new Map<string, string>();
            }),
          ),
        );
    });

    const pageTitle = pageRemId ? titles.get(pageRemId) || '' : '';
    const portalEffectiveId = kind === 'page' ? pageRemId || focusedPortalId : focusedPortalId;
    const portalTitle =
      kind === 'page'
        ? pageRemId
          ? titles.get(pageRemId) || ''
          : ''
        : focusedPortalId
          ? titles.get(focusedPortalId) || ''
          : '';
    const focusTitle = focusedRemId ? titles.get(focusedRemId) || '' : '';
    const anchorTitle = anchorRemId ? titles.get(anchorRemId) || '' : '';

    return {
      uiContext: uiSnapshot.ui_context ?? null,
      selection: selectionSnapshot.selection ?? null,
      ui_snapshot: uiSnapshot,
      selection_snapshot: selectionSnapshot,
      anchor: { source: anchorSource, id: anchorRemId, title: anchorTitle || undefined },
      portal: { kind, id: portalEffectiveId, title: portalTitle || undefined },
      page: { id: pageRemId, title: pageTitle || undefined },
      focus: { id: focusedRemId, title: focusTitle || undefined },
      selection_items: {
        kind: selectionKind,
        total_count: selectionTotalCount,
        truncated: selectionTruncated,
        limit: selectionLimitEffective,
        shown: selectionShownIds.map((id) => ({ id, title: titles.get(id) || undefined })),
      },
      ...(dbPathCandidate ? { remnote_db: dbPathCandidate } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
}
