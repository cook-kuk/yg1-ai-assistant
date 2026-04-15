#!/usr/bin/env node
import pg from "pg"
const { Pool } = pg
const pool = new Pool({ host: "20.119.98.136", port: 5432, database: "smart_catalog", user: "smart_catalog", password: "smart_catalog" })
async function q(sql, p=[]) { return (await pool.query(sql, p)).rows }

async function main() {
  console.log("=== Brands 분포 (top 30) ===")
  for (const r of await q(`
    SELECT series_brand_name, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    GROUP BY series_brand_name ORDER BY cnt DESC LIMIT 30
  `)) console.log(`  ${String(r.series_brand_name ?? "(null)").padEnd(40)} ${r.cnt}`)

  console.log("\n=== CRX 브랜드 매칭 ===")
  for (const r of await q(`
    SELECT series_brand_name, edp_brand_name, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    WHERE UPPER(COALESCE(series_brand_name,'') || ' ' || COALESCE(edp_brand_name,'')) LIKE '%CRX%'
    GROUP BY series_brand_name, edp_brand_name ORDER BY cnt DESC LIMIT 20
  `)) console.log(`  series=${r.series_brand_name} edp=${r.edp_brand_name} cnt=${r.cnt}`)

  console.log("\n=== CRX 시리즈 (edp_series_name 전역 검색) ===")
  for (const r of await q(`
    SELECT edp_series_name, series_brand_name, edp_root_category, COUNT(*) AS cnt,
           array_agg(DISTINCT unnest_tag) AS tags
    FROM catalog_app.product_recommendation_mv,
         LATERAL UNNEST(COALESCE(material_tags, ARRAY[]::text[])) AS unnest_tag
    WHERE UPPER(COALESCE(edp_series_name,'')) LIKE '%CRX%'
       OR UPPER(COALESCE(series_description,'')) LIKE '%CRX%'
    GROUP BY edp_series_name, series_brand_name, edp_root_category
    ORDER BY cnt DESC LIMIT 20
  `)) console.log(`  series=${r.edp_series_name} brand=${r.series_brand_name} cat=${r.edp_root_category} cnt=${r.cnt} tags=${JSON.stringify(r.tags)}`)

  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
