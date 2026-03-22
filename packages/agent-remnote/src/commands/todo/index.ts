import { Command } from '@effect/cli';

import { todosListCommand } from '../read/todos/list.js';
import { writePowerupTodoAddCommand } from '../write/powerup/todo/todoAdd.js';
import { writePowerupTodoDoneCommand } from '../write/powerup/todo/todoDone.js';
import { writePowerupTodoRemoveCommand } from '../write/powerup/todo/todoRemove.js';
import { writePowerupTodoUndoneCommand } from '../write/powerup/todo/todoUndone.js';

export const todoSubcommands = [
  todosListCommand,
  writePowerupTodoAddCommand,
  writePowerupTodoDoneCommand,
  writePowerupTodoUndoneCommand,
  writePowerupTodoRemoveCommand,
] as const;

export const todoCommand = Command.make('todo', {}).pipe(Command.withSubcommands(todoSubcommands));

export const powerupTodoCommand = Command.make('todo', {}).pipe(Command.withSubcommands(todoSubcommands));
