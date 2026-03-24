import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { defaultUserScenarioDir, listBuiltinScenarioEntries } from '../../../lib/scenario-store/index.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

export const scenarioBuiltinListCommand = Command.make('list', {}, () =>
  Effect.gen(function* () {
    const entries = listBuiltinScenarioEntries();
    const installDir = defaultUserScenarioDir();
    const md = [
      `- install_dir_default: ${installDir}`,
      ...entries.map((entry) => `- ${entry.id}: ${entry.title}`),
    ].join('\n');

    yield* writeSuccess({
      data: {
        install_dir_default: installDir,
        entries,
      },
      md,
    });
  }).pipe(Effect.catchAll(writeFailure)),
).pipe(Command.withDescription('List builtin scenario packages and the default user install directory.'));
