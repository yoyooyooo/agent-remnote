import { Command } from '@effect/cli';

import { backupCleanupCommand } from './cleanup.js';
import { backupListCommand } from './list.js';

export const backupCommand = Command.make('backup', {}).pipe(
  Command.withSubcommands([backupListCommand, backupCleanupCommand]),
  Command.withDescription('Backup artifact governance commands.'),
);
