import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { tryParseRemnoteLink } from '../../../lib/remnote.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';

import { optionToUndefined, writeCommonOptions } from '../_shared.js';
import {
  buildMovePromotionActions,
  isMovePromotionMode,
  normalizeMovePromotionIntent,
} from './_promotion.js';
import { dryRunEnvelope, ensureWaitArgs, loadTxnDetail, submitActionEnvelope } from './children/common.js';

function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
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

const before = Options.text('before').pipe(Options.optional, Options.map(optionToUndefined));
const after = Options.text('after').pipe(Options.optional, Options.map(optionToUndefined));

export const writeRemMoveCommand = Command.make(
  'move',
  {
    rem: Options.text('rem'),
    parent: Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined)),
    ref: Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined)),
    before,
    after,
    standalone: Options.boolean('standalone'),
    isDocument: Options.boolean('is-document'),
    leavePortal: Options.boolean('leave-portal'),
    position: Options.integer('position').pipe(Options.optional, Options.map(optionToUndefined)),

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
    rem,
    parent,
    ref,
    before,
    after,
    standalone,
    isDocument,
    leavePortal,
    position,
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
        isMovePromotionMode({
          rem,
          parent,
          ref,
          before,
          after,
          standalone,
          isDocument,
          leavePortal,
          position,
        })
      ) {
        yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });

        const payloadSvc = yield* Payload;
        const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;
        const intent = yield* normalizeMovePromotionIntent({
          rem,
          parent,
          ref,
          before,
          after,
          standalone,
          isDocument,
          leavePortal,
          position,
        });
        const actions = yield* buildMovePromotionActions(intent);
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

        if (dryRun) {
          const compiled = yield* dryRunEnvelope(body);
          yield* writeSuccess({
            data: {
              dry_run: true,
              kind: compiled.kind,
              ops: compiled.ops,
              alias_map: compiled.aliasMap,
              meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
            },
            md: `- dry_run: true\n- action: rem.move\n- rem_id: ${intent.remId}\n`,
          });
          return;
        }

        const out = yield* submitActionEnvelope({
          body,
          wait,
          timeoutMs,
          pollMs,
        });

        const detail =
          wait && typeof (out as any)?.txn_id === 'string'
            ? yield* loadTxnDetail({ txnId: String((out as any).txn_id) }).pipe(Effect.catchAll(() => Effect.succeed(null)))
            : null;

        const moveOp = Array.isArray((detail as any)?.ops)
          ? (detail as any).ops.find((op: any) => String(op?.type ?? '').trim() === 'move_rem')
          : null;
        const moveResult = parseResultJson(moveOp?.result);

        const warnings = [
          ...((Array.isArray((out as any)?.warnings) ? (out as any).warnings : []) as string[]),
          ...((Array.isArray(moveResult?.warnings) ? moveResult.warnings : []) as string[]),
        ];
        const nextActions = [
          ...((Array.isArray((out as any)?.nextActions) ? (out as any).nextActions : []) as string[]),
          ...((Array.isArray(moveResult?.nextActions) ? moveResult.nextActions : []) as string[]),
        ];

        const enriched = {
          ...(out as any),
          rem_id: intent.remId,
          durable_target: {
            rem_id: intent.remId,
            is_document: intent.isDocument,
            placement_kind: intent.contentPlacement.kind,
          },
          source_context: {
            source_kind: 'targets',
            source_origin: 'move_single_rem',
            ...(typeof moveResult?.source_parent_id === 'string' && moveResult.source_parent_id.trim()
              ? { parent_id: moveResult.source_parent_id.trim() }
              : {}),
          },
          portal: {
            requested: intent.leavePortal,
            created: moveResult?.portal_created === true,
            ...(typeof moveResult?.portal_id === 'string' && moveResult.portal_id.trim()
              ? { rem_id: moveResult.portal_id.trim(), placement_kind: 'in_place_single_rem' }
              : intent.leavePortal
                ? { placement_kind: 'in_place_single_rem' }
                : {}),
          },
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(nextActions.length > 0 ? { nextActions } : {}),
        };

        yield* writeSuccess({
          data: enriched,
          ids: Array.isArray((out as any)?.op_ids) ? [(out as any).txn_id, ...(out as any).op_ids] : [(out as any).txn_id],
          md: [
            `- txn_id: ${(out as any).txn_id}`,
            `- op_ids: ${Array.isArray((out as any).op_ids) ? (out as any).op_ids.length : ''}`,
            `- notified: ${(out as any).notified}`,
            `- sent: ${(out as any).sent ?? ''}`,
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

      const refs = yield* RefResolver;
      const payloadSvc = yield* Payload;

      const remId = normalizeRemIdInput(rem);

      const resolvedRef = ref ?? '';
      const parentId =
        typeof parent === 'string'
          ? normalizeRemIdInput(parent)
          : dryRun
            ? resolvedRef
            : yield* refs.resolve(resolvedRef);

      const payload: Record<string, unknown> = { remId, newParentId: parentId };
      if (position !== undefined) payload.position = position;

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'move_rem', payload }, payloadSvc.normalizeKeys),
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
          data: { dry_run: true, ops: [op], meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined },
          md: `- dry_run: true\n- op: move_rem\n- rem_id: ${remId}\n`,
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
      const out = waited ? ({ ...data, ...waited } as any) : data;

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
