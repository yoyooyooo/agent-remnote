import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { Queue } from '../../../services/Queue.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { tryParseRemnoteLink } from '../../../lib/remnote.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { waitForTxn } from '../../_waitTxn.js';

import { optionToUndefined, writeCommonOptions } from '../_shared.js';

function makeUuidLike(): string {
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return String(g.crypto.randomUUID());
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRemIdInput(raw: string): string {
  const trimmed = raw.trim();
  const link = tryParseRemnoteLink(trimmed);
  if (link?.remId) return link.remId;
  return trimmed;
}

function looksLikeRef(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.startsWith('remnote://') || s.startsWith('http://') || s.startsWith('https://')) return true;
  const idx = s.indexOf(':');
  if (idx <= 0) return false;
  const prefix = s.slice(0, idx).trim().toLowerCase();
  return prefix === 'id' || prefix === 'page' || prefix === 'title' || prefix === 'daily';
}

export const writePortalCreateCommand = Command.make(
  'create',
  {
    parent: Options.text('parent'),
    target: Options.text('target'),
    position: Options.integer('position').pipe(Options.optional, Options.map(optionToUndefined)),
    clientTempId: Options.text('client-temp-id').pipe(Options.optional, Options.map(optionToUndefined)),

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
    target,
    position,
    clientTempId,
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

      const parentIdInput = parent;
      const targetIdInput = target;

      const parentId =
        looksLikeRef(parentIdInput) && !dryRun
          ? yield* refs.resolve(parentIdInput)
          : normalizeRemIdInput(parentIdInput);
      const targetRemId =
        looksLikeRef(targetIdInput) && !dryRun
          ? yield* refs.resolve(targetIdInput)
          : normalizeRemIdInput(targetIdInput);

      if (!parentId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Missing --parent',
            exitCode: 2,
          }),
        );
      }
      if (!targetRemId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Missing --target',
            exitCode: 2,
          }),
        );
      }

      const portalClientTempId = clientTempId ? String(clientTempId).trim() : `tmp:${makeUuidLike()}`;

      const op = yield* Effect.try({
        try: () =>
          normalizeOp(
            {
              type: 'create_portal',
              payload: {
                parentId,
                targetRemId,
                ...(position !== undefined ? { position } : {}),
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
          ? yield* queue
              .inspect({ dbPath: cfg.storeDb, txnId: data.txn_id })
              .pipe(
                Effect.map((inspected) => {
                  const idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
                  const match = idMap.find((r) => String(r?.client_temp_id ?? '') === portalClientTempId);
                  const remoteId = match?.remote_id ? String(match.remote_id) : '';
                  return remoteId ? { portal_rem_id: remoteId } : {};
                }),
                Effect.catchAll(() => Effect.succeed({})),
              )
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
);
