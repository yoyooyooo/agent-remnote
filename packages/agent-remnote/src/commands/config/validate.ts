import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { UserConfigFile } from '../../services/UserConfigFile.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const configValidateCommand = Command.make('validate', {}, () =>
  Effect.gen(function* () {
    const userConfig = yield* UserConfigFile;
    const inspection = yield* userConfig.inspect();
    const data = {
      config_file: inspection.configFile,
      exists: inspection.exists,
      valid: inspection.valid,
      values: inspection.values,
      unknown_keys: inspection.unknownKeys,
      errors: inspection.errors,
    };
    const mdLines = [
      `- config_file: ${data.config_file}`,
      `- exists: ${data.exists}`,
      `- valid: ${data.valid}`,
      `- apiBaseUrl: ${data.values.apiBaseUrl ?? ''}`,
      `- apiHost: ${data.values.apiHost ?? ''}`,
      `- apiPort: ${data.values.apiPort ?? ''}`,
      `- apiBasePath: ${data.values.apiBasePath ?? ''}`,
      `- unknown_keys: ${data.unknown_keys.join(', ')}`,
      `- errors: ${data.errors.join(' | ')}`,
    ];
    yield* writeSuccess({ data, md: `${mdLines.join('\n')}\n` });
  }).pipe(Effect.catchAll(writeFailure)),
);
