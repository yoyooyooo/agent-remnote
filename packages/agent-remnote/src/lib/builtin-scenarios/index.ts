import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScenarioPackage } from '../scenario-shared/index.js';

export type BuiltinScenarioCatalogEntry = {
  readonly id: string;
  readonly kind: 'scenario_package';
  readonly title: string;
  readonly summary: string;
  readonly source: 'builtin' | 'provider_reserved';
  readonly owner: string;
  readonly version: number;
  readonly package_path: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly tags: readonly string[];
  readonly vars: readonly {
    readonly name: string;
    readonly type: string;
    readonly required: boolean;
    readonly default?: unknown;
  }[];
  readonly action_capabilities: readonly string[];
  readonly remote_parity_required: boolean;
  readonly review_status: string;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function locateBuiltinSourceRoot(): { readonly packageRoot: string; readonly builtinSourceRoot: string } {
  const packageRootCandidates = [
    path.resolve(MODULE_DIR, '../../../'),
    path.resolve(MODULE_DIR, '..'),
  ];

  for (const packageRoot of packageRootCandidates) {
    const builtinSourceRoot = path.join(packageRoot, 'builtin-scenarios');
    if (existsSync(path.join(builtinSourceRoot, 'catalog.json'))) {
      return { packageRoot, builtinSourceRoot };
    }
  }

  throw new Error(`Unable to locate builtin-scenarios catalog from ${MODULE_DIR}`);
}

const { packageRoot: PACKAGE_ROOT, builtinSourceRoot: BUILTIN_SOURCE_ROOT } = locateBuiltinSourceRoot();
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const BUILTIN_CATALOG_PATH = path.join(BUILTIN_SOURCE_ROOT, 'catalog.json');
const BUILTIN_SOURCE_PREFIX = 'packages/agent-remnote/builtin-scenarios/';

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveRepoPath(relPath: string): string {
  return path.resolve(REPO_ROOT, relPath);
}

function resolveBuiltinPackagePath(relPath: string): string {
  const normalized = relPath.replaceAll('\\', '/');
  if (normalized.startsWith(BUILTIN_SOURCE_PREFIX)) {
    return path.resolve(BUILTIN_SOURCE_ROOT, normalized.slice(BUILTIN_SOURCE_PREFIX.length));
  }
  return resolveRepoPath(relPath);
}

export function getBuiltinScenarioCatalogSourcePath(): string {
  return BUILTIN_CATALOG_PATH;
}

export const builtinScenarioCatalog = readJsonFile<readonly BuiltinScenarioCatalogEntry[]>(BUILTIN_CATALOG_PATH);
const builtinScenarioPackageCache = new Map<string, ScenarioPackage>();
const builtinScenarioPackagesTarget: Record<string, ScenarioPackage> = {};

function loadBuiltinScenarioPackage(entry: BuiltinScenarioCatalogEntry): ScenarioPackage {
  const cached = builtinScenarioPackageCache.get(entry.package_id);
  if (cached) return cached;
  const loaded = readJsonFile<ScenarioPackage>(resolveBuiltinPackagePath(entry.package_path));
  builtinScenarioPackageCache.set(entry.package_id, loaded);
  return loaded;
}

for (const entry of builtinScenarioCatalog) {
  Object.defineProperty(builtinScenarioPackagesTarget, entry.package_id, {
    enumerable: true,
    configurable: false,
    get: () => loadBuiltinScenarioPackage(entry),
  });
}

export const builtinScenarioPackages: Readonly<Record<string, ScenarioPackage>> = Object.freeze(builtinScenarioPackagesTarget);

export type BuiltinScenarioId = string;

export function getBuiltinScenarioPackage(id: string): ScenarioPackage {
  const entry = builtinScenarioCatalog.find((item) => item.package_id === id);
  if (!entry) {
    throw new Error(`Unknown builtin scenario package: ${id}`);
  }
  return loadBuiltinScenarioPackage(entry);
}

export function getBuiltinScenarioPackageSourcePath(id: string): string {
  const entry = builtinScenarioCatalog.find((item) => item.package_id === id);
  if (!entry) {
    throw new Error(`Unknown builtin scenario source: ${id}`);
  }
  return resolveBuiltinPackagePath(entry.package_path);
}
