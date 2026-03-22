import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { Payload } from '../../services/Payload.js';
import { Queue, type EnqueueOpInput } from '../../services/Queue.js';
import { WsClient } from '../../services/WsClient.js';
import type { DaemonFiles } from '../../services/DaemonFiles.js';
import type { Process } from '../../services/Process.js';
import type { SupervisorState } from '../../services/SupervisorState.js';
import { StatusLineController } from '../../runtime/status-line/StatusLineController.js';
import { enqueueOps, type EnqueueAndNotifyResult } from '../_enqueue.js';
import { waitForTxn, type WaitTxnResult } from '../_waitTxn.js';

export function dispatchOps(params: {
  readonly ops: readonly EnqueueOpInput[];
  readonly priority?: number | undefined;
  readonly clientId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly dispatchMode?: 'serial' | 'conflict_parallel' | undefined;
  readonly meta?: unknown;
  readonly notify: boolean;
  readonly ensureDaemon: boolean;
  readonly wait: boolean;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
}): Effect.Effect<
  EnqueueAndNotifyResult | (EnqueueAndNotifyResult & WaitTxnResult),
  any,
  AppConfig | HostApiClient | WsClient | Queue | Payload | DaemonFiles | Process | SupervisorState | StatusLineController
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;

    if (cfg.apiBaseUrl) {
      const hostApi = yield* HostApiClient;
      const data = (yield* hostApi.writeApply({
        baseUrl: cfg.apiBaseUrl,
        body: {
          version: 1,
          kind: 'ops',
          ops: params.ops,
          priority: params.priority,
          clientId: params.clientId,
          idempotencyKey: params.idempotencyKey,
          meta: params.meta,
          notify: params.notify,
          ensureDaemon: params.ensureDaemon,
        },
      })) as EnqueueAndNotifyResult;

      if (!params.wait) return data;

      const waited = (yield* hostApi.queueWait({
        baseUrl: cfg.apiBaseUrl,
        txnId: String((data as any).txn_id),
        timeoutMs: params.timeoutMs,
        pollMs: params.pollMs,
      })) as WaitTxnResult;

      return { ...data, ...waited };
    }

    const data = yield* enqueueOps({
      ops: params.ops,
      priority: params.priority,
      clientId: params.clientId,
      idempotencyKey: params.idempotencyKey,
      dispatchMode: params.dispatchMode,
      meta: params.meta,
      notify: params.notify,
      ensureDaemon: params.ensureDaemon,
    });

    if (!params.wait) return data;

    const waited = yield* waitForTxn({
      txnId: data.txn_id,
      timeoutMs: params.timeoutMs,
      pollMs: params.pollMs,
    });

    return { ...data, ...waited };
  });
}
