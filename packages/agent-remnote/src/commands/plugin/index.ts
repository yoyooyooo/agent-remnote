import { Command } from '@effect/cli';

import { readSelectionCommand } from '../read/selection/index.js';
import { readUiContextCommand } from '../read/uiContext/index.js';
import { pluginSearchCommand } from './search.js';

export const pluginCommand = Command.make('plugin', {}).pipe(
  Command.withSubcommands([pluginSearchCommand, readUiContextCommand, readSelectionCommand]),
);

