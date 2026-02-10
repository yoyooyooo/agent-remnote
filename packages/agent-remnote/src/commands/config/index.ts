import { Command } from '@effect/cli';

import { configPrintCommand } from './print.js';

export const configCommand = Command.make('config', {}).pipe(Command.withSubcommands([configPrintCommand]));
