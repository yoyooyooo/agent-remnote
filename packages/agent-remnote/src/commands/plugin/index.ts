import { Command } from '@effect/cli';

import { readSelectionCommand } from '../read/selection/index.js';
import { readUiContextCommand } from '../read/uiContext/index.js';
import { pluginCurrentCommand } from './current.js';
import { pluginEnsureCommand } from './ensure.js';
import { pluginLogsCommand } from './logs.js';
import { pluginRestartCommand } from './restart.js';
import { pluginSearchCommand } from './search.js';
import { pluginServeCommand } from './serve.js';
import { pluginStartCommand } from './start.js';
import { pluginStatusCommand } from './status.js';
import { pluginStopCommand } from './stop.js';

export const pluginCommand = Command.make('plugin', {}).pipe(
  Command.withSubcommands([
    pluginCurrentCommand,
    pluginSearchCommand,
    pluginServeCommand,
    pluginStartCommand,
    pluginStopCommand,
    pluginRestartCommand,
    pluginEnsureCommand,
    pluginStatusCommand,
    pluginLogsCommand,
    readUiContextCommand,
    readSelectionCommand,
  ]),
);
