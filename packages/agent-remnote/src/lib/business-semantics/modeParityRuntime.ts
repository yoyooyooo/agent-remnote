import * as Effect from 'effect/Effect';

import { waitForTxn, type WaitTxnResult } from '../../commands/_waitTxn.js';
import { tryParseRemnoteLink } from '../remnote.js';
import {
  executeDbSearchUseCase,
  executeByReferenceUseCase,
  executeDailyRemIdUseCase,
  executePluginSearchUseCase,
  executeQueryUseCase,
  executeReadOutlineUseCase,
  executeReadPageIdUseCase,
  executeReferencesUseCase,
  executeResolveRefUseCase,
  executeWriteApplyUseCase,
  collectPluginCurrentUseCase,
  collectSelectionCurrentUseCase,
  collectSelectionOutlineUseCase,
  collectSelectionRootsUseCase,
  collectSelectionSnapshotUseCase,
  collectUiContextDescribeUseCase,
  collectUiContextFocusedRemUseCase,
  collectUiContextPageUseCase,
  collectUiContextSnapshotUseCase,
} from '../hostApiUseCases.js';
import { AppConfig } from '../../services/AppConfig.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { CliError, type CliError as CliErrorType } from '../../services/Errors.js';
import { Queue } from '../../services/Queue.js';
import { RefResolver } from '../../services/RefResolver.js';

export const modeParityCapabilityIds = [
  'resolve.ref',
  'search.db',
  'search.plugin',
  'read.outline',
  'read.page-id',
  'read.by-reference',
  'read.references',
  'read.resolve-ref',
  'read.query',
  'daily.rem-id',
  'plugin.current',
  'ui-context.snapshot',
  'ui-context.page',
  'ui-context.focused-rem',
  'ui-context.describe',
  'selection.current',
  'selection.snapshot',
  'selection.roots',
  'selection.outline',
  'write.apply',
  'queue.txn',
  'queue.wait',
] as const;

export type ModeParityCapabilityId = (typeof modeParityCapabilityIds)[number];
export type ModeParityMode = 'local' | 'remote';
export type ModeParityCapabilityHandler = (input: unknown) => Effect.Effect<unknown, CliErrorType, any>;

export type ModeParityAdapter = {
  readonly mode: ModeParityMode;
  readonly handlers: Readonly<Partial<Record<ModeParityCapabilityId, ModeParityCapabilityHandler>>>;
};

export type ModeParityRuntime = {
  readonly mode: ModeParityMode;
  readonly supports: (capability: ModeParityCapabilityId) => boolean;
  readonly invoke: (capability: ModeParityCapabilityId, input: unknown) => Effect.Effect<unknown, CliErrorType, any>;
  readonly adapter: ModeParityAdapter;
};

export function createModeParityAdapter(
  mode: ModeParityMode,
  handlers: Partial<Record<ModeParityCapabilityId, ModeParityCapabilityHandler>>,
): ModeParityAdapter {
  return {
    mode,
    handlers: Object.freeze({ ...handlers }),
  };
}

export function createModeParityRuntime(adapter: ModeParityAdapter): ModeParityRuntime {
  return {
    mode: adapter.mode,
    supports: (capability) => typeof adapter.handlers[capability] === 'function',
    invoke: (capability, input) => {
      const handler = adapter.handlers[capability];
      if (!handler) {
        return Effect.fail(
          new CliError({
            code: 'INTERNAL',
            message: `ModeParityRuntime capability is unavailable: ${capability}`,
            exitCode: 1,
          }),
        );
      }
      return handler(input);
    },
    adapter,
  };
}

type SearchDbCapabilityInput = {
  readonly query: string;
  readonly timeRange?: string | undefined;
  readonly parentId?: string | undefined;
  readonly pagesOnly?: boolean | undefined;
  readonly excludePages?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly timeoutMs?: number | undefined;
};

type WriteApplyCapabilityInput = {
  readonly body: unknown;
  readonly wait?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
};

type QueueWaitCapabilityInput = {
  readonly txnId: string;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
};

type QueueTxnCapabilityInput = {
  readonly txnId: string;
};

type ResolveRefCapabilityInput = {
  readonly ref: string;
};

function normalizeDirectRemoteRef(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;

  const idx = trimmed.indexOf(':');
  if (idx <= 0) return undefined;
  const prefix = trimmed.slice(0, idx).trim().toLowerCase();
  if (prefix !== 'id') return undefined;

  const value = trimmed.slice(idx + 1).trim();
  return value || undefined;
}

type ReadOutlineCapabilityInput = {
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
};

type ReadPageIdCapabilityInput = {
  readonly ref?: string | undefined;
  readonly ids?: readonly string[] | undefined;
  readonly maxHops?: number | undefined;
  readonly detail?: boolean | undefined;
};

type ReadByReferenceCapabilityInput = {
  readonly reference: readonly string[];
  readonly timeRange?: string | undefined;
  readonly maxDepth?: number | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
};

type ReadReferencesCapabilityInput = {
  readonly id: string;
  readonly includeDescendants?: boolean | undefined;
  readonly maxDepth?: number | undefined;
  readonly includeOccurrences?: boolean | undefined;
  readonly resolveText?: boolean | undefined;
  readonly includeInbound?: boolean | undefined;
  readonly inboundMaxDepth?: number | undefined;
};

type ReadResolveRefCapabilityInput = {
  readonly ids: readonly string[];
  readonly expandReferences?: boolean | undefined;
  readonly maxReferenceDepth?: number | undefined;
  readonly detail?: boolean | undefined;
};

type ReadQueryCapabilityInput = {
  readonly queryObj: Record<string, unknown>;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly snippetLength?: number | undefined;
};

type DailyRemIdCapabilityInput = {
  readonly date?: string | undefined;
  readonly offsetDays?: number | undefined;
};

type PluginSearchCapabilityInput = {
  readonly query: string;
  readonly searchContextRemId?: string | undefined;
  readonly limit?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly ensureDaemon?: boolean | undefined;
};

type PluginCurrentCapabilityInput = {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly selectionLimit?: number | undefined;
};

type UiContextCapabilityInput = {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
};

type UiContextDescribeCapabilityInput = {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly selectionLimit?: number | undefined;
};

type SelectionOutlineCapabilityInput = {
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly maxNodes?: number | undefined;
  readonly excludeProperties?: boolean | undefined;
  readonly includeEmpty?: boolean | undefined;
  readonly expandReferences?: boolean | undefined;
  readonly maxReferenceDepth?: number | undefined;
  readonly detail?: boolean | undefined;
};

export function resolveWave1ModeParityRuntime(): Effect.Effect<
  ModeParityRuntime,
  never,
  AppConfig | HostApiClient | Queue | RefResolver
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const hostApi = yield* HostApiClient;
    const queue = yield* Queue;
    const refs = yield* RefResolver;

    const local = createModeParityAdapter('local', {
      'resolve.ref': (input) => {
        const params = input as ResolveRefCapabilityInput;
        return refs.resolve(params.ref);
      },
      'search.db': (input) => {
        const params = input as SearchDbCapabilityInput;
        return executeDbSearchUseCase(params);
      },
      'read.outline': (input) => {
        const params = input as ReadOutlineCapabilityInput;
        return executeReadOutlineUseCase(params);
      },
      'read.page-id': (input) => {
        const params = input as ReadPageIdCapabilityInput;
        return executeReadPageIdUseCase(params);
      },
      'read.by-reference': (input) => {
        const params = input as ReadByReferenceCapabilityInput;
        return executeByReferenceUseCase(params);
      },
      'read.references': (input) => {
        const params = input as ReadReferencesCapabilityInput;
        return executeReferencesUseCase(params);
      },
      'read.resolve-ref': (input) => {
        const params = input as ReadResolveRefCapabilityInput;
        return executeResolveRefUseCase(params);
      },
      'read.query': (input) => {
        const params = input as ReadQueryCapabilityInput;
        return executeQueryUseCase(params);
      },
      'daily.rem-id': (input) => {
        const params = input as DailyRemIdCapabilityInput;
        return executeDailyRemIdUseCase(params);
      },
      'search.plugin': (input) => {
        const params = input as PluginSearchCapabilityInput;
        return executePluginSearchUseCase(params);
      },
      'plugin.current': (input) => {
        const params = input as PluginCurrentCapabilityInput;
        return collectPluginCurrentUseCase(params);
      },
      'ui-context.snapshot': (input) => {
        const params = input as UiContextCapabilityInput;
        return collectUiContextSnapshotUseCase(params);
      },
      'ui-context.page': (input) => {
        const params = input as UiContextCapabilityInput;
        return collectUiContextPageUseCase(params);
      },
      'ui-context.focused-rem': (input) => {
        const params = input as UiContextCapabilityInput;
        return collectUiContextFocusedRemUseCase(params);
      },
      'ui-context.describe': (input) => {
        const params = input as UiContextDescribeCapabilityInput;
        return collectUiContextDescribeUseCase(params);
      },
      'selection.current': (input) => {
        const params = input as UiContextCapabilityInput;
        return collectSelectionCurrentUseCase(params);
      },
      'selection.snapshot': (input) => {
        const params = input as UiContextCapabilityInput;
        return collectSelectionSnapshotUseCase(params);
      },
      'selection.roots': (input) => {
        const params = input as UiContextCapabilityInput;
        return collectSelectionRootsUseCase(params);
      },
      'selection.outline': (input) => {
        const params = input as SelectionOutlineCapabilityInput;
        return collectSelectionOutlineUseCase(params);
      },
      'write.apply': (input) => {
        const params = input as WriteApplyCapabilityInput;
        return executeWriteApplyUseCase({
          raw: params.body,
          wait: params.wait,
          timeoutMs: params.timeoutMs,
          pollMs: params.pollMs,
        });
      },
      'queue.txn': (input) => {
        const params = input as QueueTxnCapabilityInput;
        return queue.inspect({ dbPath: cfg.storeDb, txnId: params.txnId });
      },
      'queue.wait': (input) => {
        const params = input as QueueWaitCapabilityInput;
        return waitForTxn({
          txnId: params.txnId,
          timeoutMs: params.timeoutMs,
          pollMs: params.pollMs,
        });
      },
    });

    const remote = createModeParityAdapter('remote', {
      'resolve.ref': (input) => {
        const params = input as ResolveRefCapabilityInput;
        return Effect.gen(function* () {
          const direct = normalizeDirectRemoteRef(params.ref);
          if (direct) return direct;
          const resolved = yield* hostApi.resolveRefValue({
            baseUrl: cfg.apiBaseUrl!,
            body: { ref: params.ref },
          });
          return String((resolved as any)?.remId ?? '');
        });
      },
      'search.db': (input) => {
        const params = input as SearchDbCapabilityInput;
        return hostApi.searchDb({
          baseUrl: cfg.apiBaseUrl!,
          query: params.query,
          timeRange: params.timeRange,
          parentId: params.parentId,
          pagesOnly: params.pagesOnly,
          excludePages: params.excludePages,
          limit: params.limit,
          offset: params.offset,
          timeoutMs: params.timeoutMs,
        });
      },
      'read.outline': (input) => {
        const params = input as ReadOutlineCapabilityInput;
        return hostApi.readOutline({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            id: params.id,
            ref: params.ref,
            depth: params.depth,
            offset: params.offset,
            nodes: params.nodes,
            format: params.format,
            excludeProperties: params.excludeProperties,
            includeEmpty: params.includeEmpty,
            expandReferences: params.expandReferences,
            maxReferenceDepth: params.maxReferenceDepth,
            detail: params.detail,
          },
        });
      },
      'read.page-id': (input) => {
        const params = input as ReadPageIdCapabilityInput;
        return hostApi.readPageId({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            ...(params.ref ? { ref: params.ref } : { ids: params.ids }),
            ...(params.maxHops !== undefined ? { maxHops: params.maxHops } : {}),
            detail: params.detail,
          },
        });
      },
      'read.by-reference': (input) => {
        const params = input as ReadByReferenceCapabilityInput;
        return hostApi.byReference({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            reference: params.reference,
            timeRange: params.timeRange,
            maxDepth: params.maxDepth,
            limit: params.limit,
            offset: params.offset,
          },
        });
      },
      'read.references': (input) => {
        const params = input as ReadReferencesCapabilityInput;
        return hostApi.references({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            id: params.id,
            includeDescendants: params.includeDescendants,
            maxDepth: params.maxDepth,
            includeOccurrences: params.includeOccurrences,
            resolveText: params.resolveText,
            includeInbound: params.includeInbound,
            inboundMaxDepth: params.inboundMaxDepth,
          },
        });
      },
      'read.resolve-ref': (input) => {
        const params = input as ReadResolveRefCapabilityInput;
        return hostApi.resolveRef({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            ids: params.ids,
            expandReferences: params.expandReferences,
            maxReferenceDepth: params.maxReferenceDepth,
            detail: params.detail,
          },
        });
      },
      'read.query': (input) => {
        const params = input as ReadQueryCapabilityInput;
        return hostApi.query({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            queryObj: params.queryObj,
            limit: params.limit,
            offset: params.offset,
            snippetLength: params.snippetLength,
          },
        });
      },
      'daily.rem-id': (input) => {
        const params = input as DailyRemIdCapabilityInput;
        return hostApi.dailyRemId({
          baseUrl: cfg.apiBaseUrl!,
          date: params.date,
          offsetDays: params.offsetDays,
        });
      },
      'search.plugin': (input) => {
        const params = input as PluginSearchCapabilityInput;
        return hostApi.searchPlugin({
          baseUrl: cfg.apiBaseUrl!,
          query: params.query,
          searchContextRemId: params.searchContextRemId,
          limit: params.limit,
          timeoutMs: params.timeoutMs,
          ensureDaemon: params.ensureDaemon,
        });
      },
      'plugin.current': (input) => {
        const params = input as PluginCurrentCapabilityInput;
        return hostApi.pluginCurrent({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
          selectionLimit: params.selectionLimit,
        });
      },
      'ui-context.snapshot': (input) => {
        const params = input as UiContextCapabilityInput;
        return hostApi.uiContextSnapshot({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
        });
      },
      'ui-context.page': (input) => {
        const params = input as UiContextCapabilityInput;
        return hostApi.uiContextPage({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
        });
      },
      'ui-context.focused-rem': (input) => {
        const params = input as UiContextCapabilityInput;
        return hostApi.uiContextFocusedRem({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
        });
      },
      'ui-context.describe': (input) => {
        const params = input as UiContextDescribeCapabilityInput;
        return hostApi.uiContextDescribe({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
          selectionLimit: params.selectionLimit,
        });
      },
      'selection.current': (input) => {
        const params = input as UiContextCapabilityInput;
        return hostApi.selectionCurrent({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
        });
      },
      'selection.snapshot': (input) => {
        const params = input as UiContextCapabilityInput;
        return hostApi.selectionSnapshot({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
        });
      },
      'selection.roots': (input) => {
        const params = input as UiContextCapabilityInput;
        return hostApi.selectionRoots({
          baseUrl: cfg.apiBaseUrl!,
          stateFile: params.stateFile,
          staleMs: params.staleMs,
        });
      },
      'selection.outline': (input) => {
        const params = input as SelectionOutlineCapabilityInput;
        return hostApi.selectionOutline({
          baseUrl: cfg.apiBaseUrl!,
          body: {
            stateFile: params.stateFile,
            staleMs: params.staleMs,
            maxDepth: params.maxDepth,
            maxNodes: params.maxNodes,
            excludeProperties: params.excludeProperties,
            includeEmpty: params.includeEmpty,
            expandReferences: params.expandReferences,
            maxReferenceDepth: params.maxReferenceDepth,
            detail: params.detail,
          },
        });
      },
      'write.apply': (input) => {
        const params = input as WriteApplyCapabilityInput;
        return Effect.gen(function* () {
          const data = yield* hostApi.writeApply({
            baseUrl: cfg.apiBaseUrl!,
            body: params.body as Record<string, unknown>,
          });
          if (!params.wait) return data;
          const waited = yield* hostApi.queueWait({
            baseUrl: cfg.apiBaseUrl!,
            txnId: String((data as any).txn_id),
            timeoutMs: params.timeoutMs,
            pollMs: params.pollMs,
          });
          return { ...(data as any), ...(waited as any) };
        });
      },
      'queue.txn': (input) => {
        const params = input as QueueTxnCapabilityInput;
        return hostApi.queueTxn({
          baseUrl: cfg.apiBaseUrl!,
          txnId: params.txnId,
        });
      },
      'queue.wait': (input) => {
        const params = input as QueueWaitCapabilityInput;
        return hostApi.queueWait({
          baseUrl: cfg.apiBaseUrl!,
          txnId: params.txnId,
          timeoutMs: params.timeoutMs,
          pollMs: params.pollMs,
        }) as Effect.Effect<WaitTxnResult, CliErrorType, any>;
      },
    });

    return createModeParityRuntime(cfg.apiBaseUrl ? remote : local);
  });
}

export function invokeWave1Capability(
  capability: ModeParityCapabilityId,
  input: unknown,
): Effect.Effect<unknown, CliErrorType, any> {
  return Effect.gen(function* () {
    const runtime = yield* resolveWave1ModeParityRuntime();
    return yield* runtime.invoke(capability, input);
  });
}
