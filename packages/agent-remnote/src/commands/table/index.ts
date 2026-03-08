import { Command } from '@effect/cli';

import { writeTableCreateCommand } from '../write/table/create.js';
import { writeTableOptionCommand } from '../write/table/option/index.js';
import { writeTablePropertyCommand } from '../write/table/property/index.js';
import { writeTableRecordCommand } from '../write/table/record/index.js';

import { tableShowCommand } from './show.js';

export const tableCommand = Command.make('table', {}).pipe(
  Command.withSubcommands([
    tableShowCommand,
    writeTableCreateCommand,
    writeTableRecordCommand,
    writeTablePropertyCommand,
    writeTableOptionCommand,
  ]),
);
