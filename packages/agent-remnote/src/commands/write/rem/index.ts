import { Command } from '@effect/cli';

import { writeRemCreateCommand } from './create.js';
import { writeRemDeleteCommand } from './delete.js';
import { writeRemMoveCommand } from './move.js';
import { writeRemTagCommand } from './tag/index.js';
import { writeRemTextCommand } from './text.js';

export const writeRemCommand = Command.make('rem', {}).pipe(
  Command.withSubcommands([
    writeRemCreateCommand,
    writeRemMoveCommand,
    writeRemTextCommand,
    writeRemTagCommand,
    writeRemDeleteCommand,
  ]),
);
