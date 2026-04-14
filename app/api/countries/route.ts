import "server-only"

import { NextResponse } from "next/server"
import { Pool } from "pg"
import {
  COUNTRY_CANONICAL_VALUES,
  canonicalizeCountryValue,
} from "@/lib/recommendation/shared/canonical-values"

export const COUNTRIES_SQL = `SELECT DISTINCT country_row.country AS country
FROM catalog_app.product_recommendation_mv,
     LATERAL unnest(country_codes) AS country_row(country)
WHERE country_row.country IS NOT NULL
  AND BTRIM(country_row.country) <> ''
ORDER BY country_row.country`

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
    const result = await pool.query<{ country: string }>(COUNTRIES_SQL)
    const countries = Array.from(
      new Set(
        result.rows
          .map((row) => canonicalizeCountryValue(row.country))
          .filter(
            (country): country is (typeof COUNTRY_CANONICAL_VALUES)[number] =>
              COUNTRY_CANONICAL_VALUES.includes(country as (typeof COUNTRY_CANONICAL_VALUES)[number]),
          ),
      ),
    )
    return NextResponse.json({ countries })
  } catch (error) {
    console.error("[countries] Failed to fetch countries:", error)
    return NextResponse.json({
      countries: COUNTRY_CANONICAL_VALUES,
      fallback: true,
    })
  }
}
