import { deriveConflictKeys } from '../kernel/conflicts/index.js';
import { collectTempIdsFromPayload, substituteTempIdsInPayload } from '../kernel/op-catalog/index.js';

import {
  ackDead,
  claimOpById,
  claimSelectedOpsBatch,
  getRemoteIdsByClientTempIds,
  listInFlightOps,
  peekEligibleOps,
} from '../internal/queue/index.js';

import type { WsBridgeCoreClientState, WsBridgeCoreConfig, WsBridgeCoreDb } from './wsBridgeCoreTypes.js';
import { clampInt, safeParseJson } from './wsBridgeCoreUtils.js';

export type RequestOpsSelection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'oversize';
      readonly opId: string;
      readonly opBytes: number;
      readonly maxBytesEffective: number;
      readonly maxOpBytesEffective: number;
    }
  | { readonly kind: 'dispatch'; readonly msg: any; readonly firstOpId: string | null };

type DispatchCandidateInfo = {
  readonly op_id: string;
  readonly txn_id: string;
  readonly op_seq: number;
  readonly op_type: string;
  readonly txn_dispatch_mode: string | null;
  readonly payload: unknown;
  readonly payload_json: string;
  readonly payloadSub: unknown;
  readonly idempotency_key: string | null;
  readonly leaseMs: number;
  readonly depsReady: boolean;
  readonly missingTempIds: readonly string[];
  readonly keys: readonly string[];
  readonly opBytes: number;
};

function chooseLookaheadSeed(params: {
  readonly candidates: readonly DispatchCandidateInfo[];
  readonly maxOpsEffective: number;
  readonly maxBytesEffective: number;
  readonly maxOpBytesEffective: number;
  readonly baseBudgetForEstimate: unknown;
  readonly skipped: unknown;
  readonly estimateBatchBytes: (p: {
    readonly opBytesSum: number;
    readonly opCount: number;
    readonly budget: unknown;
    readonly skipped: unknown;
  }) => number;
  readonly usedKeys: ReadonlySet<string>;
  readonly usedTxnIds: ReadonlySet<string>;
  readonly wsSchedulerEnabled: boolean;
  readonly isSerialTxn: (dispatchMode: unknown) => boolean;
}): {
  readonly windowCount: number;
  readonly seedIds: ReadonlySet<string>;
} {
  const windowCount = Math.min(params.candidates.length, Math.max(8, Math.min(12, params.maxOpsEffective * 4)));
  if (windowCount <= 1 || params.maxOpsEffective <= 1) {
    return { windowCount: 0, seedIds: new Set() };
  }

  const window = params.candidates.slice(0, windowCount);
  let best: {
    readonly indices: readonly number[];
    readonly bytes: number;
  } = {
    indices: [],
    bytes: 0,
  };

  const betterThanBest = (indices: readonly number[], bytes: number): boolean => {
    if (indices.length !== best.indices.length) return indices.length > best.indices.length;
    const sum = indices.reduce((acc, value) => acc + value, 0);
    const bestSum = best.indices.reduce((acc, value) => acc + value, 0);
    if (sum !== bestSum) return sum < bestSum;
    return bytes > best.bytes;
  };

  const dfs = (
    position: number,
    selectedIndices: readonly number[],
    usedKeys: ReadonlySet<string>,
    usedTxnIds: ReadonlySet<string>,
    opBytesSum: number,
  ): void => {
    if (selectedIndices.length > params.maxOpsEffective) return;
    if (selectedIndices.length + (window.length - position) < best.indices.length) return;

    if (position >= window.length) {
      if (betterThanBest(selectedIndices, opBytesSum)) {
        best = { indices: [...selectedIndices], bytes: opBytesSum };
      }
      return;
    }

    dfs(position + 1, selectedIndices, usedKeys, usedTxnIds, opBytesSum);

    const candidate = window[position]!;
    if (!candidate.depsReady) return;
    if (candidate.txn_id && usedTxnIds.has(candidate.txn_id)) return;
    if (params.wsSchedulerEnabled) {
      for (const key of candidate.keys) {
        if (usedKeys.has(key)) return;
      }
    }
    if (candidate.opBytes > params.maxOpBytesEffective) return;

    const nextCount = selectedIndices.length + 1;
    const nextBytesSum = opBytesSum + candidate.opBytes;
    const est = params.estimateBatchBytes({
      opBytesSum: nextBytesSum,
      opCount: nextCount,
      budget: params.baseBudgetForEstimate,
      skipped: params.skipped,
    });
    if (est + 256 > params.maxBytesEffective) return;

    const nextUsedKeys = new Set(usedKeys);
    const nextUsedTxnIds = new Set(usedTxnIds);
    if (candidate.txn_id && params.isSerialTxn(candidate.txn_dispatch_mode)) nextUsedTxnIds.add(candidate.txn_id);
    if (params.wsSchedulerEnabled) for (const key of candidate.keys) nextUsedKeys.add(key);

    dfs(position + 1, [...selectedIndices, position], nextUsedKeys, nextUsedTxnIds, nextBytesSum);
  };

  dfs(0, [], new Set(params.usedKeys), new Set(params.usedTxnIds), 0);

  if (best.indices.length <= 1) {
    return { windowCount: 0, seedIds: new Set() };
  }

  return {
    windowCount,
    seedIds: new Set(best.indices.map((index) => window[index]!.op_id)),
  };
}

export function selectOpsForDispatch(params: {
  readonly db: WsBridgeCoreDb;
  readonly cfg: WsBridgeCoreConfig;
  readonly client: WsBridgeCoreClientState;
  readonly leaseMsRequested: number | undefined;
  readonly maxOpsRequested: number;
  readonly maxBytesRequested: number | undefined;
  readonly maxOpBytesRequested: number | undefined;
}): RequestOpsSelection {
  const leaseMsEffective = clampInt(params.leaseMsRequested ?? 30_000, 100, 300_000);

  const maxOpsEffective = clampInt(params.maxOpsRequested, 1, 100);

  const maxBytesHardMax = Math.max(1, Math.floor(params.cfg.wsDispatchMaxBytes));
  const maxBytesMin = Math.min(1024, maxBytesHardMax);
  const maxBytesEffective = clampInt(params.maxBytesRequested ?? maxBytesHardMax, maxBytesMin, maxBytesHardMax);

  const maxOpBytesHardMax = Math.max(1, Math.floor(params.cfg.wsDispatchMaxOpBytes));
  const maxOpBytesMin = Math.min(256, maxOpBytesHardMax);
  const maxOpBytesEffective = Math.min(
    clampInt(params.maxOpBytesRequested ?? maxOpBytesHardMax, maxOpBytesMin, maxOpBytesHardMax),
    maxBytesEffective,
  );

  const peekLimit = clampInt(Math.max(50, maxOpsEffective * 10), 50, 500);

  const estimateBatchBytes = (p: {
    readonly opBytesSum: number;
    readonly opCount: number;
    readonly budget: unknown;
    readonly skipped: unknown;
  }): number => {
    const budgetJson = JSON.stringify(p.budget ?? {});
    const skippedJson = JSON.stringify(p.skipped ?? {});
    const opsBytes = p.opCount <= 0 ? 2 : 2 + p.opBytesSum + (p.opCount - 1);
    return (
      Buffer.byteLength('{"type":"OpDispatchBatch","budget":', 'utf8') +
      Buffer.byteLength(budgetJson, 'utf8') +
      Buffer.byteLength(',"skipped":', 'utf8') +
      Buffer.byteLength(skippedJson, 'utf8') +
      Buffer.byteLength(',"ops":', 'utf8') +
      opsBytes +
      Buffer.byteLength('}', 'utf8')
    );
  };

  const baseBudgetForEstimate = {
    maxOpsRequested: params.maxOpsRequested,
    maxOpsEffective,
    maxBytesRequested: params.maxBytesRequested ?? maxBytesEffective,
    maxBytesEffective,
    maxOpBytesRequested: params.maxOpBytesRequested ?? maxOpBytesEffective,
    maxOpBytesEffective,
    approxBytes: 0,
    scanLimit: peekLimit,
  };

  const skipped = { overBudget: 0, oversizeOp: 0, conflict: 0, txnBusy: 0, depsMissing: 0 };

  const usedKeys = new Set<string>();
  const usedTxnIds = new Set<string>();

  const isSerialTxn = (dispatchMode: unknown): boolean => {
    const raw = typeof dispatchMode === 'string' ? dispatchMode.trim() : '';
    return raw !== 'conflict_parallel';
  };

  const mergeKeys = (a: readonly string[], b: readonly string[]): readonly string[] => {
    const out: string[] = [];
    for (const k of [...a, ...b]) {
      if (!k) continue;
      if (out.includes(k)) continue;
      out.push(k);
    }
    return out;
  };

  const inFlight = listInFlightOps(params.db, 500);
  for (const o of inFlight) {
    const txnId = typeof (o as any).txn_id === 'string' ? (o as any).txn_id : '';
    if (!txnId) continue;
    if (isSerialTxn((o as any).txn_dispatch_mode)) usedTxnIds.add(txnId);
  }

  const candidates = peekEligibleOps(params.db, peekLimit).map((op) => {
    const op_id = String((op as any).op_id);
    const txn_id = String((op as any).txn_id);
    const op_seq =
      typeof (op as any).op_seq === 'number' && Number.isFinite((op as any).op_seq)
        ? (op as any).op_seq
        : Number((op as any).op_seq ?? 0);
    const op_type = String((op as any).type);
    const txn_dispatch_mode = (op as any)?.txn_dispatch_mode ?? null;
    const payload_json = String((op as any).payload_json ?? '');
    const payload = safeParseJson(payload_json);
    const payloadBytes = Buffer.byteLength(payload_json, 'utf8');
    const leaseMs =
      payloadBytes >= 200_000
        ? Math.max(leaseMsEffective, Math.round(leaseMsEffective * 2))
        : payloadBytes >= 50_000
          ? Math.max(leaseMsEffective, Math.round(leaseMsEffective * 1.5))
          : leaseMsEffective;
    const leaseMsForOp = clampInt(leaseMs, 100, 300_000);
    return {
      op_id,
      txn_id,
      op_seq,
      op_type,
      txn_dispatch_mode,
      payload,
      payload_json,
      payloadBytes,
      idempotency_key: (op as any).idempotency_key ?? null,
      leaseMs: leaseMsForOp,
    };
  });

  const tempIds = new Set<string>();
  for (const o of inFlight) {
    const opType = String((o as any)?.type ?? '');
    const payload = safeParseJson(String((o as any)?.payload_json ?? ''));
    const ids = collectTempIdsFromPayload(opType, payload);
    for (const id of ids) tempIds.add(id);
  }
  for (const c of candidates) {
    const ids = collectTempIdsFromPayload(c.op_type, c.payload);
    for (const id of ids) tempIds.add(id);
  }
  const tempIdList = Array.from(tempIds);
  const idMap = tempIdList.length > 0 ? getRemoteIdsByClientTempIds(params.db, tempIdList) : {};

  if (params.cfg.wsSchedulerEnabled) {
    for (const o of inFlight) {
      const opType = String((o as any)?.type ?? '');
      const payload = safeParseJson(String((o as any)?.payload_json ?? ''));
      const payloadSub = substituteTempIdsInPayload(opType, payload, idMap);
      const keys = mergeKeys(deriveConflictKeys(opType, payload), deriveConflictKeys(opType, payloadSub));
      for (const k of keys) usedKeys.add(k);
    }
  }

  const UUID_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
  const LEASE_EXPIRES_AT_PLACEHOLDER = 1700000000000;

  const candidateInfos: DispatchCandidateInfo[] = candidates.map((c) => {
    const opTempIds = collectTempIdsFromPayload(c.op_type, c.payload);
    const missingTempIds: string[] = [];
    for (const id of opTempIds) {
      if ((idMap as any)[id]) continue;
      missingTempIds.push(id);
    }
    const depsReady = missingTempIds.length === 0;
    const payloadSub = substituteTempIdsInPayload(c.op_type, c.payload, idMap);
    const keys = params.cfg.wsSchedulerEnabled
      ? mergeKeys(deriveConflictKeys(c.op_type, c.payload), deriveConflictKeys(c.op_type, payloadSub))
      : [];
    const dispatchItemEstimate = {
      op_id: c.op_id,
      attempt_id: UUID_PLACEHOLDER,
      txn_id: c.txn_id,
      op_seq: c.op_seq,
      op_type: c.op_type,
      payload: payloadSub,
      idempotency_key: c.idempotency_key,
      lease_expires_at: LEASE_EXPIRES_AT_PLACEHOLDER,
    };
    const opJson = JSON.stringify(dispatchItemEstimate);
    const opBytes = Buffer.byteLength(opJson, 'utf8');
    return {
      ...c,
      depsReady,
      missingTempIds,
      payloadSub,
      keys,
      opBytes,
    };
  });

  const lookaheadSeed = chooseLookaheadSeed({
    candidates: candidateInfos,
    maxOpsEffective,
    maxBytesEffective,
    maxOpBytesEffective,
    baseBudgetForEstimate,
    skipped,
    estimateBatchBytes,
    usedKeys,
    usedTxnIds,
    wsSchedulerEnabled: params.cfg.wsSchedulerEnabled,
    isSerialTxn,
  });

  // Oversize op: fail-fast and mark it dead to avoid jitter.
  for (const c of candidateInfos) {
    if (c.txn_id && usedTxnIds.has(c.txn_id)) continue;
    if (!c.depsReady) continue;
    if (params.cfg.wsSchedulerEnabled) {
      let blocked = false;
      for (const k of c.keys) {
        if (usedKeys.has(k)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }

    if (c.opBytes <= maxOpBytesEffective) break;

    const claimed = claimOpById(params.db, c.op_id, params.client.connId, c.leaseMs);
    if (claimed) {
      ackDead(params.db, {
        opId: c.op_id,
        attemptId: String((claimed as any).attempt_id),
        lockedBy: params.client.connId,
        error: {
          code: 'OP_PAYLOAD_TOO_LARGE',
          message: `Operation payload is too large (${c.opBytes} bytes > ${maxOpBytesEffective} bytes)`,
        },
      });
    }

    return { kind: 'oversize', opId: c.op_id, opBytes: c.opBytes, maxBytesEffective, maxOpBytesEffective };
  }

  const selectedOps: typeof candidateInfos = [];
  let opBytesSum = 0;

  for (let index = 0; index < candidateInfos.length; index += 1) {
    const c = candidateInfos[index]!;
    if (selectedOps.length >= maxOpsEffective) break;
    if (lookaheadSeed.windowCount > 0 && index < lookaheadSeed.windowCount && !lookaheadSeed.seedIds.has(c.op_id)) {
      continue;
    }
    if (lookaheadSeed.seedIds.has(c.op_id)) {
      selectedOps.push(c);
      opBytesSum += c.opBytes;
      if (c.txn_id && isSerialTxn(c.txn_dispatch_mode)) usedTxnIds.add(c.txn_id);
      if (params.cfg.wsSchedulerEnabled) for (const k of c.keys) usedKeys.add(k);
      continue;
    }
    if (c.txn_id && usedTxnIds.has(c.txn_id)) {
      skipped.txnBusy += 1;
      continue;
    }
    if (!c.depsReady) {
      skipped.depsMissing += 1;
      continue;
    }
    if (params.cfg.wsSchedulerEnabled) {
      let blocked = false;
      for (const k of c.keys) {
        if (usedKeys.has(k)) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        skipped.conflict += 1;
        continue;
      }
    }
    if (c.opBytes > maxOpBytesEffective) {
      skipped.oversizeOp += 1;
      continue;
    }

    const nextCount = selectedOps.length + 1;
    const nextBytesSum = opBytesSum + c.opBytes;
    const est = estimateBatchBytes({
      opBytesSum: nextBytesSum,
      opCount: nextCount,
      budget: baseBudgetForEstimate,
      skipped,
    });
    // Safety margin to account for minor JSON size drift (budget/skipped digit changes, etc.).
    if (est + 256 > maxBytesEffective) {
      skipped.overBudget += 1;
      continue;
    }

    selectedOps.push(c);
    opBytesSum = nextBytesSum;
    if (c.txn_id && isSerialTxn(c.txn_dispatch_mode)) usedTxnIds.add(c.txn_id);
    if (params.cfg.wsSchedulerEnabled) for (const k of c.keys) usedKeys.add(k);
  }

  const selectedById = new Map<string, (typeof candidateInfos)[number]>();
  for (const s of selectedOps) selectedById.set(s.op_id, s);

  const claimedOps = claimSelectedOpsBatch(params.db, {
    lockedBy: params.client.connId,
    selected: selectedOps.map((s) => ({
      op_id: s.op_id,
      txn_id: s.txn_id,
      op_seq: s.op_seq,
      txn_dispatch_mode: s.txn_dispatch_mode,
      type: s.op_type,
      payload_json: s.payload_json,
      idempotency_key: s.idempotency_key,
      leaseMs: s.leaseMs,
    })),
  });

  if (claimedOps.length === 0) return { kind: 'none' };

  const dispatchItems = claimedOps.map((op) => {
    const id = String((op as any).op_id);
    const info = selectedById.get(id);
    return {
      op_id: (op as any).op_id,
      attempt_id: (op as any).attempt_id,
      txn_id: (op as any).txn_id,
      op_seq: (op as any).op_seq,
      op_type: (op as any).type,
      payload: info ? info.payloadSub : safeParseJson(String((op as any).payload_json ?? '')),
      idempotency_key: (op as any).idempotency_key,
      lease_expires_at: (op as any).lease_expires_at ?? undefined,
    };
  });

  const budget = {
    ...baseBudgetForEstimate,
    approxBytes: 0,
  };

  const msg0: any = { type: 'OpDispatchBatch', budget: { ...budget, approxBytes: 0 }, skipped, ops: dispatchItems };
  const approxBytes = Buffer.byteLength(JSON.stringify(msg0), 'utf8');
  msg0.budget.approxBytes = approxBytes;

  return { kind: 'dispatch', msg: msg0, firstOpId: dispatchItems[0]?.op_id ?? null };
}
