import * as Effect from 'effect/Effect';

import { compileWritePlanV1 } from '../kernel/write-plan/index.js';
import { trimBoundaryBlankLines } from '../lib/text.js';
import { CliError, isCliError } from '../services/Errors.js';
import type { FileInput } from '../services/FileInput.js';
import { Payload } from '../services/Payload.js';

import { readMarkdownTextFromInputSpec } from './_shared.js';
import { normalizeOp, normalizeOps } from './_enqueue.js';
import { resolveRefsInPayload } from './_resolveRefsInPayload.js';
import { makeTempId } from './_tempId.js';

type ApplyActionInput = {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly as?: string | undefined;
};

export type ParsedApplyEnvelope =
  | {
      readonly version: 1;
      readonly kind: 'actions';
      readonly actions: readonly ApplyActionInput[];
      readonly priority?: number | undefined;
      readonly clientId?: string | undefined;
      readonly idempotencyKey?: string | undefined;
      readonly meta?: unknown;
      readonly notify?: boolean | undefined;
      readonly ensureDaemon?: boolean | undefined;
    }
  | {
      readonly version: 1;
      readonly kind: 'ops';
      readonly ops: readonly any[];
      readonly priority?: number | undefined;
      readonly clientId?: string | undefined;
      readonly idempotencyKey?: string | undefined;
      readonly meta?: unknown;
      readonly notify?: boolean | undefined;
      readonly ensureDaemon?: boolean | undefined;
    };

export type CompiledApplyEnvelope = {
  readonly kind: 'actions' | 'ops';
  readonly ops: readonly ReturnType<typeof normalizeOp>[];
  readonly aliasMap?: Readonly<Record<string, string>> | undefined;
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly meta?: unknown;
  readonly notify?: boolean | undefined;
  readonly ensureDaemon?: boolean | undefined;
};

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function invalidFieldType(key: string, expected: string): CliError {
  return new CliError({
    code: 'INVALID_PAYLOAD',
    message: `Invalid apply envelope: ${key} must be ${expected}`,
    exitCode: 2,
  });
}

function readOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (!hasOwn(obj, key) || value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidFieldType(key, 'a non-empty string');
  const trimmed = value.trim();
  if (!trimmed) throw invalidFieldType(key, 'a non-empty string');
  return trimmed;
}

function readOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (!hasOwn(obj, key) || value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidFieldType(key, 'a finite number');
  }
  return value;
}

function readOptionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (!hasOwn(obj, key) || value === undefined) return undefined;
  if (typeof value !== 'boolean') throw invalidFieldType(key, 'a boolean');
  return value;
}

function expandMarkdownInputSpecs(value: unknown): Effect.Effect<unknown, CliError, FileInput> {
  return Effect.gen(function* () {
    if (Array.isArray(value)) {
      return yield* Effect.forEach(value, (item) => expandMarkdownInputSpecs(item), { concurrency: 1 });
    }

    if (!value || typeof value !== 'object') return value;

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(obj)) {
      if (key === 'markdown' && typeof entry === 'string') {
        const raw = yield* readMarkdownTextFromInputSpec(entry);
        out[key] = trimBoundaryBlankLines(raw);
        continue;
      }
      out[key] = yield* expandMarkdownInputSpecs(entry);
    }

    return out;
  });
}

function hasAliasRef(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().startsWith('@');
  if (Array.isArray(value)) return value.some((item) => hasAliasRef(item));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((item) => hasAliasRef(item));
}

function coalesceApplyActions(actions: readonly ApplyActionInput[]): readonly ApplyActionInput[] {
  const out: ApplyActionInput[] = [];

  const canCoalesce = (action: ApplyActionInput): boolean => !action.as && !hasAliasRef(action.input);

  for (let i = 0; i < actions.length; i += 1) {
    const current = actions[i]!;

    if (current.action === 'rem.move' && canCoalesce(current)) {
      const firstRemId = typeof current.input.rem_id === 'string' ? current.input.rem_id.trim() : '';
      const firstParentId = typeof current.input.new_parent_id === 'string' ? current.input.new_parent_id.trim() : '';
      const firstStandalone = current.input.standalone === true;
      const firstLeavePortal = current.input.leave_portal === true;
      const firstPosition = typeof current.input.position === 'number' ? current.input.position : undefined;
      const firstIsDocument = current.input.is_document === true;

      if (firstRemId && firstParentId && !firstStandalone && !firstLeavePortal) {
        const remIds = [firstRemId];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'rem.move' || !canCoalesce(next)) break;

          const remId = typeof next.input.rem_id === 'string' ? next.input.rem_id.trim() : '';
          const parentId = typeof next.input.new_parent_id === 'string' ? next.input.new_parent_id.trim() : '';
          const standalone = next.input.standalone === true;
          const leavePortal = next.input.leave_portal === true;
          const position = typeof next.input.position === 'number' ? next.input.position : undefined;
          const isDocument = next.input.is_document === true;

          if (!remId || parentId !== firstParentId || standalone || leavePortal) break;
          if (position !== firstPosition) break;
          if (isDocument !== firstIsDocument) break;

          remIds.push(remId);
          j += 1;
        }

        if (remIds.length >= 2) {
          const input: Record<string, unknown> = {
            rem_ids: remIds,
            new_parent_id: firstParentId,
          };
          if (typeof firstPosition === 'number') input.position = firstPosition;
          if (firstIsDocument) input.is_document = true;
          out.push({ action: 'rem.moveMany', input });
          i = j - 1;
          continue;
        }
      }
    }

    if (current.action === 'portal.create' && canCoalesce(current)) {
      const firstParentId = typeof current.input.parent_id === 'string' ? current.input.parent_id.trim() : '';
      const firstTargetId = typeof current.input.target_rem_id === 'string' ? current.input.target_rem_id.trim() : '';

      if (firstParentId && firstTargetId) {
        const items: Array<Record<string, unknown>> = [
          {
            target_rem_id: firstTargetId,
            ...(typeof current.input.position === 'number' ? { position: current.input.position } : {}),
          },
        ];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'portal.create' || !canCoalesce(next)) break;

          const parentId = typeof next.input.parent_id === 'string' ? next.input.parent_id.trim() : '';
          const targetId = typeof next.input.target_rem_id === 'string' ? next.input.target_rem_id.trim() : '';
          if (!targetId || parentId !== firstParentId) break;

          items.push({
            target_rem_id: targetId,
            ...(typeof next.input.position === 'number' ? { position: next.input.position } : {}),
          });
          j += 1;
        }

        if (items.length >= 2) {
          out.push({
            action: 'portal.createMany',
            input: {
              parent_id: firstParentId,
              items,
            },
          });
          i = j - 1;
          continue;
        }
      }
    }

    if (current.action === 'tag.add' && canCoalesce(current)) {
      const firstRemId = typeof current.input.rem_id === 'string' ? current.input.rem_id.trim() : '';
      const firstTagId = typeof current.input.tag_id === 'string' ? current.input.tag_id.trim() : '';
      if (firstRemId && firstTagId) {
        const items: Array<Record<string, unknown>> = [{ rem_id: firstRemId, tag_id: firstTagId }];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'tag.add' || !canCoalesce(next)) break;
          const remId = typeof next.input.rem_id === 'string' ? next.input.rem_id.trim() : '';
          const tagId = typeof next.input.tag_id === 'string' ? next.input.tag_id.trim() : '';
          if (!remId || !tagId) break;
          items.push({ rem_id: remId, tag_id: tagId });
          j += 1;
        }

        if (items.length >= 2) {
          out.push({ action: 'tag.addMany', input: { items } });
          i = j - 1;
          continue;
        }
      }
    }

    if (current.action === 'tag.remove' && canCoalesce(current)) {
      const firstRemId = typeof current.input.rem_id === 'string' ? current.input.rem_id.trim() : '';
      const firstTagId = typeof current.input.tag_id === 'string' ? current.input.tag_id.trim() : '';
      const firstRemoveProperties = current.input.remove_properties === true;
      if (firstRemId && firstTagId) {
        const items: Array<Record<string, unknown>> = [{ rem_id: firstRemId, tag_id: firstTagId }];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'tag.remove' || !canCoalesce(next)) break;
          const remId = typeof next.input.rem_id === 'string' ? next.input.rem_id.trim() : '';
          const tagId = typeof next.input.tag_id === 'string' ? next.input.tag_id.trim() : '';
          const removeProperties = next.input.remove_properties === true;
          if (!remId || !tagId || removeProperties !== firstRemoveProperties) break;
          items.push({ rem_id: remId, tag_id: tagId });
          j += 1;
        }

        if (items.length >= 2) {
          out.push({
            action: 'tag.removeMany',
            input: {
              items,
              ...(firstRemoveProperties ? { remove_properties: true } : {}),
            },
          });
          i = j - 1;
          continue;
        }
      }
    }

    if (current.action === 'todo.setStatus' && canCoalesce(current)) {
      const firstRemId = typeof current.input.rem_id === 'string' ? current.input.rem_id.trim() : '';
      const firstStatus = typeof current.input.status === 'string' ? current.input.status.trim() : '';
      if (firstRemId && firstStatus) {
        const items: Array<Record<string, unknown>> = [{ rem_id: firstRemId, status: firstStatus }];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'todo.setStatus' || !canCoalesce(next)) break;
          const remId = typeof next.input.rem_id === 'string' ? next.input.rem_id.trim() : '';
          const status = typeof next.input.status === 'string' ? next.input.status.trim() : '';
          if (!remId || !status) break;
          items.push({ rem_id: remId, status });
          j += 1;
        }

        if (items.length >= 2) {
          out.push({
            action: 'todo.setStatusMany',
            input: { items },
          });
          i = j - 1;
          continue;
        }
      }
    }

    if (current.action === 'source.add' && canCoalesce(current)) {
      const firstRemId = typeof current.input.rem_id === 'string' ? current.input.rem_id.trim() : '';
      const firstSourceId = typeof current.input.source_id === 'string' ? current.input.source_id.trim() : '';
      if (firstRemId && firstSourceId) {
        const items: Array<Record<string, unknown>> = [{ rem_id: firstRemId, source_id: firstSourceId }];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'source.add' || !canCoalesce(next)) break;
          const remId = typeof next.input.rem_id === 'string' ? next.input.rem_id.trim() : '';
          const sourceId = typeof next.input.source_id === 'string' ? next.input.source_id.trim() : '';
          if (!remId || !sourceId) break;
          items.push({ rem_id: remId, source_id: sourceId });
          j += 1;
        }

        if (items.length >= 2) {
          out.push({
            action: 'source.addMany',
            input: { items },
          });
          i = j - 1;
          continue;
        }
      }
    }

    if (current.action === 'source.remove' && canCoalesce(current)) {
      const firstRemId = typeof current.input.rem_id === 'string' ? current.input.rem_id.trim() : '';
      const firstSourceId = typeof current.input.source_id === 'string' ? current.input.source_id.trim() : '';
      if (firstRemId && firstSourceId) {
        const items: Array<Record<string, unknown>> = [{ rem_id: firstRemId, source_id: firstSourceId }];
        let j = i + 1;

        while (j < actions.length) {
          const next = actions[j]!;
          if (next.action !== 'source.remove' || !canCoalesce(next)) break;
          const remId = typeof next.input.rem_id === 'string' ? next.input.rem_id.trim() : '';
          const sourceId = typeof next.input.source_id === 'string' ? next.input.source_id.trim() : '';
          if (!remId || !sourceId) break;
          items.push({ rem_id: remId, source_id: sourceId });
          j += 1;
        }

        if (items.length >= 2) {
          out.push({
            action: 'source.removeMany',
            input: { items },
          });
          i = j - 1;
          continue;
        }
      }
    }

    out.push(current);
  }

  return out;
}

export function normalizeAndExpandApplyEnvelope(
  raw: unknown,
): Effect.Effect<unknown, CliError, Payload | FileInput> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;
    const normalized = payloadSvc.normalizeKeys(raw);
    return yield* expandMarkdownInputSpecs(normalized);
  });
}

export function parseApplyEnvelope(raw: unknown): ParsedApplyEnvelope {
  const obj = asObject(raw);
  if (!obj) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid apply envelope: expected an object',
      exitCode: 2,
    });
  }

  const version = obj.version;
  if (version !== 1) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid apply envelope: expected version=1',
      exitCode: 2,
    });
  }

  const kind = typeof obj.kind === 'string' ? obj.kind.trim() : '';
  const shared = {
    version: 1 as const,
    priority: readOptionalNumber(obj, 'priority'),
    clientId: readOptionalString(obj, 'client_id'),
    idempotencyKey: readOptionalString(obj, 'idempotency_key'),
    meta: obj.meta,
    notify: readOptionalBoolean(obj, 'notify'),
    ensureDaemon: readOptionalBoolean(obj, 'ensure_daemon'),
  };

  if (kind === 'ops') {
    if (!Array.isArray(obj.ops) || obj.ops.length === 0) {
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: 'Invalid apply envelope: ops must be a non-empty array',
        exitCode: 2,
      });
    }
    return { ...shared, kind: 'ops', ops: obj.ops };
  }

  if (kind === 'actions') {
    if (!Array.isArray(obj.actions) || obj.actions.length === 0) {
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: 'Invalid apply envelope: actions must be a non-empty array',
        exitCode: 2,
      });
    }

    const actions: ApplyActionInput[] = obj.actions.map((value, index) => {
      const item = asObject(value);
      if (!item) {
        throw new CliError({
          code: 'INVALID_PAYLOAD',
          message: `Invalid action at index ${index}: expected an object`,
          exitCode: 2,
        });
      }
      const action = readOptionalString(item, 'action');
      if (!action) {
        throw new CliError({
          code: 'INVALID_PAYLOAD',
          message: `Invalid action at index ${index}: action is required`,
          exitCode: 2,
        });
      }
      const input = asObject(item.input);
      if (!input) {
        throw new CliError({
          code: 'INVALID_PAYLOAD',
          message: `Invalid action at index ${index}: input must be an object`,
          exitCode: 2,
        });
      }
      const as = readOptionalString(item, 'as');
      return { action, input, ...(as ? { as } : {}) };
    });

    return { ...shared, kind: 'actions', actions };
  }

  throw new CliError({
    code: 'INVALID_PAYLOAD',
    message: 'Invalid apply envelope: kind must be "actions" or "ops"',
    exitCode: 2,
  });
}

export function compileApplyEnvelope(
  parsed: ParsedApplyEnvelope,
): Effect.Effect<CompiledApplyEnvelope, CliError, Payload | FileInput | any> {
  return Effect.gen(function* () {
    const payloadSvc = yield* Payload;

    if (parsed.kind === 'ops') {
      const ops = yield* normalizeOps(parsed.ops);
      return {
        kind: 'ops',
        ops,
        priority: parsed.priority,
        clientId: parsed.clientId,
        idempotencyKey: parsed.idempotencyKey,
        meta: parsed.meta,
        notify: parsed.notify,
        ensureDaemon: parsed.ensureDaemon,
      };
    }

    const compiled = yield* Effect.try({
      try: () =>
        compileWritePlanV1(
          {
            version: 1,
            steps: coalesceApplyActions(parsed.actions).map((action) => ({
              action: action.action,
              input: action.input,
              ...(action.as ? { as: action.as } : {}),
            })),
          },
          { makeTempId },
        ),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_PAYLOAD',
              message: String((e as any)?.message || 'Failed to compile apply actions'),
              exitCode: 2,
            }),
    });

    const resolvedOps = yield* Effect.forEach(
      compiled.ops,
      (op) =>
        resolveRefsInPayload({ opType: op.type, payload: op.payload }).pipe(
          Effect.map((payload) => ({ ...op, payload })),
        ),
      { concurrency: 1 },
    );

    const normalizedOps = yield* Effect.try({
      try: () => resolvedOps.map((op) => normalizeOp(op, payloadSvc.normalizeKeys)),
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

    return {
      kind: 'actions',
      ops: normalizedOps,
      aliasMap: compiled.alias_map,
      priority: parsed.priority,
      clientId: parsed.clientId,
      idempotencyKey: parsed.idempotencyKey,
      meta: parsed.meta,
      notify: parsed.notify,
      ensureDaemon: parsed.ensureDaemon,
    };
  });
}
