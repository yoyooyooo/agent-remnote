import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { buildMovePromotionReceipt } from '../../../lib/business-semantics/receiptBuilders.js';
import { CliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { readOptionalText, writeCommonOptions } from '../_shared.js';
import { PORTAL_REM_ALIAS, buildMovePromotionActions, normalizeMovePromotionIntent } from './_promotion.js';
import { dryRunEnvelope, ensureWaitArgs, loadTxnDetail, submitActionEnvelope } from './children/common.js';

export const writeRemMoveCommand = Command.make(
  'move',
  {
    subject: Options.text('subject').pipe(Options.withDescription('Existing durable subject to relocate.')),
    at: Options.text('at').pipe(
      Options.withDescription('Examples: standalone, parent:id:P1, parent[2]:id:P1, before:id:R1, after:id:R1.'),
    ),
    portal: readOptionalText('portal').pipe(
      Options.withDescription('Use in-place to leave a portal at the original location, or at:<placement-spec> for explicit portal placement.'),
    ),
    isDocument: Options.boolean('is-document'),

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
    subject,
    at,
    portal,
    isDocument,
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
      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const intent = yield* normalizeMovePromotionIntent({
        subject,
        at,
        isDocument,
        portal,
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
      const aliasMap =
        detail?.alias_map && typeof detail.alias_map === 'object'
          ? (detail.alias_map as Record<string, string>)
          : (out as any)?.alias_map && typeof (out as any).alias_map === 'object'
            ? ((out as any).alias_map as Record<string, string>)
            : undefined;
      const portalClientTempId = aliasMap?.[PORTAL_REM_ALIAS];
      const enriched = buildMovePromotionReceipt({
        out,
        detail,
        intent,
        portalClientTempId,
      });

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
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Move an existing durable subject to a new placement, optionally leaving a portal behind.'));
