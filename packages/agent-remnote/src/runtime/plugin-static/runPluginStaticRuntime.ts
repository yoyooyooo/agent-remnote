import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as Effect from 'effect/Effect';

import { resolvePluginDistPath } from '../../lib/pluginArtifacts.js';
import { CliError, isCliError } from '../../services/Errors.js';

const CONTENT_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function sendText(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function requestPathname(req: IncomingMessage): string {
  return new URL(req.url || '/', 'http://127.0.0.1').pathname;
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

async function handleRequest(req: IncomingMessage, res: ServerResponse, distPath: string): Promise<void> {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  const relativePath = normalizeAssetPath(requestPathname(req));
  if (!relativePath) {
    sendText(res, 404, 'Not found');
    return;
  }

  const filePath = path.resolve(distPath, relativePath);
  if (filePath !== distPath && !filePath.startsWith(`${distPath}${path.sep}`)) {
    sendText(res, 404, 'Not found');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    const body = method === 'HEAD' ? undefined : await fs.readFile(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', contentTypeFor(filePath));
    res.setHeader('content-length', String(stat.size));
    if (body === undefined) res.end();
    else res.end(body);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

export function runPluginStaticRuntime(params?: {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly distPath?: string | undefined;
  readonly onStarted?:
    | ((info: { readonly host: string; readonly port: number; readonly distPath: string }) => Effect.Effect<void, CliError>)
    | undefined;
}): Effect.Effect<void, CliError> {
  return Effect.gen(function* () {
    const distPath = params?.distPath ?? (yield* Effect.try({
      try: () => resolvePluginDistPath(),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'DEPENDENCY_MISSING',
              message: 'Plugin build artifacts are unavailable',
              exitCode: 1,
              details: { error: String((error as any)?.message || error) },
            }),
    }));

    const host = params?.host ?? '127.0.0.1';
    const port = params?.port ?? 8080;
    const server = createServer((req, res) => {
      void handleRequest(req, res, distPath);
    });

    const listen = Effect.async<void, CliError>((resume) => {
      const onError = (error: unknown) => {
        cleanup();
        resume(
          Effect.fail(
            new CliError({
              code: 'PLUGIN_UNAVAILABLE',
              message: 'Failed to start plugin static server',
              exitCode: 1,
              details: { host, port, error: String((error as any)?.message || error) },
            }),
          ),
        );
      };

      const onListening = () => {
        cleanup();
        resume(Effect.void);
      };

      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);

      return Effect.sync(cleanup);
    });

    yield* listen;

    const actualPort = (() => {
      const addr = server.address();
      return addr && typeof addr === 'object' ? addr.port : port;
    })();

    if (params?.onStarted) {
      yield* params.onStarted({ host, port: actualPort, distPath });
    }

    const waitForStop = Effect.async<void, never>((resume) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        try {
          server.close(() => resume(Effect.void));
        } catch {
          resume(Effect.void);
        }
      };

      const onTerm = () => stop();
      const onInt = () => stop();
      process.on('SIGTERM', onTerm);
      process.on('SIGINT', onInt);

      return Effect.sync(() => {
        process.off('SIGTERM', onTerm);
        process.off('SIGINT', onInt);
        stop();
      });
    });

    yield* waitForStop;
  });
}
