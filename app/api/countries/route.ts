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
       FROM catalog_app.product_recommendation_mv,
            LATERAL unnest(country_codes) AS country_row(country)
       WHERE country IS NOT NULL
         AND BTRIM(country) <> ''
       ORDER BY country`
    )
    const countries = result.rows.map((row) => row.country)
    return NextResponse.json({ countries })
  } catch (error) {
    console.error("[countries] Failed to fetch countries:", error)
    return NextResponse.json({
      countries: ["KOR", "ENG", "CHN", "JPN"],
      fallback: true,
    })
  }
}
