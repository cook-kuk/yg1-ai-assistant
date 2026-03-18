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
      `SELECT DISTINCT country_option.country
       FROM (
         SELECT UPPER(BTRIM(country_row.country_code)) AS country
         FROM catalog_app.product_recommendation_mv
         CROSS JOIN LATERAL unnest(COALESCE(country_codes, ARRAY[]::text[])) AS country_row(country_code)
       ) AS country_option
       WHERE country_option.country <> ''
       ORDER BY country_option.country`
    )

    return NextResponse.json({
      countries: result.rows.map((row) => row.country),
    })
  } catch (error) {
    console.error("[countries] Failed to fetch countries:", error)
    return NextResponse.json({
      countries: ["KOREA", "ASIA", "AMERICA", "EUROPE"],
      fallback: true,
    })
  }
}
