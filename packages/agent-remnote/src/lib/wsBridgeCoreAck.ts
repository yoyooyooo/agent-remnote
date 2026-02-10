import type { WsConnId } from '../kernel/ws-bridge/index.js';

import {
  type AckResult,
  IdMapConflictError,
  ackDead,
  ackRetry,
  ackSuccess,
  getTxnIdByOpId,
  recordOpAttempt,
  upsertIdMap,
} from '../internal/queue/index.js';

import type { WsBridgeCoreAction, WsBridgeCoreDb } from './wsBridgeCoreTypes.js';

export type OpAckHandlingResult = {
  readonly actions: readonly WsBridgeCoreAction[];
  readonly touchAckTimestamp: boolean;
  readonly invalidateStatusLineReason: string | null;
};

export function handleOpAckMessage(params: {
  readonly now: number;
  readonly db: WsBridgeCoreDb;
  readonly connId: WsConnId;
  readonly msg: any;
}): OpAckHandlingResult {
  const opId = typeof params.msg?.op_id === 'string' ? params.msg.op_id : typeof params.msg?.opId === 'string' ? params.msg.opId : '';
  const attemptId =
    typeof params.msg?.attempt_id === 'string'
      ? params.msg.attempt_id
      : typeof params.msg?.attemptId === 'string'
        ? params.msg.attemptId
        : '';
  const status = typeof params.msg?.status === 'string' ? params.msg.status : '';
  if (!opId || !attemptId || !status) {
    return {
      actions: [
        {
          _tag: 'Log',
          level: 'warn',
          event: 'invalid_op_ack',
          details: { connId: params.connId, opId: opId || null, attemptId: attemptId || null, status: status || null },
        },
        { _tag: 'SendJson', connId: params.connId, msg: { type: 'Error', message: 'invalid OpAck' } },
      ],
      touchAckTimestamp: false,
      invalidateStatusLineReason: null,
    };
  }

  const lockedBy = params.connId;

  const ackRes = (() => {
    try {
      if (status === 'success') {
        return ackSuccess(params.db, { opId, attemptId, lockedBy, result: params.msg.result || null });
      }
      if (status === 'retry') {
        return ackRetry(params.db, {
          opId,
          attemptId,
          lockedBy,
          error: { code: params.msg.error_code, message: params.msg.error_message, retryAfterMs: params.msg.retry_after_ms },
        });
      }
      if (status === 'failed' || status === 'dead') {
        return ackDead(params.db, { opId, attemptId, lockedBy, error: { code: params.msg.error_code, message: params.msg.error_message } });
      }
      return { ok: false as const, op_id: opId, attempt_id: attemptId, reason: 'stale_ack' as const };
    } catch {
      return { ok: false as const, op_id: opId, attempt_id: attemptId, reason: 'stale_ack' as const };
    }
  })() satisfies AckResult;

  if (!ackRes.ok) {
    return {
      actions: [
        {
          _tag: 'Log',
          level: 'warn',
          event: 'op_ack_rejected',
          details: {
            connId: params.connId,
            opId,
            attemptId,
            status,
            reason: ackRes.reason,
            current: (ackRes as any).current ?? null,
          },
        },
        {
          _tag: 'SendJson',
          connId: params.connId,
          msg: {
            type: 'AckRejected',
            op_id: opId,
            attempt_id: attemptId,
            reason:
              ackRes.reason === 'not_found'
                ? 'not_found'
                : ackRes.reason === 'invalid_attempt'
                  ? 'stale_attempt'
                  : 'stale_ack',
            current: (ackRes as any).current,
          },
        },
      ],
      touchAckTimestamp: true,
      invalidateStatusLineReason: 'op_ack_rejected',
    };
  }

  const actions: WsBridgeCoreAction[] = [
    {
      _tag: 'Log',
      level: 'debug',
      event: 'op_acked',
      details: {
        connId: params.connId,
        opId,
        attemptId,
        status,
        duplicate: (ackRes as any).duplicate ?? null,
        error_code: params.msg?.error_code ?? null,
        error_message: params.msg?.error_message ?? null,
        retry_after_ms: params.msg?.retry_after_ms ?? null,
      },
    },
  ];

  if (status === 'success' && (ackRes as any).duplicate === false) {
    try {
      const mappings: Array<{ client_temp_id: string; remote_id: string; remote_type?: string }> = [];
      const created = params.msg?.result?.created;
      if (created?.client_temp_id && created?.remote_id) {
        mappings.push({
          client_temp_id: created.client_temp_id,
          remote_id: created.remote_id,
          remote_type: created.remote_type || 'rem',
        });
      }
      if (Array.isArray(params.msg?.result?.id_map)) {
        for (const m of params.msg.result.id_map) {
          if (m?.client_temp_id && m?.remote_id) {
            mappings.push({
              client_temp_id: m.client_temp_id,
              remote_id: m.remote_id,
              remote_type: m.remote_type || 'rem',
            });
          }
        }
      }
      if (Array.isArray(params.msg?.remote_id_map)) {
        for (const m of params.msg.remote_id_map) {
          if (m?.client_temp_id && m?.remote_id) {
            mappings.push({
              client_temp_id: m.client_temp_id,
              remote_id: m.remote_id,
              remote_type: m.remote_type || 'rem',
            });
          }
        }
      }
      if (mappings.length > 0) {
        const txnId = getTxnIdByOpId(params.db, opId);
        upsertIdMap(
          params.db,
          mappings.map((m) => ({ ...m, source_txn: txnId })),
        );
      }
    } catch (e) {
      if (e instanceof IdMapConflictError) {
        const txnId = getTxnIdByOpId(params.db, opId);
        try {
          recordOpAttempt(params.db, {
            opId,
            attemptId,
            connId: lockedBy,
            status: 'id_map_conflict',
            detail: {
              txn_id: txnId ?? null,
              client_temp_id: e.clientTempId,
              existing: e.existing,
              incoming: e.incoming,
            },
          });
        } catch {}

        const nextActions = [
          `agent-remnote queue inspect --op ${opId}`,
          txnId ? `agent-remnote queue inspect --txn ${txnId}` : undefined,
          'agent-remnote queue stats',
        ].filter((x): x is string => typeof x === 'string' && x.length > 0);

        actions.push({
          _tag: 'Log',
          level: 'warn',
          event: 'id_map_conflict',
          details: { opId, attemptId, txnId: txnId ?? null, clientTempId: e.clientTempId },
        });

        actions.push({
          _tag: 'SendJson',
          connId: params.connId,
          msg: {
            type: 'Error',
            code: 'ID_MAP_CONFLICT',
            message: 'Id map conflict detected',
            details: {
              op_id: opId,
              attempt_id: attemptId,
              txn_id: txnId ?? undefined,
              client_temp_id: e.clientTempId,
              existing: e.existing,
              incoming: e.incoming,
            },
            nextActions,
          },
        });
      }
    }
  }

  actions.push({ _tag: 'SendJson', connId: params.connId, msg: { type: 'AckOk', ok: true, op_id: opId, attempt_id: attemptId } });

  return { actions, touchAckTimestamp: true, invalidateStatusLineReason: 'op_acked' };
}
