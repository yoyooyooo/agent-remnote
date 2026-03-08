import { Worker } from 'node:worker_threads';

export type WorkerRunnerEnvelope =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: { readonly message: string; readonly stack?: string | undefined } };

export type WorkerRunnerDiagnostics = {
  readonly url: string;
  readonly threadId: number;
  readonly timeoutMs: number;
  readonly workerData?: unknown;
};

export async function runWorkerJob(params: {
  readonly url: URL;
  readonly workerData: unknown;
  readonly timeoutMs: number;
  readonly onTimeout: (diag: WorkerRunnerDiagnostics) => Error;
}): Promise<unknown> {
  const timeoutMs = Math.max(1, Math.floor(params.timeoutMs));

  return await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(params.url, { workerData: params.workerData });

    const diag: WorkerRunnerDiagnostics = {
      url: String(params.url),
      threadId: worker.threadId,
      timeoutMs,
      workerData: params.workerData,
    };

    let settled = false;
    let terminating = false;
    const done = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };

    const fail = (error: unknown) => {
      const err =
        error instanceof Error ? error : new Error(String((error as any)?.message || error || 'Unknown error'));
      if ((err as any).details === undefined) (err as any).details = diag;
      reject(err);
    };

    const timer = setTimeout(() => {
      terminating = true;
      worker.terminate().catch(() => {});
      done(() => {
        cleanup();
        const err = params.onTimeout(diag);
        if ((err as any).details === undefined) (err as any).details = diag;
        fail(err);
      });
    }, timeoutMs);

    const onMessage = (msg: WorkerRunnerEnvelope) => {
      done(() => {
        cleanup();
        worker.terminate().catch(() => {});
        if (msg && (msg as any).ok === true) {
          resolve((msg as any).result);
          return;
        }
        const message = String((msg as any)?.error?.message || 'Worker error');
        const err = new Error(message);
        const stack = (msg as any)?.error?.stack;
        if (typeof stack === 'string' && stack.trim()) (err as any).stack = stack;
        (err as any).details = diag;
        fail(err);
      });
    };

    const onError = (err: unknown) => {
      done(() => {
        cleanup();
        fail(err);
      });
    };

    const onExit = (code: number) => {
      if (terminating) return;
      done(() => {
        cleanup();
        fail(new Error(`Worker exited unexpectedly (code=${code})`));
      });
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}
