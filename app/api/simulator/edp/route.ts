import { NextRequest, NextResponse } from "next/server"
import { getSharedPool } from "@/lib/data/shared-pool"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const series = searchParams.get("series")?.trim()
  if (!series) {
    return NextResponse.json({ error: "series parameter required" }, { status: 400 })
  }

  const pool = getSharedPool()
  if (!pool) {
    return NextResponse.json({ edp: null, reason: "no-db" })
  }

  const normalized = series.replace(/[\s-]/g, "").toUpperCase()
  try {
    const result = await pool.query<{ edp_no: string }>(
      `SELECT edp_no
       FROM raw_catalog.prod_edp
       WHERE edp_no IS NOT NULL
         AND REPLACE(REPLACE(UPPER(COALESCE(edp_series_name, '')), ' ', ''), '-', '') = $1
       ORDER BY edp_no
       LIMIT 1`,
      [normalized]
    )
    return NextResponse.json({ edp: result.rows[0]?.edp_no ?? null, series: normalized })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ edp: null, error: msg }, { status: 500 })
  }
}
