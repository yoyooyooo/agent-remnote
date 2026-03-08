import { Command } from '@effect/cli';

import { apiEnsureCommand } from './ensure.js';
import { apiLogsCommand } from './logs.js';
import { apiRestartCommand } from './restart.js';
import { apiServeCommand } from './serve.js';
import { apiStartCommand } from './start.js';
import { apiStatusCommand } from './status.js';
import { apiStopCommand } from './stop.js';

export const apiCommand = Command.make('api', {}).pipe(
  Command.withSubcommands([
    apiServeCommand,
    apiStartCommand,
    apiStopCommand,
    apiRestartCommand,
    apiEnsureCommand,
    apiStatusCommand,
    apiLogsCommand,
  ]),
);
