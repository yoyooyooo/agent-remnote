import { Command } from '@effect/cli';

import { scenarioBuiltinInstallCommand } from './install.js';
import { scenarioBuiltinListCommand } from './list.js';

export const scenarioBuiltinCommand = Command.make('builtin', {}).pipe(
  Command.withSubcommands([scenarioBuiltinListCommand, scenarioBuiltinInstallCommand]),
  Command.withDescription('Builtin scenario catalog and installation helpers.'),
);
