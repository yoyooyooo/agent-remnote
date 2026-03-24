import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SHARED_ROOTS = [
  'packages/agent-remnote/src/lib/scenario-shared',
  'packages/agent-remnote/src/lib/scenario-schema',
] as const;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (stat.isFile() && full.endsWith('.ts')) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return out;
}

describe('gate: shared subpackage boundary', () => {
  it('keeps scenario shared files free from host/runtime/service imports', () => {
    const violations: Array<{ file: string; spec: string }> = [];

    for (const root of SHARED_ROOTS) {
      for (const file of listTsFiles(root)) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        const text = readFileSync(file, 'utf8');
        const specs = Array.from(text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)).map((match) => match[1] ?? '');

        for (const spec of specs) {
          const forbidden =
            spec.startsWith('node:') ||
            spec.includes('/services/') ||
            spec.includes('/internal/') ||
            spec.includes('/commands/') ||
            spec.includes('/runtime/') ||
            spec.includes('/kernel/') ||
            spec.includes('/adapters/') ||
            spec.includes('HostApiClient') ||
            spec.includes('modeParityRuntime');
          if (forbidden) {
            violations.push({ file: rel, spec });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
