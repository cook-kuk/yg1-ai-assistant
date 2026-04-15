#!/usr/bin/env node
// tool_subtypes 전수 조사:
// 1) series_profile_mv.tool_subtypes 에 들어있는 원본 값들을 unnest 해서 소문자 분포 추출
// 2) canonical 리스트(square/ball/radius/roughing/taper/chamfer/highfeed/corner radius) 밖의 값 식별
// 3) 동일 시리즈 내 대소문자 중복(SQUARE vs Square) 규모 확인

import pg from "pg"
const { Pool } = pg
const pool = new Pool({ host: "20.119.98.136", port: 5432, database: "smart_catalog", user: "smart_catalog", password: "smart_catalog" })
async function q(sql, p = []) { return (await pool.query(sql, p)).rows }

const KNOWN = new Set([
  "square", "ball", "radius", "corner radius", "cornerradius",
  "roughing", "rough", "taper", "chamfer",
  "high-feed", "highfeed", "high feed",
])

function isKnown(lower) {
  if (!lower) return false
  const key = lower.trim()
  if (KNOWN.has(key)) return true
  for (const k of KNOWN) if (key.includes(k)) return true
  return false
}

async function main() {
  console.log("=== (A) series_profile_mv 존재 확인 ===")
  const exists = await q(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name = 'series_profile_mv'
  `)
  console.log(exists)

  const schema = exists[0]?.table_schema ?? "catalog_app"
  const tbl = `${schema}.series_profile_mv`

  console.log(`\n=== (B) tool_subtypes 원본 값 (raw, 대소문자 그대로) 분포 ===`)
  const raw = await q(`
    SELECT val AS raw_val, COUNT(*) AS cnt
    FROM ${tbl}, UNNEST(tool_subtypes) AS val
    GROUP BY val
    ORDER BY cnt DESC
  `)
  for (const r of raw) console.log(`  ${String(r.raw_val).padEnd(40)} ${r.cnt}`)
  console.log(`  (총 distinct raw values = ${raw.length})`)

  console.log(`\n=== (C) 소문자 변환 후 분포 ===`)
  const lower = await q(`
    SELECT LOWER(val) AS low_val, COUNT(*) AS cnt, COUNT(DISTINCT val) AS raw_variants
    FROM ${tbl}, UNNEST(tool_subtypes) AS val
    GROUP BY LOWER(val)
    ORDER BY cnt DESC
  `)
  for (const r of lower) {
    const mark = isKnown(String(r.low_val)) ? "    " : "  ⚠️"
    console.log(`${mark} ${String(r.low_val).padEnd(40)} cnt=${r.cnt}  variants=${r.raw_variants}`)
  }
  console.log(`  (총 distinct lower values = ${lower.length})`)

  console.log(`\n=== (D) canonical 리스트 밖의 값 (소문자 기준) ===`)
  const unknown = lower.filter(r => !isKnown(String(r.low_val)))
  if (unknown.length === 0) {
    console.log("  ✅ 전부 알려진 리스트(square/ball/radius/roughing/taper/chamfer/high-feed) 안에 들어옴")
  } else {
    for (const r of unknown) console.log(`  ⚠️  ${String(r.low_val).padEnd(40)} cnt=${r.cnt}`)
  }

  console.log(`\n=== (E) 동일 시리즈에서 대소문자 중복 규모 ===`)
  const dup = await q(`
    WITH u AS (
      SELECT series_name, val, LOWER(val) AS lv
      FROM ${tbl}, UNNEST(tool_subtypes) AS val
    )
    SELECT lv, COUNT(DISTINCT val) AS case_variants, COUNT(DISTINCT series_name) AS series_cnt
    FROM u
    GROUP BY lv
    HAVING COUNT(DISTINCT val) > 1
    ORDER BY series_cnt DESC
  `)
  if (dup.length === 0) console.log("  (대소문자 중복 없음)")
  else for (const r of dup) console.log(`  ${String(r.lv).padEnd(20)} case_variants=${r.case_variants} series=${r.series_cnt}`)

  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
