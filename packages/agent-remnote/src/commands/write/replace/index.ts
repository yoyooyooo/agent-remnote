import { Command } from '@effect/cli';

import { replaceBlockCommand } from './block.js';
import { replaceTextCommand } from './text.js';

export const writeReplaceCommand = Command.make('replace', {}).pipe(
  Command.withSubcommands([replaceBlockCommand, replaceTextCommand]),
);
