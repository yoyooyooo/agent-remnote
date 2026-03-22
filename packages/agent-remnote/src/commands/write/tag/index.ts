import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../../services/Errors.js';
import { Payload } from '../../../services/Payload.js';
import { normalizeOp } from '../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { dispatchOps } from '../_dispatchOps.js';

import { optionToUndefined, writeCommonOptions } from '../_shared.js';
import { resolveRefValue } from '../_refValue.js';

export const writeTagAddCommand = Command.make(
  'add',
  {
    tag: Options.text('tag').pipe(Options.repeated, Options.withDescription('Tag endpoint. May be repeated.')),
    to: Options.text('to').pipe(Options.repeated, Options.withDescription('Rem endpoint. May be repeated.')),

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
  ({ tag, to, notify, ensureDaemon, wait, timeoutMs, pollMs, dryRun, priority, clientId, idempotencyKey, meta }) =>
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

      const payloadSvc = yield* Payload;
      if (tag.length === 0 || to.length === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'tag add requires at least one --tag and at least one --to',
            exitCode: 2,
          }),
        );
      }

      const tagIds = yield* Effect.forEach(tag, (value) => resolveRefValue(value));
      const remIds = yield* Effect.forEach(to, (value) => resolveRefValue(value));
      const ops = yield* Effect.forEach(tagIds, (tagId) =>
        Effect.forEach(remIds, (remId) =>
          Effect.try({
            try: () => normalizeOp({ type: 'add_tag', payload: { remId, tagId } }, payloadSvc.normalizeKeys),
            catch: (e) =>
              isCliError(e)
                ? e
                : new CliError({
                    code: 'INVALID_PAYLOAD',
                    message: 'Failed to generate op',
                    exitCode: 2,
                    details: { error: String((e as any)?.message || e) },
                  }),
          }),
        ),
      ).pipe(Effect.map((rows) => rows.flat()));

      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;

      if (dryRun) {
        yield* writeSuccess({
          data: { dry_run: true, ops, meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined },
          md: `- dry_run: true\n- op: add_tag\n- relations: ${ops.length}\n`,
        });
        return;
      }

      const out = yield* dispatchOps({
        ops,
        priority,
        clientId,
        idempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
        wait,
        timeoutMs,
        pollMs,
      });

      yield* writeSuccess({
        data: out,
        ids: [(out as any).txn_id, ...((out as any).op_ids ?? [])],
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${Array.isArray((out as any).op_ids) ? (out as any).op_ids.length : 0}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          ...(wait ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Relation write. Repeated --tag and repeated --to expand as a cross-product, not pairwise.'));

export const writeTagRemoveCommand = Command.make(
  'remove',
  {
    tag: Options.text('tag').pipe(Options.repeated, Options.withDescription('Tag endpoint. May be repeated.')),
    to: Options.text('to').pipe(Options.repeated, Options.withDescription('Rem endpoint. May be repeated.')),
    removeProperties: Options.boolean('remove-properties').pipe(Options.optional, Options.map(optionToUndefined)),

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
    tag,
    to,
    removeProperties,
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

      const payloadSvc = yield* Payload;
      if (tag.length === 0 || to.length === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'tag remove requires at least one --tag and at least one --to',
            exitCode: 2,
          }),
        );
      }

      const tagIds = yield* Effect.forEach(tag, (value) => resolveRefValue(value));
      const remIds = yield* Effect.forEach(to, (value) => resolveRefValue(value));
      const ops = yield* Effect.forEach(tagIds, (tagId) =>
        Effect.forEach(remIds, (remId) => {
          const payload: Record<string, unknown> = { remId, tagId };
          if (removeProperties !== undefined) payload.removeProperties = removeProperties;

          return Effect.try({
            try: () => normalizeOp({ type: 'remove_tag', payload }, payloadSvc.normalizeKeys),
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
        }),
      ).pipe(Effect.map((rows) => rows.flat()));

      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;

      if (dryRun) {
        yield* writeSuccess({
          data: { dry_run: true, ops, meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined },
          md: `- dry_run: true\n- op: remove_tag\n- relations: ${ops.length}\n`,
        });
        return;
      }

      const out = yield* dispatchOps({
        ops,
        priority,
        clientId,
        idempotencyKey,
        meta: metaValue,
        notify,
        ensureDaemon,
        wait,
        timeoutMs,
        pollMs,
      });

      yield* writeSuccess({
        data: out,
        ids: [(out as any).txn_id, ...((out as any).op_ids ?? [])],
        md: [
          `- txn_id: ${(out as any).txn_id}`,
          `- op_ids: ${Array.isArray((out as any).op_ids) ? (out as any).op_ids.length : 0}`,
          `- notified: ${(out as any).notified}`,
          `- sent: ${(out as any).sent ?? ''}`,
          ...(wait ? [`- status: ${(out as any).status}`, `- elapsed_ms: ${(out as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('Relation write. Repeated --tag and repeated --to expand as a cross-product, not pairwise.'));

export const writeTagCommand = Command.make('tag', {}).pipe(
  Command.withSubcommands([writeTagAddCommand, writeTagRemoveCommand]),
);
