import fs from "node:fs"
import pg from "pg"
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)]}))
const c = new pg.Client({connectionString: env.DATABASE_URL})
await c.connect()

const colQ = `
SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS dt
FROM pg_attribute a JOIN pg_class cl ON cl.oid=a.attrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname='catalog_app' AND cl.relname='product_recommendation_mv' AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum`
const all = (await c.query(colQ)).rows
const colMap = Object.fromEntries(all.map(r => [r.col, r.dt]))

// 수치 컬럼 후보 (name heuristic)
const numericCandidates = all.filter(r =>
  /(_mm|_length|_diameter|_dia|_angle|_radius|_pitch|_oal|_dc\b|_dcon\b|_r\b|_loc\b|_loh\b|_ln\b|_re\b|_apmx\b|_ap\b|_flutes|_flute_count|_flutecount|_thread_length|_neck_length|_cutter_height|_tpi|_ap_max|_w\b|_tol_)/i.test(r.col)
).map(r => r.col)

// 포함: 사용자가 지정한 3개 + 대표 샘플
const targets = Array.from(new Set([
  "option_overall_length","option_loc","option_shank_diameter",
  "option_dc","option_dcon","option_r","option_re","option_oal",
  "option_neck_diameter","option_neck_length","option_flute_length",
  "option_flutecount","option_taperangle","option_pointangle","option_pitch","option_tpi",
  "milling_overall_length","milling_outside_dia","milling_shank_dia","milling_length_of_cut",
  "milling_ball_radius","milling_helix_angle","milling_taper_angle","milling_neck_diameter",
  "milling_flutes","milling_coolant_hole",
  "holemaking_outside_dia","holemaking_shank_dia","holemaking_overall_length","holemaking_flute_length","holemaking_helix_angle","holemaking_point_angle","holemaking_flutes",
  "threading_outside_dia","threading_shank_dia","threading_overall_length","threading_thread_length","threading_pitch","threading_tpi","threading_flutes",
  "search_diameter_mm",
]))

const report = []
console.log(`\n${"col".padEnd(34)} ${"type".padEnd(8)} ${"min".padStart(9)} ${"max".padStart(9)} ${"dist".padStart(5)}  lowest12 → top4`)
console.log("-".repeat(120))
for (const col of targets) {
  const dt = colMap[col]
  if (!dt) { console.log(`${col.padEnd(34)} [missing]`); continue }
  try {
    const isNumeric = /numeric|double|real|integer|bigint|float/.test(dt)
    const where = isNumeric ? `${col} IS NOT NULL` : `${col} IS NOT NULL AND ${col}::text != '' AND ${col}::text ~ '^-?[0-9.]+$'`
    const r = (await c.query(`SELECT MIN(${col}::float8) mn, MAX(${col}::float8) mx, COUNT(DISTINCT ${col}) d FROM catalog_app.product_recommendation_mv WHERE ${where}`)).rows[0]
    if (r.d === 0 || r.d === "0") { console.log(`${col.padEnd(34)} ${dt.padEnd(8)} (모두 null/empty)`); continue }
    const lo = (await c.query(`SELECT DISTINCT ${col}::float8 v FROM catalog_app.product_recommendation_mv WHERE ${where} ORDER BY v LIMIT 12`)).rows.map(x=>x.v)
    const hi = (await c.query(`SELECT DISTINCT ${col}::float8 v FROM catalog_app.product_recommendation_mv WHERE ${where} ORDER BY v DESC LIMIT 4`)).rows.map(x=>x.v)
    const loS = `[${lo.slice(0,6).join(",")}…]`
    const hiS = `[${hi.join(",")}]`
    const row = `${col.padEnd(34)} ${dt.padEnd(8)} ${String(r.mn).padStart(9)} ${String(r.mx).padStart(9)} ${String(r.d).padStart(5)}  ${loS} → ${hiS}`
    console.log(row)
    report.push({ col, dt, min: r.mn, max: r.mx, distinct: r.d, lowest: lo, top: hi })
  } catch(e) { console.log(`${col.padEnd(34)} ERROR: ${e.message}`) }
}
await c.end()
fs.writeFileSync("test-results/numeric-stats-audit.json", JSON.stringify(report, null, 2))
console.log(`\n💾 test-results/numeric-stats-audit.json (${report.length} cols)`)
