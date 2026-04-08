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

const mvs = await c.query(`
  SELECT schemaname, matviewname FROM pg_matviews
  WHERE schemaname IN ('catalog_app','public') ORDER BY 1,2
`)
console.log("== materialized views ==")
for (const r of mvs.rows) console.log(` ${r.schemaname}.${r.matviewname}`)

for (const r of mvs.rows) {
  const name = `${r.schemaname}.${r.matviewname}`
  try {
    const d = await c.query(`SELECT pg_get_viewdef('${name}'::regclass, true) AS def`)
    fs.writeFileSync(`reports/mv-${r.matviewname}.sql`, d.rows[0].def)
    console.log(`[saved] reports/mv-${r.matviewname}.sql`)
  } catch (e) { console.warn(name, e.message) }
}

const brandCheck = await c.query(`
  SELECT 1 FROM pg_matviews WHERE schemaname='catalog_app' AND matviewname='brand_profile_mv'
`)
console.log("brand_profile_mv exists?", brandCheck.rowCount > 0)

const turningCols = await c.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='raw_catalog' AND table_name='prod_edp_option_turning'
  ORDER BY ordinal_position
`)
console.log("\n== prod_edp_option_turning columns ==")
for (const r of turningCols.rows) console.log(` ${r.column_name}`)

const brandCols = await c.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='raw_catalog' AND table_name IN ('prod_brand','prod_brand_sub')
  ORDER BY table_name, ordinal_position
`)
console.log("\n== prod_brand / prod_brand_sub columns ==")
for (const r of brandCols.rows) console.log(` ${r.column_name}`)

const catCols = await c.query(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='raw_catalog' AND table_name IN ('prod_category','prod_category_sub','prod_icons','prod_series_icons')
  ORDER BY table_name, ordinal_position
`)
console.log("\n== category/icons columns ==")
for (const r of catCols.rows) console.log(` ${r.table_name}.${r.column_name}`)

await c.end()
