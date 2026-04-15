import pg from "pg"
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const cols = (await pool.query(`
  SELECT attname AS column_name, format_type(atttypid, atttypmod) AS data_type
  FROM pg_attribute
  WHERE attrelid = 'catalog_app.product_recommendation_mv'::regclass
    AND attnum > 0 AND NOT attisdropped
  ORDER BY attname
`)).rows
const RE = String.raw`^-?[0-9]*\.?[0-9]+$`
const hits = []
for (const c of cols) {
  if (/jsonb|bytea|uuid|timestamp|date|time|bool/i.test(c.data_type)) continue
  try {
    const r = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE "${c.column_name}" IS NOT NULL AND BTRIM("${c.column_name}"::text) <> '') AS total,
             COUNT(*) FILTER (WHERE "${c.column_name}"::text ~ '${RE}') AS nn
      FROM catalog_app.product_recommendation_mv
    `)
    const total = Number(r.rows[0].total), nn = Number(r.rows[0].nn)
    if (nn === 0 || total === 0) continue
    const ratio = nn / total
    if (ratio >= 0.9) hits.push(`${c.column_name} (${c.data_type}) nn=${nn}/${total} ratio=${ratio.toFixed(2)}`)
  } catch { /* skip */ }
}
console.log("passes 90% threshold:", hits.length)
console.log(hits.join("\n"))
await pool.end()
