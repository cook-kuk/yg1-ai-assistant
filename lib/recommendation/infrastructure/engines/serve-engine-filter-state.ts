import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

export function rebuildInputFromFilters(
  baseInput: RecommendationInput,
  filters: AppliedFilter[],
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
): RecommendationInput {
  let rebuiltInput = { ...baseInput }
  for (const filter of filters) {
    rebuiltInput = applyFilterToInput(rebuiltInput, filter)
  }
  return rebuiltInput
}

export function replaceFieldFilter(
  baseInput: RecommendationInput,
  currentFilters: AppliedFilter[],
  nextFilter: AppliedFilter,
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
): {
  replacedExisting: boolean
  nextFilters: AppliedFilter[]
  nextInput: RecommendationInput
} {
  const hadExistingFieldFilter = currentFilters.some(filter => filter.field === nextFilter.field)
  const remainingFilters = currentFilters.filter(filter => filter.field !== nextFilter.field)
  const nextFilters = [...remainingFilters, nextFilter]

  return {
    replacedExisting: hadExistingFieldFilter,
    nextFilters,
    nextInput: rebuildInputFromFilters(baseInput, nextFilters, applyFilterToInput),
  }
}
