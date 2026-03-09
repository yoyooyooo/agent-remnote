import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { UserConfigFile } from '../../services/UserConfigFile.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const configSetCommand = Command.make(
  'set',
  { key: Options.text('key'), value: Options.text('value') },
  ({ key, value }) =>
    Effect.gen(function* () {
      const userConfig = yield* UserConfigFile;
      const data = yield* userConfig.set(key, value);
      yield* writeSuccess({
        data: {
          config_file: data.configFile,
          key: data.key,
          value: data.value,
          changed: data.changed,
        },
        md: `${data.key}=${data.value}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
