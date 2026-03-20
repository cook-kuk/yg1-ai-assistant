import type { CandidateSnapshot, SeriesGroup, SeriesGroupSummary } from "@/lib/recommendation/domain/types"

const UNGROUPED_KEY = "__ungrouped__"
const UNGROUPED_NAME = "(기타)"

export function groupCandidatesBySeries(candidates: CandidateSnapshot[]): SeriesGroup[] {
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
      members: [candidate],
    })
  }

  const groups = [...groupMap.values()]
  groups.sort((left, right) => {
    if (left.seriesKey === UNGROUPED_KEY) return 1
    if (right.seriesKey === UNGROUPED_KEY) return -1
    return right.topScore - left.topScore
  })

  return groups
}

export function buildGroupSummaries(groups: SeriesGroup[]): SeriesGroupSummary[] {
  return groups.map(group => ({
    seriesKey: group.seriesKey,
    seriesName: group.seriesName,
    candidateCount: group.candidateCount,
  }))
}
