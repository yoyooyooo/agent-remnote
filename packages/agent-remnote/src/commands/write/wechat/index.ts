import { Command } from '@effect/cli';

import { wechatOutlineCommand } from './outline.js';

export const writeWechatCommand = Command.make('wechat', {}).pipe(Command.withSubcommands([wechatOutlineCommand]));
