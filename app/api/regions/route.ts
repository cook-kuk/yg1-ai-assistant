import "server-only"

import { NextResponse } from "next/server"
import { Pool } from "pg"

function dbConnectionString(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.PRODUCT_DB_URL ??
    undefined
  )
}

let _pool: Pool | null = null
function getPool(): Pool {
  const connectionString = dbConnectionString()
  if (!connectionString) throw new Error("No database connection string")
  if (!_pool) {
    _pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000 })
  }
  return _pool
}

export async function GET() {
  try {
    const pool = getPool()
    const result = await pool.query<{ country: string }>(
      `SELECT DISTINCT country
       FROM (
         SELECT NULLIF(BTRIM(country), '') AS country
         FROM raw_catalog.prod_edp_option_milling
         UNION
         SELECT NULLIF(BTRIM(country), '') AS country
         FROM raw_catalog.prod_edp_option_holemaking
         UNION
         SELECT NULLIF(BTRIM(country), '') AS country
         FROM raw_catalog.prod_edp_option_threading
       ) countries
       WHERE country IS NOT NULL
       ORDER BY country`
    )
    const regions = result.rows.map((r) => r.country)
    return NextResponse.json({ regions })
  } catch (error) {
    console.error("[regions] Failed to fetch regions:", error)
    // Fallback: return common country codes if DB query fails
    return NextResponse.json({
      regions: ["KOR", "ENG", "CHN", "JPN"],
      fallback: true,
    })
  }
}
