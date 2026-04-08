import pg from "pg"
const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = async (sql) => (await pool.query(sql)).rows

// What does DB say?
// Constraints from case 4: material P, Slotting, Milling, diameter 10mm, OAL >= 100mm

// Try a few interpretations
console.log("=== A) bare: dia=10 AND oal>=100 ===")
console.log(await q(`
  SELECT COUNT(*) FROM catalog_app.product_recommendation_mv
  WHERE search_diameter_mm BETWEEN 9.5 AND 10.5
  AND NULLIF(substring(COALESCE(NULLIF(CAST(milling_overall_length AS text),''),NULLIF(CAST(holemaking_overall_length AS text),''),NULLIF(CAST(threading_overall_length AS text),''),NULLIF(CAST(option_overall_length AS text),''),NULLIF(CAST(option_oal AS text),'')) from '[-+]?[0-9]*\\.?[0-9]+'),'')::numeric >= 100
`))

console.log("=== B) + Milling category ===")
console.log(await q(`
  SELECT COUNT(*) FROM catalog_app.product_recommendation_mv
  WHERE search_diameter_mm BETWEEN 9.5 AND 10.5
  AND edp_root_category = 'Milling'
  AND NULLIF(substring(COALESCE(NULLIF(CAST(milling_overall_length AS text),''),NULLIF(CAST(option_overall_length AS text),''),NULLIF(CAST(option_oal AS text),'')) from '[-+]?[0-9]*\\.?[0-9]+'),'')::numeric >= 100
`))

console.log("=== C) + Slotting application shape ===")
console.log(await q(`
  SELECT COUNT(*) FROM catalog_app.product_recommendation_mv
  WHERE search_diameter_mm BETWEEN 9.5 AND 10.5
  AND edp_root_category = 'Milling'
  AND series_application_shape ILIKE '%Slot%'
  AND NULLIF(substring(COALESCE(NULLIF(CAST(milling_overall_length AS text),''),NULLIF(CAST(option_overall_length AS text),''),NULLIF(CAST(option_oal AS text),'')) from '[-+]?[0-9]*\\.?[0-9]+'),'')::numeric >= 100
`))

console.log("=== D) just dia=10 (no OAL) baseline ===")
console.log(await q(`SELECT COUNT(*) FROM catalog_app.product_recommendation_mv WHERE search_diameter_mm BETWEEN 9.5 AND 10.5 AND edp_root_category='Milling'`))

await pool.end()
