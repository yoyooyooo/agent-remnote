import { Command } from '@effect/cli';

import { writeRemChildrenCommand } from './children/index.js';
import { writeRemCreateCommand } from './create.js';
import { writeRemDeleteCommand } from './delete.js';
import { writeRemMoveCommand } from './move.js';
import { writeRemTagCommand } from './tag/index.js';
import { writeRemSetTextCommand } from './text.js';

export const writeRemCommand = Command.make('rem', {}).pipe(
  Command.withSubcommands([
    writeRemChildrenCommand,
    writeRemCreateCommand,
    writeRemMoveCommand,
    writeRemSetTextCommand,
    writeRemTagCommand,
    writeRemDeleteCommand,
  ]),
);
