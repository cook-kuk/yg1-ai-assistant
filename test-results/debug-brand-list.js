// DB에서 brand 목록을 직접 조회
const { Pool } = require("pg")
const connStr = "postgresql://smart_catalog:yg1_smart_2024@20.119.98.136:5432/smart_catalog"
const pool = new Pool({ connectionString: connStr, max: 1 })

async function main() {
  // Brand list
  const brandRes = await pool.query(`
    SELECT DISTINCT edp_brand_name FROM catalog_app.product_recommendation_mv
    WHERE edp_brand_name IS NOT NULL AND BTRIM(edp_brand_name) <> ''
    ORDER BY edp_brand_name
  `)
  console.log("=== DB Brand Names ===")
  const brands = brandRes.rows.map(r => r.edp_brand_name)
  console.log(brands.join(", "))

  // Check CRX-S specifically
  console.log("\n=== CRX related ===")
  const crxBrands = brands.filter(b => b.toLowerCase().includes("crx"))
  console.log("brand contains 'crx':", crxBrands)

  const crxSeries = await pool.query(`
    SELECT DISTINCT edp_series_name FROM catalog_app.product_recommendation_mv
    WHERE LOWER(edp_series_name) LIKE '%crx%' LIMIT 20
  `)
  console.log("series contains 'crx':", crxSeries.rows.map(r => r.edp_series_name))

  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
