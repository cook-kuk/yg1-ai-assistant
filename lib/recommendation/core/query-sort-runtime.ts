import type { QueryField, QuerySort } from "./query-spec"
import type { ScoredProduct } from "@/lib/recommendation/domain/types"

type SortValue = number | string | null | undefined

const QUERY_SORT_ACCESSORS: Partial<Record<QueryField, (candidate: ScoredProduct) => SortValue>> = {
  diameterMm: candidate => candidate.product.diameterMm,
  fluteCount: candidate => candidate.product.fluteCount,
  overallLengthMm: candidate => candidate.product.overallLengthMm,
  lengthOfCutMm: candidate => candidate.product.lengthOfCutMm,
  shankDiameterMm: candidate => candidate.product.shankDiameterMm,
  helixAngleDeg: candidate => candidate.product.helixAngleDeg,
  pointAngleDeg: candidate => candidate.product.pointAngleDeg,
  threadPitchMm: candidate => candidate.product.threadPitchMm,
}

function compareSortValues(left: SortValue, right: SortValue, direction: QuerySort["direction"]): number {
  const leftMissing = left == null || left === ""
  const rightMissing = right == null || right === ""
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1

  if (typeof left === "number" && typeof right === "number") {
    return direction === "desc" ? right - left : left - right
  }

  const normalizedLeft = String(left).toLowerCase()
  const normalizedRight = String(right).toLowerCase()
  return direction === "desc"
    ? normalizedRight.localeCompare(normalizedLeft, "en")
    : normalizedLeft.localeCompare(normalizedRight, "en")
}

export function sortScoredCandidatesByQuerySort(
  candidates: ScoredProduct[],
  sort: QuerySort | null | undefined,
): ScoredProduct[] {
  if (!sort || candidates.length <= 1) return candidates

  const accessor = QUERY_SORT_ACCESSORS[sort.field]
  if (!accessor) return candidates

  return [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const compared = compareSortValues(
        accessor(left.candidate),
        accessor(right.candidate),
        sort.direction,
      )
      return compared !== 0 ? compared : left.index - right.index
    })
    .map(entry => entry.candidate)
}
