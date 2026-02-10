import { openQueueDb } from "../packages/agent-remnote/src/internal/queue/db.ts"

function safeParse(s: string) { try { return JSON.parse(s) } catch { return s }
}

async function main() {
  const db = openQueueDb()
  const ops = db
    .prepare(
      `SELECT op_id, txn_id, op_seq, type, status, attempt_count, next_attempt_at, locked_by, lease_expires_at, payload_json FROM queue_ops ORDER BY created_at DESC LIMIT 50`,
    )
    .all() as any[]
  const out = ops.map(o => ({
    op_id: o.op_id,
    txn_id: o.txn_id,
    seq: o.op_seq,
    type: o.type,
    status: o.status,
    attempts: o.attempt_count,
    next_attempt_at: o.next_attempt_at,
    locked_by: o.locked_by,
    lease_expires_at: o.lease_expires_at,
    payload: safeParse(o.payload_json),
  }))
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
