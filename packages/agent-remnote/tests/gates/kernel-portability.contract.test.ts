import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function listFilesRecursively(rootDir: string, predicate: (p: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath)) out.push(fullPath);
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir);
  return out;
}

function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
}

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  while (true) {
    const gitDir = path.join(cur, '.git');
    if (fs.existsSync(gitDir)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return startDir;
    cur = parent;
  }
}

function parseImportSpecs(source: string): readonly string[] {
  const lines = source.split('\n');
  const specs: string[] = [];
  for (const line of lines) {
    const from = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
    if (from) specs.push(from[1]);
    const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    if (sideEffect) specs.push(sideEffect[1]);
  }
  return specs;
}

describe('kernel portability guard', () => {
  it('prevents platform/effect dependencies inside src/kernel/**', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = findRepoRoot(__dirname);
    const kernelRoot = path.join(repoRoot, 'packages/agent-remnote/src/kernel');

    const files = listFilesRecursively(kernelRoot, (p) => p.endsWith('.ts'));
    const violations: Array<{ file: string; rule: string; sample: string }> = [];

    for (const filePath of files) {
      const rel = normalizePath(path.relative(repoRoot, filePath));
      const source = fs.readFileSync(filePath, 'utf8');
      const specs = parseImportSpecs(source);

      for (const spec of specs) {
        const forbidden =
          spec.startsWith('node:') ||
          spec === 'ws' ||
          spec.startsWith('ws/') ||
          spec === 'better-sqlite3' ||
          spec.startsWith('better-sqlite3/') ||
          spec === 'effect' ||
          spec.startsWith('effect/') ||
          spec === '@effect/cli' ||
          spec.startsWith('@effect/') ||
          /\/(commands|services|runtime|lib|internal)(\/|$)/.test(spec);
        if (!forbidden) continue;
        violations.push({ file: rel, rule: 'forbid_kernel_import', sample: spec });
      }

      const forbiddenTokens: Array<{ rule: string; re: RegExp; sample: string }> = [
        { rule: 'forbid_time_source', re: /\bDate\.now\b/, sample: 'Date.now' },
        { rule: 'forbid_time_source', re: /\bnew Date\s*\(/, sample: 'new Date(' },
        { rule: 'forbid_random_source', re: /\bMath\.random\b/, sample: 'Math.random' },
        { rule: 'forbid_random_source', re: /\brandomUUID\b/, sample: 'randomUUID' },
        { rule: 'forbid_timer', re: /\bsetTimeout\b/, sample: 'setTimeout' },
        { rule: 'forbid_timer', re: /\bsetInterval\b/, sample: 'setInterval' },
        { rule: 'forbid_timer', re: /\bsetImmediate\b/, sample: 'setImmediate' },
        { rule: 'forbid_timer', re: /\bprocess\.nextTick\b/, sample: 'process.nextTick' },
        { rule: 'forbid_global_state', re: /\bprocess\.env\b/, sample: 'process.env' },
      ];

      for (const token of forbiddenTokens) {
        if (!token.re.test(source)) continue;
        violations.push({ file: rel, rule: token.rule, sample: token.sample });
      }
    }

    expect(violations, JSON.stringify(violations.slice(0, 20), null, 2)).toEqual([]);
  });
});

