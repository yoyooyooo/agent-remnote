import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CliError, isCliError } from '../../../services/Errors.js';
import { AppConfig } from '../../../services/AppConfig.js';
import { Payload } from '../../../services/Payload.js';
import { RemDb } from '../../../services/RemDb.js';
import { waitForTxn } from '../../_waitTxn.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { enqueueOps, normalizeOp } from '../../_enqueue.js';

import { expandTargetIds, resolveReplaceTarget } from './_target.js';

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
const maxDepth = Options.integer('max-depth').pipe(Options.withDefault(10));
const maxNodes = Options.integer('max-nodes').pipe(Options.withDefault(1000));
const requireComplete = Options.boolean('require-complete');
const excludeProperties = Options.boolean('exclude-properties');

const find = Options.text('find');
const replace = Options.text('replace');
const regex = Options.boolean('regex');
const flags = readOptionalText('flags');

const clientId = readOptionalText('client-id');
const idempotencyKey = readOptionalText('idempotency-key');
const metaSpec = readOptionalText('meta');
const priority = Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined));
const notify = Options.boolean('no-notify').pipe(Options.map((v) => !v));
const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));
const wait = Options.boolean('wait');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

function tryMakeRegExp(pattern: string, rawFlags?: string): RegExp {
  const f = typeof rawFlags === 'string' && rawFlags.trim() ? rawFlags.trim() : 'g';
  const withGlobal = f.includes('g') ? f : `g${f}`;
  return new RegExp(pattern, withGlobal);
}

function replaceRichText(value: unknown, replacer: (s: string) => string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = replacer(value);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const res = replaceRichText(item, replacer);
      if (res.changed) changed = true;
      return res.value;
    });
    return { value: out, changed };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };

  const obj = value as Record<string, any>;
  if (obj.i === 'm' && typeof obj.text === 'string') {
    const nextText = replacer(obj.text);
    if (nextText === obj.text) return { value, changed: false };
    return { value: { ...obj, text: nextText }, changed: true };
  }

  if (Array.isArray(obj.children)) {
    let changed = false;
    const nextChildren = obj.children.map((c: unknown) => {
      const res = replaceRichText(c, replacer);
      if (res.changed) changed = true;
      return res.value;
    });
    if (!changed) return { value, changed: false };
    return { value: { ...obj, children: nextChildren }, changed: true };
  }

  return { value, changed: false };
}

export const replaceLiteralCommand = Command.make(
  'literal',
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
    excludeProperties,

    find,
    replace,
    regex,
    flags,

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
    maxDepth,
    maxNodes,
    requireComplete,
    excludeProperties,
    find,
    replace,
    regex,
    flags,
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

      const cfg = yield* AppConfig;
      const payloadSvc = yield* Payload;
      const remdb = yield* RemDb;

      const target = yield* resolveReplaceTarget({ selection, stateFile, staleMs, ref, ids: id });
      const scopeValue = (scope ?? 'roots') as 'roots' | 'subtree';

      if (target.kind === 'selection' && requireComplete) {
        const sel = target.snapshot.selection;
        if (sel?.kind === 'rem' && (sel.truncated || sel.totalCount > target.rootIds.length)) {
          return yield* Effect.fail(
            new CliError({
              code: 'INVALID_ARGS',
              message: `Current selection is truncated (total=${sel.totalCount}, ids=${target.rootIds.length}). Narrow the selection or remove --require-complete.`,
              exitCode: 2,
              details: target.snapshot,
            }),
          );
        }
      }

      const expanded = yield* expandTargetIds({
        rootIds: target.rootIds,
        scope: scopeValue,
        maxDepth,
        maxNodes,
        excludeProperties,
      });

      if (requireComplete && expanded.truncated) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: `Expanded scope is truncated (reason=${expanded.truncated_reason ?? 'unknown'}). Increase --max-nodes/--max-depth or remove --require-complete.`,
            exitCode: 2,
            details: { target, expanded },
          }),
        );
      }

      const replacer = yield* Effect.try({
        try: () => {
          if (typeof find !== 'string' || find.length === 0) {
            throw new CliError({ code: 'INVALID_ARGS', message: '--find must not be empty', exitCode: 2 });
          }
          if (regex) {
            const re = tryMakeRegExp(find, flags);
            return (s: string) => s.replace(re, replace);
          }
          return (s: string) => s.split(find).join(replace);
        },
        catch: (e) =>
          new CliError({
            code: 'INVALID_ARGS',
            message: `Invalid regex: ${String((e as any)?.message || e)}`,
            exitCode: 2,
            details: { find, flags },
          }),
      });

      const { result: opsAndStats, info } = yield* remdb.withDb(cfg.remnoteDb, (db) => {
        const stmt = db.prepare('SELECT doc FROM quanta WHERE _id = ?');
        const ops: any[] = [];
        let changed = 0;

        for (const remId of expanded.ids) {
          const row = stmt.get(remId) as any;
          if (!row?.doc) continue;
          let doc: any;
          try {
            doc = JSON.parse(String(row.doc));
          } catch {
            continue;
          }
          const key = doc?.key;
          const res = replaceRichText(key, replacer);
          if (!res.changed) continue;
          doc.key = res.value;
          ops.push({ type: 'update_text', payload: { remId, text: doc.key } });
          changed += 1;
        }

        return { ops, changed };
      });

      const ops = yield* Effect.try({
        try: () => opsAndStats.ops.map((o: any) => normalizeOp(o, payloadSvc.normalizeKeys)),
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

      if (dryRun || ops.length === 0) {
        yield* writeSuccess({
          data: {
            dry_run: dryRun,
            resolution: info,
            target,
            expanded,
            find,
            replace,
            regex,
            flags,
            changed_rem_count: opsAndStats.changed,
            op_count: ops.length,
            ops,
            meta: metaValue ? payloadSvc.normalizeKeys(metaValue) : undefined,
          },
          md: `- changed_rems: ${opsAndStats.changed}\n- ops: ${ops.length}\n- truncated: ${expanded.truncated ? 'true' : 'false'}\n`,
        });
        return;
      }

      const data = yield* enqueueOps({
        ops,
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
        data: { ...(out as any), target, expanded, changed_rem_count: opsAndStats.changed },
        ids: [data.txn_id, ...data.op_ids],
        md: [
          `- txn_id: ${data.txn_id}`,
          `- op_ids: ${data.op_ids.length}`,
          `- changed_rems: ${opsAndStats.changed}`,
          `- notified: ${data.notified}`,
          `- sent: ${data.sent ?? ''}`,
          ...(waited ? [`- status: ${(waited as any).status}`, `- elapsed_ms: ${(waited as any).elapsed_ms}`] : []),
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
