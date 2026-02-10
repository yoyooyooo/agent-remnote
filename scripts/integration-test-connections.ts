import BetterSqlite3 from 'better-sqlite3'

import {
  executeGetRemConnections,
  getRemConnectionsSchema,
} from '../packages/agent-remnote/src/internal/remdb-tools/getRemConnections.ts'

function parseArg(name: string, def?: string) {
  const i = process.argv.findIndex((a) => a === `--${name}`)
  if (i >= 0) return process.argv[i + 1]
  return def
}

async function main() {
  const remId = parseArg('remId') || parseArg('id')
  if (!remId) {
    console.error('Usage: npx tsx scripts/integration-test-connections.ts --remId <ID> [--dbPath <path>] [--inDepth 3] [--outDepth 3]')
    process.exit(1)
  }
  const dbPath = parseArg('dbPath')
  const inDepth = Number(parseArg('inDepth', '3')) || 3
  const outDepth = Number(parseArg('outDepth', '3')) || 3

  console.log('=== Input ===')
  console.log({ remId, dbPath, inDepth, outDepth })

  // 1) via tool function (same as run-tool.ts get_rem_connections)
  const args = getRemConnectionsSchema.parse({
    id: remId,
    dbPath,
    inboundMaxDepth: inDepth,
    outboundMaxDepth: outDepth,
    inboundMaxCandidates: 500,
    inboundGraph: true,
  })
  const toolRes = await executeGetRemConnections(args)
  const tool = (toolRes as any)?.structuredContent ?? toolRes

  const outboundExpandedIds = new Set<string>((tool.outboundExpandedNodes || []).map((n: any) => n.id))
  const inboundGraphIds = new Set<string>((tool.inboundGraphNodes || []).map((n: any) => n.id))

  console.log('\n=== get_rem_connections (tool) ===')
  console.log(`outboundExpandedDepth=${tool.outboundExpandedDepth}, count=${tool.outboundExpandedCount}`)
  console.log(`inboundGraphDepth=${tool.inboundGraphDepth}, count=${tool.inboundGraphCount}`)

  // 2) direct DB scan (ground truth by JSON tokens)
  const db = new BetterSqlite3(dbPath || (tool.dbPath as string), { readonly: true })
  const direct = computeDirectGraphs(db, remId, inDepth, outDepth)

  console.log('\n=== Direct DB (JSON tokens) ===')
  console.log({
    outboundDepth: outDepth,
    outboundCount: direct.outbound.all.size,
    inboundDepth: inDepth,
    inboundCount: direct.inbound.all.size,
  })

  // 3) execute_search_query sanity: search phrase by target title, see overlap with inbound
  const title = guessTitle(db, remId) || remId
  const searchOverlap = computeSearchOverlap(db, title, inboundGraphIds)
  console.log('\n=== execute_search_query (phrase by title) overlap with inbound ===')
  console.log({ title, overlap: searchOverlap.overlapCount, totalInbound: inboundGraphIds.size, totalSearch: searchOverlap.searchIds.size })

  // 4) Alignment summary
  const symmetricDiff = diffSets(outboundExpandedIds, direct.outbound.all)
  const inboundDiff = diffSets(inboundGraphIds, direct.inbound.all)
  console.log('\n=== Alignment summary ===')
  console.log({
    outboundDiff: { onlyTool: symmetricDiff.onlyA.size, onlyDirect: symmetricDiff.onlyB.size },
    inboundDiff: { onlyTool: inboundDiff.onlyA.size, onlyDirect: inboundDiff.onlyB.size },
  })

  if (symmetricDiff.onlyA.size > 0) {
    console.log('Outbound only in tool (sample):', Array.from(symmetricDiff.onlyA).slice(0, 10))
  }
  if (symmetricDiff.onlyB.size > 0) {
    console.log('Outbound only in direct (sample):', Array.from(symmetricDiff.onlyB).slice(0, 10))
  }
  if (inboundDiff.onlyA.size > 0) {
    console.log('Inbound only in tool (sample):', Array.from(inboundDiff.onlyA).slice(0, 10))
  }
  if (inboundDiff.onlyB.size > 0) {
    console.log('Inbound only in direct (sample):', Array.from(inboundDiff.onlyB).slice(0, 10))
  }
}

function computeDirectGraphs(db: BetterSqlite3.Database, remId: string, inDepth: number, outDepth: number) {
  // outbound BFS by parsing JSON tokens
  const outAll = new Set<string>()
  let outFrontier = new Set<string>([remId])
  for (let d = 1; d <= outDepth; d++) {
    const next = new Set<string>()
    for (const id of outFrontier) {
      for (const to of getDirectOutbound(db, id)) {
        if (!outAll.has(to)) next.add(to)
        outAll.add(to)
      }
    }
    outFrontier = next
    if (outFrontier.size === 0) break
  }

  // inbound BFS by LIKE + verify tokens
  const inAll = new Set<string>()
  let inFrontier = new Set<string>([remId])
  for (let d = 1; d <= inDepth; d++) {
    const next = new Set<string>()
    for (const target of inFrontier) {
      for (const src of getDirectInbound(db, target)) {
        if (!inAll.has(src)) next.add(src)
        inAll.add(src)
      }
    }
    inFrontier = next
    if (inFrontier.size === 0) break
  }

  return { outbound: { all: outAll }, inbound: { all: inAll } }
}

function getDirectOutbound(db: BetterSqlite3.Database, id: string): Set<string> {
  const row = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(id) as { doc: string } | undefined
  const out = new Set<string>()
  if (!row) return out
  try {
    const doc = JSON.parse(row.doc)
    collectRefs(doc?.key, out)
    if (doc?.value !== undefined) collectRefs(doc.value, out)
  } catch {}
  return out
}

function collectRefs(value: any, into: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, into)
    return
  }
  if (value && typeof value === 'object') {
    const v: Record<string, any> = value
    if ((v.i === 'q' || v.i === 'p') && typeof v._id === 'string') {
      into.add(v._id)
      return
    }
    for (const child of Object.values(v)) collectRefs(child as any, into)
  }
}

function getDirectInbound(db: BetterSqlite3.Database, targetId: string): Set<string> {
  const needle = `"_id":"${targetId}"`
  const stmt = db.prepare('SELECT _id, doc FROM quanta WHERE doc LIKE ? LIMIT 50000')
  const out = new Set<string>()
  for (const row of stmt.iterate(`%${needle}%`) as any) {
    try {
      const doc = JSON.parse(row.doc)
      const refs = new Set<string>()
      collectRefs(doc?.key, refs)
      if (doc?.value !== undefined) collectRefs(doc.value, refs)
      if (refs.has(targetId)) out.add(row._id)
    } catch {}
  }
  return out
}

function guessTitle(db: BetterSqlite3.Database, id: string): string | null {
  try {
    const row = db.prepare("SELECT json_extract(doc, '$.kt') AS kt FROM remsSearchInfos WHERE id = ?").get(id) as { kt: string | null } | undefined
    return row?.kt ? row.kt.trim() : null
  } catch { return null }
}

function computeSearchOverlap(db: BetterSqlite3.Database, phrase: string, inboundSet: Set<string>) {
  const ids = new Set<string>()
  try {
    const fts = db.prepare(
      `SELECT id FROM remsSearchInfos WHERE ftsRowId IN (SELECT rowid FROM remsContents WHERE remsContents MATCH ?) LIMIT 500`
    )
    for (const row of fts.iterate(`"${phrase}"`) as any) {
      ids.add(row.id)
    }
  } catch {}
  let overlap = 0
  for (const id of ids) if (inboundSet.has(id)) overlap += 1
  return { overlapCount: overlap, searchIds: ids }
}

function diffSets(a: Set<string>, b: Set<string>) {
  const onlyA = new Set<string>()
  const onlyB = new Set<string>()
  for (const x of a) if (!b.has(x)) onlyA.add(x)
  for (const x of b) if (!a.has(x)) onlyB.add(x)
  return { onlyA, onlyB }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
