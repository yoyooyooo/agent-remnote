import { extendLease } from '../internal/queue/index.js';

import type { WsBridgeCoreAction, WsBridgeCoreClientState, WsBridgeCoreDb } from './wsBridgeCoreTypes.js';
import { clampInt } from './wsBridgeCoreUtils.js';

export function handleLeaseExtendMessage(params: {
  readonly db: WsBridgeCoreDb;
  readonly client: WsBridgeCoreClientState | undefined;
  readonly connId: string;
  readonly msg: any;
}): readonly WsBridgeCoreAction[] {
  if (!params.client) {
    return [{ _tag: 'SendJson', connId: params.connId, msg: { type: 'Error', message: 'unknown client' } }];
  }
  if (!params.client.capabilities?.worker) {
    return [{ _tag: 'SendJson', connId: params.connId, msg: { type: 'Error', message: 'worker capability required' } }];
  }
  if (params.client.protocolVersion !== 2) {
    return [
      {
        _tag: 'SendJson',
        connId: params.connId,
        msg: {
          type: 'Error',
          code: 'WS_PROTOCOL_VERSION_MISMATCH',
          message: 'WS Protocol v2 is required',
          details: { expected: 2, got: params.client.protocolVersion ?? null },
          nextActions: ['Update the RemNote plugin', 'Restart the plugin and retry'],
        },
      },
    ];
  }

  const opId =
    typeof params.msg?.op_id === 'string'
      ? params.msg.op_id
      : typeof params.msg?.opId === 'string'
        ? params.msg.opId
        : '';
  const attemptId =
    typeof params.msg?.attempt_id === 'string'
      ? params.msg.attempt_id
      : typeof params.msg?.attemptId === 'string'
        ? params.msg.attemptId
        : '';
  const extendMsRaw =
    typeof params.msg?.extendMs === 'number'
      ? params.msg.extendMs
      : typeof params.msg?.extend_ms === 'number'
        ? params.msg.extend_ms
        : undefined;
  const extendMsRequested = Number.isFinite(extendMsRaw) && extendMsRaw > 0 ? Math.floor(extendMsRaw) : 0;
  const extendMsEffective = clampInt(extendMsRequested, 1000, 120_000);

  if (!opId || !attemptId) {
    return [{ _tag: 'SendJson', connId: params.connId, msg: { type: 'Error', message: 'invalid LeaseExtend' } }];
  }

  const lockedBy = params.connId;
  const res = (() => {
    try {
      return extendLease(params.db, { opId, attemptId, lockedBy, extendMs: extendMsEffective });
    } catch {
      return { ok: false as const, op_id: opId, attempt_id: attemptId, reason: 'not_in_flight' as const };
    }
  })();

  if (res.ok) {
    return [
      {
        _tag: 'SendJson',
        connId: params.connId,
        msg: {
          type: 'LeaseExtendOk',
          ok: true,
          op_id: opId,
          attempt_id: attemptId,
          lease_expires_at: (res as any).lease_expires_at,
        },
      },
    ];
  }

  return [
    {
      _tag: 'SendJson',
      connId: params.connId,
      msg: {
        type: 'LeaseExtendRejected',
        ok: false,
        op_id: opId,
        attempt_id: attemptId,
        reason: (res as any).reason,
        current: (res as any).current,
      },
    },
  ];
}
