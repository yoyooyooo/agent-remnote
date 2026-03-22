import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { makeTempId } from '../../_tempId.js';
import { readOptionalText, writeCommonOptions } from '../_shared.js';
import { parsePlacementSpec, resolveTreePlacementSpec } from '../_placementSpec.js';
import { resolveRefValue } from '../_refValue.js';
import { ensureWaitArgs, loadTxnDetail, submitActionEnvelope } from '../rem/children/common.js';

export const writePortalCreateCommand = Command.make(
  'create',
  {
    to: Options.text('to').pipe(Options.withDescription('Target Rem that the portal should point to.')),
    at: Options.text('at').pipe(
      Options.withDescription(
        'Examples: parent:id:P1, parent[2]:id:P1, before:id:R1, after:id:R1. standalone is invalid for portal placement.',
      ),
    ),
    clientTempId: readOptionalText('client-temp-id'),

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
  ({ to, at, clientTempId, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
    Effect.gen(function* () {
      yield* ensureWaitArgs({ wait, timeoutMs, pollMs, dryRun });

      const placementSpec = yield* parsePlacementSpec(at, { optionName: '--at', allowStandalone: false });
      const resolvedPlacement = yield* resolveTreePlacementSpec(placementSpec, { optionName: '--at' });
      const targetRemId = yield* resolveRefValue(to);

      const payloadSvc = yield* Payload;
      const portalClientTempId = clientTempId?.trim() || makeTempId();

      const op = yield* Effect.try({
        try: () =>
          normalizeOp(
            {
              type: 'create_portal',
              payload: {
                parentId: resolvedPlacement.parentId,
                targetRemId,
                ...(resolvedPlacement.position !== undefined ? { position: resolvedPlacement.position } : {}),
                clientTempId: portalClientTempId,
              },
            },
            payloadSvc.normalizeKeys,
          ),
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
            portal_client_temp_id: portalClientTempId,
            ops: [op],
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- op: create_portal\n- portal_client_temp_id: ${portalClientTempId}\n`,
        });
        return;
      }

      const out = yield* submitActionEnvelope({
        body: {
          version: 1,
          kind: 'ops',
          ops: [op],
          ...(priority !== undefined ? { priority } : {}),
          ...(clientId ? { client_id: clientId } : {}),
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
          ...(metaValue !== undefined ? { meta: metaValue } : {}),
          notify,
          ensure_daemon: ensureDaemon,
        },
        wait,
        timeoutMs,
        pollMs,
      });
      let idMap = Array.isArray((out as any)?.id_map) ? ((out as any).id_map as any[]) : [];
      if (wait && idMap.length === 0 && typeof (out as any)?.txn_id === 'string') {
        const inspected = yield* loadTxnDetail({ txnId: String((out as any).txn_id) }).pipe(
          Effect.catchAll(() => Effect.succeed({ id_map: [] } as any)),
        );
        idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
      }
      const match = idMap.find((r) => String(r?.client_temp_id ?? '') === portalClientTempId);
      const portalRemId = match?.remote_id ? String(match.remote_id) : '';
      const opIds = Array.isArray((out as any).op_ids) ? (out as any).op_ids : [];
      const enriched =
        idMap.length > 0 || portalRemId
          ? ({
              ...(out as any),
              portal_client_temp_id: portalClientTempId,
              ...(portalRemId ? { portal_rem_id: portalRemId } : {}),
              id_map: idMap,
            } as any)
          : ({ ...(out as any), portal_client_temp_id: portalClientTempId } as any);

      yield* writeSuccess({
        data: enriched,
        ids: [(out as any).txn_id, ...opIds, ...(portalRemId ? [portalRemId] : [])].filter(Boolean),
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${opIds.length}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          `- portal_client_temp_id: ${portalClientTempId}`,
          ...(portalRemId ? [`- portal_rem_id: ${portalRemId}`] : []),
          ...((out as any).status ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Create one portal relation by pointing at a target Rem and inserting the portal into the tree.'));
