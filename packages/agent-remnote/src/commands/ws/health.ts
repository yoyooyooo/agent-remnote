import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { writeFailure, writeSuccess } from '../_shared.js';
import { AppConfig } from '../../services/AppConfig.js';
import { WsClient } from '../../services/WsClient.js';
import { WS_HEALTH_TIMEOUT_MS } from './_shared.js';

export const wsHealthCommand = Command.make('health', {}, () =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const result = yield* ws.health({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS });

    yield* writeSuccess({
      data: result,
      md: `- url: ${result.url}\n- rtt_ms: ${result.rtt_ms}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
