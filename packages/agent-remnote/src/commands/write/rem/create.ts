import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { readOptionalText, writeCommonOptions } from '../_shared.js';
import {
  DURABLE_TARGET_ALIAS,
  PORTAL_REM_ALIAS,
  buildCreatePromotionActions,
  normalizeCreatePromotionIntent,
  type NormalizedCreatePromotionIntent,
} from './_promotion.js';
import { dryRunEnvelope, ensureWaitArgs, loadTxnDetail, submitActionEnvelope } from './children/common.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findRemoteId(idMap: unknown, clientTempId: string | undefined): string | undefined {
  if (!clientTempId || !Array.isArray(idMap)) return undefined;
  const match = idMap.find((entry: any) => String(entry?.client_temp_id ?? '') === clientTempId);
  const remoteId = typeof match?.remote_id === 'string' ? match.remote_id.trim() : '';
  return remoteId || undefined;
}

function parseResultJson(raw: any): any {
  const resultJson = raw?.result_json;
  if (typeof resultJson === 'string' && resultJson.trim()) {
    try {
      return JSON.parse(resultJson);
    } catch {}
  }
  return null;
}

function replaceStringRecursive(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value === from ? to : value;
  if (Array.isArray(value)) return value.map((item) => replaceStringRecursive(item, from, to));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = replaceStringRecursive(entry, from, to);
  }
  return out;
}

function remapDurableTargetTempId(params: {
  readonly compiled: { readonly kind: string; readonly ops: unknown; readonly aliasMap?: unknown };
  readonly nextTempId?: string | undefined;
}): { readonly kind: string; readonly ops: unknown; readonly aliasMap?: unknown } {
  const nextTempId = normalizeString(params.nextTempId);
  if (!nextTempId || !params.compiled.aliasMap || typeof params.compiled.aliasMap !== 'object') return params.compiled;

  const aliasMap = params.compiled.aliasMap as Record<string, string>;
  const current = normalizeString(aliasMap[DURABLE_TARGET_ALIAS]);
  if (!current || current === nextTempId) return params.compiled;

  return {
    kind: params.compiled.kind,
    ops: replaceStringRecursive(params.compiled.ops, current, nextTempId),
    aliasMap: {
      ...aliasMap,
      [DURABLE_TARGET_ALIAS]: nextTempId,
    },
  };
}

function buildPartialCreateReceipt(params: {
  readonly txnId: string;
  readonly detail: any;
  readonly remClientTempId?: string;
  readonly portalClientTempId?: string;
  readonly intent: NormalizedCreatePromotionIntent;
}): any | undefined {
  const idMap = Array.isArray(params.detail?.id_map) ? params.detail.id_map : [];
  const remId = findRemoteId(idMap, params.remClientTempId);
  if (!remId) return undefined;

  const ops = Array.isArray(params.detail?.ops) ? params.detail.ops : [];
  const nonPortalFailed = ops.some((op: any) => String(op?.type ?? '') !== 'create_portal' && String(op?.status ?? '') !== 'succeeded');
  const portalOp = ops.find((op: any) => String(op?.type ?? '') === 'create_portal');
  const portalFailed = portalOp && String(portalOp?.status ?? '') !== 'succeeded';
  if (nonPortalFailed || !portalFailed) return undefined;

  const portalResult = parseResultJson(portalOp?.result);
  const portalError =
    normalizeString(portalResult?.error) ||
    normalizeString(portalOp?.result?.error_message) ||
    'portal insertion failed after durable target creation';
  const portalRemId = findRemoteId(idMap, params.portalClientTempId);

  return {
    partial_success: true,
    txn_id: params.txnId,
    op_ids: ops.map((op: any) => String(op?.op_id ?? '')).filter(Boolean),
    status: 'partial_success',
    id_map: idMap,
    ...(params.remClientTempId ? { rem_client_temp_id: params.remClientTempId } : {}),
    ...(params.portalClientTempId ? { portal_client_temp_id: params.portalClientTempId } : {}),
    rem_id: remId,
    durable_target: {
      rem_id: remId,
      is_document: params.intent.isDocument,
      placement_kind: params.intent.contentPlacement.kind,
    },
    source_context: {
      source_kind: params.intent.source.kind,
      ...(params.intent.source.kind === 'targets' ? { source_origin: params.intent.source.sourceOrigin } : {}),
    },
    portal: {
      requested: params.intent.portalPlacement.kind !== 'none',
      created: false,
      ...(portalRemId ? { rem_id: portalRemId } : {}),
      ...(params.intent.portalPlacement.kind !== 'none' ? { placement_kind: params.intent.portalPlacement.kind } : {}),
    },
    warnings: [portalError],
    nextActions: [`agent-remnote queue inspect --txn ${params.txnId}`],
  };
}

const tag = Options.text('tag').pipe(Options.repeated);

export const writeRemCreateCommand = Command.make(
  'create',
  {
    at: Options.text('at').pipe(
      Options.withDescription('Examples: standalone, parent:id:P1, parent[2]:id:P1, before:id:R1, after:id:R1.'),
    ),
    title: readOptionalText('title'),
    text: readOptionalText('text'),
    markdown: readOptionalText('markdown'),
    from: Options.text('from').pipe(
      Options.repeated,
      Options.withDescription(
        'Advanced path: combine repeated --from with --portal in-place only for one contiguous sibling range under one parent.',
      ),
    ),
    fromSelection: Options.boolean('from-selection').pipe(
      Options.withDescription('Preferred default for --portal in-place when the current UI selection already matches the intended source range.'),
    ),
    portal: readOptionalText('portal').pipe(
      Options.withDescription('Use in-place for original-slot backfill, or at:<placement-spec> for explicit portal placement.'),
    ),
    isDocument: Options.boolean('is-document'),
    tag,
    clientTempId: readOptionalText('client-temp-id'),
    forceText: Options.boolean('force-text'),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({
    at,
    title,
    text,
    markdown,
    from,
    fromSelection,
    portal,
    isDocument,
    tag,
    clientTempId,
    forceText,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
    priority,
    clientId,
    idempotencyKey,
    meta,
  }) =>
    Effect.gen(function* () {
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });

      const payloadSvc = yield* Payload;
      const intent = yield* normalizeCreatePromotionIntent({
        at,
        text,
        markdown,
        from,
        fromSelection,
        title,
        isDocument,
        tag,
        forceText,
        portal,
      });
      const actions = yield* buildCreatePromotionActions(intent);
      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const body: Record<string, unknown> = {
        version: 1,
        kind: 'actions',
        actions,
        ...(priority !== undefined ? { priority } : {}),
        ...(clientId ? { client_id: clientId } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        ...(metaValue !== undefined ? { meta: metaValue } : {}),
        notify,
        ensure_daemon: ensureDaemon,
      };

      const compiledBase = yield* dryRunEnvelope(body);
      const compiled = remapDurableTargetTempId({ compiled: compiledBase, nextTempId: clientTempId });
      const aliasMap =
        compiled.aliasMap && typeof compiled.aliasMap === 'object'
          ? (compiled.aliasMap as Record<string, string>)
          : undefined;
      const remClientTempId = aliasMap?.[DURABLE_TARGET_ALIAS];
      const portalClientTempId = aliasMap?.[PORTAL_REM_ALIAS];

      if (dryRun) {
        yield* writeSuccess({
          data: {
            dry_run: true,
            kind: compiled.kind,
            rem_client_temp_id: remClientTempId,
            ...(portalClientTempId ? { portal_client_temp_id: portalClientTempId } : {}),
            ops: compiled.ops,
            alias_map: aliasMap,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: [
            '- dry_run: true',
            '- kind: actions',
            ...(remClientTempId ? [`- rem_client_temp_id: ${remClientTempId}`] : []),
          ].join('\n'),
        });
        return;
      }

      const submitBody: Record<string, unknown> = {
        version: 1,
        kind: 'ops',
        ops: compiled.ops,
        ...(priority !== undefined ? { priority } : {}),
        ...(clientId ? { client_id: clientId } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        ...(metaValue !== undefined ? { meta: metaValue } : {}),
        notify,
        ensure_daemon: ensureDaemon,
      };

      const submitted = yield* submitActionEnvelope({
        body: submitBody,
        wait,
        timeoutMs,
        pollMs,
      }).pipe(Effect.either);

      if (submitted._tag === 'Left') {
        const txnId = String((submitted.left as any)?.details?.txn_id ?? '').trim();
        if (wait && txnId) {
          const detail = yield* loadTxnDetail({ txnId }).pipe(Effect.catchAll(() => Effect.succeed(null)));
          const partial = detail
            ? buildPartialCreateReceipt({
                txnId,
                detail,
                remClientTempId,
                portalClientTempId,
                intent,
              })
            : undefined;

          if (partial) {
            yield* writeSuccess({
              data: partial,
              ids: [txnId, ...(Array.isArray(partial.op_ids) ? partial.op_ids : [])],
              md: [
                `- txn_id: ${txnId}`,
                '- status: partial_success',
                ...(remClientTempId ? [`- rem_client_temp_id: ${remClientTempId}`] : []),
                ...(portalClientTempId ? [`- portal_client_temp_id: ${portalClientTempId}`] : []),
              ].join('\n'),
            });
            return;
          }
        }

        return yield* Effect.fail(submitted.left);
      }

      const out = submitted.right;
      const remId = findRemoteId((out as any)?.id_map, remClientTempId);
      const portalRemId = findRemoteId((out as any)?.id_map, portalClientTempId);

      const enriched = {
        ...(out as any),
        rem_client_temp_id: remClientTempId,
        ...(portalClientTempId ? { portal_client_temp_id: portalClientTempId } : {}),
        ...(remId ? { rem_id: remId } : {}),
        ...(portalRemId ? { portal_rem_id: portalRemId } : {}),
        ...(remId
          ? {
              durable_target: {
                rem_id: remId,
                is_document: intent.isDocument,
                placement_kind: intent.contentPlacement.kind,
              },
            }
          : {}),
        source_context: {
          source_kind: intent.source.kind,
          ...(intent.source.kind === 'targets' ? { source_origin: intent.source.sourceOrigin } : {}),
        },
        portal: {
          requested: intent.portalPlacement.kind !== 'none',
          created: Boolean(portalRemId),
          ...(portalRemId ? { rem_id: portalRemId } : {}),
          ...(intent.portalPlacement.kind !== 'none' ? { placement_kind: intent.portalPlacement.kind } : {}),
        },
      };

      yield* writeSuccess({
        data: enriched,
        ids: Array.isArray((out as any)?.op_ids) ? [(out as any).txn_id, ...(out as any).op_ids] : [(out as any).txn_id],
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${Array.isArray((out as any).op_ids) ? (out as any).op_ids.length : ''}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          ...(remClientTempId ? [`- rem_client_temp_id: ${remClientTempId}`] : []),
          ...(portalClientTempId ? [`- portal_client_temp_id: ${portalClientTempId}`] : []),
          ...((out as any).status ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms ?? ''}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Create a new durable subject from text, markdown, explicit refs, or the current selection.'));
