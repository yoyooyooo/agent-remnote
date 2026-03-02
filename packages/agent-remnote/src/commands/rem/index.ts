import { Command } from '@effect/cli';

import { readByReferenceCommand } from '../read/by-reference.js';
import { readConnectionsCommand } from '../read/connections.js';
import { readInspectCommand } from '../read/inspect.js';
import { readOutlineCommand } from '../read/outline.js';
import { readPageIdCommand } from '../read/page-id.js';
import { readReferencesCommand } from '../read/references.js';
import { readResolveRefCommand } from '../read/resolve-ref.js';

import { writeRemCreateCommand } from '../write/rem/create.js';
import { writeRemDeleteCommand } from '../write/rem/delete.js';
import { writeRemMoveCommand } from '../write/rem/move.js';
import { writeRemTagCommand } from '../write/rem/tag/index.js';
import { writeRemSetTextCommand } from '../write/rem/text.js';

export const remCommand = Command.make('rem', {}).pipe(
  Command.withSubcommands([
    writeRemCreateCommand,
    writeRemMoveCommand,
    writeRemSetTextCommand,
    writeRemTagCommand,
    writeRemDeleteCommand,
    readInspectCommand,
    readOutlineCommand,
    readPageIdCommand,
    readResolveRefCommand,
    readConnectionsCommand,
    readReferencesCommand,
    readByReferenceCommand,
  ]),
);
