import { Command } from '@effect/cli';

import { writePowerupApplyCommand } from './apply.js';
import { writePowerupOptionCommand } from './option/index.js';
import { writePowerupPropertyCommand } from './property/index.js';
import { writePowerupRecordCommand } from './record/index.js';
import { writePowerupRemoveCommand } from './remove.js';
import { writePowerupTodoCommand } from './todo/index.js';

export const writePowerupCommand = Command.make('powerup', {}).pipe(
  Command.withSubcommands([
    writePowerupApplyCommand,
    writePowerupRemoveCommand,
    writePowerupRecordCommand,
    writePowerupPropertyCommand,
    writePowerupOptionCommand,
    writePowerupTodoCommand,
  ]),
);
