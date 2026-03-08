import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { executeListTodos, executeReadRemTable } from '../../../../adapters/core.js';

import { AppConfig } from '../../../../services/AppConfig.js';
import { CliError, isCliError } from '../../../../services/Errors.js';
import { Payload } from '../../../../services/Payload.js';
import { enqueueOps, normalizeOp } from '../../../_enqueue.js';
import { writeFailure, writeSuccess } from '../../../_shared.js';
import { waitForTxn } from '../../../_waitTxn.js';

import { normalizeRemIdInput } from '../../../_powerup.js';
import { compileTableValueOps, parseValuesArrayOnly, type TablePropertyDef } from '../../../../lib/tableValues.js';

import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

const status = Options.choice('status', ['unfinished', 'finished', 'clear'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

const dispatchMode = Options.choice('dispatch-mode', ['serial', 'conflict_parallel'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

type TodoSchema = {
  readonly tagId: string;
  readonly tagName: string;
  readonly statusAttrId: string | null;
  readonly unfinishedOptionId: string | null;
  readonly finishedOptionId: string | null;
  readonly dueDateAttrId: string | null;
};

function pickTodoSchema(schemas: readonly any[], tagId?: string): TodoSchema | null {
  const mapped = schemas
    .map((s: any) => ({
      tagId: String(s?.tagId ?? ''),
      tagName: String(s?.tagName ?? ''),
      statusAttrId: s?.statusAttrId ? String(s.statusAttrId) : null,
      unfinishedOptionId: s?.unfinishedOptionId ? String(s.unfinishedOptionId) : null,
      finishedOptionId: s?.finishedOptionId ? String(s.finishedOptionId) : null,
      dueDateAttrId: s?.dueDateAttrId ? String(s.dueDateAttrId) : null,
    }))
    .filter((s) => s.tagId);

  if (tagId) {
    const direct = mapped.find((s) => s.tagId === tagId);
    return direct ?? null;
  }

  const byName = mapped.find((s) => s.tagName.trim().toLowerCase() === 'todo');
  return byName ?? mapped[0] ?? null;
}

export const writePowerupTodoAddCommand = Command.make(
  'add',
  {
    rem: Options.text('rem'),
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    status,
    due: Options.text('due').pipe(Options.optional, Options.map(optionToUndefined)),
    values: Options.text('values').pipe(Options.optional, Options.map(optionToUndefined)),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    dispatchMode,
    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({
    rem,
    tagId,
    status,
    due,
    values,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
    dispatchMode,
    priority,
    clientId,
    idempotencyKey,
    meta,
  }) =>
    todoWriteEffect({
      rem,
      tagId,
      status: status ?? 'unfinished',
      due,
      values,
      notify,
      ensureDaemon,
      wait,
      timeoutMs,
      pollMs,
      dryRun,
      dispatchMode,
      priority,
      clientId,
      idempotencyKey,
      meta,
    }).pipe(Effect.catchAll(writeFailure)),
);

export function todoWriteEffect(params: {
  readonly rem: string;
  readonly tagId: string | undefined;
  readonly status: 'unfinished' | 'finished' | 'clear';
  readonly due: string | undefined;
  readonly values: string | undefined;
  readonly notify: boolean;
  readonly ensureDaemon: boolean;
  readonly wait: boolean;
  readonly timeoutMs: number | undefined;
  readonly pollMs: number | undefined;
  readonly dryRun: boolean;
  readonly dispatchMode: 'serial' | 'conflict_parallel' | undefined;
  readonly priority: number | undefined;
  readonly clientId: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly meta: string | undefined;
}) {
  const {
    rem,
    tagId,
    status,
    due,
    values,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
    dispatchMode,
    priority,
    clientId,
    idempotencyKey,
    meta,
  } = params;

  return Effect.gen(function* () {
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

    const cfg = yield* AppConfig;
    const payloadSvc = yield* Payload;

    const remId = normalizeRemIdInput(rem);
    const normalizedTagId = tagId ? normalizeRemIdInput(tagId) : undefined;

    const discovered = yield* Effect.tryPromise({
      try: async () =>
        await executeListTodos({
          dbPath: cfg.remnoteDb,
          status: 'all',
          ...(normalizedTagId ? { tagIds: [normalizedTagId] } : {}),
          limit: 1,
          offset: 0,
        } as any),
      catch: (e) =>
        new CliError({
          code: 'DB_UNAVAILABLE',
          message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
          exitCode: 1,
        }),
    });

    const schemas = Array.isArray((discovered as any)?.usedSchemas) ? ((discovered as any).usedSchemas as any[]) : [];
    const schema = pickTodoSchema(schemas, normalizedTagId);
    if (!schema) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Todo powerup tag not found. Provide --tag-id to specify it explicitly.',
          exitCode: 2,
          hint: ['Use `agent-remnote powerup list --query Todo` to discover candidates'],
        }),
      );
    }

    const opsRaw: any[] = [{ type: 'add_tag', payload: { remId, tagId: schema.tagId } }];

    if (status !== 'clear') {
      if (!schema.statusAttrId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message:
              'Todo status property not found for this tag. Use --values with explicit propertyId/optionId instead.',
            exitCode: 2,
            details: { tag_id: schema.tagId },
          }),
        );
      }
      const optionId = status === 'finished' ? schema.finishedOptionId : schema.unfinishedOptionId;
      if (!optionId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Todo status option not found for this tag. Use --values with explicit optionId instead.',
            exitCode: 2,
            details: { tag_id: schema.tagId, status },
          }),
        );
      }
      opsRaw.push({
        type: 'set_cell_select',
        payload: { remId, propertyId: schema.statusAttrId, optionIds: optionId },
      });
    } else if (schema.statusAttrId) {
      opsRaw.push({ type: 'set_cell_select', payload: { remId, propertyId: schema.statusAttrId, optionIds: [] } });
    }

    if (due !== undefined) {
      if (!schema.dueDateAttrId) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Todo due date property not found for this tag. Use --values with explicit propertyId instead.',
            exitCode: 2,
            details: { tag_id: schema.tagId },
          }),
        );
      }
      opsRaw.push({ type: 'set_cell_date', payload: { remId, propertyId: schema.dueDateAttrId, value: due } });
    }

    const rawValues = values ? yield* payloadSvc.readJson(values) : undefined;
    const parsedValues =
      rawValues !== undefined
        ? yield* Effect.try({
            try: () => parseValuesArrayOnly(payloadSvc.normalizeKeys(rawValues)),
            catch: (e) =>
              new CliError({
                code: 'INVALID_ARGS',
                message: String((e as any)?.message || 'Invalid --values payload'),
                exitCode: 2,
                hint: ['Expected an array like: [{"propertyId":"<id>","value":...}]'],
              }),
          })
        : [];

    if (parsedValues.length > 0) {
      const properties: TablePropertyDef[] = yield* Effect.tryPromise({
        try: async () => {
          const table = await executeReadRemTable({
            tagId: schema.tagId,
            dbPath: cfg.remnoteDb,
            includeOptions: true,
            limit: 1,
            offset: 0,
          } as any);
          const props = Array.isArray((table as any)?.properties) ? ((table as any).properties as any[]) : [];
          return props.map((p) => ({
            id: String(p?.id ?? ''),
            name: String(p?.name ?? ''),
            kind: String(p?.kind ?? ''),
            options: Array.isArray(p?.options)
              ? p.options.map((o: any) => ({ id: String(o?.id ?? ''), name: String(o?.name ?? '') }))
              : undefined,
          }));
        },
        catch: (e) =>
          new CliError({
            code: 'DB_UNAVAILABLE',
            message: String((e as any)?.message || e || 'RemNote DB is unavailable'),
            exitCode: 1,
          }),
      });

      const valueOps = yield* Effect.try({
        try: () =>
          compileTableValueOps({
            rowRemId: remId,
            tableTagId: schema.tagId,
            values: parsedValues,
            properties,
          }),
        catch: (e) =>
          new CliError({
            code: 'INVALID_ARGS',
            message: String((e as any)?.message || 'Invalid todo values'),
            exitCode: 2,
            hint: ['Use propertyId to avoid ambiguity', 'Use optionId(s) when optionName is ambiguous'],
          }),
      });

      opsRaw.push(...valueOps);
    }

    const ops = yield* Effect.try({
      try: () => opsRaw.map((o) => normalizeOp(o, payloadSvc.normalizeKeys)),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Failed to generate ops',
              exitCode: 2,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;

    if (dryRun) {
      yield* writeSuccess({
        data: {
          dry_run: true,
          rem_id: remId,
          tag_id: schema.tagId,
          status,
          ...(due !== undefined ? { due } : {}),
          op_count: ops.length,
          ops,
          meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
        },
        md: `- dry_run: true\n- ops: ${ops.length}\n- rem_id: ${remId}\n- tag_id: ${schema.tagId}\n`,
      });
      return;
    }

    const data = yield* enqueueOps({
      ops,
      dispatchMode: dispatchMode ?? 'serial',
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
  });
}
