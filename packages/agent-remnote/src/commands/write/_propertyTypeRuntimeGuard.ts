import * as Effect from 'effect/Effect';

import { CliError, isCliError } from '../../services/Errors.js';

function propertyTypeCapabilityHint(scopeLabel: string): readonly string[] {
  return [
    `Create a plain ${scopeLabel} property without --type/--options if you only need the column shell.`,
    'Configure property type manually in the RemNote UI when you need select/number/date/checkbox behavior.',
    'table option add/remove still works for properties that already have a select or multi_select type.',
  ];
}

function typedPropertyCreationUnsupportedError(params: {
  readonly scopeLabel: string;
  readonly type?: string | undefined;
  readonly hasOptions: boolean;
}): CliError {
  const hasType = typeof params.type === 'string' && params.type.trim().length > 0;
  return new CliError({
    code: 'WRITE_UNAVAILABLE',
    message: `Typed property creation is currently unsupported in the RemNote plugin runtime for ${params.scopeLabel} properties`,
    exitCode: 1,
    details: {
      scope: params.scopeLabel,
      requested_type: hasType ? params.type?.trim() : undefined,
      requested_options: params.hasOptions,
    },
    hint: propertyTypeCapabilityHint(params.scopeLabel),
  });
}

function propertyTypeMutationUnsupportedError(scopeLabel: string): CliError {
  return new CliError({
    code: 'WRITE_UNAVAILABLE',
    message: `Property type mutation is currently unsupported in the RemNote plugin runtime for ${scopeLabel} properties`,
    exitCode: 1,
    details: { scope: scopeLabel },
    hint: propertyTypeCapabilityHint(scopeLabel),
  });
}

export function assertTypedPropertyCreationSupported(params: {
  readonly scopeLabel: string;
  readonly type?: string | undefined;
  readonly hasOptions: boolean;
}): void {
  const hasType = typeof params.type === 'string' && params.type.trim().length > 0;
  if (!hasType && !params.hasOptions) {
    return;
  }

  throw typedPropertyCreationUnsupportedError(params);
}

export function ensureTypedPropertyCreationSupported(params: {
  readonly scopeLabel: string;
  readonly type?: string | undefined;
  readonly hasOptions: boolean;
}): Effect.Effect<void, CliError> {
  return Effect.try({
    try: () => assertTypedPropertyCreationSupported(params),
    catch: (error) =>
      isCliError(error)
        ? error
        : new CliError({
            code: 'INTERNAL',
            message: 'Failed to validate property type runtime capability',
            exitCode: 1,
            details: { error: String((error as any)?.message || error) },
          }),
  });
}

export function assertSupportedPropertyTypeMutation(scopeLabel: string): never {
  throw propertyTypeMutationUnsupportedError(scopeLabel);
}

export function failUnsupportedPropertyTypeMutation(scopeLabel: string): Effect.Effect<never, CliError> {
  return Effect.fail(propertyTypeMutationUnsupportedError(scopeLabel));
}
