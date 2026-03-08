import { Command } from '@effect/cli';

import { planApplyCommand } from './apply.js';

export const planCommand = Command.make('plan', {}).pipe(Command.withSubcommands([planApplyCommand]));
