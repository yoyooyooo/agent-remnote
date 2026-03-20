import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { Queue } from '../../../services/Queue.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { tryParseRemnoteLink } from '../../../lib/remnote.js';
import { looksLikeStructuredMarkdown, trimBoundaryBlankLines } from '../../../lib/text.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';
import { makeTempId } from '../../_tempId.js';

import { optionToUndefined, writeCommonOptions } from '../_shared.js';
import {
  DURABLE_TARGET_ALIAS,
  PORTAL_REM_ALIAS,
  buildCreatePromotionActions,
  isCreatePromotionMode,
  normalizeCreatePromotionIntent,
} from './_promotion.js';
import { dryRunEnvelope, ensureWaitArgs, loadTxnDetail, submitActionEnvelope } from './children/common.js';

function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
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

function buildPartialCreateReceipt(params: {
  readonly txnId: string;
  readonly detail: any;
  readonly remClientTempId?: string;
  readonly portalClientTempId?: string;
  readonly intent: {
    readonly isDocument: boolean;
    readonly contentPlacement: { readonly kind: string };
    readonly portalPlacement: { readonly kind: string };
  };
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
      source_kind:
        params.intent.portalPlacement.kind === 'in_place_selection_range'
          ? 'targets'
          : params.intent.contentPlacement.kind === 'standalone'
            ? 'markdown'
            : 'markdown',
      ...(params.intent.portalPlacement.kind === 'in_place_selection_range'
        ? { source_origin: 'selection' }
        : {}),
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const tag = Options.text('tag').pipe(Options.repeated);
const title = Options.text('title').pipe(Options.optional, Options.map(optionToUndefined));
const markdown = Options.text('markdown').pipe(Options.optional, Options.map(optionToUndefined));
const target = Options.text('target').pipe(Options.repeated);
const before = Options.text('before').pipe(Options.optional, Options.map(optionToUndefined));
const after = Options.text('after').pipe(Options.optional, Options.map(optionToUndefined));
const portalParent = Options.text('portal-parent').pipe(Options.optional, Options.map(optionToUndefined));
const portalBefore = Options.text('portal-before').pipe(Options.optional, Options.map(optionToUndefined));
const portalAfter = Options.text('portal-after').pipe(Options.optional, Options.map(optionToUndefined));

export const writeRemCreateCommand = Command.make(
  'create',
  {
    parent: Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined)),
    ref: Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined)),
    title,
    text: Options.text('text').pipe(Options.optional, Options.map(optionToUndefined)),
    markdown,
    target,
    fromSelection: Options.boolean('from-selection'),
    before,
    after,
    standalone: Options.boolean('standalone'),
    portalParent,
    portalBefore,
    portalAfter,
    leavePortalInPlace: Options.boolean('leave-portal-in-place'),
    isDocument: Options.boolean('is-document'),
    tag,
    position: Options.integer('position').pipe(Options.optional, Options.map(optionToUndefined)),
    clientTempId: Options.text('client-temp-id').pipe(Options.optional, Options.map(optionToUndefined)),
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
    parent,
    ref,
    title,
    text,
    markdown,
    target,
    fromSelection,
    before,
    after,
    standalone,
    portalParent,
    portalBefore,
    portalAfter,
    leavePortalInPlace,
    isDocument,
    tag,
    position,
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
      if (
        isCreatePromotionMode({
          parent,
          ref,
          before,
          after,
          standalone,
          text,
          markdown,
          target,
          fromSelection,
          title,
          isDocument,
          tag,
          position,
          forceText,
          portalParent,
          portalBefore,
          portalAfter,
          leavePortalInPlace,
        })
      ) {
        yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });

        const payloadSvc = yield* Payload;
        const intent = yield* normalizeCreatePromotionIntent({
          parent,
          ref,
          before,
          after,
          standalone,
          text,
          markdown,
          target,
          fromSelection,
          title,
          isDocument,
          tag,
          position,
          forceText,
          portalParent,
          portalBefore,
          portalAfter,
          leavePortalInPlace,
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
        const compiled = yield* dryRunEnvelope(body);
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
              portal_client_temp_id: aliasMap?.[PORTAL_REM_ALIAS],
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
                  `- status: partial_success`,
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
        return;
      }

      if (!wait && (timeoutMs !== undefined || pollMs !== undefined)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Use --wait to enable --timeout-ms/--poll-ms',
            exitCode: 2,
          }),
        );
      }
      if (dryRun && wait) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--wait is not compatible with --dry-run',
            exitCode: 2,
          }),
        );
      }
      if (parent && ref) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --parent or --ref',
            exitCode: 2,
          }),
        );
      }
      if (!parent && !ref) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide --parent or --ref',
            exitCode: 2,
          }),
        );
      }
      if (position !== undefined && (!Number.isFinite(position) || position < 0)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--position must be a non-negative integer',
            exitCode: 2,
            details: { position },
          }),
        );
      }

      const cfg = yield* AppConfig;
      const refs = yield* RefResolver;
      const payloadSvc = yield* Payload;

      const resolvedRef = ref ?? '';
      const parentId =
        typeof parent === 'string'
          ? normalizeRemIdInput(parent)
          : dryRun
            ? normalizeRemIdInput(resolvedRef)
            : yield* refs.resolve(resolvedRef);

      const tags = Array.isArray(tag) ? tag.map(normalizeRemIdInput).filter(Boolean) : [];

      const remClientTempId = clientTempId ? String(clientTempId).trim() : makeTempId();
      const textValue = text !== undefined ? trimBoundaryBlankLines(text) : undefined;

      if (textValue && !forceText && looksLikeStructuredMarkdown(textValue)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message:
              'Input passed to --text looks like structured Markdown. Use rem children append --rem <parentRemId> --markdown ... instead, or pass --force-text to keep it literal.',
            exitCode: 2,
          }),
        );
      }

      const payload: Record<string, unknown> = {
        parentId,
        clientTempId: remClientTempId,
      };
      if (textValue !== undefined) payload.text = textValue;
      if (isDocument) payload.isDocument = true;
      if (tags.length > 0) payload.tags = tags;
      if (position !== undefined) payload.position = position;

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'create_rem', payload }, payloadSvc.normalizeKeys),
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

      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;

      if (dryRun) {
        yield* writeSuccess({
          data: {
            dry_run: true,
            rem_client_temp_id: remClientTempId,
            ops: [op],
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- op: create_rem\n- rem_client_temp_id: ${remClientTempId}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops: [op],
        priority,
        clientId,
        idempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
      });

      const waited = wait ? yield* waitForTxn({ txnId: data.txn_id, timeoutMs, pollMs }) : null;
      const queue = yield* Queue;
      const created =
        waited && (waited as any).is_success === true
          ? yield* Effect.gen(function* () {
              let idMap = Array.isArray((waited as any)?.id_map) ? ((waited as any).id_map as any[]) : [];
              if (idMap.length === 0) {
                const inspected = yield* queue.inspect({ dbPath: cfg.storeDb, txnId: data.txn_id }).pipe(
                  Effect.catchAll(() => Effect.succeed({ id_map: [] } as any)),
                );
                idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
              }
              const match = idMap.find((r) => String(r?.client_temp_id ?? '') === remClientTempId);
              const remoteId = match?.remote_id ? String(match.remote_id) : '';
              return remoteId ? { rem_id: remoteId, id_map: idMap } : { id_map: idMap };
            })
          : {};

      const legacyOut = waited
        ? ({ ...data, ...waited, rem_client_temp_id: remClientTempId, ...created } as any)
        : ({ ...data, rem_client_temp_id: remClientTempId } as any);

      yield* writeSuccess({
        data: legacyOut,
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          `- rem_client_temp_id: ${remClientTempId}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
