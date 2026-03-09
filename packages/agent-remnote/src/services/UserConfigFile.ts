import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppConfig } from './AppConfig.js';
import { normalizeApiBasePath, normalizeApiBaseUrl, normalizeApiHost, normalizeApiPort } from './Config.js';
import { CliError, isCliError } from './Errors.js';
import { resolveUserFilePath } from '../lib/paths.js';

export type UserConfigValues = {
  readonly apiBaseUrl?: string | undefined;
  readonly apiHost?: string | undefined;
  readonly apiPort?: number | undefined;
  readonly apiBasePath?: string | undefined;
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
  readonly value: string | number | null;
};

export type UserConfigSetResult = {
  readonly configFile: string;
  readonly key: string;
  readonly value: string | number;
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
  if (key === 'apiHost' || key === 'api.host' || key === 'api-host') return 'apiHost';
  if (key === 'apiPort' || key === 'api.port' || key === 'api-port') return 'apiPort';
  if (key === 'apiBasePath' || key === 'api.basePath' || key === 'api-base-path') return 'apiBasePath';
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

function normalizeApiHostCandidate(
  candidate: unknown,
  keyName: 'apiHost' | 'api.host',
  errors: string[],
): string | undefined {
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'string') {
    errors.push(`Config key ${keyName} must be a string`);
    return undefined;
  }
  return normalizeApiHost(candidate);
}

function readApiHost(doc: UserConfigDoc): {
  readonly value?: string | undefined;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  const root = doc.apiHost;
  const api = doc.api;
  const nested = isPlainObject(api) ? api.host : undefined;

  const rootValue = normalizeApiHostCandidate(root, 'apiHost', errors);
  const nestedValue = normalizeApiHostCandidate(nested, 'api.host', errors);

  if (rootValue !== undefined && nestedValue !== undefined && rootValue !== nestedValue) {
    errors.push('Config keys apiHost and api.host conflict');
  }

  return { value: rootValue ?? nestedValue, errors };
}

function normalizeApiPortCandidate(
  candidate: unknown,
  keyName: 'apiPort' | 'api.port',
  errors: string[],
): number | undefined {
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'number' && typeof candidate !== 'string') {
    errors.push(`Config key ${keyName} must be a valid port number`);
    return undefined;
  }
  try {
    return normalizeApiPort(candidate);
  } catch (error) {
    errors.push(isCliError(error) ? error.message : `Config key ${keyName} must be a valid port number`);
    return undefined;
  }
}

function readApiPort(doc: UserConfigDoc): {
  readonly value?: number | undefined;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  const root = doc.apiPort;
  const api = doc.api;
  const nested = isPlainObject(api) ? api.port : undefined;

  const rootValue = normalizeApiPortCandidate(root, 'apiPort', errors);
  const nestedValue = normalizeApiPortCandidate(nested, 'api.port', errors);

  if (rootValue !== undefined && nestedValue !== undefined && rootValue !== nestedValue) {
    errors.push('Config keys apiPort and api.port conflict');
  }

  return { value: rootValue ?? nestedValue, errors };
}

function normalizeApiBasePathCandidate(
  candidate: unknown,
  keyName: 'apiBasePath' | 'api.basePath',
  errors: string[],
): string | undefined {
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'string') {
    errors.push(`Config key ${keyName} must be a string`);
    return undefined;
  }
  return normalizeApiBasePath(candidate);
}

function readApiBasePath(doc: UserConfigDoc): {
  readonly value?: string | undefined;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  const root = doc.apiBasePath;
  const api = doc.api;
  const nested = isPlainObject(api) ? api.basePath : undefined;

  const rootValue = normalizeApiBasePathCandidate(root, 'apiBasePath', errors);
  const nestedValue = normalizeApiBasePathCandidate(nested, 'api.basePath', errors);

  if (rootValue !== undefined && nestedValue !== undefined && rootValue !== nestedValue) {
    errors.push('Config keys apiBasePath and api.basePath conflict');
  }

  return { value: rootValue ?? nestedValue, errors };
}

function inspectDoc(configFile: string, exists: boolean, doc: UserConfigDoc): UserConfigInspection {
  const apiBaseUrl = readApiBaseUrl(doc);
  const apiHost = readApiHost(doc);
  const apiPort = readApiPort(doc);
  const apiBasePath = readApiBasePath(doc);
  const unknownKeys: string[] = [];

  for (const key of Object.keys(doc)) {
    if (key === 'apiBaseUrl' || key === 'apiHost' || key === 'apiPort' || key === 'apiBasePath') continue;
    if (key !== 'api') {
      unknownKeys.push(key);
      continue;
    }
    const api = doc.api;
    if (!isPlainObject(api)) {
      continue;
    }
    for (const nestedKey of Object.keys(api)) {
      if (nestedKey === 'baseUrl' || nestedKey === 'host' || nestedKey === 'port' || nestedKey === 'basePath') {
        continue;
      }
      unknownKeys.push(`api.${nestedKey}`);
    }
  }

  const errors = [...apiBaseUrl.errors, ...apiHost.errors, ...apiPort.errors, ...apiBasePath.errors];

  return {
    configFile,
    exists,
    values: {
      apiBaseUrl: apiBaseUrl.value,
      apiHost: apiHost.value,
      apiPort: apiPort.value,
      apiBasePath: apiBasePath.value,
    },
    unknownKeys,
    errors,
    valid: errors.length === 0,
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
  await fs.writeFile(
    tmp,
    `${JSON.stringify(doc, null, 2)}
`,
    'utf8',
  );
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

function setApiHost(doc: UserConfigDoc, value: string): UserConfigDoc {
  const next = cloneDoc(doc);
  next.apiHost = normalizeApiHost(value);
  const api = next.api;
  if (isPlainObject(api)) {
    delete api.host;
    removeEmptyApiObject(next);
  }
  return next;
}

function setApiPort(doc: UserConfigDoc, value: string): UserConfigDoc {
  const next = cloneDoc(doc);
  next.apiPort = normalizeApiPort(value);
  const api = next.api;
  if (isPlainObject(api)) {
    delete api.port;
    removeEmptyApiObject(next);
  }
  return next;
}

function setApiBasePath(doc: UserConfigDoc, value: string): UserConfigDoc {
  const next = cloneDoc(doc);
  next.apiBasePath = normalizeApiBasePath(value);
  const api = next.api;
  if (isPlainObject(api)) {
    delete api.basePath;
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

function unsetApiHost(doc: UserConfigDoc): { readonly next: UserConfigDoc; readonly removed: boolean } {
  const next = cloneDoc(doc);
  let removed = false;

  if (Object.prototype.hasOwnProperty.call(next, 'apiHost')) {
    delete next.apiHost;
    removed = true;
  }

  const api = next.api;
  if (isPlainObject(api) && Object.prototype.hasOwnProperty.call(api, 'host')) {
    delete api.host;
    removeEmptyApiObject(next);
    removed = true;
  }

  return { next, removed };
}

function unsetApiPort(doc: UserConfigDoc): { readonly next: UserConfigDoc; readonly removed: boolean } {
  const next = cloneDoc(doc);
  let removed = false;

  if (Object.prototype.hasOwnProperty.call(next, 'apiPort')) {
    delete next.apiPort;
    removed = true;
  }

  const api = next.api;
  if (isPlainObject(api) && Object.prototype.hasOwnProperty.call(api, 'port')) {
    delete api.port;
    removeEmptyApiObject(next);
    removed = true;
  }

  return { next, removed };
}

function unsetApiBasePath(doc: UserConfigDoc): { readonly next: UserConfigDoc; readonly removed: boolean } {
  const next = cloneDoc(doc);
  let removed = false;

  if (Object.prototype.hasOwnProperty.call(next, 'apiBasePath')) {
    delete next.apiBasePath;
    removed = true;
  }

  const api = next.api;
  if (isPlainObject(api) && Object.prototype.hasOwnProperty.call(api, 'basePath')) {
    delete api.basePath;
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
      const value =
        targetKey === 'apiBaseUrl'
          ? (inspection.values.apiBaseUrl ?? null)
          : targetKey === 'apiHost'
            ? (inspection.values.apiHost ?? null)
            : targetKey === 'apiPort'
              ? (inspection.values.apiPort ?? null)
              : targetKey === 'apiBasePath'
                ? (inspection.values.apiBasePath ?? null)
                : null;
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
          : targetKey === 'apiHost'
            ? yield* Effect.try({
                try: () => setApiHost(doc, value),
                catch: (error) => toCliFailure(error, 'Invalid config value'),
              })
            : targetKey === 'apiPort'
              ? yield* Effect.try({
                  try: () => setApiPort(doc, value),
                  catch: (error) => toCliFailure(error, 'Invalid config value'),
                })
              : targetKey === 'apiBasePath'
                ? yield* Effect.try({
                    try: () => setApiBasePath(doc, value),
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
        value:
          targetKey === 'apiBaseUrl'
            ? String(next.apiBaseUrl ?? '')
            : targetKey === 'apiHost'
              ? String(next.apiHost ?? '')
              : targetKey === 'apiPort'
                ? Number(next.apiPort)
                : targetKey === 'apiBasePath'
                  ? String(next.apiBasePath ?? '')
                  : '',
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
      const result =
        targetKey === 'apiBaseUrl'
          ? unsetApiBaseUrl(doc)
          : targetKey === 'apiHost'
            ? unsetApiHost(doc)
            : targetKey === 'apiPort'
              ? unsetApiPort(doc)
              : targetKey === 'apiBasePath'
                ? unsetApiBasePath(doc)
                : { next: doc, removed: false };
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
