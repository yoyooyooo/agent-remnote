import { Command } from '@effect/cli';

import { readSelectionOutlineCommand } from './outline.js';
import { readSelectionRootsCommand } from './roots.js';
import { readSelectionSnapshotCommand } from './snapshot.js';

export const readSelectionCommand = Command.make('selection', {}).pipe(
  Command.withSubcommands([readSelectionSnapshotCommand, readSelectionRootsCommand, readSelectionOutlineCommand]),
);
