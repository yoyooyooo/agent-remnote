// Minimal WS client to test the WS bridge like a plugin executor.
// Usage: npx tsx scripts/ws-cli-test.ts [wsUrl] [clientInstanceId]

const portRaw = process.env.REMNOTE_WS_PORT || process.env.WS_PORT;
const port = portRaw ? Number(portRaw) : NaN;
const resolvedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 6789;
const url = process.argv[2] || `ws://localhost:${resolvedPort}/ws`;
const clientInstanceId = process.argv[3] || 'cli-ws'

// Require ws (hoisted at repo root)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as typeof import('ws')

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  console.log(`[ws-cli] connecting to ${url} as ${clientInstanceId}`)
  const ws = new WebSocket(url)

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', (e: any) => reject(e))
  })

  const send = (obj: any) => ws.send(JSON.stringify(obj))

  ws.on('message', (raw: any) => {
    try {
      const msg = JSON.parse(String(raw))
      console.log('[ws-cli] received:', msg)
    } catch {
      console.log('[ws-cli] received raw:', String(raw))
    }
  })

  // Hello + Register
  send({ type: 'Hello' })
  send({
    type: 'Register',
    protocolVersion: 2,
    clientType: 'debug',
    clientInstanceId,
    capabilities: { control: false, worker: true, readRpc: false, batchPull: true },
  })
  // Make this connection "active" for testing by emitting a selection snapshot.
  send({ type: 'SelectionChanged', selectionType: 'debug', totalCount: 0, truncated: false, remIds: [] })
  await sleep(50)

  // Request ops (batch pull)
  send({ type: 'RequestOps', leaseMs: 15000, maxOps: 1 })

  const op = await new Promise<any>((resolve) => {
    const onMsg = (raw: any) => {
      try {
        const msg = JSON.parse(String(raw))
        if (msg?.type === 'OpDispatchBatch' && Array.isArray(msg?.ops) && msg.ops.length > 0) {
          ws.off('message', onMsg)
          resolve(msg.ops[0])
        } else if (msg?.type === 'NoWork') {
          ws.off('message', onMsg)
          resolve(null)
        }
      } catch {}
    }
    ws.on('message', onMsg)
  })

  if (!op) {
    console.log('[ws-cli] NoWork — nothing to do')
    ws.close()
    return
  }

  console.log('[ws-cli] dispatch:', op)

  // Simulate success ACK
  const result: any = { ok: true }
  const nowId = () => `TEST-${Date.now()}`
  switch (op?.op_type) {
    case 'create_rem':
    case 'create_single_rem_with_markdown':
    case 'create_link_rem':
    case 'create_table': {
      const ct = op?.payload?.client_temp_id
      if (ct) result.created = { client_temp_id: ct, remote_id: nowId(), remote_type: 'rem' }
      break
    }
    case 'create_tree_with_markdown': {
      const cts = Array.isArray(op?.payload?.client_temp_ids) ? op.payload.client_temp_ids : []
      if (cts.length) result.id_map = cts.map((c: string) => ({ client_temp_id: c, remote_id: nowId(), remote_type: 'rem' }))
      break
    }
    case 'add_property': {
      const pid = op?.payload?.property_id
      if (pid) result.created = { client_temp_id: pid, remote_id: nowId(), remote_type: 'property' }
      break
    }
    case 'add_option': {
      const oid = op?.payload?.option_id
      if (oid) result.created = { client_temp_id: oid, remote_id: nowId(), remote_type: 'option' }
      break
    }
    case 'table_add_row': {
      const ct = op?.payload?.client_temp_id
      if (ct) result.created = { client_temp_id: ct, remote_id: nowId(), remote_type: 'row' }
      break
    }
    default:
      break
  }
  send({ type: 'OpAck', op_id: op.op_id, attempt_id: op.attempt_id, status: 'success', result })

  await sleep(100)
  ws.close()
  console.log('[ws-cli] done')
}

main().catch((e) => { console.error('[ws-cli] error:', e); process.exit(1) })
