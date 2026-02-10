import { Command } from '@effect/cli';

import { dbBackupsCommand } from './backups.js';
import { dbRecentCommand } from './recent.js';

export const readDbCommand = Command.make('db', {}).pipe(Command.withSubcommands([dbBackupsCommand, dbRecentCommand]));
