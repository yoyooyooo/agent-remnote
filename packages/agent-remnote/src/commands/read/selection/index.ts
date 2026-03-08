import { Command } from '@effect/cli';

import { readSelectionCurrentCommand } from './current.js';
import { readSelectionOutlineCommand } from './outline.js';
import { readSelectionRootsCommand } from './roots.js';
import { readSelectionSnapshotCommand } from './snapshot.js';

export const readSelectionCommand = Command.make('selection', {}).pipe(
  Command.withSubcommands([readSelectionSnapshotCommand, readSelectionRootsCommand, readSelectionCurrentCommand, readSelectionOutlineCommand]),
);
