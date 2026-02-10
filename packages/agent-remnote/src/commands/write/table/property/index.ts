import { Command } from '@effect/cli';

import { writeTablePropertyAddCommand } from './add.js';
import { writeTablePropertySetTypeCommand } from './setType.js';

export const writeTablePropertyCommand = Command.make('property', {}).pipe(
  Command.withSubcommands([writeTablePropertyAddCommand, writeTablePropertySetTypeCommand]),
);

