import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { writeFailure } from '../../../_shared.js';

import { todoWriteEffect } from './todoAdd.js';
import { optionToUndefined, writeCommonOptions } from '../../_shared.js';

const dispatchMode = Options.choice('dispatch-mode', ['serial', 'conflict_parallel'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);

export const writePowerupTodoUndoneCommand = Command.make(
  'undone',
  {
    rem: Options.text('rem'),
    tagId: Options.text('tag-id').pipe(Options.optional, Options.map(optionToUndefined)),
    due: Options.text('due').pipe(Options.optional, Options.map(optionToUndefined)),
    values: Options.text('values').pipe(Options.optional, Options.map(optionToUndefined)),

    notify: writeCommonOptions.notify,
    ensureDaemon: writeCommonOptions.ensureDaemon,
    wait: writeCommonOptions.wait,
    timeoutMs: writeCommonOptions.timeoutMs,
    pollMs: writeCommonOptions.pollMs,
    dryRun: writeCommonOptions.dryRun,

    dispatchMode,
    priority: writeCommonOptions.priority,
    clientId: writeCommonOptions.clientId,
    idempotencyKey: writeCommonOptions.idempotencyKey,
    meta: writeCommonOptions.meta,
  },
  ({
    rem,
    tagId,
    due,
    values,
    notify,
    ensureDaemon,
    wait,
    timeoutMs,
    pollMs,
    dryRun,
    dispatchMode,
    priority,
    clientId,
    idempotencyKey,
    meta,
  }) =>
    todoWriteEffect({
      rem,
      tagId,
      status: 'unfinished',
      due,
      values,
      notify,
      ensureDaemon,
      wait,
      timeoutMs,
      pollMs,
      dryRun,
      dispatchMode,
      priority,
      clientId,
      idempotencyKey,
      meta,
    }).pipe(Effect.catchAll(writeFailure)),
);
