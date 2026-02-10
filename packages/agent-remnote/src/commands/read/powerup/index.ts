import { Command } from '@effect/cli';

import { readPowerupListCommand } from './list.js';
import { readPowerupResolveCommand } from './resolve.js';
import { readPowerupSchemaCommand } from './schema.js';
import { readPowerupTodoCommand } from './todo/index.js';

export const readPowerupCommand = Command.make('powerup', {}).pipe(
  Command.withSubcommands([readPowerupListCommand, readPowerupResolveCommand, readPowerupSchemaCommand, readPowerupTodoCommand]),
);
