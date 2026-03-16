import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Client } from "pg"

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const values = {}
  for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const index = trimmed.indexOf("=")
    const key = trimmed.slice(0, index).trim()
    const rawValue = trimmed.slice(index + 1).trim()
    values[key] = rawValue.replace(/^['"]|['"]$/g, "")
  }
  return values
}

function envValue(key, fallback, fileEnv) {
  return process.env[key] || fileEnv[key] || fallback
}

function connectionConfig(fileEnv) {
  const databaseUrl = envValue("DATABASE_URL", "", fileEnv)
  if (databaseUrl) return { connectionString: databaseUrl }

  return {
    host: envValue("PGHOST", "", fileEnv) || envValue("POSTGRES_HOST", "", fileEnv),
    port: Number(envValue("PGPORT", "5432", fileEnv) || envValue("POSTGRES_PORT", "5432", fileEnv)),
    database: envValue("PGDATABASE", "", fileEnv) || envValue("POSTGRES_DB", "", fileEnv),
    user: envValue("PGUSER", "", fileEnv) || envValue("POSTGRES_USER", "", fileEnv),
    password: envValue("PGPASSWORD", "", fileEnv) || envValue("POSTGRES_PASSWORD", "", fileEnv),
  }
}

async function main() {
  const envPath = path.join(process.cwd(), ".env")
  const fileEnv = readDotEnv(envPath)
  const config = connectionConfig(fileEnv)

  if (!config.connectionString && (!config.host || !config.database || !config.user || !config.password)) {
    console.error("DB connection settings are missing. Fill .env or export DATABASE_URL / PG* vars.")
    process.exit(1)
  }

  const client = new Client(config)
  const requiredTables = [
    "raw_catalog.prod_edp",
    "raw_catalog.prod_series",
    "raw_catalog.prod_series_work_material_status",
    "raw_catalog.prod_edp_option_milling",
    "raw_catalog.prod_edp_option_holemaking",
    "raw_catalog.prod_edp_option_threading",
  ]

  try {
    await client.connect()

    const dbNameResult = await client.query("select current_database() as name")
    console.log(`database=${dbNameResult.rows[0].name}`)

    let hasMissing = false
    for (const tableName of requiredTables) {
      const result = await client.query(
        "select to_regclass($1) as regclass",
        [tableName]
      )
      const exists = !!result.rows[0].regclass
      console.log(`${tableName}\t${exists ? "ok" : "missing"}`)
      if (!exists) {
        hasMissing = true
        continue
      }

      const countResult = await client.query(`select count(*)::int as count from ${tableName}`)
      console.log(`${tableName}.rows\t${countResult.rows[0].count}`)
    }

    if (hasMissing) {
      console.error("Required raw_catalog tables are missing.")
      process.exit(2)
    }

    const sampleQuery = `
      select pe.edp_no, pe.series_name, ps.application_shape
      from raw_catalog.prod_edp pe
      left join raw_catalog.prod_series ps on ps.idx = pe.series_idx
      where coalesce(pe.flag_del, 'N') <> 'Y'
        and coalesce(pe.flag_show, 'Y') = 'Y'
        and nullif(pe.edp_no, '') is not null
      limit 5
    `
    const sample = await client.query(sampleQuery)
    console.log("sample_rows")
    for (const row of sample.rows) {
      console.log(JSON.stringify(row))
    }
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
