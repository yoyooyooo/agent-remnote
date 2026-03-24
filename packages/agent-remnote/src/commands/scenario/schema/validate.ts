import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { validateScenarioPackage } from '../../../lib/scenario-shared/index.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { readJsonSpec } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const spec = Options.text('spec');
const strict = Options.boolean('strict');
const schemaVersion = Options.integer('schema-version').pipe(Options.optional, Options.map(optionToUndefined));

export const scenarioSchemaValidateCommand = Command.make(
  'validate',
  { spec, strict, schemaVersion },
  ({ spec, strict, schemaVersion }) =>
    Effect.gen(function* () {
      const raw = yield* readJsonSpec(spec);
      const result = validateScenarioPackage(raw);
      const warnings = [...result.warnings];
      const errors = [...result.errors];
      if (strict && warnings.length > 0) {
        errors.push(...warnings.map((warning) => `[strict] ${warning}`));
      }

      yield* writeSuccess({
        data: {
          tool: 'scenario.schema',
          subcommand: 'validate',
          schema_version: schemaVersion ?? 1,
          ok: errors.length === 0,
          errors,
          warnings,
          hints: result.hints,
          diagnostics: result.diagnostics,
        },
        md: `- tool: scenario.schema\n- subcommand: validate\n- ok: ${errors.length === 0}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
