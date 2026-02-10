import os from 'node:os';
import path from 'node:path';

export function homeDir(): string {
  const h = os.homedir();
  if (typeof h === 'string' && h.trim()) return h;
  return process.env.HOME || process.env.USERPROFILE || '.';
}

export function expandHome(targetPath: string): string {
  const raw = targetPath.trim();
  if (!raw.startsWith('~')) return raw;

  const home = homeDir();
  if (raw === '~') return home;

  // Support both POSIX and Windows separators: `~/...` and `~\...`
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(home, raw.slice(2));
  }

  return raw.replace(/^~(?=$|[\\/])/, home);
}

export function resolveUserFilePath(filePath: string): string {
  return path.normalize(expandHome(filePath));
}
