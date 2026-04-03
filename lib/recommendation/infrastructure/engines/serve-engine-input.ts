import {
  canonicalizeIntakeSearchText,
  canonicalizeMaterialSelection,
  canonicalizeToolCategorySelection,
} from "@/lib/recommendation/shared/intake-localization"
import {
  applyFilterToRecommendationInput,
  clearFilterFromRecommendationInput,
} from "@/lib/recommendation/shared/filter-field-registry"

import type {
  AnswerState,
  AppliedFilter,
  MachiningIntent,
  ProductIntakeForm,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"

export function getKnown<T>(state?: AnswerState<T>): T | undefined {
  return state?.status === "known" ? (state as { status: "known"; value: T }).value : undefined
}

export function parseIntakeDiameter(text: string): number | null {
  if (!text) return null
  const clean = text.trim()
  const mmMatch = clean.match(/^(\d+(?:\.\d+)?)\s*mm?$/i)
  if (mmMatch) return parseFloat(mmMatch[1])
  const numMatch = clean.match(/^(\d+(?:\.\d+)?)$/)
  if (numMatch) {
    const n = parseFloat(numMatch[1])
    return n > 0 && n <= 200 ? n : null
  }
  const inchFrac = clean.match(/^(\d+)\s*\/\s*(\d+)\s*(?:inch|인치|")?$/i)
  if (inchFrac) {
    return Math.round((parseInt(inchFrac[1]) / parseInt(inchFrac[2])) * 25.4 * 100) / 100
  }
  return null
}

export function mapIntakeToInput(form: ProductIntakeForm): RecommendationInput {
  const input: Partial<RecommendationInput> = {
    manufacturerScope: "yg1-only",
    locale: "en",
  }

  const material = getKnown(form.material)
  if (material) input.material = canonicalizeMaterialSelection(material)

  const intent = getKnown(form.machiningIntent as AnswerState<MachiningIntent>)
  const intentMap: Record<MachiningIntent, string> = {
    roughing: "Roughing",
    semi: "Semi-finishing",
    finishing: "Finishing",
  }
  if (intent) input.machiningIntent = intentMap[intent]

  const opType = getKnown(form.operationType)
  if (opType) {
    const ops = opType
      .split(",")
      .map(value => canonicalizeIntakeSearchText(value.trim()))
      .filter(Boolean)
    if (ops.length > 0) input.operationType = ops.join(", ")
  }

  const diamStr = getKnown(form.diameterInfo)
  if (diamStr) {
    const diam = parseIntakeDiameter(diamStr)
    if (diam !== null) input.diameterMm = diam
  }

  const operationCategory = getKnown(form.toolTypeOrCurrentProduct)
  if (operationCategory) {
    const normalized = canonicalizeToolCategorySelection(operationCategory)
    if (normalized) {
      if (normalized === "Tooling System") {
        input.toolType = normalized
        input.machiningCategory = "Turning"
      } else {
        input.machiningCategory = normalized
      }
    }
  }

  const country = getKnown(form.country)
  if (country) {
    const normalizedCountry = country.trim().toUpperCase()
    if (normalizedCountry && normalizedCountry !== "ALL") {
      input.country = normalizedCountry
    }
  }

  return input as RecommendationInput
}

export function applyFilterToInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  let updated = { ...input }
  updated = applySingleFilter(updated, filter)

  const sideFilters = (filter as unknown as Record<string, unknown>)._sideFilters as AppliedFilter[] | undefined
  if (sideFilters && Array.isArray(sideFilters)) {
    for (const sideFilter of sideFilters) {
      updated = applySingleFilter(updated, sideFilter)
    }
  }

  return updated
}

function applySingleFilter(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  if (filter.op === "skip" || filter.rawValue === "skip") {
    return clearFilterFromRecommendationInput(input, filter.field)
  }

  return applyFilterToRecommendationInput(input, filter)
}
