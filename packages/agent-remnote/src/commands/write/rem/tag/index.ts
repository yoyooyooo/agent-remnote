import { Command } from '@effect/cli';

import { writeTagAddCommand, writeTagRemoveCommand } from '../../tag/index.js';

export const writeRemTagCommand = Command.make('tag', {}).pipe(
  Command.withSubcommands([writeTagAddCommand, writeTagRemoveCommand]),
);
