import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { UserConfigFile } from '../../services/UserConfigFile.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const configGetCommand = Command.make('get', { key: Options.text('key') }, ({ key }) =>
  Effect.gen(function* () {
    const userConfig = yield* UserConfigFile;
    const data = yield* userConfig.get(key);
    yield* writeSuccess({
      data: {
        config_file: data.configFile,
        key: data.key,
        exists: data.exists,
        value: data.value,
      },
      md: data.value === null ? '' : `${data.value}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
