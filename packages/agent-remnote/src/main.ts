import { Command } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import * as ValidationError from '@effect/cli/ValidationError';
import * as Cause from 'effect/Cause';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import { readFileSync } from 'node:fs';
import { format } from 'node:util';

import { rootCommand } from './commands/index.js';
import { buildCliEnvConfigProvider } from './services/CliConfigProvider.js';
import { cliErrorFromValidationError, exitCodeFromExit, fail, isCliError, toJsonError } from './services/Errors.js';
import { CliError } from './services/Errors.js';

function packageVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.version === 'string' && parsed.version.length > 0) return parsed.version;
  } catch {}
  return '0.0.0';
}

const version = packageVersion();
if (!process.env.AGENT_REMNOTE_VERSION) process.env.AGENT_REMNOTE_VERSION = version;

const cli = Command.run(rootCommand, {
  name: 'agent-remnote',
  version,
});

const jsonRequested = process.argv.includes('--json');
const debugRequested = process.argv.includes('--debug');

function canonicalizeArgv(argv: readonly string[]): string[] {
  const out = [...argv];
  for (let i = 0; i < out.length; i += 1) {
    const t = String(out[i] ?? '');
    if (!t.startsWith('--')) continue;
    if (t === '--queue-db') {
      out[i] = '--store-db';
      continue;
    }
    if (t.startsWith('--queue-db=')) {
      out[i] = `--store-db=${t.slice('--queue-db='.length)}`;
      continue;
    }
  }
  return out;
}

const argv = canonicalizeArgv(process.argv);

type CommandNode = {
  readonly name: string;
  readonly children: ReadonlyMap<string, CommandNode>;
};

function unwrapCommandDescriptor(desc: any): any {
  let cur = desc;
  while (cur && typeof cur === 'object' && cur._tag === 'Map' && cur.command) {
    cur = cur.command;
  }
  return cur;
}

function getCommandName(desc: any): string {
  const unwrapped = unwrapCommandDescriptor(desc);
  if (!unwrapped || typeof unwrapped !== 'object') return '';
  if (unwrapped._tag === 'Standard' || unwrapped._tag === 'GetUserInput') return String(unwrapped.name ?? '');
  if (unwrapped._tag === 'Subcommands') return getCommandName(unwrapped.parent);
  return '';
}

function getCommandChildren(desc: any): readonly any[] {
  const unwrapped = unwrapCommandDescriptor(desc);
  if (!unwrapped || typeof unwrapped !== 'object') return [];
  if (unwrapped._tag !== 'Subcommands') return [];
  return Array.isArray(unwrapped.children) ? unwrapped.children : [];
}

function buildCommandTree(desc: any): CommandNode {
  const name = getCommandName(desc);
  const children = new Map<string, CommandNode>();
  for (const child of getCommandChildren(desc)) {
    const node = buildCommandTree(child);
    if (node.name) children.set(node.name, node);
  }
  return { name, children };
}

const ROOT_BOOL_FLAGS = new Set(['--json', '--md', '--ids', '--quiet', '--debug']);

const BUILTIN_BOOL_FLAGS = new Set(['--help', '-h', '--wizard', '--version']);
const BUILTIN_VALUE_FLAGS = new Set(['--completions', '--log-level']);

const ROOT_VALUE_FLAGS = new Set([
  '--remnote-db',
  '--store-db',
  '--daemon-url',
  '--ws-port',
  '--repo',
  '--api-base-url',
  '--config-file',
  ...BUILTIN_VALUE_FLAGS,
]);

function parseRootConfigFromArgv(argv: readonly string[]): Map<string, string> {
  const tokens = argv.slice(2);
  const out = new Map<string, string>();

  let i = 0;
  while (i < tokens.length) {
    const raw = String(tokens[i] ?? '');
    if (!raw) break;
    if (raw === '--') break;
    if (!raw.startsWith('-')) break;

    const { flag, inlineValue } = splitFlagInlineValue(raw);

    if (ROOT_BOOL_FLAGS.has(flag)) {
      const key = flag.slice(2);
      if (inlineValue !== null) {
        out.set(key, inlineValue.trim().toLowerCase());
        i += 1;
        continue;
      }
      const next = tokens[i + 1];
      if (typeof next === 'string' && isBooleanLiteralToken(next)) {
        out.set(key, next.trim().toLowerCase());
        i += 2;
        continue;
      }
      out.set(key, 'true');
      i += 1;
      continue;
    }

    if (ROOT_VALUE_FLAGS.has(flag)) {
      const key =
        flag === '--remnote-db'
          ? 'remnoteDb'
          : flag === '--store-db'
            ? 'storeDb'
            : flag === '--daemon-url'
              ? 'daemonUrl'
              : flag === '--ws-port'
                ? 'wsPort'
                : flag === '--repo'
                  ? 'repo'
                  : flag === '--api-base-url'
                    ? 'apiBaseUrl'
                    : flag === '--config-file'
                      ? 'configFile'
                      : null;
      if (inlineValue !== null) {
        if (key) out.set(key, inlineValue);
        i += 1;
        continue;
      }
      const next = tokens[i + 1];
      if (typeof next !== 'string') break;
      if (key) out.set(key, next);
      i += 2;
      continue;
    }

    if (BUILTIN_BOOL_FLAGS.has(flag)) {
      if (inlineValue !== null) {
        i += 1;
        continue;
      }
      const next = tokens[i + 1];
      if (typeof next === 'string' && isBooleanLiteralToken(next)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // Unknown / unexpected: stop (strictCliPreflightOrExit will handle error reporting).
    break;
  }

  return out;
}

function isBooleanLiteralToken(token: string): boolean {
  const v = token.trim().toLowerCase();
  return v === 'true' || v === 'false';
}

function splitFlagInlineValue(token: string): { readonly flag: string; readonly inlineValue: string | null } {
  if (!token.startsWith('--')) return { flag: token, inlineValue: null };
  const eq = token.indexOf('=');
  if (eq === -1) return { flag: token, inlineValue: null };
  return { flag: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

function isKnownRootFlag(flag: string): boolean {
  return ROOT_BOOL_FLAGS.has(flag) || ROOT_VALUE_FLAGS.has(flag) || BUILTIN_BOOL_FLAGS.has(flag);
}

function consumeRootFlag(
  tokens: readonly string[],
  index: number,
): { readonly nextIndex: number; readonly error: CliError | null } {
  const raw = String(tokens[index] ?? '');
  if (!raw) {
    return {
      nextIndex: index + 1,
      error: new CliError({ code: 'INVALID_ARGS', message: "Received unknown argument: ''", exitCode: 2 }),
    };
  }

  const { flag, inlineValue } = splitFlagInlineValue(raw);
  if (!isKnownRootFlag(flag)) {
    return {
      nextIndex: index + 1,
      error: new CliError({ code: 'INVALID_ARGS', message: `Received unknown argument: '${raw}'`, exitCode: 2 }),
    };
  }

  if (ROOT_VALUE_FLAGS.has(flag)) {
    if (inlineValue !== null) return { nextIndex: index + 1, error: null };
    if (index + 1 >= tokens.length) {
      return {
        nextIndex: index + 1,
        error: new CliError({
          code: 'INVALID_ARGS',
          message: `Expected a value following option: '${flag}'`,
          exitCode: 2,
        }),
      };
    }
    return { nextIndex: index + 2, error: null };
  }

  if (ROOT_BOOL_FLAGS.has(flag) || BUILTIN_BOOL_FLAGS.has(flag)) {
    if (inlineValue !== null && !isBooleanLiteralToken(inlineValue)) {
      return {
        nextIndex: index + 1,
        error: new CliError({
          code: 'INVALID_ARGS',
          message: `Invalid boolean value for option: '${flag}'`,
          exitCode: 2,
        }),
      };
    }
    if (inlineValue !== null) return { nextIndex: index + 1, error: null };

    const next = tokens[index + 1];
    if (typeof next === 'string' && isBooleanLiteralToken(next)) return { nextIndex: index + 2, error: null };
    return { nextIndex: index + 1, error: null };
  }

  return { nextIndex: index + 1, error: null };
}

function consumeBuiltInFlag(
  tokens: readonly string[],
  index: number,
): { readonly ok: boolean; readonly nextIndex: number; readonly error: CliError | null } {
  const raw = String(tokens[index] ?? '');
  const { flag, inlineValue } = splitFlagInlineValue(raw);

  if (BUILTIN_VALUE_FLAGS.has(flag)) {
    if (inlineValue !== null) return { ok: true, nextIndex: index + 1, error: null };
    if (index + 1 >= tokens.length) {
      return {
        ok: true,
        nextIndex: index + 1,
        error: new CliError({
          code: 'INVALID_ARGS',
          message: `Expected a value following option: '${flag}'`,
          exitCode: 2,
        }),
      };
    }
    return { ok: true, nextIndex: index + 2, error: null };
  }

  if (BUILTIN_BOOL_FLAGS.has(flag)) {
    if (inlineValue !== null && !isBooleanLiteralToken(inlineValue)) {
      return {
        ok: true,
        nextIndex: index + 1,
        error: new CliError({
          code: 'INVALID_ARGS',
          message: `Invalid boolean value for option: '${flag}'`,
          exitCode: 2,
        }),
      };
    }
    if (inlineValue !== null) return { ok: true, nextIndex: index + 1, error: null };

    const next = tokens[index + 1];
    if (typeof next === 'string' && isBooleanLiteralToken(next)) return { ok: true, nextIndex: index + 2, error: null };
    return { ok: true, nextIndex: index + 1, error: null };
  }

  return { ok: false, nextIndex: index, error: null };
}

function strictCliPreflight(tree: CommandNode, argv: readonly string[]): CliError | null {
  const tokens = argv.slice(2);
  if (tokens.length === 0) return null;

  let i = 0;
  while (i < tokens.length) {
    const t = String(tokens[i] ?? '');
    if (!t) return new CliError({ code: 'INVALID_ARGS', message: "Received unknown argument: ''", exitCode: 2 });
    if (t === '--') {
      i += 1;
      break;
    }
    if (!t.startsWith('-')) break;

    const consumed = consumeRootFlag(tokens, i);
    if (consumed.error) return consumed.error;
    i = consumed.nextIndex;
  }

  if (i >= tokens.length) return null;

  let node: CommandNode = tree;
  while (i < tokens.length) {
    const t = String(tokens[i] ?? '');
    if (!t) return null;
    if (t === '--') {
      if (node.children.size > 0) {
        return new CliError({
          code: 'INVALID_ARGS',
          message: `Unexpected argument: '${t}'`,
          exitCode: 2,
        });
      }
      return null;
    }

    if (t.startsWith('-')) {
      if (node.children.size === 0) return null;

      const builtIn = consumeBuiltInFlag(tokens, i);
      if (builtIn.ok) {
        if (builtIn.error) return builtIn.error;
        i = builtIn.nextIndex;
        continue;
      }

      const { flag } = splitFlagInlineValue(t);
      if (isKnownRootFlag(flag) && !BUILTIN_BOOL_FLAGS.has(flag) && !BUILTIN_VALUE_FLAGS.has(flag)) {
        return new CliError({
          code: 'INVALID_ARGS',
          message: `Global option '${flag}' must be specified before the first subcommand`,
          exitCode: 2,
        });
      }

      return new CliError({
        code: 'INVALID_ARGS',
        message: `Unexpected option '${t}' before specifying a subcommand for ${node.name || 'command'}`,
        exitCode: 2,
      });
    }

    if (node.children.size === 0) return null;

    const next = node.children.get(t);
    if (!next) return validateCommandTokens(node, [t]);
    node = next;
    i += 1;
  }

  return null;
}

function validateCommandTokens(tree: CommandNode, tokens: readonly string[]): CliError | null {
  let node: CommandNode = tree;
  for (const tokenRaw of tokens) {
    const token = String(tokenRaw ?? '').trim();
    if (!token) continue;

    const next = node.children.get(token);
    if (next) {
      node = next;
      continue;
    }

    if (node.children.size === 0) {
      return new CliError({
        code: 'INVALID_ARGS',
        message: `Received unknown argument: '${token}'`,
        exitCode: 2,
      });
    }

    const childNames = Array.from(node.children.keys()).map((n) => `'${n}'`);
    const oneOf = childNames.length === 1 ? '' : ' one of';
    return new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid subcommand for ${node.name || 'command'} - use${oneOf} ${childNames.join(', ')}`,
      exitCode: 2,
    });
  }
  return null;
}

function formatHumanErrorLine(message: string): string {
  const trimmed = String(message ?? '').trim();
  if (!trimmed) return 'Error: Unknown error';
  return trimmed.startsWith('Error:') ? trimmed : `Error: ${trimmed}`;
}

function prefixFirstErrorLine(text: string): string {
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    lines[i] = formatHumanErrorLine(line);
    break;
  }
  return lines.join('\n');
}

function makeCliConsole(): Console.Console {
  if (jsonRequested) {
    const noop = Effect.sync(() => {});
    const unsafe: Console.UnsafeConsole = {
      assert: () => {},
      clear: () => {},
      count: () => {},
      countReset: () => {},
      debug: () => {},
      dir: () => {},
      dirxml: () => {},
      error: () => {},
      group: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {},
      info: () => {},
      log: () => {},
      table: () => {},
      time: () => {},
      timeEnd: () => {},
      timeLog: () => {},
      trace: () => {},
      warn: () => {},
    };

    return {
      [Console.TypeId]: Console.TypeId,
      assert: () => noop,
      clear: noop,
      count: () => noop,
      countReset: () => noop,
      debug: () => noop,
      dir: () => noop,
      dirxml: () => noop,
      error: () => noop,
      group: () => noop,
      groupEnd: noop,
      info: () => noop,
      log: () => noop,
      table: () => noop,
      time: () => noop,
      timeEnd: () => noop,
      timeLog: () => noop,
      trace: () => noop,
      warn: () => noop,
      unsafe,
    };
  }

  const unsafe: Console.UnsafeConsole = {
    assert: (condition, ...args) => {
      console.assert(condition, ...args);
    },
    clear: () => {
      console.clear();
    },
    count: (label) => {
      console.count(label);
    },
    countReset: (label) => {
      console.countReset(label);
    },
    debug: (...args) => {
      console.debug(...args);
    },
    dir: (item, options) => {
      console.dir(item, options);
    },
    dirxml: (...args) => {
      console.dirxml(...args);
    },
    error: (...args) => {
      console.error(prefixFirstErrorLine(format(...args)));
    },
    group: (...args) => {
      console.group(...args);
    },
    groupCollapsed: (...args) => {
      console.groupCollapsed(...args);
    },
    groupEnd: () => {
      console.groupEnd();
    },
    info: (...args) => {
      console.info(...args);
    },
    log: (...args) => {
      console.log(...args);
    },
    table: (tabularData, properties) => {
      console.table(tabularData, properties);
    },
    time: (label) => {
      console.time(label);
    },
    timeEnd: (label) => {
      console.timeEnd(label);
    },
    timeLog: (label, ...args) => {
      console.timeLog(label, ...args);
    },
    trace: (...args) => {
      console.trace(...args);
    },
    warn: (...args) => {
      console.warn(...args);
    },
  };

  return {
    [Console.TypeId]: Console.TypeId,
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

function strictCommandPreflightOrExit(argv: readonly string[]): void {
  if (jsonRequested) {
    const tokens = argv.slice(2);
    const outputBuiltins = new Set(['--help', '-h', '--version', '--wizard', '--completions']);
    const conflict = tokens.map((t) => splitFlagInlineValue(String(t)).flag).find((flag) => outputBuiltins.has(flag));
    if (conflict) {
      const error = new CliError({
        code: 'INVALID_ARGS',
        message: `Option '--json' cannot be combined with '${conflict}'`,
        exitCode: 2,
        hint: [`Remove '--json' to use ${conflict}`, `Remove '${conflict}' to use '--json' JSON envelope output`],
      });
      process.stdout.write(`${JSON.stringify(fail(toJsonError(error), error.hint))}\n`);
      process.exit(error.exitCode);
    }
  }

  const tree = buildCommandTree((rootCommand as any).descriptor);
  const error = strictCliPreflight(tree, argv);
  if (!error) return;

  if (jsonRequested) {
    process.stdout.write(`${JSON.stringify(fail(toJsonError(error), error.hint))}\n`);
    process.exit(error.exitCode);
  }

  process.stderr.write(`${formatHumanErrorLine(error.message)}\n`);
  process.exit(error.exitCode);
}

strictCommandPreflightOrExit(argv);

const configProvider = buildCliEnvConfigProvider({ cli: parseRootConfigFromArgv(argv), env: process.env });

cli(argv)
  .pipe(
    Effect.withConfigProvider(configProvider),
    Effect.provide(Layer.mergeAll(NodeContext.layer, Console.setConsole(makeCliConsole()))),
    Effect.scoped,
    Effect.exit,
    Effect.flatMap((exit) =>
      Effect.sync(() => {
        process.exitCode = exitCodeFromExit(exit);

        if (Exit.isSuccess(exit)) return;

        const failure = Cause.failureOption(exit.cause);
        if (Option.isNone(failure)) {
          if (jsonRequested) {
            process.stdout.write(
              `${JSON.stringify(
                fail({
                  code: 'INTERNAL',
                  message: 'Unknown runtime error (defect)',
                  details: debugRequested ? { cause: Cause.pretty(exit.cause) } : undefined,
                }),
              )}\n`,
            );
          } else if (!(globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__) {
            (globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__ = true;
            process.stderr.write(`${formatHumanErrorLine('Unknown runtime error (defect)')}\n`);
            if (debugRequested) process.stderr.write(Cause.pretty(exit.cause) + '\n');
          }
          return;
        }

        const error = failure.value;

        if (ValidationError.isValidationError(error)) {
          if (!jsonRequested) return;
          const cliError = cliErrorFromValidationError(error);
          process.stdout.write(`${JSON.stringify(fail(toJsonError(cliError), cliError.hint))}\n`);
          return;
        }

        if (isCliError(error)) {
          if (jsonRequested) {
            process.stdout.write(`${JSON.stringify(fail(toJsonError(error), error.hint))}\n`);
            return;
          }
          if (!(globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__) {
            (globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__ = true;
            process.stderr.write(`${formatHumanErrorLine(error.message)}\n`);
            if (debugRequested && error.details !== undefined) {
              process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
            }
            if (error.hint && error.hint.length > 0) {
              process.stderr.write('Hint:\n');
              for (const h of error.hint) process.stderr.write(`- ${h}\n`);
            }
          }
          return;
        }

        if (jsonRequested) {
          process.stdout.write(
            `${JSON.stringify(
              fail({
                code: 'INTERNAL',
                message: String((error as any)?.message || error || 'Unknown error'),
              }),
            )}\n`,
          );
        } else if (!(globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__) {
          (globalThis as any).__REMNOTE_CLI_ERROR_REPORTED__ = true;
          process.stderr.write(
            `${formatHumanErrorLine(String((error as any)?.message || error || 'Unknown error'))}\n`,
          );
        }
      }),
    ),
  )
  .pipe(NodeRuntime.runMain as any);
