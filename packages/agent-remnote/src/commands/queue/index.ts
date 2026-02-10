import { Command } from '@effect/cli';

import { queueConflictsCommand } from './conflicts.js';
import { queueInspectCommand } from './inspect.js';
import { queueProgressCommand } from './progress.js';
import { queueStatsCommand } from './stats.js';
import { queueWaitCommand } from './wait.js';

export const queueCommand = Command.make('queue', {}).pipe(
  Command.withSubcommands([
    queueStatsCommand,
    queueConflictsCommand,
    queueProgressCommand,
    queueWaitCommand,
    queueInspectCommand,
  ]),
);
