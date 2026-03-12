import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadBridgeSelectionSnapshot } from '../../commands/read/selection/_shared.js';
import { waitForTxn } from '../../commands/_waitTxn.js';
import { loadBridgeUiContextSnapshot } from '../../commands/read/uiContext/_shared.js';
import {
  collectApiHealthUseCase,
  executeDailyRemIdUseCase,
  collectApiStatusUseCase,
  collectPluginCurrentUseCase,
  collectSelectionCurrentUseCase,
  collectSelectionOutlineUseCase,
  collectSelectionRootsUseCase,
  collectSelectionSnapshotUseCase,
  collectUiContextDescribeUseCase,
  collectUiContextFocusedRemUseCase,
  collectUiContextPageUseCase,
  collectUiContextSnapshotUseCase,
  executeDbSearchUseCase,
  executePluginSearchUseCase,
  executeQueueTxnUseCase,
  executeReadOutlineUseCase,
  executeTriggerSyncUseCase,
  executeWriteApplyUseCase,
} from '../../lib/hostApiUseCases.js';
import { apiContainerBaseUrl, apiLocalBaseUrl } from '../../lib/apiUrls.js';
import { AppConfig } from '../../services/AppConfig.js';
import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { CliError, fail, isCliError, ok, toJsonError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { Payload } from '../../services/Payload.js';
import { Process } from '../../services/Process.js';
import { Queue } from '../../services/Queue.js';
import { RemDb } from '../../services/RemDb.js';
import { RefResolver } from '../../services/RefResolver.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { WorkspaceBindings } from '../../services/WorkspaceBindings.js';
import { WsClient } from '../../services/WsClient.js';
import { StatusLineController } from '../status-line/StatusLineController.js';

function statusCodeFromCliError(error: CliError): number {
  switch (error.code) {
    case 'INVALID_ARGS':
    case 'INVALID_PAYLOAD':
    case 'PAYLOAD_TOO_LARGE':
      return 400;
    case 'WORKSPACE_UNRESOLVED':
    case 'TXN_FAILED':
    case 'ID_MAP_CONFLICT':
      return 409;
    case 'PLUGIN_UNAVAILABLE':
    case 'WRITE_UNAVAILABLE':
    case 'UI_SESSION_UNAVAILABLE':
    case 'WS_UNAVAILABLE':
    case 'WS_TIMEOUT':
    case 'DB_UNAVAILABLE':
    case 'QUEUE_UNAVAILABLE':
    case 'API_UNAVAILABLE':
    case 'API_TIMEOUT':
      return 503;
    default:
      return 500;
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(`${JSON.stringify(payload)}\n`);
}

function readJsonBody(req: IncomingMessage): Effect.Effect<any, CliError> {
  return Effect.async<any, CliError>((resume) => {
    const chunks: Buffer[] = [];

    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    };

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    const onEnd = () => {
      cleanup();
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resume(Effect.succeed(raw ? JSON.parse(raw) : {}));
      } catch (error) {
        resume(
          Effect.fail(
            new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              exitCode: 2,
              details: { error: String((error as any)?.message || error) },
            }),
          ),
        );
      }
    };

    const onError = (error: unknown) => {
      cleanup();
      resume(
        Effect.fail(
          new CliError({
            code: 'INVALID_PAYLOAD',
            message: 'Failed to read request body',
            exitCode: 2,
            details: { error: String((error as any)?.message || error) },
          }),
        ),
      );
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);

    return Effect.sync(cleanup);
  });
}

export function runHttpApiRuntime(params?: {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly stateFile?: string | undefined;
}): Effect.Effect<
  void,
  CliError,
  | AppConfig
  | ApiDaemonFiles
  | DaemonFiles
  | WsClient
  | Queue
  | Payload
  | RefResolver
  | HostApiClient
  | WorkspaceBindings
  | RemDb
  | Process
  | SupervisorState
  | StatusLineController
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const runtimeCfg = { ...cfg, apiBaseUrl: undefined };
    const basePath = cfg.apiBasePath ?? '/v1';
    const apiFiles = yield* ApiDaemonFiles;
    const daemonFiles = yield* DaemonFiles;
    const ws = yield* WsClient;
    const queue = yield* Queue;
    const payload = yield* Payload;
    const refs = yield* RefResolver;
    const hostApi = yield* HostApiClient;
    const workspaceBindings = yield* WorkspaceBindings;
    const remDb = yield* RemDb;
    const processSvc = yield* Process;
    const supervisorState = yield* SupervisorState;
    const statusLine = yield* StatusLineController;

    const host = params?.host ?? cfg.apiHost ?? '0.0.0.0';
    const configuredPort = params?.port ?? cfg.apiPort ?? 3000;
    const stateFilePath = params?.stateFile ?? cfg.apiStateFile ?? apiFiles.defaultStateFile();
    const startedAt = Date.now();

    const provide = <A>(effect: Effect.Effect<A, CliError, any>) =>
      effect.pipe(
        Effect.provideService(AppConfig, runtimeCfg),
        Effect.provideService(ApiDaemonFiles, apiFiles),
        Effect.provideService(DaemonFiles, daemonFiles),
        Effect.provideService(WsClient, ws),
        Effect.provideService(Queue, queue),
        Effect.provideService(Payload, payload),
        Effect.provideService(RefResolver, refs),
        Effect.provideService(HostApiClient, hostApi),
        Effect.provideService(WorkspaceBindings, workspaceBindings),
        Effect.provideService(RemDb, remDb),
        Effect.provideService(Process, processSvc),
        Effect.provideService(SupervisorState, supervisorState),
        Effect.provideService(StatusLineController, statusLine),
      ) as Effect.Effect<A, CliError, never>;

    const routePathFor = (pathname: string): string | null => {
      if (basePath === '/') return pathname || '/';
      if (pathname === basePath) return '/';
      if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || '/';
      return null;
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const method = req.method || 'GET';
      const routePath = routePathFor(url.pathname);

      const run = async (effect: Effect.Effect<any, CliError, any>, statusCode = 200) => {
        const exit = await Effect.runPromiseExit(provide(effect));
        if (Exit.isSuccess(exit)) {
          sendJson(res, statusCode, ok(exit.value));
          return;
        }

        const failure = Cause.failureOption(exit.cause);
        const cliError = failure._tag === 'Some' && isCliError(failure.value)
          ? failure.value
          : new CliError({
              code: 'INTERNAL',
              message: Cause.pretty(exit.cause),
              exitCode: 1,
            });
        sendJson(res, statusCodeFromCliError(cliError), fail(toJsonError(cliError), cliError.hint));
      };

      if (method === 'GET' && routePath === '/health') {
        void run(
          Effect.gen(function* () {
            return yield* collectApiHealthUseCase({
              pid: process.pid,
              host,
              port: currentPort(),
              basePath,
              startedAt,
            });
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/status') {
        void run(
          Effect.gen(function* () {
            return yield* collectApiStatusUseCase({
              pid: process.pid,
              host,
              port: currentPort(),
              basePath,
              startedAt,
            });
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/ui-context') {
        sendJson(res, 200, ok(loadBridgeUiContextSnapshot({})));
        return;
      }

      if (method === 'GET' && routePath === '/selection') {
        sendJson(res, 200, ok(loadBridgeSelectionSnapshot({})));
        return;
      }

      if (method === 'GET' && routePath === '/plugin/ui-context/snapshot') {
        void run(
          collectUiContextSnapshotUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/ui-context/page') {
        void run(
          collectUiContextPageUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/ui-context/focused-rem') {
        void run(
          collectUiContextFocusedRemUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/ui-context/describe') {
        void run(
          collectUiContextDescribeUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
            selectionLimit: url.searchParams.get('selectionLimit')
              ? Number(url.searchParams.get('selectionLimit'))
              : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/selection/snapshot') {
        void run(
          collectSelectionSnapshotUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/selection/roots') {
        void run(
          collectSelectionRootsUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/selection/current') {
        void run(
          collectSelectionCurrentUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/plugin/current') {
        void run(
          collectPluginCurrentUseCase({
            stateFile: url.searchParams.get('stateFile') ?? undefined,
            staleMs: url.searchParams.get('staleMs') ? Number(url.searchParams.get('staleMs')) : undefined,
            selectionLimit: url.searchParams.get('selectionLimit') ? Number(url.searchParams.get('selectionLimit')) : undefined,
          }),
        );
        return;
      }

      if (method === 'GET' && routePath === '/daily/rem-id') {
        void run(
          executeDailyRemIdUseCase({
            date: url.searchParams.get('date') ?? undefined,
            offsetDays: url.searchParams.get('offsetDays') ? Number(url.searchParams.get('offsetDays')) : undefined,
          }),
        );
        return;
      }

      if (method === 'POST' && routePath === '/plugin/selection/outline') {
        void (async () => {
          try {
            const body = await Effect.runPromise(readJsonBody(req));
            await run(
              collectSelectionOutlineUseCase({
                stateFile: typeof body?.stateFile === 'string' ? body.stateFile : undefined,
                staleMs: typeof body?.staleMs === 'number' ? body.staleMs : undefined,
                maxDepth: typeof body?.maxDepth === 'number' ? body.maxDepth : undefined,
                maxNodes: typeof body?.maxNodes === 'number' ? body.maxNodes : undefined,
                excludeProperties: body?.excludeProperties === true,
                includeEmpty: body?.includeEmpty === true,
                expandReferences:
                  body?.expandReferences === true ? true : body?.expandReferences === false ? false : undefined,
                maxReferenceDepth: typeof body?.maxReferenceDepth === 'number' ? body.maxReferenceDepth : undefined,
                detail: body?.detail === true,
              }),
            );
          } catch (error) {
            const cliError = isCliError(error)
              ? error
              : new CliError({
                  code: 'INVALID_PAYLOAD',
                  message: 'Invalid JSON body',
                  exitCode: 2,
                  details: { error: String((error as any)?.message || error) },
                });
            sendJson(res, statusCodeFromCliError(cliError), fail(toJsonError(cliError), cliError.hint));
          }
        })();
        return;
      }

      if (method === 'POST' && routePath === '/search/db') {
        void (async () => {
          try {
            const body = await Effect.runPromise(readJsonBody(req));
            await run(
              executeDbSearchUseCase({
                query: String(body?.query ?? ''),
                timeRange: typeof body?.timeRange === 'string' ? body.timeRange : undefined,
                parentId: typeof body?.parentId === 'string' ? body.parentId : undefined,
                pagesOnly: body?.pagesOnly === true,
                excludePages: body?.excludePages === true,
                limit: typeof body?.limit === 'number' ? body.limit : undefined,
                offset: typeof body?.offset === 'number' ? body.offset : undefined,
                timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
              }),
            );
          } catch (error) {
            const cliError = new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              exitCode: 2,
              details: { error: String((error as any)?.message || error) },
            });
            sendJson(res, 400, fail(toJsonError(cliError), cliError.hint));
          }
        })();
        return;
      }

      if (method === 'POST' && routePath === '/read/outline') {
        void (async () => {
          try {
            const body = await Effect.runPromise(readJsonBody(req));
            await run(
              executeReadOutlineUseCase({
                id: typeof body?.id === 'string' ? body.id : undefined,
                ref: typeof body?.ref === 'string' ? body.ref : undefined,
                depth: typeof body?.depth === 'number' ? body.depth : undefined,
                offset: typeof body?.offset === 'number' ? body.offset : undefined,
                nodes: typeof body?.nodes === 'number' ? body.nodes : undefined,
                format: body?.format === 'json' ? 'json' : body?.format === 'md' ? 'md' : undefined,
                excludeProperties: body?.excludeProperties === true,
                includeEmpty: body?.includeEmpty === true,
                expandReferences: body?.expandReferences === true ? true : body?.expandReferences === false ? false : undefined,
                maxReferenceDepth: typeof body?.maxReferenceDepth === 'number' ? body.maxReferenceDepth : undefined,
                detail: body?.detail === true,
              }),
            );
          } catch (error) {
            const cliError = isCliError(error)
              ? error
              : new CliError({
                  code: 'INVALID_PAYLOAD',
                  message: 'Invalid JSON body',
                  exitCode: 2,
                  details: { error: String((error as any)?.message || error) },
                });
            sendJson(res, statusCodeFromCliError(cliError), fail(toJsonError(cliError), cliError.hint));
          }
        })();
        return;
      }

      if (method === 'POST' && routePath === '/search/plugin') {
        void (async () => {
          try {
            const body = await Effect.runPromise(readJsonBody(req));
            await run(
              executePluginSearchUseCase({
                query: String(body?.query ?? ''),
                searchContextRemId: typeof body?.searchContextRemId === 'string' ? body.searchContextRemId : undefined,
                limit: typeof body?.limit === 'number' ? body.limit : undefined,
                timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
                ensureDaemon: body?.ensureDaemon !== false,
              }),
            );
          } catch (error) {
            const cliError = new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              exitCode: 2,
              details: { error: String((error as any)?.message || error) },
            });
            sendJson(res, 400, fail(toJsonError(cliError), cliError.hint));
          }
        })();
        return;
      }

      if (method === 'POST' && routePath === '/write/apply') {
        void (async () => {
          try {
            const body = await Effect.runPromise(readJsonBody(req));
            await run(
              executeWriteApplyUseCase({
                raw: body,
                priority: typeof body?.priority === 'number' ? body.priority : undefined,
                clientId: typeof body?.clientId === 'string' ? body.clientId : undefined,
                idempotencyKey: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
                meta: body?.meta,
                notify: body?.notify !== false,
                ensureDaemon: body?.ensureDaemon !== false,
                wait: body?.wait === true,
                timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
                pollMs: typeof body?.pollMs === 'number' ? body.pollMs : undefined,
              }),
            );
          } catch (error) {
            const cliError = new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              exitCode: 2,
              details: { error: String((error as any)?.message || error) },
            });
            sendJson(res, 400, fail(toJsonError(cliError), cliError.hint));
          }
        })();
        return;
      }

      if (method === 'POST' && routePath === '/queue/wait') {
        void (async () => {
          try {
            const body = await Effect.runPromise(readJsonBody(req));
            await run(
              waitForTxn({ txnId: String(body?.txnId ?? ''), timeoutMs: body?.timeoutMs, pollMs: body?.pollMs }),
            );
          } catch (error) {
            const cliError = new CliError({
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              exitCode: 2,
              details: { error: String((error as any)?.message || error) },
            });
            sendJson(res, 400, fail(toJsonError(cliError), cliError.hint));
          }
        })();
        return;
      }

      if (method === 'GET' && typeof routePath === 'string' && routePath.startsWith('/queue/txns/')) {
        const txnId = decodeURIComponent(routePath.slice('/queue/txns/'.length));
        void run(executeQueueTxnUseCase({ txnId }));
        return;
      }

      if (method === 'POST' && routePath === '/actions/trigger-sync') {
        void run(executeTriggerSyncUseCase());
        return;
      }

      sendJson(
        res,
        404,
        fail({ code: 'INVALID_ARGS', message: `Route not found: ${method} ${url.pathname}` }, [
          'Check the HTTP method and path',
        ]),
      );
    });

    const currentPort = (): number => {
      const addr = server.address();
      return addr && typeof addr === 'object' ? addr.port : configuredPort;
    };

    const listen = Effect.async<void, CliError>((resume) => {
      const onError = (error: unknown) => {
        cleanup();
        resume(
          Effect.fail(
            new CliError({
              code: 'API_UNAVAILABLE',
              message: 'Failed to start host api server',
              exitCode: 1,
              details: { host, port: configuredPort, error: String((error as any)?.message || error) },
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
      server.listen(configuredPort, host);

      return Effect.sync(cleanup);
    });

    yield* listen;

    const actualPort = currentPort();
    const daemonHealth = yield* ws.health({ url: cfg.wsUrl, timeoutMs: 2000 }).pipe(Effect.either);
    yield* apiFiles.writeStateFile(stateFilePath, {
      running: true,
      pid: process.pid,
      host,
      port: actualPort,
      basePath,
      startedAt,
      localBaseUrl: apiLocalBaseUrl(actualPort, basePath),
      containerBaseUrl: apiContainerBaseUrl(actualPort, basePath),
      daemon: { healthy: daemonHealth._tag === 'Right', wsUrl: cfg.wsUrl },
    });

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
    yield* apiFiles.deleteStateFile(stateFilePath).pipe(Effect.catchAll(() => Effect.void));
  });
}
