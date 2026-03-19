import "server-only"

import { NextResponse } from "next/server"
import { getSharedPool } from "@/lib/data/shared-pool"

export async function GET() {
  try {
    const pool = getSharedPool()
    if (!pool) {
      return NextResponse.json({ countries: ["KOR", "ENG", "CHN", "JPN"], fallback: true })
    }
    const result = await pool.query<{ country: string }>(
      `SELECT DISTINCT country_row.country_code AS country
       FROM catalog_app.product_recommendation_mv,
            LATERAL unnest(country_codes) AS country_row(country_code)
       WHERE country_row.country_code IS NOT NULL
         AND BTRIM(country_row.country_code) <> ''
       ORDER BY country_row.country_code`
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
