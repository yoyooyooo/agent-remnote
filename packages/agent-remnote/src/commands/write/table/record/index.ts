import { Command } from '@effect/cli';

import { writeTableRecordAddCommand } from './add.js';
import { writeTableRecordDeleteCommand } from './delete.js';
import { writeTableRecordUpdateCommand } from './update.js';

export const writeTableRecordCommand = Command.make('record', {}).pipe(
  Command.withSubcommands([writeTableRecordAddCommand, writeTableRecordUpdateCommand, writeTableRecordDeleteCommand]),
);

