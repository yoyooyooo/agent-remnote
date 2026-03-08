import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError, isCliError } from '../../services/Errors.js';
import { FileInput } from '../../services/FileInput.js';
import { Payload } from '../../services/Payload.js';
import { RefResolver } from '../../services/RefResolver.js';
import { waitForTxn } from '../_waitTxn.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { enqueueOps, normalizeOp } from '../_enqueue.js';
import { dropBlankLinesOutsideFences, trimBoundaryBlankLines } from '../../lib/text.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

const parent = readOptionalText('parent');
const ref = readOptionalText('ref');

const file = readOptionalText('file');
const markdownInline = readOptionalText('markdown');
const stdin = Options.boolean('stdin');

const mode = Options.choice('mode', ['indent', 'native'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const indentSize = Options.integer('indent-size').pipe(Options.optional, Options.map(optionToUndefined));

const bulk = Options.choice('bulk', ['auto', 'always', 'never'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const bundleTitle = readOptionalText('bundle-title');

const clientId = readOptionalText('client-id');
const idempotencyKey = readOptionalText('idempotency-key');
const metaSpec = readOptionalText('meta');
const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));
const wait = Options.boolean('wait');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

const BULK_THRESHOLD_LINES = 80;
const BULK_THRESHOLD_CHARS = 5000;

export const writeMdCommand = Command.make(
  'md',
  {
    parent,
    ref,
    file,
    markdown: markdownInline,
    stdin,
    mode,
    indentSize,
    bulk,
    bundleTitle,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun: Options.boolean('dry-run'),

    priority,
    clientId,
    idempotencyKey,
    meta: metaSpec,
  },
  ({
    parent,
    ref,
    file,
    markdown,
    stdin,
    mode,
    indentSize,
    bulk,
    bundleTitle,
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

      if (parent && ref) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'Choose only one of --parent or --ref', exitCode: 2 }),
        );
      }
      if (!parent && !ref) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'You must provide --parent or --ref', exitCode: 2 }),
        );
      }

      const payloadSvc = yield* Payload;
      const fileInput = yield* FileInput;

      if ((file && markdown) || (stdin && (file || markdown))) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose exactly one of --file / --markdown / --stdin',
            exitCode: 2,
          }),
        );
      }
      if (!file && !markdown && !stdin) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'You must provide --file or --markdown or --stdin',
            exitCode: 2,
          }),
        );
      }

      const markdownValueRaw =
        typeof markdown === 'string'
          ? markdown
          : yield* fileInput.readTextFromFileSpec({ spec: stdin ? '-' : String(file) });
      const markdownValue = dropBlankLinesOutsideFences(trimBoundaryBlankLines(markdownValueRaw));

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

      const parentId = ref
        ? dryRun
          ? ref
          : yield* Effect.gen(function* () {
              const refs = yield* RefResolver;
              return yield* refs.resolve(ref);
            })
        : parent!;

      const payload: Record<string, unknown> = { parentId, markdown: markdownValue };
      const resolvedMode: 'indent' | 'native' = mode ?? (indentSize !== undefined ? 'indent' : 'native');
      if (resolvedMode === 'native') payload.indentMode = false;
      if (indentSize !== undefined) payload.indentSize = indentSize;

      const lines = markdownValue.split('\n').length;
      const chars = markdownValue.length;
      const shouldBundle =
        bulkMode === 'always' ||
        (bulkMode === 'auto' && (hasBundleTitle || lines >= BULK_THRESHOLD_LINES || chars >= BULK_THRESHOLD_CHARS));
      if (shouldBundle) {
        const title = bundleTitleValue || `Imported (bundle) (${lines} lines, ${chars} chars)`;
        payload.bundle = { enabled: true, title };
      }

      const op = yield* Effect.try({
        try: () => normalizeOp({ type: 'create_tree_with_markdown', payload }, payloadSvc.normalizeKeys),
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
          md: `- dry_run: true\n- op: create_tree_with_markdown\n- parent_id: ${parentId}\n`,
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
