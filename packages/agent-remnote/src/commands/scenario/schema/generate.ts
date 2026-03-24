import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { generateScenarioPackage, ScenarioSharedError } from '../../../lib/scenario-shared/index.js';
import { CliError } from '../../../services/Errors.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { readJsonSpec } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const hintSpec = Options.text('hint');
const strict = Options.boolean('strict');
const schemaVersion = Options.integer('schema-version').pipe(Options.optional, Options.map(optionToUndefined));

export const scenarioSchemaGenerateCommand = Command.make(
  'generate',
  { hint: hintSpec, strict, schemaVersion },
  ({ hint, strict, schemaVersion }) =>
    Effect.gen(function* () {
      const raw = yield* readJsonSpec(hint);
      const result = yield* Effect.try({
        try: () => generateScenarioPackage(raw),
        catch: (error) =>
          error instanceof ScenarioSharedError
            ? new CliError({
                code: error.code,
                message: error.message,
                exitCode: 2,
              })
            : new CliError({
                code: 'INTERNAL',
                message: String((error as any)?.message || error || 'scenario generate failed'),
                exitCode: 1,
              }),
      });
      const warnings = [...result.warnings];
      const errors: string[] = [];
      if (strict && warnings.length > 0) {
        errors.push(...warnings.map((warning) => `[strict] ${warning}`));
      }

      yield* writeSuccess({
        data: {
          tool: 'scenario.schema',
          subcommand: 'generate',
          schema_version: schemaVersion ?? 1,
          ok: errors.length === 0,
          errors,
          warnings,
          hints: result.hints,
          diagnostics: result.diagnostics,
          generated_package: result.package,
          inputs_used: result.inputsUsed,
          assumptions: result.assumptions,
        },
        md: `- tool: scenario.schema\n- subcommand: generate\n- ok: ${errors.length === 0}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
