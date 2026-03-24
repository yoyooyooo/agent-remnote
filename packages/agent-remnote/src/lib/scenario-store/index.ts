import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  builtinScenarioCatalog,
  builtinScenarioPackages,
  getBuiltinScenarioPackage,
  getBuiltinScenarioPackageSourcePath,
  type BuiltinScenarioId,
} from '../builtin-scenarios/index.js';
import { normalizeScenarioPackage } from '../scenario-shared/index.js';
import { homeDir, resolveUserFilePath } from '../paths.js';
import { CliError } from '../../services/Errors.js';

export type ResolvedScenarioPackage =
  | {
      readonly source: 'builtin';
      readonly spec: string;
      readonly id: BuiltinScenarioId;
      readonly packageInput: unknown;
    }
  | {
      readonly source: 'user';
      readonly spec: string;
      readonly id: string;
      readonly path: string;
      readonly packageInput: unknown;
    }
  | {
      readonly source: 'payload';
      readonly spec: string;
      readonly packageInput: unknown;
    };

export type BuiltinScenarioInstallEntry = {
  readonly id: string;
  readonly path: string;
};

export type BuiltinScenarioInstallSkip = BuiltinScenarioInstallEntry & {
  readonly reason: 'exists';
};

export type BuiltinScenarioInstallResult = {
  readonly installDir: string;
  readonly requestedIds: readonly string[];
  readonly installed: readonly BuiltinScenarioInstallEntry[];
  readonly skipped: readonly BuiltinScenarioInstallSkip[];
};

type JsonReader = {
  readonly readJson: (spec: string) => Promise<unknown>;
};

export function defaultUserScenarioDir(): string {
  return path.join(homeDir(), '.agent-remnote', 'scenarios');
}

export function resolveUserScenarioDir(input?: string): string {
  if (typeof input === 'string' && input.trim()) {
    return resolveUserFilePath(input);
  }
  return defaultUserScenarioDir();
}

export function isBuiltinScenarioId(id: string): id is BuiltinScenarioId {
  return Object.prototype.hasOwnProperty.call(builtinScenarioPackages, id);
}

function canonicalScenarioId(input: string, fieldName: string): string {
  const id = String(input ?? '').trim();
  if (!id) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `${fieldName} is required`,
      exitCode: 2,
    });
  }
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `${fieldName} must match ^[a-z0-9_]+$`,
      exitCode: 2,
      details: { value: id },
    });
  }
  return id;
}

export function userScenarioFilePath(id: string, installDir?: string): string {
  return path.join(resolveUserScenarioDir(installDir), `${canonicalScenarioId(id, 'Scenario id')}.json`);
}

async function readUserScenarioPackageById(id: string, installDir?: string): Promise<ResolvedScenarioPackage> {
  const canonicalId = canonicalScenarioId(id, 'Scenario id');
  const filePath = userScenarioFilePath(canonicalId, installDir);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new CliError({
        code: 'INVALID_ARGS',
        message: `Unknown user scenario package: ${canonicalId}`,
        exitCode: 2,
        details: { scenario_id: canonicalId, path: filePath },
        hint: [
          'Install a builtin scenario with `scenario builtin install <builtin-id>`.',
          'Or place a canonical scenario JSON file under ~/.agent-remnote/scenarios/<id>.json.',
        ],
      });
    }
    throw error;
  }

  let packageInput: unknown;
  try {
    packageInput = JSON.parse(raw);
  } catch (error) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: `Scenario file is not valid JSON: ${filePath}`,
      exitCode: 2,
      details: { path: filePath, error: String((error as any)?.message || error) },
    });
  }

  return {
    source: 'user',
    spec: canonicalId,
    id: canonicalId,
    path: filePath,
    packageInput,
  };
}

export async function resolveScenarioPackageSpec(spec: string, jsonReader: JsonReader): Promise<ResolvedScenarioPackage> {
  const trimmed = String(spec ?? '').trim();
  if (!trimmed) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'Scenario package spec is required',
      exitCode: 2,
    });
  }

  if (trimmed.startsWith('builtin:')) {
    const id = canonicalScenarioId(trimmed.slice('builtin:'.length), 'Builtin scenario id');
    if (!isBuiltinScenarioId(id)) {
      throw new CliError({
        code: 'INVALID_ARGS',
        message: `Unknown builtin scenario package: ${id}`,
        exitCode: 2,
      });
    }
    return {
      source: 'builtin',
      spec: trimmed,
      id,
      packageInput: getBuiltinScenarioPackage(id),
    };
  }

  if (trimmed.startsWith('user:')) {
    return await readUserScenarioPackageById(trimmed.slice('user:'.length));
  }

  if (trimmed === '-' || trimmed.startsWith('@') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return {
      source: 'payload',
      spec: trimmed,
      packageInput: await jsonReader.readJson(trimmed),
    };
  }

  if (isBuiltinScenarioId(trimmed)) {
    return {
      source: 'builtin',
      spec: trimmed,
      id: trimmed,
      packageInput: getBuiltinScenarioPackage(trimmed),
    };
  }

  if (/^[a-z0-9_]+$/.test(trimmed)) {
    return await readUserScenarioPackageById(trimmed);
  }

  return {
    source: 'payload',
    spec: trimmed,
    packageInput: await jsonReader.readJson(trimmed),
  };
}

function selectBuiltinInstallIds(params: {
  readonly ids: readonly string[];
  readonly all: boolean;
}): readonly BuiltinScenarioId[] {
  if (params.all && params.ids.length > 0) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'Use either --all or positional <id> arguments, not both',
      exitCode: 2,
    });
  }
  if (!params.all && params.ids.length === 0) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'Use --all or provide at least one builtin scenario id',
      exitCode: 2,
    });
  }

  const requested = params.all ? Object.keys(builtinScenarioPackages) : params.ids.map((id) => canonicalScenarioId(id, 'Builtin scenario id'));
  const unique = [...new Set(requested)];
  for (const id of unique) {
    if (!isBuiltinScenarioId(id)) {
      throw new CliError({
        code: 'INVALID_ARGS',
        message: `Unknown builtin scenario package: ${id}`,
        exitCode: 2,
      });
    }
  }
  return unique as readonly BuiltinScenarioId[];
}

export async function installBuiltinScenarioPackages(params: {
  readonly ids: readonly string[];
  readonly all: boolean;
  readonly installDir?: string | undefined;
  readonly ifMissing: boolean;
}): Promise<BuiltinScenarioInstallResult> {
  const requestedIds = selectBuiltinInstallIds({ ids: params.ids, all: params.all });
  const installDir = resolveUserScenarioDir(params.installDir);
  await fs.mkdir(installDir, { recursive: true });

  const installed: BuiltinScenarioInstallEntry[] = [];
  const skipped: BuiltinScenarioInstallSkip[] = [];

  for (const id of requestedIds) {
    const filePath = userScenarioFilePath(id, installDir);
    const pkg = getBuiltinScenarioPackage(id);
    const normalized = normalizeScenarioPackage(pkg);
    if (!normalized.ok) {
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: `Builtin scenario package is not canonical: ${id}`,
        exitCode: 2,
        details: { id, errors: normalized.errors },
      });
    }

    try {
      await fs.access(filePath);
      if (params.ifMissing) {
        skipped.push({ id, path: filePath, reason: 'exists' });
        continue;
      }
      throw new CliError({
        code: 'INVALID_ARGS',
        message: `Scenario file already exists: ${filePath}`,
        exitCode: 2,
        details: { id, path: filePath },
        hint: ['Use --if-missing to skip existing files.'],
      });
    } catch (error: any) {
      if (error?.code && error.code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.copyFile(getBuiltinScenarioPackageSourcePath(id), filePath);
    installed.push({ id, path: filePath });
  }

  return {
    installDir,
    requestedIds,
    installed,
    skipped,
  };
}

export function listBuiltinScenarioEntries() {
  return builtinScenarioCatalog;
}
