import { Command } from '@effect/cli';

import { readUiContextDescribeCommand } from './describe.js';
import { readUiContextFocusedRemCommand } from './focused-rem.js';
import { readUiContextPageCommand } from './page.js';
import { readUiContextSnapshotCommand } from './snapshot.js';

export const readUiContextCommand = Command.make('ui-context', {}).pipe(
  Command.withSubcommands([
    readUiContextSnapshotCommand,
    readUiContextPageCommand,
    readUiContextFocusedRemCommand,
    readUiContextDescribeCommand,
  ]),
);
