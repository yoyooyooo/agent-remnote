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
import { looksLikeStructuredMarkdown, trimBoundaryBlankLines } from '../../lib/text.js';
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
const markdown = readOptionalText('markdown');
const mdFile = readOptionalText('md-file');
const stdin = Options.boolean('stdin');
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
const forceText = Options.boolean('force-text');
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
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new CliError({ code: 'INVALID_ARGS', message: `Invalid date: ${raw}`, exitCode: 2 });
  }
  return d;
}

function todayAtMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export const dailyWriteCommand = Command.make(
  'write',
  {
    text,
    markdown,
    mdFile,
    stdin,
    date,
    offsetDays,
    prepend: Options.boolean('prepend'),
    createIfMissing,
    noCreateIfMissing,
    notify,
    ensureDaemon,
    forceText,
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
    markdown: markdownInput,
    mdFile,
    stdin,
    date,
    offsetDays,
    prepend,
    createIfMissing,
    noCreateIfMissing,
    notify,
    ensureDaemon,
    forceText,
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

      const inputModeCount =
        Number(Boolean(text)) + Number(Boolean(markdownInput)) + Number(Boolean(mdFile)) + Number(Boolean(stdin));
      if (inputModeCount > 1) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --text, --markdown, --md-file, or --stdin',
            exitCode: 2,
          }),
        );
      }
      if (inputModeCount === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide one of --text, --markdown, --md-file, or --stdin',
            exitCode: 2,
          }),
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
      const fileInput = yield* FileInput;
      const payloadSvc = yield* Payload;
      const remDb = yield* RemDb;

      const markdownRaw = mdFile
        ? yield* fileInput.readTextFromFileSpec({ spec: mdFile })
        : stdin
          ? yield* fileInput.readTextFromFileSpec({ spec: '-' })
          : markdownInput;
      const markdown = markdownRaw !== undefined ? trimBoundaryBlankLines(markdownRaw) : undefined;
      const textValue = text !== undefined ? trimBoundaryBlankLines(text) : undefined;

      if (textValue && !forceText && looksLikeStructuredMarkdown(textValue)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message:
              'Input passed to --text looks like structured Markdown. Use --markdown, --stdin, or --md-file instead.',
            exitCode: 2,
          }),
        );
      }

      const bulkMode = bulk ?? 'auto';
      const bundleTitleValue = typeof bundleTitle === 'string' ? bundleTitle.trim() : '';
      const hasBundleTitle = Boolean(bundleTitleValue);
      if (bulkMode === 'never' && hasBundleTitle) {
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
        : new Date(todayAtMidnight().getTime() + (offsetDays ?? 0) * 24 * 3600 * 1000);

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
        (bulkMode === 'auto' && (hasBundleTitle || lines >= BULK_THRESHOLD_LINES || chars >= BULK_THRESHOLD_CHARS));

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
                title: bundleTitleValue || 'Imported (bundle)',
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
