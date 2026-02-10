import { Command } from '@effect/cli';

import { writePowerupPropertyAddCommand } from './add.js';
import { writePowerupPropertySetTypeCommand } from './setType.js';

export const writePowerupPropertyCommand = Command.make('property', {}).pipe(
  Command.withSubcommands([writePowerupPropertyAddCommand, writePowerupPropertySetTypeCommand]),
);

