import { Command } from '@effect/cli';

import { writeRemChildrenAppendCommand } from './append.js';
import { writeRemChildrenClearCommand } from './clear.js';
import { writeRemChildrenPrependCommand } from './prepend.js';
import { writeRemChildrenReplaceCommand } from './replace.js';

export const writeRemChildrenCommand = Command.make('children', {}).pipe(
  Command.withSubcommands([
    writeRemChildrenAppendCommand,
    writeRemChildrenPrependCommand,
    writeRemChildrenReplaceCommand,
    writeRemChildrenClearCommand,
  ]),
);
