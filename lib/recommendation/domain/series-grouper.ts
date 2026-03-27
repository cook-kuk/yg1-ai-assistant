import type { CandidateSnapshot, SeriesGroup, SeriesGroupSummary } from "@/lib/recommendation/domain/types"

const UNGROUPED_KEY = "__ungrouped__"
const UNGROUPED_NAME = "(기타)"
type SeriesMaterialRatingValue = "EXCELLENT" | "GOOD" | "NULL"
interface SeriesMaterialRank {
  rating: SeriesMaterialRatingValue
  score: number
}

function normalizeSeriesKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\-·ㆍ./(),]+/g, "")
}

function materialRatingOrder(value: SeriesMaterialRatingValue | null | undefined): number {
  if (value === "EXCELLENT") return 0
  if (value === "GOOD") return 1
  if (value === "NULL") return 2
  return 3
}

export function groupCandidatesBySeries(
  candidates: CandidateSnapshot[],
  ratingBySeries?: Map<string, SeriesMaterialRank>
): SeriesGroup[] {
  const groupMap = new Map<string, SeriesGroup>()

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
      seriesName: candidate.seriesName ?? UNGROUPED_NAME,
      seriesIconUrl: candidate.seriesIconUrl ?? null,
      description: candidate.description ?? null,
      candidateCount: 1,
      topScore: candidate.score,
      materialRating: candidate.seriesName ? (ratingBySeries?.get(normalizeSeriesKey(candidate.seriesName))?.rating ?? null) : null,
      materialRatingScore: candidate.seriesName ? (ratingBySeries?.get(normalizeSeriesKey(candidate.seriesName))?.score ?? null) : null,
      members: [candidate],
    })
  }

  const groups = [...groupMap.values()]
  groups.sort((left, right) => {
    if (left.seriesKey === UNGROUPED_KEY) return 1
    if (right.seriesKey === UNGROUPED_KEY) return -1
    const leftScore = left.materialRatingScore ?? 0
    const rightScore = right.materialRatingScore ?? 0
    if (leftScore !== rightScore) return rightScore - leftScore
    const ratingDelta = materialRatingOrder(left.materialRating) - materialRatingOrder(right.materialRating)
    if (ratingDelta !== 0) return ratingDelta
    return right.topScore - left.topScore
  })

  return groups
}

export function buildGroupSummaries(groups: SeriesGroup[]): SeriesGroupSummary[] {
  return groups.map(group => ({
    seriesKey: group.seriesKey,
    seriesName: group.seriesName,
    candidateCount: group.candidateCount,
    materialRating: group.materialRating ?? null,
    materialRatingScore: group.materialRatingScore ?? null,
  }))
}
