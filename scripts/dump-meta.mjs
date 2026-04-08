/**
 * Dump distinct values from raw_catalog.* for all metadata that
 * deterministic-scr.ts (and friends) should statically know about.
 *
 * Output: test-results/db-meta.json
 *
 * Usage: node scripts/dump-meta.mjs
 */
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Client } from "pg"

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const values = {}
  for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#") || !t.includes("=")) continue
    const i = t.indexOf("=")
    values[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return values
}

function envValue(key, fallback, fileEnv) {
  return process.env[key] || fileEnv[key] || fallback
}

function connectionConfig(fileEnv) {
  const url = envValue("DATABASE_URL", "", fileEnv)
  if (url) return { connectionString: url }
  return {
    host: envValue("PGHOST", "", fileEnv) || envValue("POSTGRES_HOST", "", fileEnv),
    port: Number(envValue("PGPORT", "5432", fileEnv) || envValue("POSTGRES_PORT", "5432", fileEnv)),
    database: envValue("PGDATABASE", "", fileEnv) || envValue("POSTGRES_DB", "", fileEnv),
    user: envValue("PGUSER", "", fileEnv) || envValue("POSTGRES_USER", "", fileEnv),
    password: envValue("PGPASSWORD", "", fileEnv) || envValue("POSTGRES_PASSWORD", "", fileEnv),
  }
}

// table -> list of columns to dump as distinct
const TARGETS = {
  "raw_catalog.prod_brand": ["brand_name", "country"],
  "raw_catalog.prod_work_piece_by_category": ["root_category", "tag_name", "name", "name_kor"],
  "raw_catalog.prod_series": [
    "root_category",
    "brand_name",
    "tool_type",
    "sales",
    "application_shape",
    "cutting_Edge_shape",
    "shank_type",
    "product_type",
    "cooling_type",
    "hole_type",
    "thread_direction",
    "geometry",
    "machining_condition",
    "country",
    "STI",
    "unit",
  ],
  "raw_catalog.prod_edp_option_milling": [
    "option_milling_cuttingedgeshape", "option_milling_roughingfinishtype",
    "option_milling_shanktype", "option_milling_toolmaterial",
    "option_milling_coating", "option_milling_geometrystandard",
    "option_milling_cuttershape", "option_milling_coolanthole",
    "option_milling_cuttingdirection", "option_milling_connection_type",
    "option_milling_singledoubleend",
    "option_milling_cfrp", "option_milling_gfrp", "option_milling_kfrp", "option_milling_honeycomb",
    "option_milling_coolant", "option_milling_oil_mist", "option_milling_air", "option_milling_dry",
    "option_milling_chipbreaker",
  ],
  "raw_catalog.prod_edp_option_holemaking": [
    "option_holemaking_shanktype", "option_holemaking_toolmaterial",
    "option_holemaking_coating", "option_holemaking_coolanthole",
    "option_holemaking_standarddrilltype", "option_holemaking_holeshape",
    "option_holemaking_cutting_direction",
    "option_holemaking_cfrp", "option_holemaking_gfrp",
    "option_holemaking_cfrp_alu", "option_holemaking_cfrp_tita",
    "option_holemaking_chipbreaker", "option_holemaking_helix_direction",
    "option_holemaking_surface_finish",
  ],
  "raw_catalog.prod_edp_option_threading": [
    "option_threading_coarsefine", "option_threading_geometrystandard",
    "option_threading_threadshape", "option_threading_flutetype",
    "option_threading_toolmaterial", "option_threading_coating",
    "option_threading_coolanthole", "option_threading_threaddirection",
    "option_threading_internal_external", "option_threading_cuttingdirection",
    "option_threading_holeshape", "option_threading_sti",
  ],
  "raw_catalog.prod_edp_option_turning": [
    "option_turning_grade", "option_turning_chip_breaker", "option_turning_work_piece",
    "option_turning_external_internal", "option_turning_coolant",
    "option_turning_hand", "option_turning_category",
  ],
  "raw_catalog.prod_edp_option_tooling": [
    "option_tooling_producttype", "option_tooling_type", "option_tooling_shanktype",
    "option_tooling_accessory", "option_tooling_coolant_system",
    "option_tooling_adapter_type", "option_tooling_standard",
  ],
}

async function tableExists(client, fq) {
  const r = await client.query("select to_regclass($1) as r", [fq])
  return !!r.rows[0].r
}

async function columnExists(client, schema, table, col) {
  const r = await client.query(
    `select 1 from information_schema.columns
      where table_schema = $1 and table_name = $2 and lower(column_name) = lower($3)`,
    [schema, table, col]
  )
  return r.rowCount > 0
}

async function distinctValues(client, fq, col) {
  // case-insensitive column lookup so we don't fight nvarchar quoted casing
  const [schema, table] = fq.split(".")
  const r = await client.query(
    `select column_name from information_schema.columns
      where table_schema = $1 and table_name = $2 and lower(column_name) = lower($3)
      limit 1`,
    [schema, table, col]
  )
  if (r.rowCount === 0) return null
  const realCol = r.rows[0].column_name
  const sql = `
    select distinct "${realCol}"::text as v
    from ${fq}
    where "${realCol}" is not null and trim("${realCol}"::text) <> ''
    order by 1
  `
  const out = await client.query(sql)
  return out.rows.map(x => x.v)
}

async function main() {
  const fileEnv = readDotEnv(path.join(process.cwd(), ".env"))
  const cfg = connectionConfig(fileEnv)
  if (!cfg.connectionString && (!cfg.host || !cfg.database || !cfg.user)) {
    console.error("DB env missing")
    process.exit(1)
  }
  const client = new Client(cfg)
  await client.connect()

  const result = {}
  const missingTables = []
  const missingCols = []

  for (const [fq, cols] of Object.entries(TARGETS)) {
    if (!(await tableExists(client, fq))) {
      missingTables.push(fq)
      continue
    }
    result[fq] = {}
    for (const col of cols) {
      const vals = await distinctValues(client, fq, col)
      if (vals == null) {
        missingCols.push(`${fq}.${col}`)
        continue
      }
      result[fq][col] = vals
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    missingTables,
    missingCols,
    counts: Object.fromEntries(
      Object.entries(result).map(([t, cols]) => [
        t, Object.fromEntries(Object.entries(cols).map(([c, v]) => [c, v.length])),
      ])
    ),
    data: result,
  }

  const outPath = path.join(process.cwd(), "test-results", "db-meta.json")
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf-8")
  console.log(`wrote ${outPath}`)
  console.log(`missing tables: ${missingTables.length}, missing cols: ${missingCols.length}`)

  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
