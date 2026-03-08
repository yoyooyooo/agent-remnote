import { Command } from '@effect/cli';

import { writeOpsCommand } from '../ops.js';

export const writeAdvancedCommand = Command.make('advanced', {}).pipe(Command.withSubcommands([writeOpsCommand]));
