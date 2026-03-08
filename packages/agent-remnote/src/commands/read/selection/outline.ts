import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeOutlineRemSubtree } from '../../../adapters/core.js';

import { CliError } from '../../../services/Errors.js';
import { AppConfig } from '../../../services/AppConfig.js';
import { HostApiClient } from '../../../services/HostApiClient.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { cliErrorFromUnknown } from '../../_tool.js';
import { loadBridgeSelectionSnapshot, requireOkRemSelection } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

const maxDepth = Options.integer('max-depth').pipe(Options.withDefault(10));
const maxNodes = Options.integer('max-nodes').pipe(Options.withDefault(1000));

export const readSelectionOutlineCommand = Command.make(
  'outline',
  {
    stateFile,
    staleMs,
    maxDepth,
    maxNodes,
    excludeProperties: Options.boolean('exclude-properties'),
    includeEmpty: Options.boolean('include-empty'),
    expandReferences: Options.boolean('expand-references'),
    maxReferenceDepth: Options.integer('max-reference-depth').pipe(Options.optional, Options.map(optionToUndefined)),
    detail: Options.boolean('detail'),
  },
  ({
    stateFile,
    staleMs,
    maxDepth,
    maxNodes,
    excludeProperties,
    includeEmpty,
    expandReferences,
    maxReferenceDepth,
    detail,
  }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const hostApi = yield* HostApiClient;

      if (cfg.apiBaseUrl) {
        const data = yield* hostApi.selectionOutline({
          baseUrl: cfg.apiBaseUrl,
          body: {
            stateFile,
            staleMs,
            maxDepth,
            maxNodes,
            excludeProperties,
            includeEmpty,
            expandReferences,
            maxReferenceDepth,
            detail,
          },
        });

        if (cfg.format === 'json') {
          yield* writeSuccess({ data });
          return;
        }

        const mdParts: string[] = [];
        mdParts.push(`- selected: ${data.selection?.totalCount ?? ''}`);
        mdParts.push(`- roots: ${Array.isArray(data.selection?.remIds) ? data.selection.remIds.length : ''}`);
        mdParts.push(`- exported_nodes: ${data.exported_node_count ?? ''}`);
        mdParts.push(`- truncated: ${data.truncated ? 'true' : 'false'}`);
        mdParts.push('');
        for (const r of Array.isArray(data.roots) ? data.roots : []) {
          const title = String(r?.title ?? r?.rootId ?? '');
          const rootId = String(r?.rootId ?? '');
          if (title || rootId) mdParts.push(`## ${title || rootId} (${rootId || title})`);
          const m = String(r?.markdown ?? '');
          if (m.trim()) mdParts.push(m.trimEnd());
          mdParts.push('');
        }

        yield* writeSuccess({ data, md: mdParts.join('\n').trimEnd() + '\n' });
        return;
      }

      const snapshot = loadBridgeSelectionSnapshot({ stateFile, staleMs });
      const selection = yield* requireOkRemSelection(snapshot);
      const rootIds = selection.remIds.map(String);

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

      const maxTotalNodes = Number.isFinite(maxNodes) && maxNodes > 0 ? Math.floor(maxNodes) : 1000;
      const maxDepthValue = Number.isFinite(maxDepth) && maxDepth >= 0 ? Math.floor(maxDepth) : 10;

      let remaining = maxTotalNodes;
      let exported = 0;
      const roots: any[] = [];

      for (const rootId of rootIds) {
        if (remaining <= 0) break;
        const perRootMax = Math.max(1, Math.min(remaining, maxTotalNodes));

        const format = cfg.format === 'json' ? 'json' : 'markdown';
        const result = yield* Effect.tryPromise({
          try: async () =>
            await executeOutlineRemSubtree({
              id: rootId,
              dbPath: cfg.remnoteDb,
              maxDepth: maxDepthValue as any,
              startOffset: 0,
              maxNodes: perRootMax as any,
              format: format === 'json' ? 'json' : 'markdown',
              excludeProperties,
              includeEmpty,
              expandReferences: expandReferences === false ? false : undefined,
              maxReferenceDepth: maxReferenceDepth as any,
              detail,
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

      const data = {
        selection,
        params: {
          max_depth: maxDepthValue,
          max_nodes: maxTotalNodes,
          exclude_properties: excludeProperties,
          include_empty: includeEmpty,
          expand_references: expandReferences === false ? false : true,
          max_reference_depth: maxReferenceDepth,
          detail,
        },
        exported_node_count: exported,
        truncated,
        roots,
      };

      if (cfg.format === 'json') {
        yield* writeSuccess({ data });
        return;
      }

      const mdParts: string[] = [];
      mdParts.push(`- selected: ${selection.totalCount}`);
      mdParts.push(`- roots: ${rootIds.length}`);
      mdParts.push(`- exported_nodes: ${exported}`);
      mdParts.push(`- truncated: ${truncated ? 'true' : 'false'}`);
      mdParts.push('');
      for (const r of roots) {
        const title = String((r as any)?.title ?? (r as any)?.rootId ?? '');
        const rootId = String((r as any)?.rootId ?? '');
        if (title || rootId) mdParts.push(`## ${title || rootId} (${rootId || title})`);
        const m = String((r as any)?.markdown ?? '');
        if (m.trim()) mdParts.push(m.trimEnd());
        mdParts.push('');
      }

      yield* writeSuccess({ data, md: mdParts.join('\n').trimEnd() + '\n' });
    }).pipe(Effect.catchAll(writeFailure)),
);
