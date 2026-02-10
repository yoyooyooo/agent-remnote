import { Command } from '@effect/cli';

import { writeWechatCommand } from '../write/wechat/index.js';

import { importMarkdownCommand } from './markdown.js';

export const importCommand = Command.make('import', {}).pipe(Command.withSubcommands([importMarkdownCommand, writeWechatCommand]));

