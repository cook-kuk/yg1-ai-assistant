#!/usr/bin/env node
/**
 * product_recommendation_mv 컬럼 + 소스 시스템 카탈로그 탐색.
 * - mv 컬럼 전체 list
 * - point_angle / pitch / coolant 관련 컬럼이 prod_edp_option_* 에 있는지 확인
 * - 인벤토리 테이블 존재 여부 확인
 */
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

async function main() {
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
  console.log("[probe] connected")

  async function q(sql, params = []) {
    const r = await c.query(sql, params)
    return r.rows
  }

  console.log("\n== product_recommendation_mv columns ==")
  const cols = await q(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'catalog_app' AND table_name = 'product_recommendation_mv'
    ORDER BY ordinal_position
  `)
  console.log(`total: ${cols.length}`)
  for (const r of cols) console.log(`  ${r.column_name}  (${r.data_type})`)

  console.log("\n== mv definition (first 120 lines) ==")
  const def = await q(`SELECT pg_get_viewdef('catalog_app.product_recommendation_mv'::regclass, true) AS def`)
  if (def[0]?.def) {
    const lines = def[0].def.split("\n")
    console.log(lines.slice(0, 120).join("\n"))
    if (lines.length > 120) console.log(`... (${lines.length - 120} more lines)`)
    fs.writeFileSync("reports/mv-definition.sql", def[0].def)
    console.log("\n[saved] reports/mv-definition.sql")
  }

  console.log("\n== tables with 'point_angle' / 'pitch' / 'inventory' / 'stock' columns ==")
  const rel = await q(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE column_name ILIKE ANY (ARRAY['%point_angle%','%pointangle%','%pitch%','%tpi%','%inventory%','%stock%','%in_stock%'])
      AND table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY table_schema, table_name, column_name
  `)
  for (const r of rel) console.log(`  ${r.table_schema}.${r.table_name}.${r.column_name} (${r.data_type})`)

  console.log("\n== source edp_option_holemaking / threading columns (sample) ==")
  const src = await q(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_name ILIKE 'prod_edp_option_%'
      AND column_name ILIKE ANY (ARRAY['%point%','%pitch%','%tpi%','%coolant%'])
    ORDER BY table_name, column_name
  `)
  for (const r of src) console.log(`  ${r.table_schema}.${r.table_name}.${r.column_name}`)

  await c.end()
  console.log("\n[done]")
}

main().catch(e => { console.error(e); process.exit(1) })
