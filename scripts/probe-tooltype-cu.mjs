#!/usr/bin/env node
import pg from "pg"
const { Pool } = pg
const pool = new Pool({ host: "20.119.98.136", port: 5432, database: "smart_catalog", user: "smart_catalog", password: "smart_catalog" })
async function q(sql, p=[]) { return (await pool.query(sql, p)).rows }
async function main() {
  console.log("=== series_tool_type 분포 (top 30) ===")
  for (const r of await q(`
    SELECT series_tool_type, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    GROUP BY series_tool_type ORDER BY cnt DESC LIMIT 30
  `)) console.log(`  ${String(r.series_tool_type ?? "(null)").padEnd(50)} ${r.cnt}`)

  console.log("\n=== edp_root_category 분포 ===")
  for (const r of await q(`
    SELECT edp_root_category, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    GROUP BY edp_root_category ORDER BY cnt DESC LIMIT 20
  `)) console.log(`  ${String(r.edp_root_category ?? "(null)").padEnd(50)} ${r.cnt}`)

  console.log("\n=== search_subtype 분포 ===")
  for (const r of await q(`
    SELECT search_subtype, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    GROUP BY search_subtype ORDER BY cnt DESC LIMIT 30
  `)) console.log(`  ${String(r.search_subtype ?? "(null)").padEnd(50)} ${r.cnt}`)

  // Milling 매칭
  const mill = await q(`
    SELECT
      COUNT(*) FILTER (WHERE series_tool_type ILIKE '%mill%') AS by_tool_type,
      COUNT(*) FILTER (WHERE edp_root_category ILIKE '%mill%') AS by_root_cat,
      COUNT(*) FILTER (WHERE search_subtype ILIKE '%mill%') AS by_subtype,
      COUNT(*) AS total
    FROM catalog_app.product_recommendation_mv
  `)
  console.log("\n=== Milling 매칭 ===")
  console.log(mill[0])

  // 구리 work_piece
  console.log("\n=== series_profile_mv 의 work_piece 중 구리/copper 매칭 시리즈 수 ===")
  const cuSeries = await q(`
    SELECT COUNT(*) AS cnt FROM catalog_app.series_profile_mv
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(work_piece_statuses) wp
      WHERE wp->>'normalized_work_piece_name' ILIKE '%COPPER%'
         OR wp->>'normalized_work_piece_name' ILIKE '%구리%'
    )
  `).catch(e => { console.log("err:", e.message); return [{ cnt: "?" }] })
  console.log(`  cu series: ${cuSeries[0].cnt}`)

  // 구리 + Milling 교집합 (series 단위)
  const cuMillSeries = await q(`
    SELECT COUNT(DISTINCT s.normalized_series_name) AS cnt
    FROM catalog_app.series_profile_mv s
    WHERE s.primary_tool_type ILIKE '%mill%'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.work_piece_statuses) wp
        WHERE wp->>'normalized_work_piece_name' ILIKE '%COPPER%'
           OR wp->>'normalized_work_piece_name' ILIKE '%구리%'
      )
  `).catch(e => { console.log("err:", e.message); return [{ cnt: "?" }] })
  console.log(`  cu × Milling series: ${cuMillSeries[0].cnt}`)

  // CRX 시리즈 tool_type
  console.log("\n=== CRX 시리즈 tool_type ===")
  for (const r of await q(`
    SELECT DISTINCT series_name, primary_tool_type, primary_root_category
    FROM catalog_app.series_profile_mv
    WHERE series_name ILIKE '%CRX%' LIMIT 10
  `)) console.log(`  series=${r.series_name}  tool_type=${r.primary_tool_type}  root_cat=${r.primary_root_category}`)

  // 구리 work_piece 매칭 시리즈 + 그들의 tool_type 분포
  console.log("\n=== 구리 매칭 시리즈의 primary_tool_type 분포 ===")
  for (const r of await q(`
    SELECT primary_tool_type, COUNT(*) AS cnt
    FROM catalog_app.series_profile_mv s
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(s.work_piece_statuses) wp
      WHERE wp->>'normalized_work_piece_name' ILIKE '%COPPER%'
         OR wp->>'normalized_work_piece_name' ILIKE '%구리%'
    )
    GROUP BY primary_tool_type ORDER BY cnt DESC LIMIT 20
  `)) console.log(`  ${String(r.primary_tool_type ?? "(null)").padEnd(50)} ${r.cnt}`)

  await pool.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
