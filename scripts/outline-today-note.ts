import { withResolvedDatabase, summarizeKey, safeJsonParse } from "../packages/agent-remnote/src/internal/remdb-tools/shared.ts"

async function main() {
  const rootId = process.argv[2] || "wXQpW1gQL6CVIrHSx"
  const maxDepth = Number(process.argv[3] ?? 5)

  const { info, result } = await withResolvedDatabase(undefined, async (db) => {
    const stmt = db.prepare(`WITH RECURSIVE tree(id, depth, order_path) AS (
      SELECT _id, 0 AS depth, COALESCE(json_extract(doc, '$.f'), '')
      FROM quanta WHERE _id = @rootId
      UNION ALL
      SELECT child._id,
             tree.depth + 1,
             tree.order_path || char(0) || COALESCE(json_extract(child.doc, '$.f'), '')
      FROM quanta child
      JOIN tree ON json_extract(child.doc, '$.parent') = tree.id
      WHERE tree.depth + 1 <= @maxDepth
    )
    SELECT tree.id,
           tree.depth,
           tree.order_path AS orderPath,
           quanta.doc AS doc
    FROM tree
    JOIN quanta ON quanta._id = tree.id
    ORDER BY tree.order_path`)

    const rows = stmt.all({ rootId, maxDepth }) as Array<{
      id: string
      depth: number
      orderPath: string
      doc: string
    }>

    const nodes = rows.map((row) => {
      const doc = safeJsonParse<Record<string, unknown>>(row.doc)
      const summary = summarizeKey(doc?.key, db, { expand: true, maxDepth: 1 })
      return {
        id: row.id,
        depth: row.depth,
        sortKey: (doc?.f as string) ?? null,
        text: summary.text,
        references: summary.references,
      }
    })

    return { nodes }
  })

  console.log("Resolved DB:", info)
  console.log(JSON.stringify(result.nodes, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
