import { Command } from '@effect/cli';

import { dailySummaryCommand } from '../read/daily/summary.js';
import { dailyWriteCommand } from './write.js';

export const dailyCommand = Command.make('daily', {}).pipe(
  Command.withSubcommands([dailySummaryCommand, dailyWriteCommand]),
);
