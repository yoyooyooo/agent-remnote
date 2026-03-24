import { Command } from '@effect/cli';

import { scenarioSchemaExplainCommand } from './explain.js';
import { scenarioSchemaGenerateCommand } from './generate.js';
import { scenarioSchemaNormalizeCommand } from './normalize.js';
import { scenarioSchemaValidateCommand } from './validate.js';

export const scenarioSchemaCommand = Command.make('schema', {}).pipe(
  Command.withSubcommands([
    scenarioSchemaValidateCommand,
    scenarioSchemaNormalizeCommand,
    scenarioSchemaExplainCommand,
    scenarioSchemaGenerateCommand,
  ]),
);
