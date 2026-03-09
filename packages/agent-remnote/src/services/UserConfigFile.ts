import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppConfig } from './AppConfig.js';
import { normalizeApiBaseUrl } from './Config.js';
import { CliError, isCliError } from './Errors.js';
import { resolveUserFilePath } from '../lib/paths.js';

export type UserConfigValues = {
  readonly apiBaseUrl?: string | undefined;
};

export type UserConfigInspection = {
  readonly configFile: string;
  readonly exists: boolean;
  readonly values: UserConfigValues;
  readonly unknownKeys: readonly string[];
  readonly errors: readonly string[];
  readonly valid: boolean;
};

export type UserConfigGetResult = {
  readonly configFile: string;
  readonly key: string;
  readonly exists: boolean;
  readonly value: string | null;
};

export type UserConfigSetResult = {
  readonly configFile: string;
  readonly key: string;
  readonly value: string;
  readonly changed: boolean;
};

export type UserConfigUnsetResult = {
  readonly configFile: string;
  readonly key: string;
  readonly removed: boolean;
  readonly fileDeleted: boolean;
};

export interface UserConfigFileService {
  readonly path: () => Effect.Effect<string, never, AppConfig>;
  readonly inspect: () => Effect.Effect<UserConfigInspection, never, AppConfig>;
  readonly get: (key: string) => Effect.Effect<UserConfigGetResult, CliError, AppConfig>;
  readonly set: (key: string, value: string) => Effect.Effect<UserConfigSetResult, CliError, AppConfig>;
  readonly unset: (key: string) => Effect.Effect<UserConfigUnsetResult, CliError, AppConfig>;
}

export class UserConfigFile extends Context.Tag('UserConfigFile')<UserConfigFile, UserConfigFileService>() {}

type UserConfigDoc = Record<string, unknown>;

type ParsedDoc =
  | { readonly ok: true; readonly exists: boolean; readonly configFile: string; readonly doc: UserConfigDoc }
  | { readonly ok: false; readonly exists: boolean; readonly configFile: string; readonly errors: readonly string[] };

function canonicalKey(input: string): string {
  const key = String(input ?? '').trim();
  if (!key) {
    throw new CliError({ code: 'INVALID_ARGS', message: 'Config key is required', exitCode: 2 });
  }
  if (key === 'apiBaseUrl' || key === 'api.baseUrl' || key === 'api-base-url') return 'apiBaseUrl';
  throw new CliError({ code: 'INVALID_ARGS', message: `Unsupported config key: ${key}`, exitCode: 2 });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDoc(doc: UserConfigDoc): UserConfigDoc {
  return JSON.parse(JSON.stringify(doc)) as UserConfigDoc;
}

function removeEmptyApiObject(doc: UserConfigDoc): void {
  const api = doc.api;
  if (!isPlainObject(api)) return;
  if (Object.keys(api).length === 0) delete doc.api;
}

function readApiBaseUrl(doc: UserConfigDoc): {
  readonly value?: string | undefined;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  const root = doc.apiBaseUrl;
  const api = doc.api;
  const nested = isPlainObject(api) ? api.baseUrl : undefined;

  const rootValue =
    root === undefined
      ? undefined
      : typeof root === 'string'
        ? root
        : (errors.push('Config key apiBaseUrl must be a string'), undefined);

  const nestedValue =
    nested === undefined
      ? undefined
      : typeof nested === 'string'
        ? nested
        : (errors.push('Config key api.baseUrl must be a string'), undefined);

  if (rootValue && nestedValue && rootValue !== nestedValue) {
    errors.push('Config keys apiBaseUrl and api.baseUrl conflict');
  }

  return { value: rootValue ?? nestedValue, errors };
}

function inspectDoc(configFile: string, exists: boolean, doc: UserConfigDoc): UserConfigInspection {
  const apiBaseUrl = readApiBaseUrl(doc);
  const unknownKeys: string[] = [];

  for (const key of Object.keys(doc)) {
    if (key === 'apiBaseUrl') continue;
    if (key !== 'api') {
      unknownKeys.push(key);
      continue;
    }
    const api = doc.api;
    if (!isPlainObject(api)) {
      continue;
    }
    for (const nestedKey of Object.keys(api)) {
      if (nestedKey === 'baseUrl') continue;
      unknownKeys.push(`api.${nestedKey}`);
    }
  }

  return {
    configFile,
    exists,
    values: { apiBaseUrl: apiBaseUrl.value },
    unknownKeys,
    errors: apiBaseUrl.errors,
    valid: apiBaseUrl.errors.length === 0,
  };
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readDocDetailed(configFile: string): Promise<ParsedDoc> {
  const file = resolveUserFilePath(configFile);
  let rawText = '';
  try {
    rawText = await fs.readFile(file, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { ok: true, exists: false, configFile: file, doc: {} };
    return {
      ok: false,
      exists: true,
      configFile: file,
      errors: [`Failed to read config file: ${file}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      exists: true,
      configFile: file,
      errors: [`Invalid JSON in config file: ${file}`],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      exists: true,
      configFile: file,
      errors: [`Config file must contain a JSON object: ${file}`],
    };
  }

  return { ok: true, exists: true, configFile: file, doc: parsed };
}

function requireParsedDoc(parsed: ParsedDoc): {
  readonly exists: boolean;
  readonly configFile: string;
  readonly doc: UserConfigDoc;
} {
  if (parsed.ok) return parsed;
  throw new CliError({
    code: 'INVALID_ARGS',
    message: parsed.errors[0] || 'Invalid config file',
    exitCode: 2,
    details: { config_file: parsed.configFile, errors: parsed.errors },
  });
}

async function writeDoc(configFile: string, doc: UserConfigDoc): Promise<void> {
  const file = resolveUserFilePath(configFile);
  await ensureDir(file);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

async function deleteDoc(configFile: string): Promise<void> {
  await fs.rm(resolveUserFilePath(configFile), { force: true });
}

function setApiBaseUrl(doc: UserConfigDoc, value: string): UserConfigDoc {
  const next = cloneDoc(doc);
  next.apiBaseUrl = normalizeApiBaseUrl(value);
  const api = next.api;
  if (isPlainObject(api)) {
    delete api.baseUrl;
    removeEmptyApiObject(next);
  }
  return next;
}

function unsetApiBaseUrl(doc: UserConfigDoc): { readonly next: UserConfigDoc; readonly removed: boolean } {
  const next = cloneDoc(doc);
  let removed = false;

  if (Object.prototype.hasOwnProperty.call(next, 'apiBaseUrl')) {
    delete next.apiBaseUrl;
    removed = true;
  }

  const api = next.api;
  if (isPlainObject(api) && Object.prototype.hasOwnProperty.call(api, 'baseUrl')) {
    delete api.baseUrl;
    removeEmptyApiObject(next);
    removed = true;
  }

  return { next, removed };
}

function isEmptyDoc(doc: UserConfigDoc): boolean {
  return Object.keys(doc).length === 0;
}

function toCliFailure(error: unknown, message: string): CliError {
  return isCliError(error)
    ? error
    : new CliError({
        code: 'INVALID_ARGS',
        message,
        exitCode: 2,
        details: { error: String((error as any)?.message || error) },
      });
}

export const UserConfigFileLive = Layer.succeed(UserConfigFile, {
  path: () =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      return cfg.configFile;
    }),
  inspect: () =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const parsed = yield* Effect.promise(() => readDocDetailed(cfg.configFile));
      if (!parsed.ok) {
        return {
          configFile: parsed.configFile,
          exists: parsed.exists,
          values: {},
          unknownKeys: [],
          errors: parsed.errors,
          valid: false,
        } satisfies UserConfigInspection;
      }
      return inspectDoc(parsed.configFile, parsed.exists, parsed.doc);
    }),
  get: (key) =>
    Effect.gen(function* () {
      const targetKey = yield* Effect.try({
        try: () => canonicalKey(key),
        catch: (error) => toCliFailure(error, 'Invalid config key'),
      });
      const cfg = yield* AppConfig;
      const parsed = yield* Effect.promise(() => readDocDetailed(cfg.configFile));
      const { configFile, doc } = yield* Effect.try({
        try: () => requireParsedDoc(parsed),
        catch: (error) => toCliFailure(error, 'Invalid config file'),
      });
      const inspection = inspectDoc(configFile, parsed.exists, doc);
      const value = targetKey === 'apiBaseUrl' ? (inspection.values.apiBaseUrl ?? null) : null;
      return {
        configFile,
        key: targetKey,
        exists: value !== null,
        value,
      } satisfies UserConfigGetResult;
    }),
  set: (key, value) =>
    Effect.gen(function* () {
      const targetKey = yield* Effect.try({
        try: () => canonicalKey(key),
        catch: (error) => toCliFailure(error, 'Invalid config key'),
      });
      const cfg = yield* AppConfig;
      const parsed = yield* Effect.promise(() => readDocDetailed(cfg.configFile));
      const { configFile, doc } = yield* Effect.try({
        try: () => requireParsedDoc(parsed),
        catch: (error) => toCliFailure(error, 'Invalid config file'),
      });
      const next =
        targetKey === 'apiBaseUrl'
          ? yield* Effect.try({
              try: () => setApiBaseUrl(doc, value),
              catch: (error) => toCliFailure(error, 'Invalid config value'),
            })
          : doc;
      yield* Effect.tryPromise({
        try: async () => await writeDoc(configFile, next),
        catch: (error) =>
          new CliError({
            code: 'INTERNAL',
            message: 'Failed to write config file',
            exitCode: 1,
            details: { config_file: configFile, error: String((error as any)?.message || error) },
          }),
      });
      return {
        configFile,
        key: targetKey,
        value: String(next.apiBaseUrl ?? ''),
        changed: true,
      } satisfies UserConfigSetResult;
    }),
  unset: (key) =>
    Effect.gen(function* () {
      const targetKey = yield* Effect.try({
        try: () => canonicalKey(key),
        catch: (error) => toCliFailure(error, 'Invalid config key'),
      });
      const cfg = yield* AppConfig;
      const parsed = yield* Effect.promise(() => readDocDetailed(cfg.configFile));
      const { configFile, doc, exists } = yield* Effect.try({
        try: () => requireParsedDoc(parsed),
        catch: (error) => toCliFailure(error, 'Invalid config file'),
      });
      if (!exists) {
        return {
          configFile,
          key: targetKey,
          removed: false,
          fileDeleted: false,
        } satisfies UserConfigUnsetResult;
      }
      const result = targetKey === 'apiBaseUrl' ? unsetApiBaseUrl(doc) : { next: doc, removed: false };
      if (!result.removed) {
        return {
          configFile,
          key: targetKey,
          removed: false,
          fileDeleted: false,
        } satisfies UserConfigUnsetResult;
      }
      if (isEmptyDoc(result.next)) {
        yield* Effect.tryPromise({
          try: async () => await deleteDoc(configFile),
          catch: (error) =>
            new CliError({
              code: 'INTERNAL',
              message: 'Failed to delete config file',
              exitCode: 1,
              details: { config_file: configFile, error: String((error as any)?.message || error) },
            }),
        });
        return {
          configFile,
          key: targetKey,
          removed: true,
          fileDeleted: true,
        } satisfies UserConfigUnsetResult;
      }
      yield* Effect.tryPromise({
        try: async () => await writeDoc(configFile, result.next),
        catch: (error) =>
          new CliError({
            code: 'INTERNAL',
            message: 'Failed to write config file',
            exitCode: 1,
            details: { config_file: configFile, error: String((error as any)?.message || error) },
          }),
      });
      return {
        configFile,
        key: targetKey,
        removed: true,
        fileDeleted: false,
      } satisfies UserConfigUnsetResult;
    }),
} satisfies UserConfigFileService);
