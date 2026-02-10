import { Command } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

function makeConsole(): Console.Console {
  const unsafe = console as any;
  return {
    assert: (condition, ...args) => Effect.sync(() => unsafe.assert(condition, ...args)),
    clear: Effect.sync(() => unsafe.clear()),
    count: (label) => Effect.sync(() => unsafe.count(label)),
    countReset: (label) => Effect.sync(() => unsafe.countReset(label)),
    debug: (...args) => Effect.sync(() => unsafe.debug(...args)),
    dir: (item, options) => Effect.sync(() => unsafe.dir(item, options)),
    dirxml: (...args) => Effect.sync(() => unsafe.dirxml(...args)),
    error: (...args) => Effect.sync(() => unsafe.error(...args)),
    group: (options) =>
      Effect.sync(() => {
        const label = options?.label;
        if (options?.collapsed) unsafe.groupCollapsed(label);
        else unsafe.group(label);
      }),
    groupEnd: Effect.sync(() => unsafe.groupEnd()),
    info: (...args) => Effect.sync(() => unsafe.info(...args)),
    log: (...args) => Effect.sync(() => unsafe.log(...args)),
    table: (tabularData, properties) => Effect.sync(() => unsafe.table(tabularData, properties)),
    time: (label) => Effect.sync(() => unsafe.time(label)),
    timeEnd: (label) => Effect.sync(() => unsafe.timeEnd(label)),
    timeLog: (label, ...args) => Effect.sync(() => unsafe.timeLog(label, ...args)),
    trace: (...args) => Effect.sync(() => unsafe.trace(...args)),
    warn: (...args) => Effect.sync(() => unsafe.warn(...args)),
    unsafe,
  };
}

// Minimal reproduction for "@effect/cli --help duplicates command prefixes".
// Expected command list (no duplicates):
//   - a
//   - a b
//   - a b c
//
// Buggy output (seen on @effect/cli@0.73.x):
//   - a b a a b c
const c = Command.make('c', {});
const b = Command.make('b', {}).pipe(Command.withSubcommands([c]));
const a = Command.make('a', {}).pipe(Command.withSubcommands([b]));
const root = Command.make('demo', {}).pipe(Command.withSubcommands([a]));

const cli = Command.run(root, { name: 'demo', version: '0.0.0' });

NodeRuntime.runMain(
  cli(process.argv).pipe(Effect.provide(Layer.mergeAll(NodeContext.layer, Console.setConsole(makeConsole()))), Effect.scoped),
);

