import type {
  RecommendationCandidateDto,
  RecommendationSeriesGroupSummaryDto,
} from "@/lib/contracts/recommendation"

export interface RecommendationCandidateSeriesGroup {
  seriesKey: string
  seriesName: string
  candidateCount: number
  topScore: number
  seriesIconUrl: string | null
  description: string | null
  materialRating: "EXCELLENT" | "GOOD" | "NULL" | null
  materialRatingScore: number | null
  members: RecommendationCandidateDto[]
}

const UNGROUPED_KEY = "__ungrouped__"
const UNGROUPED_NAME = "(기타)"

function defaultSeriesName(value: string | null): string {
  return value ?? UNGROUPED_NAME
}

// 그룹 내 후보 우선순위:
//   1) score 내림차순 (최우선)
//   2) matchStatus: exact > approximate > none
//   3) stockStatus: instock > limited > unknown > outofstock
//   4) totalStock 내림차순 (재고 많을수록 위)
//   5) productCode 사전순 (최후 안정 정렬)
const MATCH_STATUS_RANK: Record<string, number> = { exact: 0, approximate: 1, none: 2 }
const STOCK_STATUS_RANK: Record<string, number> = { instock: 0, limited: 1, unknown: 2, outofstock: 3 }

function compareCandidates(a: RecommendationCandidateDto, b: RecommendationCandidateDto): number {
  if (b.score !== a.score) return b.score - a.score
  const ma = MATCH_STATUS_RANK[a.matchStatus] ?? 99
  const mb = MATCH_STATUS_RANK[b.matchStatus] ?? 99
  if (ma !== mb) return ma - mb
  const sa = STOCK_STATUS_RANK[a.stockStatus] ?? 99
  const sb = STOCK_STATUS_RANK[b.stockStatus] ?? 99
  if (sa !== sb) return sa - sb
  const ta = a.totalStock ?? -1
  const tb = b.totalStock ?? -1
  if (tb !== ta) return tb - ta
  return a.productCode.localeCompare(b.productCode)
}

/** 그룹 내 members 를 우선순위 정책으로 정렬 (in-place). 외부에서도 재사용 가능. */
export function sortCandidatesByPriority(
  candidates: RecommendationCandidateDto[]
): RecommendationCandidateDto[] {
  return [...candidates].sort(compareCandidates)
}

export function groupRecommendationCandidatesBySeries(
  candidates: RecommendationCandidateDto[],
  summaries?: RecommendationSeriesGroupSummaryDto[] | null
): RecommendationCandidateSeriesGroup[] {
  const groupMap = new Map<string, RecommendationCandidateSeriesGroup>()

  for (const candidate of candidates) {
    const key = candidate.seriesName ?? UNGROUPED_KEY
    const existing = groupMap.get(key)

    if (existing) {
      existing.members.push(candidate)
      existing.candidateCount += 1
      if (candidate.score > existing.topScore) {
        existing.topScore = candidate.score
      }
      continue
    }

    groupMap.set(key, {
      seriesKey: key,
      seriesName: defaultSeriesName(candidate.seriesName),
      candidateCount: 1,
      topScore: candidate.score,
      seriesIconUrl: candidate.seriesIconUrl ?? null,
      description: candidate.description ?? null,
      materialRating: null,
      materialRatingScore: null,
      members: [candidate],
    })
  }

  // 각 그룹의 members 를 우선순위로 정렬 (score → matchStatus → stockStatus → totalStock → code).
  // 백엔드 score 는 이미 내림차순일 가능성이 높지만 동률 / display 단계에서 깨질 수 있어
  // 항상 한 번 더 안정적으로 정렬해 사용자에게 일관된 우선순위를 보여준다.
  for (const group of groupMap.values()) {
    group.members.sort(compareCandidates)
  }

  const grouped = [...groupMap.values()]

  if (summaries && summaries.length > 0) {
    for (const summary of summaries) {
      const group = groupMap.get(summary.seriesKey)
      if (group) {
        group.materialRating = summary.materialRating ?? null
        group.materialRatingScore = summary.materialRatingScore ?? null
      }
    }
    const ordered = summaries
      .map(summary => groupMap.get(summary.seriesKey))
      .filter((group): group is RecommendationCandidateSeriesGroup => Boolean(group))
    const seen = new Set(ordered.map(group => group.seriesKey))
    const remaining = grouped.filter(group => !seen.has(group.seriesKey))
    return [...ordered, ...remaining]
  }

  grouped.sort((left, right) => {
    if (left.seriesKey === UNGROUPED_KEY) return 1
    if (right.seriesKey === UNGROUPED_KEY) return -1
    return right.topScore - left.topScore
  })

  return grouped
}
