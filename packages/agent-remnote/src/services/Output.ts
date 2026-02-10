import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import type { JsonEnvelope } from './Errors.js';

export interface OutputService {
  readonly stdout: (text: string) => Effect.Effect<void>;
  readonly stderr: (text: string) => Effect.Effect<void>;
  readonly json: (value: JsonEnvelope) => Effect.Effect<void>;
}

export class Output extends Context.Tag('Output')<Output, OutputService>() {}

export const OutputLive = Layer.succeed(Output, {
  stdout: (text) =>
    Effect.sync(() => {
      process.stdout.write(text);
    }),
  stderr: (text) =>
    Effect.sync(() => {
      process.stderr.write(text);
    }),
  json: (value) =>
    Effect.sync(() => {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    }),
} satisfies OutputService);
