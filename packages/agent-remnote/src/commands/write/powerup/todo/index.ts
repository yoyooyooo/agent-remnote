import { Command } from '@effect/cli';

import { writePowerupTodoAddCommand } from './todoAdd.js';
import { writePowerupTodoDoneCommand } from './todoDone.js';
import { writePowerupTodoRemoveCommand } from './todoRemove.js';
import { writePowerupTodoUndoneCommand } from './todoUndone.js';

export const writePowerupTodoCommand = Command.make('todo', {}).pipe(
  Command.withSubcommands([
    writePowerupTodoAddCommand,
    writePowerupTodoDoneCommand,
    writePowerupTodoUndoneCommand,
    writePowerupTodoRemoveCommand,
  ]),
);
