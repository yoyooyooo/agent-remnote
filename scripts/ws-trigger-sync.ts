// Send a TriggerStartSync to the WS bridge to actively wake up subscribers
// Usage: npx tsx scripts/ws-trigger-sync.ts [wsUrl]

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as typeof import('ws')

async function main() {
  const portRaw = process.env.REMNOTE_WS_PORT || process.env.WS_PORT;
  const port = portRaw ? Number(portRaw) : NaN;
  const resolvedPort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 6789;
  const url =
    process.argv[2] ||
    process.env.REMNOTE_DAEMON_URL ||
    process.env.DAEMON_URL ||
    `ws://localhost:${resolvedPort}/ws`;
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', (e: any) => reject(e)) })
  const send = (obj: any) => ws.send(JSON.stringify(obj))

  let responded = false
  ws.on('message', (raw: any) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg?.type === 'StartSyncTriggered') {
        responded = true
        console.log(JSON.stringify(msg, null, 2))
        ws.close()
      }
    } catch {}
  })

  send({ type: 'TriggerStartSync' })

  // Failsafe: close even if the server doesn't respond.
  await new Promise<void>((resolve) => setTimeout(resolve, responded ? 100 : 1500))
  try { ws.close() } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })
