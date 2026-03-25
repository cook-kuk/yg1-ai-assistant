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
