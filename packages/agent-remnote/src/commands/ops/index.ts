import { Command } from '@effect/cli';

import { opsListCommand } from './list.js';
import { opsSchemaCommand } from './schema.js';

export const opsCommand = Command.make('ops', {}).pipe(Command.withSubcommands([opsListCommand, opsSchemaCommand]));
