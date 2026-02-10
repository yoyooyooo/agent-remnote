import { Command } from '@effect/cli';

import { todosListCommand } from './list.js';

export const readTodosCommand = Command.make('todos', {}).pipe(Command.withSubcommands([todosListCommand]));
