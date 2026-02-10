import { openQueueDb } from "../packages/agent-remnote/src/internal/queue/db.ts"
import { queueStats } from "../packages/agent-remnote/src/internal/queue/dao.ts"

async function main() {
  const db = openQueueDb()
  const st = queueStats(db)
  console.log(JSON.stringify(st, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
