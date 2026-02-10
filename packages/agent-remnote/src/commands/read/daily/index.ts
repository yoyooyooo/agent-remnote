import { Command } from '@effect/cli';

import { dailySummaryCommand } from './summary.js';

export const readDailyCommand = Command.make('daily', {}).pipe(Command.withSubcommands([dailySummaryCommand]));

