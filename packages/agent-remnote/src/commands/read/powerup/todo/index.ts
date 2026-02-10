import { Command } from '@effect/cli';

import { makeTodosListCommand } from '../../todos/list.js';

export const readPowerupTodoCommand = Command.make('todo', {}).pipe(Command.withSubcommands([makeTodosListCommand()]));
