/**
 * Predictive Filter — 필터 적용 전에 0건 예측.
 * 전체 조합이 0건이면 필터를 하나씩 빼봤을 때 각각 몇 건인지 병렬 COUNT.
 * "이 조건 빼면 몇 건" 대안을 유저에게 제시.
 */

import type { AppliedFilter } from "@/lib/types/exploration"

export interface PredictiveResult {
  /** 전체 필터 적용 시 예상 건수 */
  fullCount: number
  /** 0건 예측 여부 */
  willBeZero: boolean
  /** 필터 하나씩 빼봤을 때 결과 (건수 내림차순) */
  dropOneResults: Array<{
    droppedFilter: AppliedFilter
    estimatedCount: number
  }>
  /** 유저에게 보여줄 제안 메시지 */
  suggestion: string | null
}

/**
 * executor: 주어진 필터로 COUNT만 반환하는 가벼운 함수.
 */
export async function predictFilterResult(
  filters: AppliedFilter[],
  executor: (filters: AppliedFilter[]) => Promise<number>,
): Promise<PredictiveResult> {
  if (filters.length <= 1) {
    const count = await executor(filters)
    return { fullCount: count, willBeZero: count === 0, dropOneResults: [], suggestion: null }
  }

  const fullCount = await executor(filters)

  if (fullCount > 0) {
    return { fullCount, willBeZero: false, dropOneResults: [], suggestion: null }
  }

  // 0건 → drop-one 병렬 계산
  const results = await Promise.all(
    filters.map(async (droppedFilter, idx) => {
      const remaining = filters.filter((_, i) => i !== idx)
      const count = await executor(remaining)
      return { droppedFilter, estimatedCount: count }
    }),
  )

  const dropOneResults = results
    .filter(r => r.estimatedCount > 0)
    .sort((a, b) => b.estimatedCount - a.estimatedCount)

  let suggestion: string | null
  if (dropOneResults.length > 0) {
    const top = dropOneResults.slice(0, 3)
    const lines = top.map(r => {
      const fieldName = r.droppedFilter.field
      const value = r.droppedFilter.rawValue ?? r.droppedFilter.value
      return `"${fieldName}: ${value}" 빼면 ${r.estimatedCount}건`
    })
    suggestion = `현재 조건으로는 0건인데, 조건을 하나 완화하면 결과가 나옵니다:\n${lines.join("\n")}`
  } else {
    suggestion = "모든 조건을 조합해도 0건입니다. 조건을 크게 변경하시거나 처음부터 다시 시작하시겠어요?"
  }

  return { fullCount: 0, willBeZero: true, dropOneResults, suggestion }
}
