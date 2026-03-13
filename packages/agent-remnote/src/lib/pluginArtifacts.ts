import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError } from '../services/Errors.js';

function currentDir(moduleUrl: string): string {
  return path.dirname(fileURLToPath(moduleUrl));
}

function isDirectory(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(targetPath: string): boolean {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function distCandidates(moduleUrl: string): string[] {
  const dir = currentDir(moduleUrl);
  return [
    path.resolve(dir, '../../plugin-artifacts/dist'),
    path.resolve(dir, '../plugin-artifacts/dist'),
    path.resolve(dir, '../../../plugin/dist'),
    path.resolve(dir, '../../plugin/dist'),
  ];
}

function zipCandidates(moduleUrl: string): string[] {
  const dir = currentDir(moduleUrl);
  return [
    path.resolve(dir, '../../plugin-artifacts/PluginZip.zip'),
    path.resolve(dir, '../plugin-artifacts/PluginZip.zip'),
    path.resolve(dir, '../../../plugin/PluginZip.zip'),
    path.resolve(dir, '../../plugin/PluginZip.zip'),
  ];
}

function validateDistPath(targetPath: string): boolean {
  return isDirectory(targetPath) && existsSync(path.join(targetPath, 'manifest.json'));
}

export function resolvePluginDistPath(moduleUrl = import.meta.url): string {
  for (const candidate of distCandidates(moduleUrl)) {
    if (validateDistPath(candidate)) return candidate;
  }

  throw new CliError({
    code: 'DEPENDENCY_MISSING',
    message: 'Plugin build artifacts are unavailable',
    exitCode: 1,
    details: { candidates: distCandidates(moduleUrl) },
    hint: [
      'Run npm run build --workspace @remnote/plugin in the repository checkout',
      'Or install a packaged agent-remnote release that includes plugin artifacts',
    ],
  });
}

export function resolvePluginZipPath(moduleUrl = import.meta.url): string {
  for (const candidate of zipCandidates(moduleUrl)) {
    if (isFile(candidate)) return candidate;
  }

  throw new CliError({
    code: 'DEPENDENCY_MISSING',
    message: 'Plugin zip artifact is unavailable',
    exitCode: 1,
    details: { candidates: zipCandidates(moduleUrl) },
    hint: [
      'Run npm run build --workspace @remnote/plugin in the repository checkout',
      'Or install a packaged agent-remnote release that includes plugin artifacts',
    ],
  });
}
