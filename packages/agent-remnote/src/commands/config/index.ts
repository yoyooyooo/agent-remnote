import { Command } from '@effect/cli';

import { configGetCommand } from './get.js';
import { configListCommand } from './list.js';
import { configPathCommand } from './path.js';
import { configPrintCommand } from './print.js';
import { configSetCommand } from './set.js';
import { configUnsetCommand } from './unset.js';
import { configValidateCommand } from './validate.js';

export const configCommand = Command.make('config', {}).pipe(
  Command.withSubcommands([
    configPrintCommand,
    configPathCommand,
    configListCommand,
    configGetCommand,
    configSetCommand,
    configUnsetCommand,
    configValidateCommand,
  ]),
);
