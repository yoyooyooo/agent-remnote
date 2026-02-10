import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { Queue } from '../../../services/Queue.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { tryParseRemnoteLink } from '../../../lib/remnote.js';
import { trimBoundaryBlankLines } from '../../../lib/text.js';
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

const tag = Options.text('tag').pipe(Options.repeated);

export const writeRemCreateCommand = Command.make(
  'create',
  {
    parent: Options.text('parent').pipe(Options.optional, Options.map(optionToUndefined)),
    ref: Options.text('ref').pipe(Options.optional, Options.map(optionToUndefined)),
    text: Options.text('text').pipe(Options.optional, Options.map(optionToUndefined)),
    isDocument: Options.boolean('is-document'),
    tag,
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
    ref,
    text,
    isDocument,
    tag,
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

      const remClientTempId = clientTempId ? String(clientTempId).trim() : `tmp:${makeUuidLike()}`;
      const textValue = text !== undefined ? trimBoundaryBlankLines(text) : undefined;

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
          ? yield* queue
              .inspect({ dbPath: cfg.storeDb, txnId: data.txn_id })
              .pipe(
                Effect.map((inspected) => {
                  const idMap = Array.isArray((inspected as any)?.id_map) ? ((inspected as any).id_map as any[]) : [];
                  const match = idMap.find((r) => String(r?.client_temp_id ?? '') === remClientTempId);
                  const remoteId = match?.remote_id ? String(match.remote_id) : '';
                  return remoteId ? { rem_id: remoteId } : {};
                }),
                Effect.catchAll(() => Effect.succeed({})),
              )
          : {};

      const out = waited
        ? ({ ...data, ...waited, rem_client_temp_id: remClientTempId, ...created } as any)
        : ({ ...data, rem_client_temp_id: remClientTempId } as any);

      yield* writeSuccess({
        data: out,
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
