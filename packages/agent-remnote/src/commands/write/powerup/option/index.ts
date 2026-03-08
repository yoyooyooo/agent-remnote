import { Command } from '@effect/cli';

import { writePowerupOptionAddCommand } from './add.js';
import { writePowerupOptionRemoveCommand } from './remove.js';

export const writePowerupOptionCommand = Command.make('option', {}).pipe(
  Command.withSubcommands([writePowerupOptionAddCommand, writePowerupOptionRemoveCommand]),
);
