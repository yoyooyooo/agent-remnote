import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { UserConfigFile } from '../../services/UserConfigFile.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const configPathCommand = Command.make('path', {}, () =>
  Effect.gen(function* () {
    const userConfig = yield* UserConfigFile;
    const configFile = yield* userConfig.path();
    yield* writeSuccess({
      data: { config_file: configFile },
      md: `${configFile}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
