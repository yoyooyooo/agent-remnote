import * as Options from '@effect/cli/Options';
import * as Option from 'effect/Option';

export function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

export function readOptionalText(name: string) {
  return Options.text(name).pipe(Options.optional, Options.map(optionToUndefined));
}

export const writeCommonOptions = {
  notify: Options.boolean('no-notify').pipe(Options.map((v) => !v)),
  ensureDaemon: Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v)),
  wait: Options.boolean('wait'),
  timeoutMs: Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined)),
  pollMs: Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined)),
  dryRun: Options.boolean('dry-run'),

  priority: Options.integer('priority').pipe(Options.optional, Options.map(optionToUndefined)),
  clientId: readOptionalText('client-id'),
  idempotencyKey: readOptionalText('idempotency-key'),
  meta: readOptionalText('meta'),
} as const;
