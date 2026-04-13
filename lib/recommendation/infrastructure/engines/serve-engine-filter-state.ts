import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

type RangeOp = "gte" | "lte" | "between"

function isRangeOp(op: string | undefined): op is RangeOp {
  return op === "gte" || op === "lte" || op === "between"
}

function firstNumericValue(filter: AppliedFilter): number | null {
  const raw = filter.rawValue ?? filter.value
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (Array.isArray(raw)) {
    const first = raw.find(value => typeof value === "number" && Number.isFinite(value))
    if (typeof first === "number") return first
  }
  const parsed = Number(String(raw ?? "").replace(/[^\d.+-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function secondNumericValue(filter: AppliedFilter): number | null {
  const primaryRaw = filter.rawValue ?? filter.value
  if (Array.isArray(primaryRaw)) {
    for (let index = primaryRaw.length - 1; index >= 0; index -= 1) {
      const value = primaryRaw[index]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
  }

  const raw = (filter as AppliedFilter & { rawValue2?: unknown }).rawValue2
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  const parsed = Number(String(raw ?? "").replace(/[^\d.+-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function rangeUnit(field: string): string {
  if (field.endsWith("Mm")) return "mm"
  if (field.endsWith("Deg")) return "°"
  if (field === "fluteCount") return "날"
  if (field === "rpm") return "RPM"
  if (field === "feedRate") return "mm/rev"
  if (field === "cuttingSpeed") return "m/min"
  return ""
}

function formatRangeValue(field: string, value: number): string {
  const unit = rangeUnit(field)
  const normalized = Number.isInteger(value) ? String(value) : String(value)
  return `${normalized}${unit}`
}

function mergeRangeFilters(
  field: string,
  currentFilters: AppliedFilter[],
  nextFilter: AppliedFilter,
): AppliedFilter | null {
  if (!isRangeOp(nextFilter.op)) return null

  const sameFieldRangeFilters = currentFilters.filter(filter => filter.field === field && isRangeOp(filter.op))
  if (sameFieldRangeFilters.length === 0) return null

  let lowerBound: number | null = null
  let upperBound: number | null = null

  for (const filter of [...sameFieldRangeFilters, nextFilter]) {
    if (filter.op === "gte") {
      const value = firstNumericValue(filter)
      if (value == null) return null
      lowerBound = lowerBound == null ? value : Math.max(lowerBound, value)
      continue
    }

    if (filter.op === "lte") {
      const value = firstNumericValue(filter)
      if (value == null) return null
      upperBound = upperBound == null ? value : Math.min(upperBound, value)
      continue
    }

    const low = firstNumericValue(filter)
    const high = secondNumericValue(filter) ?? low
    if (low == null || high == null) return null
    const min = Math.min(low, high)
    const max = Math.max(low, high)
    lowerBound = lowerBound == null ? min : Math.max(lowerBound, min)
    upperBound = upperBound == null ? max : Math.min(upperBound, max)
  }

  if (lowerBound != null && upperBound != null && lowerBound > upperBound) {
    return null
  }

  if (lowerBound != null && upperBound != null) {
    if (lowerBound === upperBound) {
      return {
        field,
        op: "eq",
        value: formatRangeValue(field, lowerBound),
        rawValue: lowerBound,
        appliedAt: nextFilter.appliedAt,
      }
    }

    return {
      field,
      op: "between",
      value: `${formatRangeValue(field, lowerBound)} ~ ${formatRangeValue(field, upperBound)}`,
      rawValue: lowerBound,
      rawValue2: upperBound,
      appliedAt: nextFilter.appliedAt,
    } as AppliedFilter
  }

  if (lowerBound != null) {
    return {
      field,
      op: "gte",
      value: formatRangeValue(field, lowerBound),
      rawValue: lowerBound,
      appliedAt: nextFilter.appliedAt,
    }
  }

  if (upperBound != null) {
    return {
      field,
      op: "lte",
      value: formatRangeValue(field, upperBound),
      rawValue: upperBound,
      appliedAt: nextFilter.appliedAt,
    }
  }

  return null
}

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
  // canonicalField 매핑: diameterRefine과 diameterMm은 같은 필드로 취급
  const CANONICAL_MAP: Record<string, string> = { diameterRefine: "diameterMm", diameterMm: "diameterMm" }
  const canonField = CANONICAL_MAP[nextFilter.field] ?? nextFilter.field
  const fieldsToReplace = new Set([nextFilter.field, canonField])
  const mergedRangeFilter = mergeRangeFilters(canonField, currentFilters, {
    ...nextFilter,
    field: canonField,
  })
  const effectiveNextFilter = mergedRangeFilter ?? nextFilter

  const hadExistingFieldFilter = currentFilters.some(filter => fieldsToReplace.has(filter.field) || fieldsToReplace.has(CANONICAL_MAP[filter.field] ?? filter.field))
  const remainingFilters = currentFilters.filter(filter => !fieldsToReplace.has(filter.field) && !fieldsToReplace.has(CANONICAL_MAP[filter.field] ?? filter.field))
  const nextFilters = [...remainingFilters, effectiveNextFilter]

  return {
    replacedExisting: hadExistingFieldFilter,
    nextFilters,
    nextInput: rebuildInputFromFilters(baseInput, nextFilters, applyFilterToInput),
  }
}

export function replaceFieldFilters(
  baseInput: RecommendationInput,
  currentFilters: AppliedFilter[],
  nextFiltersToApply: AppliedFilter[],
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
): {
  replacedExisting: boolean
  replacedFields: string[]
  nextFilters: AppliedFilter[]
  nextInput: RecommendationInput
} {
  let workingFilters = [...currentFilters]
  const replacedFields = new Set<string>()

  for (const nextFilter of nextFiltersToApply) {
    const hadExistingFieldFilter = workingFilters.some(filter => filter.field === nextFilter.field)
    if (hadExistingFieldFilter) replacedFields.add(nextFilter.field)
    workingFilters = workingFilters.filter(filter => filter.field !== nextFilter.field)
    workingFilters.push(nextFilter)
  }

  return {
    replacedExisting: replacedFields.size > 0,
    replacedFields: [...replacedFields],
    nextFilters: workingFilters,
    nextInput: rebuildInputFromFilters(baseInput, workingFilters, applyFilterToInput),
  }
}
