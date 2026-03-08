import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { runHttpApiRuntime } from '../../runtime/http-api/runHttpApiRuntime.js';
import { writeFailure } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const host = Options.text('host').pipe(Options.optional, Options.map(optionToUndefined));
const port = Options.integer('port').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const apiServeCommand = Command.make('serve', { host, port, stateFile }, ({ host, port, stateFile }) =>
  runHttpApiRuntime({ host, port, stateFile }).pipe(Effect.catchAll(writeFailure)),
);
