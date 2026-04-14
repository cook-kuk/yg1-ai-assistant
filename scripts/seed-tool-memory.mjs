#!/usr/bin/env node
/**
 * Seed catalog_app.tool_memory with eval-judge S01~S10 success cases so the
 * ensemble context can hit pg_trgm matches on typo/abbreviation queries.
 */
import { readFileSync, existsSync } from "fs"
import pg from "pg"

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL missing")
  process.exit(1)
}

const seeds = [
  { q: "스테인리스 4날 10mm 추천해줘", filters: [{ field: "workPieceName", op: "eq", value: "STAINLESSSTEELS" }, { field: "diameterMm", op: "eq", value: "10" }, { field: "fluteCount", op: "eq", value: "4" }], count: 152 },
  { q: "직경 10mm 이상만", filters: [{ field: "diameterMm", op: "gte", value: "10" }], count: 500 },
  { q: "헬릭스가 뭐야", filters: [], count: 0 },
  { q: "AlCrN vs TiAlN 스테인리스", filters: [{ field: "workPieceName", op: "eq", value: "STAINLESSSTEELS" }], count: 200 },
  { q: "SUS316L 많이 하는데 괜찮은 거", filters: [{ field: "workPieceName", op: "eq", value: "STAINLESSSTEELS" }], count: 152 },
  { q: "아무거나 빨리 10mm", filters: [{ field: "diameterMm", op: "eq", value: "10" }], count: 500 },
]

function sqlFromFilters(filters) {
  if (!filters.length) return "SELECT * FROM catalog_app.product LIMIT 0"
  const where = filters
    .map(f => {
      if (f.op === "gte") return `${f.field} >= '${f.value}'`
      if (f.op === "lte") return `${f.field} <= '${f.value}'`
      return `${f.field} = '${f.value}'`
    })
    .join(" AND ")
  return `SELECT * FROM catalog_app.product WHERE ${where}`
}

const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 })

try {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm")
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_app.tool_memory (
      id              SERIAL PRIMARY KEY,
      question        TEXT NOT NULL,
      sql_query       TEXT NOT NULL,
      filters         JSONB NOT NULL DEFAULT '[]'::jsonb,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      success         BOOLEAN,
      hit_count       INTEGER NOT NULL DEFAULT 0,
      last_hit_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tool_memory_question_trgm
      ON catalog_app.tool_memory USING gin (question gin_trgm_ops)
  `)

  let inserted = 0, updated = 0
  for (const s of seeds) {
    const sql = sqlFromFilters(s.filters)
    const upd = await pool.query(
      `UPDATE catalog_app.tool_memory
          SET sql_query = $2, filters = $3::jsonb, candidate_count = $4, success = TRUE
        WHERE question = $1`,
      [s.q, sql, JSON.stringify(s.filters), s.count],
    )
    if (upd.rowCount && upd.rowCount > 0) { updated++; continue }
    await pool.query(
      `INSERT INTO catalog_app.tool_memory (question, sql_query, filters, candidate_count, success)
       VALUES ($1, $2, $3::jsonb, $4, TRUE)`,
      [s.q, sql, JSON.stringify(s.filters), s.count],
    )
    inserted++
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE success IS TRUE) AS success_rows
       FROM catalog_app.tool_memory`,
  )
  console.log(JSON.stringify({ inserted, updated, totalRows: Number(rows[0].total), successRows: Number(rows[0].success_rows) }))
} finally {
  await pool.end()
}
