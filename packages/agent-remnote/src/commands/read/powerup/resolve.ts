import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { failInRemoteMode } from '../../_remoteMode.js';
import { resolvePowerup } from '../../_powerup.js';
import { writeFailure, writeSuccess } from '../../_shared.js';

export const readPowerupResolveCommand = Command.make('resolve', { powerup: Options.text('powerup') }, ({ powerup }) =>
  Effect.gen(function* () {
    yield* failInRemoteMode({
      command: 'powerup resolve',
      reason: 'this command still resolves powerups from the local RemNote database',
    });
    const resolved = yield* resolvePowerup(powerup);
    yield* writeSuccess({
      data: resolved,
      md: [
        `- matched_by: ${resolved.matchedBy}`,
        `- powerup_id: ${resolved.id}`,
        `- title: ${resolved.title}`,
        `- code: ${resolved.rcrt}`,
      ].join('\n'),
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
