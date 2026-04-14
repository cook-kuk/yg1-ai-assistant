import { NextResponse } from "next/server"
import {
  getLearnedPoolStats,
  loadLearnedPool,
} from "@/lib/recommendation/core/feedback-pool"

/**
 * Feedback-Driven Few-Shot Pool stats.
 *
 * 사용자 👍/👎 피드백으로 축적된 learned examples 현황.
 * 대시보드 ("시스템이 사용할수록 학습합니다" 증명) + 헬스체크용.
 */
export async function GET() {
  try {
    await loadLearnedPool()
    const stats = getLearnedPoolStats()
    return NextResponse.json({
      ...stats,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load pool stats", detail: (error as Error).message },
      { status: 500 },
    )
  }
}
