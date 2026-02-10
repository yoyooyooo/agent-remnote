import * as Effect from 'effect/Effect';

import { AppConfig } from '../services/AppConfig.js';
import { CliError, ok } from '../services/Errors.js';
import { Output } from '../services/Output.js';

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function formatHumanErrorLine(message: string): string {
  const trimmed = String(message ?? '').trim();
  if (!trimmed) return 'Error: Unknown error';
  return trimmed.startsWith('Error:') ? trimmed : `Error: ${trimmed}`;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}

export function writeSuccess(params: {
  readonly data: unknown;
  readonly md?: string | undefined;
  readonly ids?: readonly string[] | undefined;
}): Effect.Effect<void, CliError, AppConfig | Output> {
  return Effect.gen(function* () {
    const config = yield* AppConfig;
    const out = yield* Output;

    if (config.format === 'json') {
      yield* out.json(ok(params.data));
      return;
    }

    if (config.quiet) return;

    if (config.format === 'ids') {
      if (!params.ids || params.ids.length === 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'This command does not support --ids output',
            exitCode: 2,
          }),
        );
      }
      yield* out.stdout(`${params.ids.join('\n')}\n`);
      return;
    }

    // Keep stdout clean for agent usage: print warnings/nextActions to stderr.
    if (params.data && typeof params.data === 'object') {
      const anyData = params.data as any;
      const warnings = readStringArray(anyData?.warnings);
      const nextActions = readStringArray(anyData?.nextActions);

      if (warnings.length > 0) {
        yield* out.stderr('Warnings:\n');
        for (const w of warnings) yield* out.stderr(`- ${w}\n`);
      }
      if (nextActions.length > 0) {
        yield* out.stderr('Next actions:\n');
        for (const a of nextActions) yield* out.stderr(`- ${a}\n`);
      }
    }

    const md = params.md ?? '';
    if (md.trim().length > 0) {
      yield* out.stdout(ensureTrailingNewline(md));
    }
  });
}

export function writeFailure(error: CliError): Effect.Effect<never, CliError, AppConfig | Output> {
  return Effect.gen(function* () {
    const config = yield* AppConfig;
    const out = yield* Output;

    if (config.format === 'json') {
      // For `--json`, the failure envelope is handled in main.ts to avoid duplicate output.
      return yield* Effect.fail(error);
    }

    (globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__ = true;

    yield* out.stderr(ensureTrailingNewline(formatHumanErrorLine(error.message)));
    if (config.debug && error.details !== undefined) {
      yield* out.stderr(`${JSON.stringify(error.details, null, 2)}\n`);
    }
    if (error.hint && error.hint.length > 0) {
      yield* out.stderr(`Hint:\n`);
      for (const h of error.hint) {
        yield* out.stderr(`- ${h}\n`);
      }
    }

    return yield* Effect.fail(error);
  });
}
