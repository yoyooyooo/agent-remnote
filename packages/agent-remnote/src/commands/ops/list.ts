import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { TYPES } from '../../adapters/core.js';

import { writeFailure, writeSuccess } from '../_shared.js';

export const opsListCommand = Command.make('list', {}, () =>
  Effect.gen(function* () {
    const types = Object.keys(TYPES).sort();
    yield* writeSuccess({
      data: { types },
      ids: types,
      md: types.map((t) => `- ${t}`).join('\n'),
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
