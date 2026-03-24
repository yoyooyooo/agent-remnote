import { Command } from '@effect/cli';

import { scenarioBuiltinCommand } from './builtin/index.js';
import { scenarioRunCommand } from './run.js';
import { scenarioSchemaCommand } from './schema/index.js';

export const scenarioCommand = Command.make('scenario', {}).pipe(
  Command.withSubcommands([scenarioSchemaCommand, scenarioBuiltinCommand, scenarioRunCommand]),
);
