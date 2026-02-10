import { Command } from '@effect/cli';

import { writeAdvancedCommand } from './advanced/index.js';
import { writeBulletCommand } from './bullet.js';
import { writeDailyCommand } from './daily.js';
import { writeMdCommand } from './md.js';
import { writePlanCommand } from './plan.js';
import { writePortalCommand } from './portal/index.js';
import { writePowerupCommand } from './powerup/index.js';
import { writeReplaceCommand } from './replace/index.js';
import { writeRemCommand } from './rem/index.js';
import { writeTableCommand } from './table/index.js';
import { writeTagCommand } from './tag/index.js';
import { writeWechatCommand } from './wechat/index.js';

export const writeCommand = Command.make('write', {}).pipe(
  Command.withSubcommands([
    writeMdCommand,
    writeBulletCommand,
    writeDailyCommand,
    writePlanCommand,
    writeTagCommand,
    writeRemCommand,
    writePortalCommand,
    writeTableCommand,
    writePowerupCommand,
    writeReplaceCommand,
    writeWechatCommand,
    writeAdvancedCommand,
  ]),
);
