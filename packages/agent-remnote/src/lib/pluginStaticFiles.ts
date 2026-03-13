import { promises as fs } from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function normalizeAssetPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const raw = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return null;
  return normalized;
}

export async function readPluginStaticAsset(params: {
  readonly distPath: string;
  readonly pathname: string;
  readonly method: string;
}): Promise<
  | { readonly ok: true; readonly statusCode: number; readonly contentType: string; readonly contentLength: number; readonly body?: Buffer }
  | { readonly ok: false; readonly statusCode: number; readonly message: string }
> {
  const method = params.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, statusCode: 405, message: 'Method not allowed' };
  }

  const relativePath = normalizeAssetPath(params.pathname);
  if (!relativePath) {
    return { ok: false, statusCode: 404, message: 'Not found' };
  }

  const filePath = path.resolve(params.distPath, relativePath);
  if (filePath !== params.distPath && !filePath.startsWith(`${params.distPath}${path.sep}`)) {
    return { ok: false, statusCode: 404, message: 'Not found' };
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { ok: false, statusCode: 404, message: 'Not found' };
    }

    const body = method === 'HEAD' ? undefined : await fs.readFile(filePath);
    return {
      ok: true,
      statusCode: 200,
      contentType: contentTypeFor(filePath),
      contentLength: stat.size,
      body,
    };
  } catch {
    return { ok: false, statusCode: 404, message: 'Not found' };
  }
}
