import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { UserConfigFile } from '../../services/UserConfigFile.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const configUnsetCommand = Command.make('unset', { key: Options.text('key') }, ({ key }) =>
  Effect.gen(function* () {
    const userConfig = yield* UserConfigFile;
    const data = yield* userConfig.unset(key);
    yield* writeSuccess({
      data: {
        config_file: data.configFile,
        key: data.key,
        removed: data.removed,
        file_deleted: data.fileDeleted,
      },
      md: `${data.key} removed=${data.removed}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
