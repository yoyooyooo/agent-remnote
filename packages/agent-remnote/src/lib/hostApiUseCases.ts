import * as Effect from 'effect/Effect';

import {
  executeFindRemsByReference,
  executeOutlineRemSubtree,
  executeListRemReferences,
  executeResolveRemPage,
  executeResolveRemReference,
  executeSearchQuery,
  executeSearchRemOverview,
  formatDateWithPattern,
  getDateFormatting,
  type BetterSqliteInstance,
} from '../adapters/core.js';
import { listBackupArtifacts, openStoreDb } from '../internal/public.js';
import {
  loadBridgeSelectionSnapshot,
  requireOkRemSelection,
  requireStableSiblingRangeLocal,
} from './business-semantics/selectionResolution.js';
import { loadBridgeUiContextSnapshot, requireOkUiContext } from './business-semantics/uiContextResolution.js';
import { compileApplyEnvelope, parseApplyEnvelope } from '../commands/_applyEnvelope.js';
import { enqueueOps, normalizeOp } from '../commands/_enqueue.js';
import { validateOptionMutationOps } from '../commands/write/_optionRuntimeGuard.js';
import { resolveAnchorPlacement } from './business-semantics/placementResolution.js';
import { waitForTxn } from '../commands/_waitTxn.js';
import { WS_START_WAIT_DEFAULT_MS, ensureWsSupervisor } from '../commands/ws/_shared.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError, isCliError } from '../services/Errors.js';
import type { HostApiClient } from '../services/HostApiClient.js';
import { Payload } from '../services/Payload.js';
import { RemDb } from '../services/RemDb.js';
import { Queue } from '../services/Queue.js';
import { RefResolver } from '../services/RefResolver.js';
import { WorkspaceBindings } from '../services/WorkspaceBindings.js';
import { WsClient } from '../services/WsClient.js';
import { apiContainerBaseUrl, apiLocalBaseUrl } from './apiUrls.js';
import { currentExpectedPluginBuildInfo, pluginBuildWarnings } from './pluginBuildInfo.js';
import { currentRuntimeBuildInfo, runtimeVersionWarnings } from './runtimeBuildInfo.js';
import { dropBlankLinesOutsideFences, trimBoundaryBlankLines } from './text.js';
import { requireResolvedWorkspace, resolveWorkspaceSnapshot } from './workspaceResolver.js';
import { cliErrorFromUnknown } from '../commands/_tool.js';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseDateInput(raw: string): Date {
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const value = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(trimmed);
  if (Number.isNaN(value.getTime())) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid date: ${raw}`, exitCode: 2 });
  }
  if (
    match &&
    (value.getFullYear() !== Number(match[1]) ||
      value.getMonth() !== Number(match[2]) - 1 ||
      value.getDate() !== Number(match[3]))
  ) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid date: ${raw}`, exitCode: 2 });
  }
  return value;
}

function todayAtMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
}): Effect.Effect<any, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const effectiveTimeoutMs = clampInt(params.timeoutMs ?? 30_000, 1, 30_000);
    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({});
    return yield* Effect.tryPromise({
      try: async () =>
        await executeSearchRemOverview({
          query: params.query,
          dbPath: cfg.remnoteDb ?? workspace!.dbPath,
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

export function executeReadOutlineUseCase(params: {
  readonly id?: string | undefined;
  readonly ref?: string | undefined;
  readonly depth?: number | undefined;
  readonly offset?: number | undefined;
  readonly nodes?: number | undefined;
  readonly format?: 'md' | 'json' | undefined;
  readonly excludeProperties?: boolean | undefined;
  readonly includeEmpty?: boolean | undefined;
  readonly expandReferences?: boolean | undefined;
  readonly maxReferenceDepth?: number | undefined;
  readonly detail?: boolean | undefined;
}): Effect.Effect<any, CliError, AppConfig | HostApiClient | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    const cfg = yield* AppConfig;

    if (params.id && params.ref) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --id or --ref', exitCode: 2 }),
      );
    }

    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({ ref: params.ref });
    const resolvedId = params.ref
      ? yield* refs.resolve(params.ref, { dbPath: cfg.remnoteDb ?? workspace?.dbPath })
      : params.id;
    if (!resolvedId) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'You must provide --id or --ref', exitCode: 2 }),
      );
    }

    const activeBackupRemIds = yield* Effect.sync(() => {
      const db = openStoreDb(cfg.storeDb);
      try {
        return new Set(
          listBackupArtifacts(db, { includeCleaned: false, limit: 1000 })
            .map((item) => String(item.backup_rem_id ?? '').trim())
            .filter(Boolean),
        );
      } finally {
        db.close();
      }
    }).pipe(Effect.catchAll(() => Effect.succeed(new Set<string>())));

    const result = yield* Effect.tryPromise({
      try: async () =>
        await executeOutlineRemSubtree({
          id: resolvedId,
          dbPath: cfg.remnoteDb ?? workspace!.dbPath,
          maxDepth: params.depth as any,
          startOffset: params.offset as any,
          maxNodes: params.nodes as any,
          format: 'json',
          excludeProperties: params.excludeProperties === true,
          includeEmpty: params.includeEmpty === true,
          expandReferences: params.expandReferences === false ? false : undefined,
          maxReferenceDepth: params.maxReferenceDepth as any,
          detail: true,
        } as any),
      catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
    });

    if (activeBackupRemIds.size === 0) {
      if (params.format === 'json') return result;
      const tree = Array.isArray((result as any).tree) ? (result as any).tree : [];
      return {
        ...(result as any),
        markdown: outlineNodesToMarkdown(tree),
        ...(params.detail === true ? {} : { tree: simplifyOutlineTree(tree) }),
      };
    }

    const tree = Array.isArray((result as any).tree) ? (result as any).tree : [];
    const filteredTree = filterOutlineTreeByHiddenBackupSubtrees(tree, activeBackupRemIds, resolvedId);

    const filtered = {
      ...(result as any),
      nodeCount: filteredTree.length,
      totalNodeCount: filteredTree.length,
      hasMore: Boolean((result as any).hasMore),
      nextOffset: (result as any).nextOffset ?? null,
      markdown: outlineNodesToMarkdown(filteredTree),
      tree: params.detail === true ? filteredTree : simplifyOutlineTree(filteredTree),
    };

    if (params.format === 'json') return filtered;
    return filtered;
  });
}

export function executeReadPageIdUseCase(params: {
  readonly ref?: string | undefined;
  readonly ids?: readonly string[] | undefined;
  readonly maxHops?: number | undefined;
  readonly detail?: boolean | undefined;
}): Effect.Effect<any, CliError, AppConfig | HostApiClient | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    const cfg = yield* AppConfig;

    const ref = typeof params.ref === 'string' && params.ref.trim() ? params.ref.trim() : undefined;
    const ids = Array.isArray(params.ids) ? params.ids.map((value) => String(value).trim()).filter(Boolean) : [];
    if ((ref ? 1 : 0) + (ids.length > 0 ? 1 : 0) !== 1) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'You must provide exactly one input: --ref or --id (repeatable)',
          exitCode: 2,
          hint: [
            'Example: agent-remnote rem page-id --id <remId>',
            'Example: agent-remnote rem page-id --ref "id:<remId>"',
          ],
        }),
      );
    }

    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({ ref });
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;
    const resolvedIds = ref ? [yield* refs.resolve(ref, { dbPath })] : ids;
    if (resolvedIds.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Provide at least one Rem ID via --id', exitCode: 2 }),
      );
    }

    return yield* Effect.tryPromise({
      try: async () =>
        await executeResolveRemPage({
          ids: resolvedIds,
          dbPath,
          maxHops: params.maxHops as any,
          detail: params.detail,
        } as any),
      catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
    });
  });
}

export function executeResolveRefUseCase(params: {
  readonly ids: readonly string[];
  readonly expandReferences?: boolean | undefined;
  readonly maxReferenceDepth?: number | undefined;
  readonly detail?: boolean | undefined;
}): Effect.Effect<any, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ids = params.ids.map((value) => String(value).trim()).filter(Boolean);
    if (ids.length === 0) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Provide at least one Rem ID via --ids',
          exitCode: 2,
        }),
      );
    }

    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({});
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;

    return yield* Effect.tryPromise({
      try: async () =>
        await executeResolveRemReference({
          ids,
          dbPath,
          expandReferences: params.expandReferences === false ? false : undefined,
          maxReferenceDepth: params.maxReferenceDepth as any,
          detail: params.detail,
        } as any),
      catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
    });
  });
}

export function executeResolveRefValueUseCase(params: {
  readonly ref: string;
}): Effect.Effect<{ readonly remId: string }, CliError, AppConfig | HostApiClient | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    const remId = yield* refs.resolve(params.ref);
    return { remId };
  });
}

export function executeResolvePlacementUseCase(params: {
  readonly spec: { readonly kind: 'before' | 'after'; readonly anchorRef: string };
}): Effect.Effect<{ readonly kind: 'before' | 'after'; readonly parentId: string; readonly position: number }, CliError, AppConfig | HostApiClient | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const resolved =
      params.spec.kind === 'before'
        ? yield* resolveAnchorPlacement({ anchorRef: params.spec.anchorRef, offset: 0 })
        : yield* resolveAnchorPlacement({ anchorRef: params.spec.anchorRef, offset: 1 });

    return {
      kind: params.spec.kind,
      parentId: resolved.parentId,
      position: resolved.position,
    } as const;
  });
}

export function executeResolveStableSiblingRangeUseCase(params: {
  readonly remIds: readonly string[];
  readonly missingMessage?: string | undefined;
  readonly mismatchMessage?: string | undefined;
}): Effect.Effect<
  { readonly orderedRemIds: readonly string[]; readonly parentId: string; readonly position: number },
  CliError,
  AppConfig | RemDb | WorkspaceBindings
> {
  return requireStableSiblingRangeLocal({
    remIds: params.remIds,
    missingMessage: params.missingMessage?.trim() || 'Selection refs could not be fully resolved from the local RemNote DB',
    mismatchMessage:
      params.mismatchMessage?.trim() ||
      'Selection refs must resolve to contiguous sibling Rems under the same parent',
  });
}

export function executeByReferenceUseCase(params: {
  readonly reference: readonly string[];
  readonly timeRange?: string | undefined;
  readonly maxDepth?: number | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const references = params.reference.map((value) => String(value).trim()).filter(Boolean);
    if (references.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Provide at least one Rem ID via --reference', exitCode: 2 }),
      );
    }

    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({});
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;

    return yield* Effect.tryPromise({
      try: async () =>
        await executeFindRemsByReference({
          targetIds: references,
          dbPath,
          timeRange: params.timeRange as any,
          maxDepth: params.maxDepth as any,
          limit: params.limit as any,
          offset: params.offset as any,
        } as any),
      catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
    });
  });
}

export function executeReferencesUseCase(params: {
  readonly id: string;
  readonly includeDescendants?: boolean | undefined;
  readonly maxDepth?: number | undefined;
  readonly includeOccurrences?: boolean | undefined;
  readonly resolveText?: boolean | undefined;
  readonly includeInbound?: boolean | undefined;
  readonly inboundMaxDepth?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({});
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;
    const { payload } = yield* Effect.tryPromise({
      try: async () =>
        await executeListRemReferences({
          id: params.id,
          dbPath,
          includeDescendants: params.includeDescendants,
          maxDepth: params.maxDepth as any,
          includeOccurrences: params.includeOccurrences,
          resolveText: params.resolveText === false ? false : undefined,
          includeInbound: params.includeInbound,
          inboundMaxDepth: params.inboundMaxDepth as any,
        } as any),
      catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
    });
    return payload;
  });
}

export function executeQueryUseCase(params: {
  readonly queryObj: Record<string, unknown>;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly snippetLength?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({});
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;
    const { payload } = yield* Effect.tryPromise({
      try: async () =>
        await executeSearchQuery({
          ...params.queryObj,
          dbPath,
          limit: params.limit as any,
          offset: params.offset as any,
          snippetLength: params.snippetLength as any,
        } as any),
      catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
    });
    return payload;
  });
}

function filterOutlineTreeByHiddenBackupSubtrees(
  tree: readonly any[],
  hiddenIds: ReadonlySet<string>,
  rootId: string,
): readonly any[] {
  const out: any[] = [];
  let skipDepth: number | null = null;

  for (const node of tree) {
    const depth = Number(node?.depth ?? 0);
    if (skipDepth !== null) {
      if (depth > skipDepth) continue;
      skipDepth = null;
    }

    const id = typeof node?.id === 'string' ? node.id : '';
    if (id && id !== rootId && hiddenIds.has(id)) {
      skipDepth = depth;
      continue;
    }

    out.push(node);
  }

  return out;
}

function outlineNodesToMarkdown(nodes: readonly any[]): string {
  return nodes
    .map((node) => {
      const depth = Number(node?.depth ?? 0);
      const text = typeof node?.text === 'string' && node.text.trim() ? node.text : '(empty)';
      return `${'  '.repeat(Math.max(0, depth))}- ${text}`;
    })
    .join('\n');
}

function simplifyOutlineTree(nodes: readonly any[]) {
  return nodes.map((node) => ({
    id: node.id,
    depth: node.depth,
    kind: node.kind,
    text: node.text,
    target: node.target ?? null,
    references: Array.isArray(node.references) ? node.references : [],
  }));
}

export function executeDailyRemIdUseCase(params: {
  readonly date?: string | undefined;
  readonly offsetDays?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | HostApiClient | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    if (params.date && params.offsetDays !== undefined) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --date or --offset-days', exitCode: 2 }),
      );
    }

    const refs = yield* RefResolver;
    const remDb = yield* RemDb;
    const cfg = yield* AppConfig;
    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({});
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;

    let ref = `daily:${params.offsetDays ?? 0}`;
    let remId = '';
    let dateString: string | undefined;

    if (params.date) {
      const target = parseDateInput(params.date);
      dateString = yield* remDb
        .withDb(dbPath, async (db) => {
          const format = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';
          return formatDateWithPattern(target, format);
        })
        .pipe(
          Effect.map((result) => result.result),
          Effect.catchAll(() => Effect.succeed(formatDateWithPattern(target, 'yyyy/MM/dd'))),
        );

      const result = yield* Effect.tryPromise({
        try: async () =>
          await executeSearchRemOverview({
            query: dateString,
            dbPath,
            limit: 1,
            preferExact: true,
            exactFirstSingle: true,
            excludePages: true,
          } as any),
        catch: (error) => cliErrorFromUnknown(error, { code: 'DB_UNAVAILABLE' }),
      });

      const first = Array.isArray((result as any).matches) ? (result as any).matches[0] : undefined;
      remId = first?.id ? String(first.id) : '';
      ref = `daily:${params.date}`;
      if (!remId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: `No Daily Rem found for date: ${params.date}`,
            exitCode: 2,
          }),
        );
      }
    } else {
      const offset = params.offsetDays ?? 0;
      ref = `daily:${offset}`;
      remId = yield* refs.resolve(ref, { dbPath });
      const target = todayAtMidnight();
      target.setDate(target.getDate() + offset);
      dateString = yield* remDb
        .withDb(dbPath, async (db) => {
          const format = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';
          return formatDateWithPattern(target, format);
        })
        .pipe(
          Effect.map((result) => result.result),
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
    }

    return { ref, remId, dateString };
  });
}

export function executeWriteApplyUseCase(params: {
  readonly raw: unknown;
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly meta?: unknown;
  readonly notify?: boolean | undefined;
  readonly ensureDaemon?: boolean | undefined;
  readonly wait?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
}): Effect.Effect<any, CliError, AppConfig | Queue | Payload | WsClient | RefResolver | RemDb | any> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const payloadSvc = yield* Payload;

    const parsed = yield* Effect.try({
      try: () => parseApplyEnvelope(payloadSvc.normalizeKeys(params.raw)),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid apply envelope',
              exitCode: 2,
            }),
    });

    const compiled = yield* compileApplyEnvelope(parsed);
    yield* validateOptionMutationOps({ scopeLabel: 'generic', ops: compiled.ops });
    if (compiled.ops.length > 500) {
      return yield* Effect.fail(
        new CliError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `Too many ops (${compiled.ops.length}); split the request and try again`,
          exitCode: 2,
          details: { ops: compiled.ops.length, max_ops: 500 },
        }),
      );
    }

    const data = yield* enqueueOps({
      ops: compiled.ops,
      priority: params.priority ?? compiled.priority,
      clientId: params.clientId ?? compiled.clientId,
      idempotencyKey: params.idempotencyKey ?? compiled.idempotencyKey,
      meta: params.meta ?? compiled.meta,
      notify: params.notify ?? compiled.notify ?? true,
      ensureDaemon: params.ensureDaemon ?? compiled.ensureDaemon ?? true,
    });
    if (!params.wait) {
      return compiled.kind === 'actions' ? { ...data, alias_map: compiled.aliasMap } : data;
    }
    const waited = yield* waitForTxn({ txnId: data.txn_id, timeoutMs: params.timeoutMs, pollMs: params.pollMs });
    const out = { ...data, ...waited };
    return compiled.kind === 'actions' ? { ...out, alias_map: compiled.aliasMap } : out;
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
    const cfg = yield* AppConfig;
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

    const workspace = cfg.remnoteDb ? undefined : params.ref ? yield* requireResolvedWorkspace({ ref: params.ref }) : undefined;
    const parentId = params.ref
      ? yield* Effect.gen(function* () {
          const refs = yield* RefResolver;
          return yield* refs.resolve(params.ref!, { dbPath: cfg.remnoteDb ?? workspace?.dbPath });
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
      runtime: currentRuntimeBuildInfo(),
      api: { running: true, healthy: true, pid: params.pid, startedAt: params.startedAt, build: currentRuntimeBuildInfo() },
      daemon: {
        running: wsHealth._tag === 'Right',
        healthy: wsHealth._tag === 'Right',
        wsUrl: cfg.wsUrl,
        build: null,
      },
      activeWorkerConnId: clientsRes._tag === 'Right' ? (clientsRes.right.activeWorkerConnId ?? null) : null,
      clients: clientsRes._tag === 'Right' ? clientsRes.right.clients : [],
      queue:
        queueStats._tag === 'Right'
          ? {
              available: true,
              pending: (queueStats.right as any).pending ?? 0,
              in_flight: (queueStats.right as any).in_flight ?? 0,
            }
          : { available: false, pending: 0, in_flight: 0 },
      localBaseUrl: apiLocalBaseUrl(params.port, params.basePath),
      containerBaseUrl: apiContainerBaseUrl(params.port, params.basePath),
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
}): Effect.Effect<any, CliError, AppConfig | WsClient | Queue | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const health = yield* collectApiHealthUseCase(params);
    const uiContext = loadBridgeUiContextSnapshot({ stateFile: undefined, staleMs: undefined, connId: undefined });
    const selection = loadBridgeSelectionSnapshot({ stateFile: undefined, staleMs: undefined, connId: undefined });
    const workspaceResolution = yield* resolveWorkspaceSnapshot({});
    const pluginRpcReady = health.daemon.healthy === true && typeof health.activeWorkerConnId === 'string' && health.activeWorkerConnId.length > 0;
    const uiSessionReady = uiContext.status === 'ok' || selection.status === 'ok';
    const effectiveDbPath = workspaceResolution.dbPath ?? cfg.remnoteDb ?? null;
    const dbReadReady = workspaceResolution.resolved === true || !!cfg.remnoteDb;
    const queueReady = health.queue?.available === true;
    const writeReady = queueReady && pluginRpcReady;
    const bindingSource =
      workspaceResolution.bindingSource ??
      (cfg.remnoteDb ? 'config' : workspaceResolution.source === 'unresolved' ? undefined : workspaceResolution.source);

    const activeWorkerRuntime =
      typeof health.activeWorkerConnId === 'string' && Array.isArray((health as any)?.clients)
        ? (((health as any).clients as any[]).find((client: any) => client.connId === health.activeWorkerConnId)?.runtime ??
          null)
        : null;

    const warnings = [
      ...runtimeVersionWarnings({
        current: currentRuntimeBuildInfo(),
      }) as string[],
      ...pluginBuildWarnings({
        expected: currentExpectedPluginBuildInfo(),
        live: activeWorkerRuntime,
      }),
    ];
    if (health.api?.running === true && !(health as any)?.api?.build) {
      warnings.push('host api state has no build info; restart the api service to refresh runtime metadata');
    }
    if (health.activeWorkerConnId && !activeWorkerRuntime) {
      warnings.push('active worker did not report runtime metadata; reload the RemNote plugin');
    }

    return {
      ...health,
      capabilities: {
        db_read_ready: dbReadReady,
        plugin_rpc_ready: pluginRpcReady,
        write_ready: writeReady,
        ui_session_ready: uiSessionReady,
      },
      workspace: {
        resolved: workspaceResolution.resolved,
        currentWorkspaceId: workspaceResolution.workspaceId ?? null,
        currentDbPath: effectiveDbPath,
        bindingSource: bindingSource ?? null,
        resolutionSource: cfg.remnoteDb && workspaceResolution.resolved !== true ? 'config' : workspaceResolution.source,
        candidateWorkspaces: workspaceResolution.candidates,
        reasons: workspaceResolution.reasons,
      },
      plugin: {
        ws_healthy: health.daemon.healthy,
        active_worker_conn_id: health.activeWorkerConnId,
        active_worker: health.activeWorkerConnId
          ? {
              conn_id: health.activeWorkerConnId,
              runtime: activeWorkerRuntime,
            }
          : null,
      },
      write: {
        daemon_ready: health.daemon.healthy,
        queue_ready: queueReady,
        worker_ready: pluginRpcReady,
      },
      uiContext,
      selection,
      warnings,
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
}): Effect.Effect<any, CliError, AppConfig | RemDb | WorkspaceBindings> {
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
    const workspace = yield* resolveWorkspaceSnapshot({
      stateFile: params.stateFile,
      staleMs: params.staleMs,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const dbPathCandidate = cfg.remnoteDb ?? (workspace?.resolved ? workspace.dbPath : undefined);

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
}): Effect.Effect<any, CliError, AppConfig | RemDb | WorkspaceBindings> {
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
    const workspace = yield* resolveWorkspaceSnapshot({
      stateFile: params.stateFile,
      staleMs: params.staleMs,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const dbPathCandidate = cfg.remnoteDb ?? (workspace?.resolved ? workspace.dbPath : undefined);

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
}): Effect.Effect<any, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const snapshot = loadBridgeSelectionSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    const selection = yield* requireOkRemSelection(snapshot);
    const workspace = cfg.remnoteDb ? undefined : yield* requireResolvedWorkspace({ stateFile: params.stateFile, staleMs: params.staleMs });
    const dbPath = cfg.remnoteDb ?? workspace!.dbPath;
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
            dbPath,
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
          cliErrorFromUnknown(e, {
            code: 'DB_UNAVAILABLE',
            details: {
              root_id: rootId,
              db_path: dbPath,
              workspace_id: workspace?.workspaceId,
            },
          }),
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
}): Effect.Effect<any, CliError, AppConfig | RemDb | WorkspaceBindings> {
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
    const workspace = yield* resolveWorkspaceSnapshot({
      stateFile: params.stateFile,
      staleMs: params.staleMs,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const dbPathCandidate = cfg.remnoteDb ?? (workspace?.resolved ? workspace.dbPath : undefined);

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
