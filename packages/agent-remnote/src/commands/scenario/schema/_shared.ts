import * as Effect from 'effect/Effect';

import { Payload } from '../../../services/Payload.js';

export function readJsonSpec(spec: string): Effect.Effect<unknown, any, Payload> {
  return Effect.gen(function* () {
    const payload = yield* Payload;
    return yield* payload.readJson(spec);
  });
}
