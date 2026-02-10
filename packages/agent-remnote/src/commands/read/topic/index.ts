import { Command } from '@effect/cli';

import { topicSummaryCommand } from './summary.js';

export const readTopicCommand = Command.make('topic', {}).pipe(Command.withSubcommands([topicSummaryCommand]));
