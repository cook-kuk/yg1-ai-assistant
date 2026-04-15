#!/usr/bin/env node
import pg from "pg"
const { Pool } = pg
const pool = new Pool({ host: "20.119.98.136", port: 5432, database: "smart_catalog", user: "smart_catalog", password: "smart_catalog" })
async function q(sql, p=[]) { return (await pool.query(sql, p)).rows }

async function main() {
  console.log("=== (A) CRX-S / CRXS / CRX 시리즈 존재 ===")
  for (const r of await q(`
    SELECT edp_series_name, COUNT(*) AS cnt, MIN(edp_root_category) AS cat
    FROM catalog_app.product_recommendation_mv
    WHERE UPPER(COALESCE(edp_series_name,'')) LIKE '%CRX%'
    GROUP BY edp_series_name ORDER BY cnt DESC LIMIT 30
  `)) console.log(`  ${String(r.edp_series_name).padEnd(20)} cat=${r.cat}  cnt=${r.cnt}`)

  console.log("\n=== (B) material_tags 분포 (top 30) — N/K/P/M 코드 또는 '구리'/'Cu' 포함 ===")
  for (const r of await q(`
    SELECT t AS tag, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv, UNNEST(COALESCE(material_tags, ARRAY[]::text[])) AS t
    GROUP BY t ORDER BY cnt DESC LIMIT 40
  `)) console.log(`  ${String(r.tag).padEnd(40)} ${r.cnt}`)

  console.log("\n=== (C) CRX-S 재질 태그 ===")
  for (const r of await q(`
    SELECT edp_series_name, array_agg(DISTINCT t) AS tags
    FROM catalog_app.product_recommendation_mv, UNNEST(COALESCE(material_tags, ARRAY[]::text[])) AS t
    WHERE UPPER(COALESCE(edp_series_name,'')) LIKE '%CRX%'
    GROUP BY edp_series_name
  `)) console.log(`  ${r.edp_series_name}: ${JSON.stringify(r.tags)}`)

  console.log("\n=== (D) Milling 카테고리 제품 중 'N' (non-ferrous, 구리 포함) 재질 태그 매칭 수 ===")
  for (const r of await q(`
    SELECT edp_series_name, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    WHERE edp_root_category = 'Milling'
      AND 'N' = ANY(COALESCE(material_tags, ARRAY[]::text[]))
    GROUP BY edp_series_name ORDER BY cnt DESC LIMIT 20
  `)) console.log(`  ${String(r.edp_series_name).padEnd(25)} cnt=${r.cnt}`)

  console.log("\n=== (E) 구리 전용 키워드 탐색 (description/feature) ===")
  for (const r of await q(`
    SELECT edp_series_name, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    WHERE edp_root_category = 'Milling'
      AND (LOWER(series_description) LIKE '%copper%' OR LOWER(series_description) LIKE '%구리%'
           OR LOWER(series_feature) LIKE '%copper%' OR LOWER(series_feature) LIKE '%구리%')
    GROUP BY edp_series_name ORDER BY cnt DESC LIMIT 20
  `)) console.log(`  ${String(r.edp_series_name).padEnd(25)} cnt=${r.cnt}`)

  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
