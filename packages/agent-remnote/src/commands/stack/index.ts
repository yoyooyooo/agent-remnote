import { Command } from '@effect/cli';

import { stackEnsureCommand } from './ensure.js';
import { stackStatusCommand } from './status.js';
import { stackStopCommand } from './stop.js';

export const stackCommand = Command.make('stack', {}).pipe(
  Command.withSubcommands([stackEnsureCommand, stackStopCommand, stackStatusCommand]),
);
