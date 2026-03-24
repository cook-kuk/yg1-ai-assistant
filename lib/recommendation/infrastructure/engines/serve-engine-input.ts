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

  const diamStr = getKnown(form.diameterInfo)
  if (diamStr) {
    const diam = parseIntakeDiameter(diamStr)
    if (diam !== null) input.diameterMm = diam
  }

  const operationCategory = getKnown(form.toolTypeOrCurrentProduct)
  if (operationCategory) {
    const normalized = canonicalizeIntakeSearchText(operationCategory)
    if (normalized) {
      input.machiningCategory = normalized
      if (!opParts.includes(normalized)) opParts.push(normalized)
    }
  }

  if (opParts.length > 0) input.operationType = opParts.join(" ")

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

  const numericFilterValue = typeof filter.rawValue === "number"
    ? filter.rawValue
    : parseFloat(String(filter.rawValue))
  const booleanFilterValue = String(filter.rawValue).toLowerCase() === "true" || String(filter.rawValue).toLowerCase() === "yes"

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
        updated.workPieceName = undefined
        break
      case "toolSubtype":
        updated.toolSubtype = undefined
        break
      case "seriesName":
        updated.seriesName = undefined
        break
      case "toolMaterial":
        updated.toolMaterial = undefined
        break
      case "toolType":
        updated.toolType = undefined
        break
      case "brand":
        updated.brand = undefined
        break
      case "country":
        updated.country = undefined
        break
      case "shankDiameterMm":
        updated.shankDiameterMm = undefined
        break
      case "lengthOfCutMm":
        updated.lengthOfCutMm = undefined
        break
      case "overallLengthMm":
        updated.overallLengthMm = undefined
        break
      case "helixAngleDeg":
        updated.helixAngleDeg = undefined
        break
      case "ballRadiusMm":
        updated.ballRadiusMm = undefined
        break
      case "taperAngleDeg":
        updated.taperAngleDeg = undefined
        break
      case "coolantHole":
        updated.coolantHole = undefined
      case "workPieceName":
        updated.workPieceName = undefined
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
      updated.workPieceName = undefined
      break
    case "workPieceName":
      updated.workPieceName = String(filter.rawValue)
      break
    case "fluteCount":
      updated.flutePreference = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "coating":
      updated.coatingPreference = String(filter.rawValue)
      break
    case "cuttingType":
      updated.operationType = String(filter.rawValue)
      break
    case "toolSubtype":
      updated.toolSubtype = String(filter.rawValue)
      break
    case "seriesName":
      updated.seriesName = String(filter.rawValue)
      break
    case "toolMaterial":
      updated.toolMaterial = String(filter.rawValue)
      break
    case "toolType":
      updated.toolType = String(filter.rawValue)
      break
    case "brand":
      updated.brand = String(filter.rawValue)
      break
    case "country":
      updated.country = String(filter.rawValue).toUpperCase()
      break
    case "shankDiameterMm":
      updated.shankDiameterMm = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "lengthOfCutMm":
      updated.lengthOfCutMm = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "overallLengthMm":
      updated.overallLengthMm = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "helixAngleDeg":
      updated.helixAngleDeg = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "ballRadiusMm":
      updated.ballRadiusMm = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "taperAngleDeg":
      updated.taperAngleDeg = Number.isNaN(numericFilterValue) ? undefined : numericFilterValue
      break
    case "coolantHole":
      updated.coolantHole = booleanFilterValue
      break
  }

  return updated
}
