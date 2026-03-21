import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { Queue } from '../../../services/Queue.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';
import { makeTempId } from '../../_tempId.js';
import { readOptionalText, writeCommonOptions } from '../_shared.js';
import { parsePlacementSpec, resolveTreePlacementSpec } from '../_placementSpec.js';
import { resolveRefValue } from '../_refValue.js';

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

      const placementSpec = yield* parsePlacementSpec(at, { optionName: '--at', allowStandalone: false });
      const resolvedPlacement = yield* resolveTreePlacementSpec(placementSpec, { optionName: '--at' });
      const targetRemId = yield* resolveRefValue(to);

      const cfg = yield* AppConfig;
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
              const match = idMap.find((r) => String(r?.client_temp_id ?? '') === portalClientTempId);
              const remoteId = match?.remote_id ? String(match.remote_id) : '';
              return remoteId ? { portal_rem_id: remoteId, id_map: idMap } : { id_map: idMap };
            })
          : {};

      const out = waited
        ? ({ ...data, ...waited, portal_client_temp_id: portalClientTempId, ...created } as any)
        : ({ ...data, portal_client_temp_id: portalClientTempId } as any);

      yield* writeSuccess({
        data: out,
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          `- portal_client_temp_id: ${portalClientTempId}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Create one portal relation by pointing at a target Rem and inserting the portal into the tree.'));
