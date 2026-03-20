import { canonicalizeIntakeSearchText } from "@/lib/recommendation/shared/intake-localization"

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
  if (material) input.material = canonicalizeIntakeSearchText(material)

  const opParts: string[] = []
  const intent = getKnown(form.machiningIntent as AnswerState<MachiningIntent>)
  const intentMap: Record<MachiningIntent, string> = {
    roughing: "Roughing",
    semi: "Semi-finishing",
    finishing: "Finishing",
  }
  if (intent) opParts.push(intentMap[intent])

  const opType = getKnown(form.operationType)
  if (opType) {
    const ops = opType
      .split(",")
      .map(value => canonicalizeIntakeSearchText(value.trim()))
      .filter(Boolean)
    opParts.push(...ops)
  }
  if (opParts.length > 0) input.operationType = opParts.join(" ")

  const diamStr = getKnown(form.diameterInfo)
  if (diamStr) {
    const diam = parseIntakeDiameter(diamStr)
    if (diam !== null) input.diameterMm = diam
  }

  const toolType = getKnown(form.toolTypeOrCurrentProduct)
  if (toolType) input.toolType = canonicalizeIntakeSearchText(toolType)

  const country = getKnown(form.country)
  if (country) input.country = country.trim().toUpperCase()

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
  const updated = { ...input }

  if (filter.op === "skip" || filter.rawValue === "skip") {
    switch (filter.field) {
      case "diameterMm":
      case "diameterRefine":
        updated.diameterMm = undefined
        break
      case "fluteCount":
        updated.flutePreference = undefined
        break
      case "coating":
        updated.coatingPreference = undefined
        break
      case "cuttingType":
        updated.operationType = undefined
        break
      case "material":
        updated.material = undefined
        break
      case "toolSubtype":
        updated.toolSubtype = undefined
        break
    }
    return updated
  }

  switch (filter.field) {
    case "diameterMm":
    case "diameterRefine":
      updated.diameterMm = typeof filter.rawValue === "number" ? filter.rawValue : parseFloat(String(filter.rawValue))
      break
    case "material":
      updated.material = String(filter.rawValue)
      break
  }

  return updated
}
