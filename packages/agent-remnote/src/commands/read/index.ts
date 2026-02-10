import { Command } from '@effect/cli';

import { readDailyCommand } from './daily/index.js';
import { readDbCommand } from './db/index.js';
import { readByReferenceCommand } from './by-reference.js';
import { readConnectionsCommand } from './connections.js';
import { readInspectCommand } from './inspect.js';
import { readOutlineCommand } from './outline.js';
import { readPageIdCommand } from './page-id.js';
import { readPowerupCommand } from './powerup/index.js';
import { readQueryCommand } from './query.js';
import { readReferencesCommand } from './references.js';
import { readResolveRefCommand } from './resolve-ref.js';
import { readSearchCommand } from './search.js';
import { readSearchPluginCommand } from './search-plugin.js';
import { readSelectionCommand } from './selection/index.js';
import { readTableCommand } from './table.js';
import { readTodosCommand } from './todos/index.js';
import { readTopicCommand } from './topic/index.js';
import { readUiContextCommand } from './uiContext/index.js';

export const readCommand = Command.make('read', {}).pipe(
  Command.withSubcommands([
    readDbCommand,
    readDailyCommand,
    readTodosCommand,
    readTopicCommand,
    readSearchCommand,
    readSearchPluginCommand,
    readQueryCommand,
    readSelectionCommand,
    readUiContextCommand,
    readPageIdCommand,
    readPowerupCommand,
    readOutlineCommand,
    readInspectCommand,
    readResolveRefCommand,
    readConnectionsCommand,
    readReferencesCommand,
    readByReferenceCommand,
    readTableCommand,
  ]),
);
