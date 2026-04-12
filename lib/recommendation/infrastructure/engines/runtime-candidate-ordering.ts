import type { SpecExecutorResult } from "@/lib/recommendation/core/execute-spec-via-compiler"
import type { QuerySort } from "@/lib/recommendation/core/query-spec"
import { sortScoredCandidatesByQuerySort } from "@/lib/recommendation/core/query-sort-runtime"
import type { ScoredProduct } from "@/lib/recommendation/domain/types"

type PhaseGSnapshot = Pick<SpecExecutorResult, "products" | "rowCount">

function wrapCompiledProduct(product: PhaseGSnapshot["products"][number], rank: number): ScoredProduct {
  return {
    product: product as unknown as ScoredProduct["product"],
    score: Math.max(1, 100 - rank),
    scoreBreakdown: null,
    matchedFields: [],
    matchStatus: "approximate",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "unknown",
    totalStock: null,
    minLeadTimeDays: null,
  }
}

export function applyRuntimeCandidateOrdering(
  candidates: ScoredProduct[],
  sort: QuerySort | null,
  phaseGCompiledResult: PhaseGSnapshot | null,
): {
  candidates: ScoredProduct[]
  phaseGReplaced: boolean
  sortApplied: boolean
} {
  let orderedCandidates = candidates
  let phaseGReplaced = false

  if (phaseGCompiledResult && phaseGCompiledResult.rowCount > 0) {
    const originalByCode = new Map<string, ScoredProduct>()
    for (const candidate of orderedCandidates) {
      const key = candidate.product.normalizedCode || candidate.product.displayCode || ""
      if (key) originalByCode.set(key, candidate)
    }

    const reordered: ScoredProduct[] = []
    for (const [index, product] of phaseGCompiledResult.products.entries()) {
      const key = product.normalizedCode || product.displayCode || ""
      const hit = key ? originalByCode.get(key) : undefined
      if (hit) reordered.push(hit)
      else reordered.push(wrapCompiledProduct(product, index))
    }

    if (reordered.length > 0) {
      orderedCandidates = reordered
      phaseGReplaced = true
    }
  }

  const sortApplied = !!sort
  if (sort) {
    orderedCandidates = sortScoredCandidatesByQuerySort(orderedCandidates, sort)
  }

  return {
    candidates: orderedCandidates,
    phaseGReplaced,
    sortApplied,
  }
}
