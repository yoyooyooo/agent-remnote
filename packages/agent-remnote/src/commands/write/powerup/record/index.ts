import { Command } from '@effect/cli';

import { writePowerupRecordAddCommand } from './add.js';
import { writePowerupRecordDeleteCommand } from './delete.js';
import { writePowerupRecordUpdateCommand } from './update.js';

export const writePowerupRecordCommand = Command.make('record', {}).pipe(
  Command.withSubcommands([
    writePowerupRecordAddCommand,
    writePowerupRecordUpdateCommand,
    writePowerupRecordDeleteCommand,
  ]),
);
