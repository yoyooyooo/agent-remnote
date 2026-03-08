import { Command } from '@effect/cli';

import { writeTableCreateCommand } from './create.js';
import { writeTableOptionCommand } from './option/index.js';
import { writeTablePropertyCommand } from './property/index.js';
import { writeTableRecordCommand } from './record/index.js';

export const writeTableCommand = Command.make('table', {}).pipe(
  Command.withSubcommands([
    writeTableCreateCommand,
    writeTableRecordCommand,
    writeTablePropertyCommand,
    writeTableOptionCommand,
  ]),
);
