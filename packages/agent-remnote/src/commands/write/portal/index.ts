import { Command } from '@effect/cli';

import { writePortalCreateCommand } from './create.js';

export const writePortalCommand = Command.make('portal', {}).pipe(Command.withSubcommands([writePortalCreateCommand]));
