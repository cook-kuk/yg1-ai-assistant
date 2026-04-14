#!/usr/bin/env node
/**
 * Schema Coverage Audit (Fix 4)
 *
 * 골든셋 FIELD_ALIAS + 알려진 한국어 field cue 목록을 DB 컬럼과 대조해
 * 커버리지 리포트를 생성한다. 결과는 test-results/schema-coverage-report.txt.
 *
 * Sources:
 *  - FIELD_ALIAS: scripts/eval-golden-full.mjs 에서 파싱
 *  - DB columns:  pg_attribute of catalog_app.product_recommendation_mv
 *  - 한국어 cue → 영문 alias 매핑은 DB 샘플값 기반(하드코딩 금지)
 *
 * Usage:
 *   node scripts/audit-schema-coverage.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import pg from "pg"

// .env.local 로드
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

// ── 1) FIELD_ALIAS 를 eval-golden-full.mjs 에서 파싱 ─────────────
const evalSrc = readFileSync("scripts/eval-golden-full.mjs", "utf8")
const aliasBlockMatch = evalSrc.match(/const FIELD_ALIAS = \{([\s\S]*?)\}/)
if (!aliasBlockMatch) {
  console.error("❌ FIELD_ALIAS block not found in scripts/eval-golden-full.mjs")
  process.exit(1)
}
const aliasEntries = []
for (const line of aliasBlockMatch[1].split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]+)"/)
  if (m) aliasEntries.push({ alias: m[1], dbField: m[2] })
}
console.log(`✓ parsed ${aliasEntries.length} FIELD_ALIAS entries`)

// ── 2) DB 스키마 로드 ──────────────────────────────────────────
const connStr = process.env.DATABASE_URL
  || (process.env.PGHOST
    ? `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}`
    : null)
if (!connStr) {
  console.error("❌ No DB connection (DATABASE_URL / PG* not set)")
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: connStr, max: 2 })

const colRes = await pool.query(`
  SELECT attname AS column_name, format_type(atttypid, atttypmod) AS data_type
  FROM pg_attribute
  WHERE attrelid = 'catalog_app.product_recommendation_mv'::regclass
    AND attnum > 0 AND NOT attisdropped
  ORDER BY attnum
`)
const dbColumns = colRes.rows.map(r => r.column_name)
const dbColumnSet = new Set(dbColumns)
console.log(`✓ loaded ${dbColumns.length} DB columns from catalog_app.product_recommendation_mv`)

// ── 3) Filter field registry (TS SSOT) 의 canonical field 목록 ─
// (TS 파일을 정규식으로 파싱 — build 없이 실행 가능하게)
let registryFields = []
try {
  const regSrc = readFileSync("lib/recommendation/shared/filter-field-registry.ts", "utf8")
  const idRe = /(?:^|\n)\s*field:\s*"([^"]+)"/g
  let m
  while ((m = idRe.exec(regSrc)) !== null) registryFields.push(m[1])
  registryFields = [...new Set(registryFields)]
  console.log(`✓ filter-field-registry has ${registryFields.length} canonical fields`)
} catch (e) {
  console.warn(`⚠ could not parse filter-field-registry.ts: ${e.message}`)
}

// ── 4) 매핑 결과 분류 ──────────────────────────────────────────
const mapped = []     // alias → DB column 존재 OR registry 에 있는 것
const missing = []    // alias → 매칭 DB 컬럼/registry 필드 없음
for (const { alias, dbField } of aliasEntries) {
  if (dbColumnSet.has(dbField) || registryFields.includes(dbField)) {
    mapped.push({ alias, dbField, source: dbColumnSet.has(dbField) ? "db" : "registry" })
  } else {
    missing.push({ alias, dbField })
  }
}

// ── 5) alias 가 없는 DB 컬럼 (역방향) ──────────────────────────
const aliasedDbFields = new Set(aliasEntries.map(e => e.dbField))
const unaliasedDbCols = dbColumns.filter(c => !aliasedDbFields.has(c))

// ── 6) 리포트 작성 ────────────────────────────────────────────
const lines = []
lines.push("═══ Schema Coverage Report ═══")
lines.push(`Generated: ${new Date().toISOString()}`)
lines.push(`DB: catalog_app.product_recommendation_mv`)
lines.push(`Source alias file: scripts/eval-golden-full.mjs`)
lines.push("")
lines.push(`Alias 항목 수 : ${aliasEntries.length}`)
lines.push(`DB 컬럼 수    : ${dbColumns.length}`)
lines.push(`Registry 필드 : ${registryFields.length}`)
lines.push("")
lines.push(`매핑된 필드 (${mapped.length}개)`)
lines.push("─".repeat(60))
for (const { alias, dbField, source } of mapped) {
  lines.push(`  OK   ${alias.padEnd(26)} → ${dbField}    [${source}]`)
}
lines.push("")
lines.push(`누락된 필드 (${missing.length}개) — alias 만 있고 DB/registry 어디에도 컬럼 없음`)
lines.push("─".repeat(60))
if (missing.length === 0) {
  lines.push("  (없음)")
} else {
  for (const { alias, dbField } of missing) {
    lines.push(`  MISS ${alias.padEnd(26)} → ${dbField}`)
  }
}
lines.push("")
lines.push(`Alias 없는 DB 컬럼 (${unaliasedDbCols.length}개) — DB 에는 있지만 golden-full FIELD_ALIAS 에 매핑 없음`)
lines.push("─".repeat(60))
for (const col of unaliasedDbCols) {
  lines.push(`  -    ${col}`)
}
lines.push("")
lines.push(`═══ 끝 ═══`)

mkdirSync("test-results", { recursive: true })
const outPath = "test-results/schema-coverage-report.txt"
writeFileSync(outPath, lines.join("\n"))
console.log(`\n💾 ${outPath}`)
console.log(`  매핑: ${mapped.length}`)
console.log(`  누락: ${missing.length}`)
console.log(`  alias 없는 DB 컬럼: ${unaliasedDbCols.length}`)

await pool.end()
