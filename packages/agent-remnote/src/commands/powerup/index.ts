import { Command } from '@effect/cli';

import { readPowerupListCommand } from '../read/powerup/list.js';
import { readPowerupResolveCommand } from '../read/powerup/resolve.js';
import { readPowerupSchemaCommand } from '../read/powerup/schema.js';
import { powerupTodoCommand } from '../todo/index.js';

import { writePowerupApplyCommand } from '../write/powerup/apply.js';
import { writePowerupOptionCommand } from '../write/powerup/option/index.js';
import { writePowerupPropertyCommand } from '../write/powerup/property/index.js';
import { writePowerupRecordCommand } from '../write/powerup/record/index.js';
import { writePowerupRemoveCommand } from '../write/powerup/remove.js';

export const powerupCommand = Command.make('powerup', {}).pipe(
  Command.withSubcommands([
    readPowerupListCommand,
    readPowerupResolveCommand,
    readPowerupSchemaCommand,
    writePowerupApplyCommand,
    writePowerupRemoveCommand,
    writePowerupRecordCommand,
    writePowerupPropertyCommand,
    writePowerupOptionCommand,
    powerupTodoCommand,
  ]),
);
