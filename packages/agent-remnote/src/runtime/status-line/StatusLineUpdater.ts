import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import type { CliError } from '../../services/Errors.js';
import { AppConfig } from '../../services/AppConfig.js';
import { Queue } from '../../services/Queue.js';
import { StatusLineFile } from '../../services/StatusLineFile.js';
import { Tmux } from '../../services/Tmux.js';
import { WsBridgeState } from '../../services/WsBridgeState.js';

import { updateStatusLine, type StatusLineSource } from './updateStatusLine.js';

export interface StatusLineUpdaterService {
  readonly update: (params: { readonly source: StatusLineSource }) => Effect.Effect<{ readonly text: string; readonly wrote: boolean }, CliError>;
}

export class StatusLineUpdater extends Context.Tag('StatusLineUpdater')<StatusLineUpdater, StatusLineUpdaterService>() {}

export const StatusLineUpdaterLive = Layer.effect(
  StatusLineUpdater,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;
    const wsState = yield* WsBridgeState;
    const statusLineFile = yield* StatusLineFile;
    const tmux = yield* Tmux;

    return {
      update: (params) =>
        updateStatusLine(params).pipe(
          Effect.provideService(AppConfig, cfg),
          Effect.provideService(Queue, queue),
          Effect.provideService(WsBridgeState, wsState),
          Effect.provideService(StatusLineFile, statusLineFile),
          Effect.provideService(Tmux, tmux),
        ),
    } satisfies StatusLineUpdaterService;
  }),
);
