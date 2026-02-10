import { Command } from '@effect/cli';

import { wsEnsureCommand } from '../ws/ensure.js';
import { wsHealthCommand } from '../ws/health.js';
import { wsLogsCommand } from '../ws/logs.js';
import { wsRestartCommand } from '../ws/restart.js';
import { wsServeCommand } from '../ws/serve.js';
import { wsStartCommand } from '../ws/start.js';
import { wsStatusCommand } from '../ws/status.js';
import { wsStatusLineCommand } from '../ws/statusLine.js';
import { wsStopCommand } from '../ws/stop.js';
import { wsSupervisorCommand } from '../ws/supervisor.js';
import { wsSyncCommand } from '../ws/sync.js';

export const daemonCommand = Command.make('daemon', {}).pipe(
  Command.withSubcommands([
    wsHealthCommand,
    wsServeCommand,
    wsStartCommand,
    wsSupervisorCommand,
    wsStopCommand,
    wsRestartCommand,
    wsEnsureCommand,
    wsSyncCommand,
    wsStatusCommand,
    wsStatusLineCommand,
    wsLogsCommand,
  ]),
);
