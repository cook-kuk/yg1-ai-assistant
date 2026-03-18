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
    const result = await pool.query<{ region: string }>(
      `SELECT DISTINCT TRIM(unnested) AS region
       FROM catalog_app.product_recommendation_mv,
            LATERAL unnest(string_to_array(region, ',')) AS unnested
       WHERE region IS NOT NULL AND region <> ''
         AND TRIM(unnested) <> ''
       ORDER BY region`
    )
    const regions = result.rows.map((r) => r.region)
    return NextResponse.json({ regions })
  } catch (error) {
    console.error("[regions] Failed to fetch regions:", error)
    // Fallback: return default region list if DB query fails
    return NextResponse.json({
      regions: ["KOR", "ENG", "CHN", "JPN"],
      fallback: true,
    })
  }
}
