export type OpDispatch = {
  type: 'OpDispatch';
  op_id: string;
  attempt_id: string;
  txn_id: string;
  op_seq: number;
  op_type: string;
  payload: any;
  idempotency_key?: string | null;
  lease_expires_at?: number;
};

export type OpDispatchItem = Omit<OpDispatch, 'type'>;

export type OpDispatchBatch = {
  type: 'OpDispatchBatch';
  budget?: {
    maxOpsRequested?: number;
    maxOpsEffective?: number;
    maxBytesRequested?: number;
    maxBytesEffective?: number;
    maxOpBytesRequested?: number;
    maxOpBytesEffective?: number;
    approxBytes?: number;
    scanLimit?: number;
  };
  skipped?: { overBudget?: number; oversizeOp?: number; conflict?: number; txnBusy?: number };
  ops: readonly OpDispatchItem[];
};
