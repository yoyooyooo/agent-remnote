import * as Data from 'effect/Data';
import * as Exit from 'effect/Exit';
import * as Cause from 'effect/Cause';
import * as Option from 'effect/Option';
import * as ValidationError from '@effect/cli/ValidationError';
import * as HelpDoc from '@effect/cli/HelpDoc';

export type CliErrorCode =
  | 'INVALID_ARGS'
  | 'INVALID_PAYLOAD'
  | 'PAYLOAD_TOO_LARGE'
  | 'QUEUE_UNAVAILABLE'
  | 'QUEUE_SCHEMA_NEWER'
  | 'QUEUE_SCHEMA_UNKNOWN'
  | 'QUEUE_SCHEMA_INVALID'
  | 'ID_MAP_CONFLICT'
  | 'TXN_FAILED'
  | 'TXN_TIMEOUT'
  | 'DB_UNAVAILABLE'
  | 'WS_UNAVAILABLE'
  | 'WS_TIMEOUT'
  | 'API_UNAVAILABLE'
  | 'API_TIMEOUT'
  | 'DEPENDENCY_MISSING'
  | 'TIMEOUT'
  | 'AGENT_BROWSER_FAILED'
  | 'EXTRACT_FAILED'
  | 'INTERNAL';

export type CliExitCode = 1 | 2;

export type JsonError = {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
};

export type JsonEnvelope =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: JsonError; readonly hint?: readonly string[] };

export class CliError extends Data.TaggedError('CliError')<{
  readonly code: CliErrorCode;
  readonly message: string;
  readonly exitCode: CliExitCode;
  readonly details?: unknown;
  readonly hint?: readonly string[];
}> {}

export function isCliError(u: unknown): u is CliError {
  return typeof u === 'object' && u !== null && (u as any)._tag === 'CliError';
}

export function ok(data: unknown): JsonEnvelope {
  return { ok: true, data };
}

export function fail(error: JsonError, hint?: readonly string[]): JsonEnvelope {
  return hint && hint.length > 0 ? { ok: false, error, hint } : { ok: false, error };
}

export function toJsonError(error: CliError): JsonError {
  return { code: error.code, message: error.message, details: error.details };
}

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, '');
}

export function renderValidationErrorMessage(err: ValidationError.ValidationError): string {
  return stripAnsi(HelpDoc.toAnsiText(err.error)).trim();
}

export function cliErrorFromValidationError(err: ValidationError.ValidationError): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message: renderValidationErrorMessage(err) || 'Invalid arguments',
    details: { tag: err._tag },
    exitCode: 2,
  });
}

export function exitCodeFromExit(exit: Exit.Exit<unknown, unknown>): number {
  if (Exit.isSuccess(exit)) return 0;
  if (Cause.isInterruptedOnly(exit.cause)) return 0;

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    const error = failure.value;
    if (isCliError(error)) return error.exitCode;
    if (ValidationError.isValidationError(error)) return 2;
  }
  return 1;
}
