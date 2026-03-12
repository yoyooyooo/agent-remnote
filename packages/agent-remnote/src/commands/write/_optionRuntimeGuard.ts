import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { RemDb } from '../../services/RemDb.js';
import { CliError } from '../../services/Errors.js';
import type { EnqueueOpInput } from '../../services/Queue.js';

type SelectLikeFieldType = 'single_select' | 'multi_select';

function optionCapabilityHint(scopeLabel: string): readonly string[] {
  return [
    `Use the RemNote UI to convert the ${scopeLabel} property to single_select or multi_select first.`,
    `Only then use ${scopeLabel} option add/remove from the CLI.`,
    'Plain properties do not support option mutation.',
  ];
}

function isSupportedOptionFieldType(value: unknown): value is SelectLikeFieldType {
  return value === 'single_select' || value === 'multi_select';
}

function invalidOptionTargetError(params: {
  readonly scopeLabel: string;
  readonly targetKind: 'property' | 'option';
  readonly targetId: string;
  readonly fieldType?: string | null | undefined;
  readonly parentPropertyId?: string | null | undefined;
}): CliError {
  if (params.targetKind === 'option') {
    return new CliError({
      code: 'INVALID_ARGS',
      message: `Option mutation requires option ${params.targetId} to belong to a single_select or multi_select ${params.scopeLabel} property`,
      exitCode: 2,
      details: {
        scope: params.scopeLabel,
        option_id: params.targetId,
        parent_property_id: params.parentPropertyId ?? undefined,
        property_field_type: params.fieldType ?? undefined,
      },
      hint: optionCapabilityHint(params.scopeLabel),
    });
  }

  return new CliError({
    code: 'INVALID_ARGS',
    message: `Option mutation requires property ${params.targetId} to have ft=single_select or ft=multi_select in the local RemNote DB`,
    exitCode: 2,
    details: {
      scope: params.scopeLabel,
      property_id: params.targetId,
      property_field_type: params.fieldType ?? undefined,
    },
    hint: optionCapabilityHint(params.scopeLabel),
  });
}

function missingOptionTargetError(params: {
  readonly scopeLabel: string;
  readonly targetKind: 'property' | 'option';
  readonly targetId: string;
}): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message: `${params.targetKind === 'property' ? 'Property' : 'Option'} ${params.targetId} was not found in the local RemNote DB`,
    exitCode: 2,
    details: {
      scope: params.scopeLabel,
      [`${params.targetKind}_id`]: params.targetId,
    },
    hint: optionCapabilityHint(params.scopeLabel),
  });
}

export function ensureOptionMutationSupportedForProperty(params: {
  readonly scopeLabel: string;
  readonly propertyId: string;
}): Effect.Effect<void, CliError, RemDb | AppConfig> {
  return Effect.gen(function* () {
    const remDb = yield* RemDb;
    const cfg = yield* AppConfig;
    const propertyId = String(params.propertyId ?? '').trim();
    if (!propertyId) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Missing property id for option mutation',
          exitCode: 2,
        }),
      );
    }

    const result = yield* remDb.withDb(cfg.remnoteDb, (db) => {
      const row = db
        .prepare(
          `SELECT json_extract(doc, '$.ft') AS field_type
             FROM quanta
            WHERE _id = ?`,
        )
        .get(propertyId) as { field_type?: unknown } | undefined;
      return { found: !!row, fieldType: typeof row?.field_type === 'string' ? row.field_type : null };
    });

    if (!result.result.found) {
      return yield* Effect.fail(missingOptionTargetError({ scopeLabel: params.scopeLabel, targetKind: 'property', targetId: propertyId }));
    }

    if (!isSupportedOptionFieldType(result.result.fieldType)) {
      return yield* Effect.fail(
        invalidOptionTargetError({
          scopeLabel: params.scopeLabel,
          targetKind: 'property',
          targetId: propertyId,
          fieldType: result.result.fieldType,
        }),
      );
    }
  });
}

export function ensureOptionMutationSupportedForOption(params: {
  readonly scopeLabel: string;
  readonly optionId: string;
}): Effect.Effect<void, CliError, RemDb | AppConfig> {
  return Effect.gen(function* () {
    const remDb = yield* RemDb;
    const cfg = yield* AppConfig;
    const optionId = String(params.optionId ?? '').trim();
    if (!optionId) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Missing option id for option mutation',
          exitCode: 2,
        }),
      );
    }

    const result = yield* remDb.withDb(cfg.remnoteDb, (db) => {
      const optionRow = db
        .prepare(
          `SELECT json_extract(doc, '$.parent') AS parent_property_id
             FROM quanta
            WHERE _id = ?`,
        )
        .get(optionId) as { parent_property_id?: unknown } | undefined;

      const parentPropertyId =
        typeof optionRow?.parent_property_id === 'string' ? optionRow.parent_property_id.trim() : '';
      if (!parentPropertyId) {
        return { found: !!optionRow, parentPropertyId: null as string | null, fieldType: null as string | null };
      }

      const propertyRow = db
        .prepare(
          `SELECT json_extract(doc, '$.ft') AS field_type
             FROM quanta
            WHERE _id = ?`,
        )
        .get(parentPropertyId) as { field_type?: unknown } | undefined;

      return {
        found: !!optionRow,
        parentPropertyId,
        fieldType: typeof propertyRow?.field_type === 'string' ? propertyRow.field_type : null,
      };
    });

    if (!result.result.found) {
      return yield* Effect.fail(missingOptionTargetError({ scopeLabel: params.scopeLabel, targetKind: 'option', targetId: optionId }));
    }

    if (!isSupportedOptionFieldType(result.result.fieldType)) {
      return yield* Effect.fail(
        invalidOptionTargetError({
          scopeLabel: params.scopeLabel,
          targetKind: 'option',
          targetId: optionId,
          parentPropertyId: result.result.parentPropertyId,
          fieldType: result.result.fieldType,
        }),
      );
    }
  });
}

export function validateOptionMutationOps(params: {
  readonly scopeLabel: string;
  readonly ops: readonly EnqueueOpInput[];
}): Effect.Effect<void, CliError, RemDb | AppConfig> {
  return Effect.forEach(
    params.ops,
    (op) => {
      if (op.type === 'add_option') {
        const propertyId = typeof (op.payload as any)?.property_id === 'string' ? (op.payload as any).property_id : '';
        return ensureOptionMutationSupportedForProperty({ scopeLabel: params.scopeLabel, propertyId });
      }

      if (op.type === 'remove_option') {
        const optionId = typeof (op.payload as any)?.option_id === 'string' ? (op.payload as any).option_id : '';
        return ensureOptionMutationSupportedForOption({ scopeLabel: params.scopeLabel, optionId });
      }

      return Effect.void;
    },
    { concurrency: 1, discard: true },
  );
}
