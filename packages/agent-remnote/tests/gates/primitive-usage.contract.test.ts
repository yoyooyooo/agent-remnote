import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_NODE_PRIMITIVE_IMPORTS = new Set<string>([]);
const ALLOWED_RAW_TIMERS = new Set<string>([]);
const ALLOWED_NEW_PROMISE = new Set<string>([]);

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

describe('primitive usage guard', () => {
  it('prevents raw platform primitives in commands/** and runtime/** (allowlist-based)', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = findRepoRoot(__dirname);

    const srcRoot = path.join(repoRoot, 'packages/agent-remnote/src');
    const commandsRoot = path.join(srcRoot, 'commands');
    const runtimeRoot = path.join(srcRoot, 'runtime');

    const files = [
      ...listFilesRecursively(commandsRoot, (p) => p.endsWith('.ts')),
      ...listFilesRecursively(runtimeRoot, (p) => p.endsWith('.ts')),
    ];

    const violations: Array<{ file: string; rule: string; sample: string }> = [];

    for (const filePath of files) {
      const rel = normalizePath(path.relative(repoRoot, filePath));
      const source = fs.readFileSync(filePath, 'utf8');

      const specs = parseImportSpecs(source);
      for (const spec of specs) {
        const forbiddenNode =
          spec === 'node:fs' ||
          spec === 'node:child_process' ||
          spec === 'node:worker_threads' ||
          spec === 'node:crypto' ||
          spec === 'ws' ||
          spec === 'better-sqlite3';

        if (!forbiddenNode) continue;

        if (ALLOWED_NODE_PRIMITIVE_IMPORTS.has(rel)) continue;
        violations.push({ file: rel, rule: 'forbid_node_primitive_import', sample: spec });
      }

      const timerRe = /\b(setTimeout|setInterval|setImmediate|process\.nextTick)\b/;
      if (timerRe.test(source) && !ALLOWED_RAW_TIMERS.has(rel)) {
        violations.push({ file: rel, rule: 'forbid_raw_timer', sample: timerRe.exec(source)?.[1] ?? 'timer' });
      }

      if (/\bnew Promise\b/.test(source) && !ALLOWED_NEW_PROMISE.has(rel)) {
        violations.push({ file: rel, rule: 'forbid_new_promise', sample: 'new Promise' });
      }

      if (/\bprocess\.env\.[A-Z0-9_]+\s*=/.test(source)) {
        violations.push({ file: rel, rule: 'forbid_process_env_assignment', sample: 'process.env.* =' });
      }
    }

    expect(violations, JSON.stringify(violations.slice(0, 20), null, 2)).toEqual([]);
  });
});
