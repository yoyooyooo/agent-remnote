import * as Effect from 'effect/Effect';

import { executeOutlineRemSubtree } from '../../../adapters/core.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import type { HostApiClient } from '../../../services/HostApiClient.js';
import { RefResolver } from '../../../services/RefResolver.js';
import type { WorkspaceBindings } from '../../../services/WorkspaceBindings.js';
import { failInRemoteMode } from '../../_remoteMode.js';

import {
  loadBridgeSelectionSnapshot,
  requireOkRemSelection,
  type BridgeSelectionSnapshot,
} from '../../read/selection/_shared.js';

export type ReplaceTarget =
  | { readonly kind: 'selection'; readonly snapshot: BridgeSelectionSnapshot; readonly rootIds: readonly string[] }
  | { readonly kind: 'ref'; readonly ref: string; readonly rootIds: readonly string[] }
  | { readonly kind: 'ids'; readonly rootIds: readonly string[] };

export function resolveReplaceTarget(params: {
  readonly selection: boolean;
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
  readonly ref?: string | undefined;
  readonly ids: readonly string[];
}): Effect.Effect<ReplaceTarget, CliError, AppConfig | HostApiClient | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const _cfg = yield* AppConfig;
    yield* failInRemoteMode({
      command: 'replace target resolution',
      reason: 'replace markdown is an advanced/local-only block replace path that still depends on local selection/ref resolution semantics',
    });
    const refs = yield* RefResolver;

    const hasSelection = params.selection === true;
    const hasRef = typeof params.ref === 'string' && params.ref.trim().length > 0;
    const hasIds = Array.isArray(params.ids) && params.ids.length > 0;
    const count = [hasSelection, hasRef, hasIds].filter(Boolean).length;

    if (count !== 1) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'You must provide exactly one target: --selection or --ref or --id (repeatable)',
          exitCode: 2,
          details: { selection: hasSelection, ref: hasRef, ids: hasIds ? params.ids.length : 0 },
        }),
      );
    }

    if (hasSelection) {
      const snapshot = loadBridgeSelectionSnapshot({
        stateFile: params.stateFile,
        staleMs: params.staleMs,
      });
      const selection = yield* requireOkRemSelection(snapshot);
      const rootIds = selection.remIds.map(String).filter(Boolean);
      if (rootIds.length === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'No Rem is currently selected',
            exitCode: 2,
            details: snapshot,
          }),
        );
      }
      return { kind: 'selection', snapshot, rootIds };
    }

    if (hasRef) {
      const resolved = yield* refs.resolve(params.ref!);
      return { kind: 'ref', ref: params.ref!, rootIds: [resolved] };
    }

    const rootIds = params.ids
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
    if (rootIds.length === 0) {
      return yield* Effect.fail(
        new CliError({ code: 'INVALID_ARGS', message: 'Provide at least one Rem ID via --id', exitCode: 2 }),
      );
    }
    return { kind: 'ids', rootIds };
  });
}

export type ExpandResult = {
  readonly rootIds: readonly string[];
  readonly ids: readonly string[];
  readonly exported_node_count: number;
  readonly truncated: boolean;
  readonly truncated_reason?: string;
  readonly roots: readonly any[];
};

export function expandTargetIds(params: {
  readonly rootIds: readonly string[];
  readonly scope: 'roots' | 'subtree';
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly excludeProperties: boolean;
}): Effect.Effect<ExpandResult, CliError, AppConfig> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    yield* failInRemoteMode({
      command: 'replace subtree expansion',
      reason: 'replace commands still expand target subtrees from the local RemNote database',
    });

    if (params.scope === 'roots') {
      const unique = Array.from(new Set(params.rootIds));
      return {
        rootIds: params.rootIds,
        ids: unique,
        exported_node_count: unique.length,
        truncated: false,
        roots: [],
      };
    }

    const maxTotalNodes = Number.isFinite(params.maxNodes) && params.maxNodes > 0 ? Math.floor(params.maxNodes) : 1000;
    const maxDepthValue = Number.isFinite(params.maxDepth) && params.maxDepth >= 0 ? Math.floor(params.maxDepth) : 10;

    let remaining = maxTotalNodes;
    let exported = 0;
    const roots: any[] = [];
    const ids: string[] = [];

    for (const rootId of params.rootIds) {
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
            excludeProperties: params.excludeProperties,
            includeEmpty: true,
            expandReferences: false,
            detail: false,
          } as any),
        catch: (e) =>
          new CliError({
            code: 'DB_UNAVAILABLE',
            message: 'Failed to read RemNote local database',
            exitCode: 1,
            details: { error: String((e as any)?.message || e) },
          }),
      });

      const tree = Array.isArray((result as any).tree) ? ((result as any).tree as Array<{ id?: string }>) : [];
      for (const node of tree) {
        const id = typeof node?.id === 'string' ? node.id : '';
        if (id) ids.push(id);
      }

      const nodeCount = Number((result as any).nodeCount ?? tree.length);
      const n = Number.isFinite(nodeCount) && nodeCount >= 0 ? Math.floor(nodeCount) : tree.length;
      exported += n;
      remaining -= n;

      roots.push(result);
    }

    const unique = Array.from(new Set(ids));
    const truncatedByBudget = exported >= maxTotalNodes && params.rootIds.length > roots.length;
    const truncatedByRoots = roots.some((r) => !!(r as any)?.hasMore);
    const truncated = truncatedByBudget || truncatedByRoots;
    const truncated_reason = truncatedByRoots ? 'root_hasMore' : truncatedByBudget ? 'budget_exhausted' : undefined;

    return { rootIds: params.rootIds, ids: unique, exported_node_count: exported, truncated, truncated_reason, roots };
  });
}
