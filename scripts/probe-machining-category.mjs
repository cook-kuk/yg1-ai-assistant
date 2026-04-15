#!/usr/bin/env node
import pg from "pg"
const { Pool } = pg
const pool = new Pool({ host: "20.119.98.136", port: 5432, database: "smart_catalog", user: "smart_catalog", password: "smart_catalog" })
async function q(sql, p=[]) { return (await pool.query(sql, p)).rows }

async function main() {
  console.log("=== (A) product_recommendation_mv.edp_root_category 분포 ===")
  for (const r of await q(`
    SELECT edp_root_category, COUNT(*) AS cnt
    FROM catalog_app.product_recommendation_mv
    GROUP BY edp_root_category ORDER BY cnt DESC LIMIT 30
  `)) console.log(`  ${String(r.edp_root_category ?? "(null)").padEnd(40)} ${r.cnt}`)

  console.log("\n=== (B) 소문자 변환 후 분포 ===")
  for (const r of await q(`
    SELECT LOWER(edp_root_category) AS low_val, COUNT(*) AS cnt, COUNT(DISTINCT edp_root_category) AS variants
    FROM catalog_app.product_recommendation_mv
    GROUP BY LOWER(edp_root_category) ORDER BY cnt DESC LIMIT 30
  `)) console.log(`  ${String(r.low_val ?? "(null)").padEnd(40)} cnt=${r.cnt}  variants=${r.variants}`)

  console.log("\n=== (C) 'Milling' 정확 일치 (eq, case-sensitive) ===")
  for (const r of await q(`
    SELECT COUNT(*) AS cnt FROM catalog_app.product_recommendation_mv
    WHERE edp_root_category = 'Milling'
  `)) console.log(`  cnt = ${r.cnt}`)

  console.log("\n=== (D) LOWER('Milling') 매칭 ===")
  for (const r of await q(`
    SELECT COUNT(*) AS cnt FROM catalog_app.product_recommendation_mv
    WHERE LOWER(edp_root_category) = 'milling'
  `)) console.log(`  cnt = ${r.cnt}`)

  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
