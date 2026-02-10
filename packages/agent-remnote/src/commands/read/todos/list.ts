import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { executeListTodos } from '../../../adapters/core.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { cliErrorFromUnknown } from '../../_tool.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const status = Options.choice('status', ['unfinished', 'finished', 'all'] as const).pipe(
  Options.optional,
  Options.map(optionToUndefined),
);
const sort = Options.choice(
  'sort',
  ['dueAsc', 'dueDesc', 'updatedAtAsc', 'updatedAtDesc', 'createdAtAsc', 'createdAtDesc'] as const,
).pipe(Options.optional, Options.map(optionToUndefined));
const tagId = Options.text('tag-id').pipe(Options.repeated);
const tagTitle = Options.text('tag-title').pipe(Options.repeated);
const preferTodoOnly = Options.boolean('prefer-todo-only');
const preferTodoFirst = Options.boolean('prefer-todo-first');
const includeDescendants = Options.boolean('no-descendants').pipe(Options.map((v) => !v));
const ancestor = Options.text('ancestor').pipe(Options.optional, Options.map(optionToUndefined));
const dueBefore = Options.text('due-before').pipe(Options.optional, Options.map(optionToUndefined));
const dueAfter = Options.text('due-after').pipe(Options.optional, Options.map(optionToUndefined));
const includeTagOnlyWhenNoStatus = Options.boolean('no-tag-only-when-no-status').pipe(Options.map((v) => !v));

const statusAttrTitle = Options.text('status-attr-title').pipe(Options.repeated);
const unfinishedOptionTitle = Options.text('unfinished-option-title').pipe(Options.repeated);
const finishedOptionTitle = Options.text('finished-option-title').pipe(Options.repeated);
const dueDateAttrTitle = Options.text('due-date-attr-title').pipe(Options.repeated);

const alwaysIncludeTagOnlyTitle = Options.text('always-include-tag-only-title').pipe(Options.repeated);

const snippetLength = Options.integer('snippet-length').pipe(Options.optional, Options.map(optionToUndefined));
const limit = Options.integer('limit').pipe(Options.withDefault(20));
const offset = Options.integer('offset').pipe(Options.withDefault(0));

export function makeTodosListCommand() {
  return Command.make(
    'list',
    {
      status,
      sort,
      tagId,
      tagTitle,
      preferTodoOnly,
      preferTodoFirst,
      includeDescendants,
      ancestor,
      dueBefore,
      dueAfter,
      includeTagOnlyWhenNoStatus,
      statusAttrTitle,
      unfinishedOptionTitle,
      finishedOptionTitle,
      dueDateAttrTitle,
      alwaysIncludeTagOnlyTitle,
      snippetLength,
      limit,
      offset,
    },
    ({
      status,
      sort,
      tagId,
      tagTitle,
      preferTodoOnly,
      preferTodoFirst,
      includeDescendants,
      ancestor,
      dueBefore,
      dueAfter,
      includeTagOnlyWhenNoStatus,
      statusAttrTitle,
      unfinishedOptionTitle,
      finishedOptionTitle,
      dueDateAttrTitle,
      alwaysIncludeTagOnlyTitle,
      snippetLength,
      limit,
      offset,
    }) =>
      Effect.gen(function* () {
        const cfg = yield* AppConfig;
        const payload = yield* Effect.tryPromise({
          try: async () =>
            await executeListTodos({
              dbPath: cfg.remnoteDb,
              status: status as any,
              sort: sort as any,
              ancestorId: ancestor,
              includeDescendants,
              dueBefore: dueBefore as any,
              dueAfter: dueAfter as any,
              tagIds: tagId && tagId.length > 0 ? tagId : undefined,
              tagTitles: tagTitle && tagTitle.length > 0 ? tagTitle : undefined,
              preferTodoOnly,
              preferTodoFirst,
              includeTagOnlyWhenNoStatus,
              statusAttrTitles: statusAttrTitle && statusAttrTitle.length > 0 ? statusAttrTitle : undefined,
              unfinishedOptionTitles:
                unfinishedOptionTitle && unfinishedOptionTitle.length > 0 ? unfinishedOptionTitle : undefined,
              finishedOptionTitles: finishedOptionTitle && finishedOptionTitle.length > 0 ? finishedOptionTitle : undefined,
              dueDateAttrTitles: dueDateAttrTitle && dueDateAttrTitle.length > 0 ? dueDateAttrTitle : undefined,
              alwaysIncludeTagOnlyTitles:
                alwaysIncludeTagOnlyTitle && alwaysIncludeTagOnlyTitle.length > 0 ? alwaysIncludeTagOnlyTitle : undefined,
              snippetLength: snippetLength as any,
              limit: limit as any,
              offset: offset as any,
            } as any),
          catch: (e) => cliErrorFromUnknown(e, { code: 'DB_UNAVAILABLE' }),
        });

        yield* writeSuccess({ data: payload, md: (payload as any).markdown ?? '' });
      }).pipe(Effect.catchAll(writeFailure)),
  );
}

export const todosListCommand = makeTodosListCommand();
