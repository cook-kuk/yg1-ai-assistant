#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"

function readEnv(p) {
  if (!fs.existsSync(p)) return {}
  const o = {}
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#") || !t.includes("=")) continue
    const i = t.indexOf("=")
    o[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return o
}
const env = {
  ...readEnv(path.join(process.cwd(), ".env")),
  ...readEnv(path.join(process.cwd(), ".env.local")),
  ...readEnv(path.join(process.cwd(), ".env.vercel")),
  ...process.env,
}
const cfg = env.DATABASE_URL
  ? { connectionString: env.DATABASE_URL }
  : {
      host: env.PGHOST || env.POSTGRES_HOST,
      port: Number(env.PGPORT || env.POSTGRES_PORT || 5432),
      database: env.PGDATABASE || env.POSTGRES_DB,
      user: env.PGUSER || env.POSTGRES_USER,
      password: env.PGPASSWORD || env.POSTGRES_PASSWORD,
    }
const c = new Client(cfg)
await c.connect()

const sql = fs.readFileSync("reports/migrations/20260408_create_product_turning_options_mv.sql", "utf8")
console.log("[apply] executing migration...")
await c.query(sql)
console.log("[apply] done")

const count = await c.query("SELECT count(*)::int AS n FROM catalog_app.product_turning_options_mv")
console.log("rows:", count.rows[0].n)

const sample = await c.query(`
  SELECT edp_no, turning_grade, turning_chip_breaker, turning_work_piece,
         turning_ic_mm, turning_corner_radius_mm, turning_work_piece_tags
  FROM catalog_app.product_turning_options_mv
  WHERE turning_grade IS NOT NULL
  LIMIT 5
`)
console.log("sample:", JSON.stringify(sample.rows, null, 2))

const join = await c.query(`
  SELECT count(*)::int AS matched
  FROM catalog_app.product_recommendation_mv p
  JOIN catalog_app.product_turning_options_mv t ON t.edp_no = p.edp_no
`)
console.log("join-matched EDPs:", join.rows[0].matched)

await c.end()
