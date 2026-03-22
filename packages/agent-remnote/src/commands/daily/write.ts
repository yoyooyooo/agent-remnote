import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { compileApplyEnvelope, parseApplyEnvelope } from '../_applyEnvelope.js';
import { readMarkdownTextFromInputSpec, writeFailure, writeSuccess } from '../_shared.js';
import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { isSingleRootOutlineMarkdown, looksLikeStructuredMarkdown, trimBoundaryBlankLines } from '../../lib/text.js';
import { decideOutlineWriteShape } from '../../kernel/write-plan/index.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Payload } from '../../services/Payload.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

const text = readOptionalText('text');
const markdown = readOptionalText('markdown');
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
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const d = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
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

export const dailyWriteCommand = Command.make(
  'write',
  {
    text,
    markdown,
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
      if (dryRun && wait) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--wait is not compatible with --dry-run',
            exitCode: 2,
          }),
        );
      }

      const inputModeCount = Number(text !== undefined) + Number(markdownInput !== undefined);
      if (inputModeCount > 1) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --text or --markdown',
            exitCode: 2,
          }),
        );
      }
      if (inputModeCount === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide one of --text or --markdown',
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

      const payloadSvc = yield* Payload;

      const markdownRaw =
        markdownInput !== undefined ? yield* readMarkdownTextFromInputSpec(markdownInput) : undefined;
      const markdownValue = markdownRaw !== undefined ? trimBoundaryBlankLines(markdownRaw) : undefined;
      const textValue = text !== undefined ? trimBoundaryBlankLines(text) : undefined;

      if (textValue && !forceText && looksLikeStructuredMarkdown(textValue)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Input passed to --text looks like structured Markdown. Use --markdown instead.',
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

      const target = date ? parseDateInput(date) : null;
      const createIfMissingBool = noCreateIfMissing ? false : createIfMissing ? true : undefined;
      const content = markdownValue ?? textValue ?? '';
      const lines = content.split('\n').length;
      const chars = content.length;
      const writeShape = decideOutlineWriteShape({ markdown: markdownValue });
      const shouldBundle =
        bulkMode === 'always' ||
        (bulkMode === 'auto' &&
          (hasBundleTitle ||
            ((lines >= BULK_THRESHOLD_LINES || chars >= BULK_THRESHOLD_CHARS) &&
              !(markdownValue !== undefined &&
                !hasBundleTitle &&
                writeShape.shape === 'single_root_outline' &&
                isSingleRootOutlineMarkdown(markdownValue)))));

      const metaValue = meta ? yield* payloadSvc.readJson(meta) : undefined;
      const body: Record<string, unknown> = {
        version: 1,
        kind: 'actions',
        actions: [
          {
            action: 'daily.write',
            input: {
              ...(markdownValue !== undefined ? { markdown: markdownValue } : {}),
              ...(textValue !== undefined ? { text: textValue } : {}),
              ...(target ? { date: target.toISOString() } : { offset_days: offsetDays ?? 0 }),
              ...(prepend ? { prepend: true } : {}),
              ...(createIfMissingBool !== undefined ? { create_if_missing: createIfMissingBool } : {}),
              ...(shouldBundle
                ? {
                    bundle: {
                      enabled: true,
                      title: bundleTitleValue || 'Imported (bundle)',
                    },
                  }
                : {}),
            },
          },
        ],
        ...(priority !== undefined ? { priority } : {}),
        ...(clientId ? { client_id: clientId } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        ...(metaValue !== undefined ? { meta: metaValue } : {}),
        notify,
        ensure_daemon: ensureDaemon,
      };

      if (dryRun) {
        const parsed = yield* Effect.try({
          try: () => parseApplyEnvelope(payloadSvc.normalizeKeys(body)),
          catch: (error) =>
            isCliError(error)
              ? error
              : new CliError({
                  code: 'INVALID_PAYLOAD',
                  message: String((error as any)?.message || 'Invalid apply envelope'),
                  exitCode: 2,
                }),
        });
        const compiled = yield* compileApplyEnvelope(parsed);
        yield* writeSuccess({
          data: {
            dry_run: true,
            kind: compiled.kind,
            ops: compiled.ops,
            alias_map: compiled.aliasMap,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- action: daily.write\n`,
        });
        return;
      }

      const out: any = yield* invokeWave1Capability('write.apply', {
        body,
        wait,
        timeoutMs,
        pollMs,
      });

      yield* writeSuccess({
        data: out,
        ids: [out.txn_id, ...(Array.isArray(out.op_ids) ? out.op_ids : [])],
        md: [
          `- txn_id: ${out.txn_id}`,
          `- op_ids: ${Array.isArray(out.op_ids) ? out.op_ids.length : ''}`,
          `- notified: ${out.notified}`,
          `- sent: ${out.sent ?? ''}`,
          ...(out.status ? [`- status: ${out.status}`, `- elapsed_ms: ${out.elapsed_ms ?? ''}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
