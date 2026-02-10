import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError, isCliError } from '../../../services/Errors.js';
import { FileInput } from '../../../services/FileInput.js';
import { Payload } from '../../../services/Payload.js';
import { waitForTxn } from '../../_waitTxn.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';
import { resolveReplaceTarget } from './_target.js';
import { trimBoundaryBlankLines } from '../../../lib/text.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

const selection = Options.boolean('selection');
const stateFile = readOptionalText('state-file');
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));
const ref = readOptionalText('ref');
const ids = Options.text('id').pipe(Options.repeated);

const scope = Options.choice('scope', ['roots', 'subtree'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const requireComplete = Options.boolean('require-complete');
const maxDepth = Options.integer('max-depth').pipe(Options.withDefault(10));
const maxNodes = Options.integer('max-nodes').pipe(Options.withDefault(1000));

const allowDiscontiguous = Options.boolean('allow-discontiguous');
const useCurrentSelection = Options.boolean('use-current-selection');
const portalId = readOptionalText('portal-id');

const markdownInline = readOptionalText('markdown');
const file = readOptionalText('file');

const clientId = readOptionalText('client-id');
const idempotencyKey = readOptionalText('idempotency-key');
const metaSpec = readOptionalText('meta');
const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));
const wait = Options.boolean('wait');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

export const replaceBlockCommand = Command.make(
  'block',
  {
    selection,
    stateFile,
    staleMs,
    ref,
    id: ids,

    scope,
    maxDepth,
    maxNodes,
    requireComplete,

    allowDiscontiguous,
    useCurrentSelection,
    portalId,

    file,
    markdown: markdownInline,

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
    selection,
    stateFile,
    staleMs,
    ref,
    id,
    scope,
    maxDepth: _maxDepth,
    maxNodes: _maxNodes,
    requireComplete,
    allowDiscontiguous,
    useCurrentSelection,
    portalId,
    file,
    markdown,
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

      const fileInput = yield* FileInput;
      const payloadSvc = yield* Payload;

      const resolvedTarget = yield* resolveReplaceTarget({ selection, stateFile, staleMs, ref, ids: id });

      if (file && markdown) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Choose only one of --file or --markdown',
            exitCode: 2,
          }),
        );
      }
      if (!file && !markdown) {
        return yield* Effect.fail(
          new CliError({ code: 'INVALID_ARGS', message: 'You must provide --file or --markdown', exitCode: 2 }),
        );
      }

      const mdRaw =
        typeof markdown === 'string' ? markdown : yield* fileInput.readTextFromFileSpec({ spec: String(file) });
      const md = trimBoundaryBlankLines(mdRaw);

      const scopeValue = (scope ?? 'roots') as 'roots' | 'subtree';
      if (scopeValue !== 'roots') {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message:
              'replace block does not support --scope subtree (block-level replace deletes roots and recursively deletes their subtrees)',
            exitCode: 2,
          }),
        );
      }

      if (resolvedTarget.kind === 'selection' && requireComplete) {
        const sel = resolvedTarget.snapshot.selection;
        if (sel?.kind === 'rem' && (sel.truncated || sel.totalCount > resolvedTarget.rootIds.length)) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: `Current selection is truncated (total=${sel.totalCount}, ids=${resolvedTarget.rootIds.length}). Narrow the selection or remove --require-complete.`,
              exitCode: 2,
              details: resolvedTarget.snapshot,
            }),
          );
        }
      }

      const opPayload =
        resolvedTarget.kind === 'selection'
          ? useCurrentSelection
            ? {
                markdown: md,
                target: { mode: 'current' },
                requireSameParent: true,
                requireContiguous: allowDiscontiguous ? false : true,
                portalId: portalId || undefined,
              }
            : {
                markdown: md,
                target: { mode: 'expected', remIds: resolvedTarget.rootIds },
                requireSameParent: true,
                requireContiguous: allowDiscontiguous ? false : true,
                portalId: portalId || undefined,
              }
          : {
              markdown: md,
              target: { mode: 'explicit', remIds: resolvedTarget.rootIds },
              requireSameParent: true,
              requireContiguous: allowDiscontiguous ? false : true,
              portalId: portalId || undefined,
            };

      const op = yield* Effect.try({
        try: () =>
          normalizeOp({ type: 'replace_selection_with_markdown', payload: opPayload }, payloadSvc.normalizeKeys),
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
            target: resolvedTarget,
            op,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- dry_run: true\n- op: replace_selection_with_markdown\n- target: ${resolvedTarget.kind}\n`,
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
        data: { ...(out as any), target: resolvedTarget },
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
