import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), '..');
const distMain = path.join(packageRoot, 'dist', 'main.js');

if (!fs.existsSync(distMain)) {
  process.stderr.write('[agent-remnote] build verification failed: dist/main.js not found. Run `npm run build`.\n');
  process.exit(1);
}

const content = fs.readFileSync(distMain, 'utf8');
const signatures = ['parentSelfUsage', 'append(preceding, parentSelfUsage)'];
const missing = signatures.filter((s) => !content.includes(s));

if (missing.length > 0) {
  process.stderr.write(
    '[agent-remnote] build verification failed: expected patched @effect/cli help logic to be bundled into dist/main.js, but signature not found.\n' +
      `[agent-remnote] missing: ${missing.join(', ')}\n` +
      '[agent-remnote] hint: ensure bun patchedDependencies applied (bun install) and rebuild.\n',
  );
  process.exit(1);
}

const allowedBuiltins = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'querystring',
  'readline',
  'stream',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
]);

const allowedThirdPartyExternals = new Set(['better-sqlite3']);

const isAllowedExternal = (specifier) => {
  if (specifier.startsWith('node:')) return true;
  if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) return true;
  if (allowedBuiltins.has(specifier)) return true;
  if (allowedThirdPartyExternals.has(specifier)) return true;
  return false;
};

const importSpecifiers = [...content.matchAll(/^import\s+(?:.+?\s+from\s+)?["']([^"']+)["'];/gm)].map((m) => m[1]);
const requireSpecifiers = [...content.matchAll(/__require\(["']([^"']+)["']\)/g)].map((m) => m[1]);

const externals = [...new Set([...importSpecifiers, ...requireSpecifiers])].filter((s) => !isAllowedExternal(s));
if (externals.length > 0) {
  process.stderr.write(
    '[agent-remnote] build verification failed: dist/main.js has unexpected external imports/requires.\n' +
      `[agent-remnote] externals: ${externals.join(', ')}\n` +
      '[agent-remnote] hint: if a module must stay external, keep it in dependencies and add it to the allowlist.\n',
  );
  process.exit(1);
}
