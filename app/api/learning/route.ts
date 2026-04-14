import { NextResponse } from "next/server"
import { getKGStats } from "@/lib/recommendation/core/knowledge-graph"
import { getSharedPool } from "@/lib/data/shared-pool"
import {
  getLearnedPoolStats,
  loadLearnedPool,
} from "@/lib/recommendation/core/feedback-pool"

async function getDbSeriesCount(): Promise<number> {
  const pool = getSharedPool()
  if (!pool) return 0
  try {
    const res = await pool.query(
      `SELECT COUNT(DISTINCT edp_series_name) AS cnt FROM catalog_app.product_recommendation_mv WHERE edp_series_name IS NOT NULL`
    )
    return Number(res.rows[0]?.cnt ?? 0)
  } catch {
    return 0
  }
}

/**
 * Learning dashboard endpoint.
 * - KG stats: static entity graph (seriesCount 포함)
 * - Pool stats: feedback-pool 실시간 👍/👎 학습 현황
 *
 * 과거 scheme(`stats`, `patterns`)는 client 하위호환을 위해 최소 shape으로 유지.
 */
export async function GET() {
  try {
    await loadLearnedPool()
    const kgStats = getKGStats()
    const seriesCount = await getDbSeriesCount()
    const poolStats = getLearnedPoolStats()

    return NextResponse.json({
      poolStats,
      kgStats: { ...kgStats, seriesCount },
      stats: {
        totalInteractions: 0,
        kgHitRate: 0,
        llmFallbackRate: 0,
        newPatternsLearned: poolStats.netPositive,
        patternsByType: {},
        topMissedPatterns: [],
        recentLearnings: [],
        dailyStats: [],
      },
      patterns: [],
      timestamp: new Date().toISOString(),
    })
  } catch {
    return NextResponse.json({ error: "Failed to load learning data" }, { status: 500 })
  }
}

/**
 * 과거 JSON-log 기반 mine/train/verify/flush/reset 액션은 제거됨.
 * 레거시 클라이언트가 호출해도 500 대신 410 Gone 으로 graceful 응답.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "deprecated",
      message: "Legacy self-learning actions were removed. Learning now happens via user feedback (👍/👎) and is visible in /api/learning/pool-stats.",
    },
    { status: 410 },
  )
}
