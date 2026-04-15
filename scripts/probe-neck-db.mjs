import fs from "node:fs"
import pg from "pg"
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)]}))
const c = new pg.Client({connectionString: env.DATABASE_URL})
await c.connect()

// materialized views need pg_attribute
const q = `
SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type
FROM pg_attribute a
JOIN pg_class cl ON cl.oid = a.attrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'catalog_app' AND cl.relname = 'product_recommendation_mv' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`
const cols = await c.query(q)
console.log(`Total columns: ${cols.rows.length}`)
const neckish = cols.rows.filter(r => /neck|radius|pitch|point|taper|helix|corner|r$|_r_/i.test(r.column_name))
console.log(`\nmatching cols:`)
for (const r of neckish) console.log(`  ${r.column_name} (${r.data_type})`)

// Pick a few to probe
for (const col of ["milling_neck_diameter","option_r","threading_pitch","milling_taper_angle"]) {
  const e = cols.rows.find(r => r.column_name === col)
  if (!e) { console.log(`\n[missing in MV] ${col}`); continue }
  try {
    const dt = e.data_type
    const isNumeric = /numeric|double|real|integer|bigint|float/.test(dt)
    const where = isNumeric ? `${col} IS NOT NULL` : `${col} IS NOT NULL AND ${col}::text != '' AND ${col}::text ~ '^-?[0-9.]+$'`
    const r = await c.query(`SELECT MIN(${col}::float8) mn, MAX(${col}::float8) mx, COUNT(DISTINCT ${col}) d FROM catalog_app.product_recommendation_mv WHERE ${where}`)
    const s = await c.query(`SELECT DISTINCT ${col}::float8 v FROM catalog_app.product_recommendation_mv WHERE ${where} ORDER BY v LIMIT 12`)
    const t = await c.query(`SELECT DISTINCT ${col}::float8 v FROM catalog_app.product_recommendation_mv WHERE ${where} ORDER BY v DESC LIMIT 6`)
    console.log(`\n${col} (${dt}): min=${r.rows[0].mn} max=${r.rows[0].mx} distinct=${r.rows[0].d}`)
    console.log(`  lowest 12 (현재 LLM이 보는): [${s.rows.map(x=>x.v).join(", ")}]`)
    console.log(`  top 6: [${t.rows.map(x=>x.v).join(", ")}]`)
  } catch(err) { console.log(`${col}: ${err.message}`) }
}
await c.end()
