import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_INTERNAL_TS_FILES = new Set([
  'packages/agent-remnote/src/internal/public.ts',
  'packages/agent-remnote/src/internal/queue/dao.ts',
  'packages/agent-remnote/src/internal/queue/db.ts',
  'packages/agent-remnote/src/internal/queue/index.ts',
  'packages/agent-remnote/src/internal/queue/sanitize.ts',
  'packages/agent-remnote/src/internal/store/db.ts',
  'packages/agent-remnote/src/internal/store/index.ts',
  'packages/agent-remnote/src/internal/store/automationDao.ts',
  'packages/agent-remnote/src/internal/store/migrations/0001-baseline.ts',
  'packages/agent-remnote/src/internal/store/migrations/0002-add-ops-attempt-id.ts',
  'packages/agent-remnote/src/internal/store/migrations/0003-add-op-attempts-table.ts',
  'packages/agent-remnote/src/internal/store/migrations/0004-add-txns-dispatch-mode.ts',
  'packages/agent-remnote/src/internal/store/migrations/0005-prefix-queue-tables.ts',
  'packages/agent-remnote/src/internal/store/migrations/0006-add-workspace-bindings.ts',
  'packages/agent-remnote/src/internal/store/migrations/0008-add-automation-skeleton.ts',
  'packages/agent-remnote/src/internal/store/migrations/0009-add-task-run-fk-indexes.ts',
  'packages/agent-remnote/src/internal/store/migrations/index.ts',
  'packages/agent-remnote/src/internal/remdb-tools/executeSearchQuery.ts',
  'packages/agent-remnote/src/internal/remdb-tools/findRemsByReference.ts',
  'packages/agent-remnote/src/internal/remdb-tools/getRemConnections.ts',
  'packages/agent-remnote/src/internal/remdb-tools/index.ts',
  'packages/agent-remnote/src/internal/remdb-tools/inspectRemDoc.ts',
  'packages/agent-remnote/src/internal/remdb-tools/listRemBackups.ts',
  'packages/agent-remnote/src/internal/remdb-tools/listRemReferences.ts',
  'packages/agent-remnote/src/internal/remdb-tools/listSupportedOps.ts',
  'packages/agent-remnote/src/internal/remdb-tools/listTodos.ts',
  'packages/agent-remnote/src/internal/remdb-tools/markdownPrepare.ts',
  'packages/agent-remnote/src/internal/remdb-tools/outlineRemSubtree.ts',
  'packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts',
  'packages/agent-remnote/src/internal/remdb-tools/resolveRemPage.ts',
  'packages/agent-remnote/src/internal/remdb-tools/resolveRemReference.ts',
  'packages/agent-remnote/src/internal/remdb-tools/searchQueryTypes.ts',
  'packages/agent-remnote/src/internal/remdb-tools/searchRemOverview.ts',
  'packages/agent-remnote/src/internal/remdb-tools/searchUtils.ts',
  'packages/agent-remnote/src/internal/remdb-tools/shared.ts',
  'packages/agent-remnote/src/internal/remdb-tools/summarizeDailyNotes.ts',
  'packages/agent-remnote/src/internal/remdb-tools/summarizeRecentActivity.ts',
  'packages/agent-remnote/src/internal/remdb-tools/summarizeTopicActivity.ts',
  'packages/agent-remnote/src/internal/remdb-tools/timeFilters.ts',
  'packages/agent-remnote/src/internal/ws-bridge/bridge.ts',
  'packages/agent-remnote/src/internal/ws-bridge/index.ts',
]);

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
  walk(rootDir);
  return out;
}

function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
}

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  // Stop at filesystem root.
  while (true) {
    const gitDir = path.join(cur, '.git');
    if (fs.existsSync(gitDir)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return startDir;
    cur = parent;
  }
}

describe('module boundaries: no deep imports', () => {
  it('prevents accidental coupling across layers', () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = findRepoRoot(__dirname);
    const srcRoot = path.join(repoRoot, 'packages/agent-remnote/src');

    const files = listFilesRecursively(srcRoot, (p) => p.endsWith('.ts'));

    const allowCoreSourceImportsFrom = new Set([
      'packages/agent-remnote/src/adapters/core.ts',
      'packages/agent-remnote/src/internal/public.ts',
    ]);

    const violations: Array<{ file: string; rule: string; sample: string }> = [];

    for (const filePath of files) {
      const rel = normalizePath(path.relative(repoRoot, filePath));
      const content = fs.readFileSync(filePath, 'utf8');

      // Rule 0: internal/** is legacy and MUST NOT grow (deletions are allowed).
      if (rel.includes('/src/internal/') && !ALLOWED_INTERNAL_TS_FILES.has(rel)) {
        violations.push({
          file: rel,
          rule: 'forbid_internal_growth',
          sample: rel,
        });
      }

      // Rule 1: Forbid importing core source directly (except the migration facades).
      if (!allowCoreSourceImportsFrom.has(rel) && content.includes('/core/src/')) {
        violations.push({
          file: rel,
          rule: 'forbid_core_src_import',
          sample: '/core/src/',
        });
      }

      // Rule 2: Forbid deep imports into internal modules (outside internal itself).
      const isInternal = rel.includes('/src/internal/');
      const isKernel = rel.includes('/src/kernel/');
      const lines = content.split('\n');
      const specs: string[] = [];
      for (const line of lines) {
        const from = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
        if (from) specs.push(from[1]);
        const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
        if (sideEffect) specs.push(sideEffect[1]);
      }

      if (isKernel) {
        for (const spec of specs) {
          const forbidden =
            spec.startsWith('node:') ||
            spec === 'ws' ||
            spec.startsWith('ws/') ||
            spec === 'better-sqlite3' ||
            spec.startsWith('better-sqlite3/') ||
            spec.startsWith('effect/') ||
            spec === 'effect' ||
            spec.startsWith('@effect/') ||
            spec === '@effect/cli' ||
            /\/(commands|services|runtime|lib|internal)(\/|$)/.test(spec);
          if (!forbidden) continue;
          violations.push({
            file: rel,
            rule: 'forbid_kernel_platform_import',
            sample: spec,
          });
        }
      }

      if (!isInternal) {
        for (const spec of specs) {
          if (!spec.includes('/internal/')) continue;

          // Allow importing the internal facade or module indexes.
          const ok =
            spec.endsWith('/internal/public.js') ||
            spec.endsWith('/internal/queue/index.js') ||
            spec.endsWith('/internal/ws-bridge/index.js') ||
            spec.endsWith('/internal/remdb-tools/index.js');

          if (!ok) {
            violations.push({
              file: rel,
              rule: 'forbid_internal_deep_import',
              sample: spec,
            });
          }
        }
      } else {
        // Rule 3: internal/** must not depend on CLI / Effect runtime layers.
        for (const spec of specs) {
          const allowedInternalService = spec.endsWith('/services/WorkerRunner.js');
          const forbiddenLayer = !allowedInternalService && /\/(commands|services)(\/|$)/.test(spec);
          const forbiddenEffect =
            spec === '@effect/cli' || spec.startsWith('@effect/cli/') || spec.startsWith('effect/');
          if (!forbiddenLayer && !forbiddenEffect) continue;
          violations.push({
            file: rel,
            rule: 'forbid_internal_layer_import',
            sample: spec,
          });
        }
      }
    }

    expect(violations, JSON.stringify(violations.slice(0, 10), null, 2)).toEqual([]);
  });
});
