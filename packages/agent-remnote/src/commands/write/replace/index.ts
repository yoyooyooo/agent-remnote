import { Command } from '@effect/cli';

import { replaceMarkdownCommand } from './block.js';
import { replaceLiteralCommand } from './text.js';

export const writeReplaceCommand = Command.make('replace', {}).pipe(
  Command.withSubcommands([replaceMarkdownCommand, replaceLiteralCommand]),
);
