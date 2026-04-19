/**
 * Series Grouper — Groups candidates by seriesName for accordion UI.
 *
 * Rules:
 *   - null seriesName → "(기타)" group, always sorted last
 *   - Groups sorted by topScore desc, "(기타)" always at end
 *   - Members within each group retain original rank order
 */

import type { CandidateSnapshot, SeriesGroup, SeriesGroupSummary } from "@/lib/types/exploration"

const UNGROUPED_KEY = "__ungrouped__"
const UNGROUPED_NAME = "(기타)"
type SeriesMaterialRatingValue = "EXCELLENT" | "GOOD" | "FAIR" | "NULL"
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
  if (value === "FAIR") return 2
  if (value === "NULL") return 3
  return 4
}

/**
 * Group candidates by series name.
 * Returns groups sorted by topScore (desc), with ungrouped last.
 */
export function groupCandidatesBySeries(
  candidates: CandidateSnapshot[],
  ratingBySeries?: Map<string, SeriesMaterialRank>
): SeriesGroup[] {
  const groupMap = new Map<string, SeriesGroup>()

  for (const c of candidates) {
    const key = c.seriesName ?? UNGROUPED_KEY
    const existing = groupMap.get(key)

    if (existing) {
      existing.members.push(c)
      existing.candidateCount++
      if (c.score > existing.topScore) {
        existing.topScore = c.score
      }
      // Use first member's icon/description as group representative
    } else {
      groupMap.set(key, {
        seriesKey: key,
        seriesName: c.seriesName ?? UNGROUPED_NAME,
        seriesIconUrl: c.seriesIconUrl ?? null,
        description: c.description ?? null,
        candidateCount: 1,
        topScore: c.score,
        materialRating: c.seriesName ? (ratingBySeries?.get(normalizeSeriesKey(c.seriesName))?.rating ?? null) : null,
        materialRatingScore: c.seriesName ? (ratingBySeries?.get(normalizeSeriesKey(c.seriesName))?.score ?? null) : null,
        members: [c],
      })
    }
  }

  // Sort: topScore desc, ungrouped always last
  const groups = [...groupMap.values()]
  groups.sort((a, b) => {
    if (a.seriesKey === UNGROUPED_KEY) return 1
    if (b.seriesKey === UNGROUPED_KEY) return -1
    const scoreDelta = (b.materialRatingScore ?? 0) - (a.materialRatingScore ?? 0)
    if (scoreDelta !== 0) return scoreDelta
    const ratingDelta = materialRatingOrder(a.materialRating) - materialRatingOrder(b.materialRating)
    if (ratingDelta !== 0) return ratingDelta
    return b.topScore - a.topScore
  })

  return groups
}

/**
 * Build lightweight summaries for checkpoint storage.
 */
export function buildGroupSummaries(groups: SeriesGroup[]): SeriesGroupSummary[] {
  return groups.map(g => ({
    seriesKey: g.seriesKey,
    seriesName: g.seriesName,
    candidateCount: g.candidateCount,
    materialRating: g.materialRating ?? null,
    materialRatingScore: g.materialRatingScore ?? null,
  }))
}

/**
 * Filter candidates to only those in a specific series group.
 */
export function filterBySeriesGroup(
  candidates: CandidateSnapshot[],
  groupKey: string
): CandidateSnapshot[] {
  if (groupKey === UNGROUPED_KEY) {
    return candidates.filter(c => c.seriesName == null)
  }
  return candidates.filter(c => c.seriesName === groupKey)
}
