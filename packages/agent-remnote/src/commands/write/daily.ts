import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { formatDateWithPattern, getDateFormatting } from '../../adapters/core.js';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { FileInput } from '../../services/FileInput.js';
import { Payload } from '../../services/Payload.js';
import { RemDb } from '../../services/RemDb.js';
import { failInRemoteMode } from '../_remoteMode.js';
import { trimBoundaryBlankLines } from '../../lib/text.js';
import { waitForTxn } from '../_waitTxn.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { enqueueOps, normalizeOp } from '../_enqueue.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

const text = readOptionalText('text');
const mdFile = readOptionalText('md-file');
const date = readOptionalText('date');
const offsetDays = Options.integer('offset-days').pipe(Options.optional, Options.map(optionToUndefined));
const createIfMissing = Options.boolean('create-if-missing');
const noCreateIfMissing = Options.boolean('no-create-if-missing');

const clientId = readOptionalText('client-id');
const idempotencyKey = readOptionalText('idempotency-key');
const metaSpec = readOptionalText('meta');
const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));
const wait = Options.boolean('wait');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

const bulk = Options.choice('bulk', ['auto', 'always', 'never'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const bundleTitle = readOptionalText('bundle-title');

const BULK_THRESHOLD_LINES = 80;
const BULK_THRESHOLD_CHARS = 5000;

function parseDateInput(raw: string): Date {
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const d = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(trimmed);
  if (isNaN(d.getTime())) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid date: ${raw}`, exitCode: 2 });
  }
  if (
    match &&
    (d.getFullYear() !== Number(match[1]) || d.getMonth() !== Number(match[2]) - 1 || d.getDate() !== Number(match[3]))
  ) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid date: ${raw}`, exitCode: 2 });
  }
  return d;
}

function todayAtMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export const writeDailyCommand = Command.make(
  'daily',
  {
    text,
    mdFile,
    date,
    offsetDays,
    prepend: Options.boolean('prepend'),
    createIfMissing,
    noCreateIfMissing,
    notify,
    ensureDaemon,
    dryRun: Options.boolean('dry-run'),
    bulk,
    bundleTitle,
    wait,
    timeoutMs,
    pollMs,

    priority,
    clientId,
    idempotencyKey,
    meta: metaSpec,
  },
  ({
    text,
    mdFile,
    date,
    offsetDays,
    prepend,
    createIfMissing,
    noCreateIfMissing,
    notify,
    ensureDaemon,
    dryRun,
    bulk,
    bundleTitle,
    wait,
    timeoutMs,
    pollMs,
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

      if (text && mdFile) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --text or --md-file', exitCode: 2 }),
        );
      }
      if (!text && !mdFile) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'You must provide --text or --md-file', exitCode: 2 }),
        );
      }
      if (date && offsetDays !== undefined) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --date or --offset-days', exitCode: 2 }),
        );
      }
      if (createIfMissing && noCreateIfMissing) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --create-if-missing or --no-create-if-missing',
            exitCode: 2,
          }),
        );
      }

      const cfg = yield* AppConfig;
      yield* failInRemoteMode({
        command: 'write daily',
        reason: 'this command still needs local Daily Note metadata before enqueueing writes',
        hints: ['Use `import markdown --ref daily:today ...` in remote mode.'],
      });
      const fileInput = yield* FileInput;
      const payloadSvc = yield* Payload;
      const remDb = yield* RemDb;

      const markdownRaw = mdFile ? yield* fileInput.readTextFromFileSpec({ spec: mdFile }) : undefined;
      const markdown = markdownRaw !== undefined ? trimBoundaryBlankLines(markdownRaw) : undefined;
      const textValue = text !== undefined ? trimBoundaryBlankLines(text) : undefined;

      const bulkMode = bulk ?? 'auto';
      const bundleTitleValue = typeof bundleTitle === 'string' ? bundleTitle.trim() : '';
      const hasBundleFields = Boolean(bundleTitleValue);
      if (bulkMode === 'never' && hasBundleFields) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Cannot specify --bundle-title when --bulk=never',
            exitCode: 2,
          }),
        );
      }

      const target = date
        ? yield* Effect.try({
            try: () => parseDateInput(date),
            catch: (e) =>
              isCliError(e) ? e : new CliError({ code: 'INVALID_ARGS', message: 'Invalid date', exitCode: 2 }),
          })
        : (() => {
            const target = todayAtMidnight();
            target.setDate(target.getDate() + (offsetDays ?? 0));
            return target;
          })();

      const dateString = yield* remDb
        .withDb(cfg.remnoteDb, async (db) => {
          const fmt = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';
          return formatDateWithPattern(target, fmt);
        })
        .pipe(
          Effect.map((r) => r.result),
          Effect.catchAll(() => Effect.succeed(undefined)),
        );

      const createIfMissingBool = noCreateIfMissing ? false : createIfMissing ? true : undefined;

      const content = markdown ?? textValue ?? '';
      const lines = typeof content === 'string' ? content.split('\n').length : 0;
      const chars = typeof content === 'string' ? content.length : 0;
      const shouldBundle =
        bulkMode === 'always' ||
        (bulkMode === 'auto' && (hasBundleFields || lines >= BULK_THRESHOLD_LINES || chars >= BULK_THRESHOLD_CHARS));

      const payload = {
        ...(markdown !== undefined ? { markdown } : {}),
        ...(textValue !== undefined ? { text: textValue } : {}),
        ...(date ? { date: target.toISOString() } : { offsetDays: offsetDays ?? 0 }),
        ...(dateString ? { dateString } : {}),
        ...(prepend ? { prepend: true } : {}),
        ...(createIfMissingBool !== undefined ? { createIfMissing: createIfMissingBool } : {}),
        ...(shouldBundle
          ? {
              bundle: {
                enabled: true,
                title: bundleTitleValue || `Imported (bundle) (${lines} lines, ${chars} chars)`,
              },
            }
          : {}),
      };

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'daily_note_write', payload }, payloadSvc.normalizeKeys),
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
        if (wait) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: '--wait is not compatible with --dry-run',
              exitCode: 2,
            }),
          );
        }
        yield* writeSuccess({
          data: { dry_run: true, ops: [op], meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined },
          md: `- dry_run: true\n- op: daily_note_write\n- date_string: ${dateString ?? ''}\n`,
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
