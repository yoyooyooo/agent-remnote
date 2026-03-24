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

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveRepoPath(relPath: string): string {
  return path.resolve(REPO_ROOT, relPath);
}

export function getBuiltinScenarioCatalogSourcePath(): string {
  return BUILTIN_CATALOG_PATH;
}

export const builtinScenarioCatalog = readJsonFile<readonly BuiltinScenarioCatalogEntry[]>(BUILTIN_CATALOG_PATH);

export const builtinScenarioPackages: Readonly<Record<string, ScenarioPackage>> = Object.freeze(
  Object.fromEntries(
    builtinScenarioCatalog.map((entry) => [entry.package_id, readJsonFile<ScenarioPackage>(resolveRepoPath(entry.package_path))]),
  ),
);

export type BuiltinScenarioId = string;

export function getBuiltinScenarioPackage(id: string): ScenarioPackage {
  const pkg = builtinScenarioPackages[id];
  if (!pkg) {
    throw new Error(`Unknown builtin scenario package: ${id}`);
  }
  return pkg;
}

export function getBuiltinScenarioPackageSourcePath(id: string): string {
  const entry = builtinScenarioCatalog.find((item) => item.package_id === id);
  if (!entry) {
    throw new Error(`Unknown builtin scenario source: ${id}`);
  }
  return resolveRepoPath(entry.package_path);
}
