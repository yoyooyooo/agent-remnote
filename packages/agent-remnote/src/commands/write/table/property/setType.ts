import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { CliError } from '../../../../services/Errors.js';
import { writeFailure } from '../../../_shared.js';
import { failUnsupportedPropertyTypeMutation } from '../../_propertyTypeRuntimeGuard.js';

import { writeCommonOptions } from '../../_shared.js';

export const writeTablePropertySetTypeCommand = Command.make(
  'set-type',
  {
    property: Options.text('property'),
    type: Options.text('type'),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({ wait, timeoutMs, pollMs, dryRun }) =>
    Effect.gen(function* () {
      if (!wait && (timeoutMs !== undefined || pollMs !== undefined)) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: 'Use --wait to enable --timeout-ms/--poll-ms',
            exitCode: 2,
          }),
        );
      }
      if (dryRun && wait) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--wait is not compatible with --dry-run',
            exitCode: 2,
          }),
        );
      }

      return yield* failUnsupportedPropertyTypeMutation('table');
    }).pipe(Effect.catchAll(writeFailure)),
);
