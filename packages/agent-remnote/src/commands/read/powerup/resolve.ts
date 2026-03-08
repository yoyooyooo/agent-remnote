import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { resolvePowerup } from '../../_powerup.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

export const readPowerupResolveCommand = Command.make('resolve', { powerup: Options.text('powerup') }, ({ powerup }) =>
  resolvePowerup(powerup).pipe(
    Effect.andThen((resolved) =>
      writeSuccess({
        data: resolved,
        md: [
          `- matched_by: ${resolved.matchedBy}`,
          `- powerup_id: ${resolved.id}`,
          `- title: ${resolved.title}`,
          `- code: ${resolved.rcrt}`,
        ].join('\n'),
      }),
    ),
    Effect.catchAll(writeFailure),
  ),
);
