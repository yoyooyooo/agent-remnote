import { Command } from '@effect/cli';

import { writeTableOptionAddCommand } from './add.js';
import { writeTableOptionRemoveCommand } from './remove.js';

export const writeTableOptionCommand = Command.make('option', {}).pipe(
  Command.withSubcommands([writeTableOptionAddCommand, writeTableOptionRemoveCommand]),
);
