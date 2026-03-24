import * as Args from '@effect/cli/Args';
import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Runtime from 'effect/Runtime';

import { invokeWave1Capability } from '../../lib/business-semantics/modeParityRuntime.js';
import { executeScenarioRun } from '../../lib/scenario-runtime/index.js';
import { resolveScenarioPackageSpec } from '../../lib/scenario-store/index.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Payload } from '../../services/Payload.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const packageOption = Options.text('package').pipe(
  Options.optional,
  Options.map(optionToUndefined),
  Options.withDescription('Scenario package spec. Compatibility alias for the positional <package> argument.'),
);
const packageArg = Args.text({ name: 'package' }).pipe(
  Args.optional,
  Args.withDescription('Scenario package spec. Preferred agent-first input slot for builtin:<id>, user:<id>, or @file.'),
);
const vars = Options.text('var').pipe(Options.repeated);
const wait = Options.boolean('wait');
const dryRun = Options.boolean('dry-run');
const timeoutMs = Options.integer('timeout-ms').pipe(Options.optional, Options.map(optionToUndefined));
const pollMs = Options.integer('poll-ms').pipe(Options.optional, Options.map(optionToUndefined));

function parseVarSpecs(items: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    const raw = String(item ?? '');
    const index = raw.indexOf('=');
    if (index <= 0) continue;
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function resolvePackageSpec(packageOptionValue: string | undefined, packageArgValue: Option.Option<string>): Effect.Effect<string, CliError> {
  return Effect.gen(function* () {
    const positional = Option.isSome(packageArgValue) ? packageArgValue.value.trim() : undefined;
    const named = packageOptionValue?.trim();

    if (named && positional && named !== positional) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Positional package spec and --package must match when both are provided',
          exitCode: 2,
          details: { package: named, positional_package: positional },
        }),
      );
    }

    const resolved = named || positional;
    if (!resolved) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: 'Scenario package spec is required',
          exitCode: 2,
          hint: ['Use `scenario run <spec>` or `scenario run --package <spec>`.'],
        }),
      );
    }

    return resolved;
  });
}

function readScenarioPackage(spec: string): Effect.Effect<unknown, CliError, Payload> {
  return Effect.gen(function* () {
    const payload = yield* Payload;
    const runtime = yield* Effect.runtime<Payload>();
    const runPromise = Runtime.runPromise(runtime);
    const resolved = yield* Effect.tryPromise({
      try: () =>
        resolveScenarioPackageSpec(spec, {
          readJson: async (inputSpec) => await runPromise(payload.readJson(inputSpec)),
        }),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'INTERNAL',
              message: String((error as any)?.message || error || 'scenario package resolution failed'),
              exitCode: 1,
            }),
    });
    return resolved.packageInput;
  });
}

export const scenarioRunCommand = Command.make(
  'run',
  { package: packageOption, packageArg, var: vars, wait, dryRun, timeoutMs, pollMs },
  ({ package: packageOptionValue, packageArg, var: varSpecs, wait, dryRun, timeoutMs, pollMs }) =>
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

      const scenarioPackageSpec = yield* resolvePackageSpec(packageOptionValue, packageArg);
      const scenarioPackage = yield* readScenarioPackage(scenarioPackageSpec);
      const varsBound = parseVarSpecs(varSpecs);
      const runtime = yield* Effect.runtime<any>();
      const runPromise = Runtime.runPromise(runtime);
      const result = yield* Effect.tryPromise({
        try: () =>
          executeScenarioRun(
            {
              scenarioPackage,
              vars: varsBound,
              dryRun,
            },
            {
              runQuery: async ({ query }) => {
                const data: any = await runPromise(
                  invokeWave1Capability('read.query', {
                    query,
                    limit: 100,
                    offset: 0,
                    snippetLength: 120,
                  }),
                );
                return {
                  items: Array.isArray(data?.items)
                    ? data.items
                        .map((item: any) => ({ rem_id: String(item?.id ?? '').trim() }))
                        .filter((item: { rem_id: string }) => item.rem_id)
                    : [],
                  total_selected: Number(data?.totalMatched ?? 0),
                  truncated: data?.hasMore === true,
                };
              },
              submitApply: async ({ envelope }) =>
                await runPromise(
                  invokeWave1Capability('write.apply', {
                    body: envelope,
                    wait,
                    timeoutMs,
                    pollMs,
                  }),
                ),
            },
          ),
        catch: (error) =>
          isCliError(error)
            ? error
            : new CliError({
                code: 'INTERNAL',
                message: String((error as any)?.message || error || 'scenario run failed'),
                exitCode: 1,
              }),
      });

      yield* writeSuccess({
        data: {
          phase: result.phase,
          submission: result.submission,
          plan: result.plan,
        },
        md: `- phase: ${result.phase}\n- submitted: ${result.submission ? 'true' : 'false'}\n`,
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
