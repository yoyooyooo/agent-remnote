import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { homeDir } from './paths.js';

export type RemnoteLink = {
  readonly workspaceId: string;
  readonly remId: string;
};

export type WorkspaceCandidate = {
  readonly workspaceId: string;
  readonly dbPath: string;
  readonly kind: 'primary' | 'secondary';
  readonly dirName: string;
  readonly mtimeMs: number;
};

const SECONDARY_WORKSPACE_DIRS = new Set(['browser', 'remnote-browser', 'lnotes']);

export function tryParseRemnoteLink(input: string): RemnoteLink | undefined {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }

  // Desktop deep link: remnote://w/<workspaceId>/<remId>
  if (u.protocol === 'remnote:' && u.hostname === 'w') {
    const parts = u.pathname.split('/').filter(Boolean);
    const workspaceId = parts.length >= 1 ? parts[0] : undefined;
    const remId = parts.length >= 2 ? parts[1] : undefined;
    if (workspaceId && remId) {
      return { workspaceId: workspaceId.trim(), remId: remId.trim() };
    }
    return undefined;
  }

  // Web URL: https://www.remnote.com/w/<workspaceId>/<remId>
  if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.endsWith('remnote.com')) {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'w') {
      const workspaceId = parts[1];
      const remId = parts[2];
      if (workspaceId && remId) {
        return { workspaceId: workspaceId.trim(), remId: remId.trim() };
      }
    }
  }

  return undefined;
}

export function tryParseRemnoteLinkFromRef(input: string): RemnoteLink | undefined {
  const direct = tryParseRemnoteLink(input);
  if (direct) return direct;

  const raw = input.trim();
  const idx = raw.indexOf(':');
  if (idx <= 0) return undefined;
  const value = raw.slice(idx + 1).trim();
  if (!value) return undefined;
  return tryParseRemnoteLink(value);
}

export function remnoteDbPathForWorkspaceId(workspaceId: string): string {
  return path.join(homeDir(), 'remnote', `remnote-${workspaceId}`, 'remnote.db');
}

export function discoverWorkspaceCandidatesSync(baseDir = path.join(homeDir(), 'remnote')): WorkspaceCandidate[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: WorkspaceCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'backups') continue;

    const isPrimary = entry.name.startsWith('remnote-');
    const isSecondary = SECONDARY_WORKSPACE_DIRS.has(entry.name);
    if (!isPrimary && !isSecondary) continue;

    const workspaceId = isPrimary ? entry.name.slice('remnote-'.length).trim() : entry.name.trim();
    if (!workspaceId) continue;

    const dbPath = path.join(baseDir, entry.name, 'remnote.db');
    try {
      const stat = fs.statSync(dbPath);
      if (!stat.isFile()) continue;
      out.push({
        workspaceId,
        dbPath,
        kind: isPrimary ? 'primary' : 'secondary',
        dirName: entry.name,
        mtimeMs: Number(stat.mtimeMs ?? 0),
      });
    } catch {
      continue;
    }
  }

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'primary' ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });

  return out;
}

export async function tryResolveRemnoteDbPathForWorkspaceId(workspaceId: string): Promise<string | undefined> {
  const p = remnoteDbPathForWorkspaceId(workspaceId);
  try {
    const stat = await fsp.stat(p);
    return stat.isFile() ? p : undefined;
  } catch {
    return undefined;
  }
}

export function tryResolveRemnoteDbPathForWorkspaceIdSync(workspaceId: string): string | undefined {
  const p = remnoteDbPathForWorkspaceId(workspaceId);
  try {
    return fs.statSync(p).isFile() ? p : undefined;
  } catch {
    return undefined;
  }
}
