/**
 * Parameter Extraction Agent — Haiku
 *
 * Extracts structured parameters from user messages.
 * Haiku LLM first, deterministic extraction as a guarded fallback.
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { ExtractedParameters } from "./types"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"

const PARAMETER_EXTRACTOR_MODEL = resolveModel("haiku", "parameter-extractor")

/**
 * Extract parameters from user message.
 * Uses Haiku first, then supplements missing/invalid fields with deterministic fallback.
 */
export async function extractParameters(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<ExtractedParameters> {
  const clean = message.trim().toLowerCase()
  const deterministic = extractDeterministicParameters(clean)

  let llmValidated: Partial<ExtractedParameters> = {}
  if (provider.available() && clean.length > 2) {
    try {
      const haikuResult = await extractWithHaiku(message, sessionState, provider)
      llmValidated = validateExtractedParameters(haikuResult)
    } catch (e) {
      console.warn("[param-extractor] Haiku extraction failed:", e)
    }
  }

  const merged: ExtractedParameters = {
    ...deterministic,
    ...llmValidated,
    comparisonTargets: llmValidated.comparisonTargets ?? deterministic.comparisonTargets,
    rawValue: llmValidated.rawValue ?? deterministic.rawValue,
    modelUsed: PARAMETER_EXTRACTOR_MODEL,
  }

  return merged
}

async function extractWithHaiku(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<Partial<ExtractedParameters>> {
  const lastField = sessionState?.lastAskedField ?? "unknown"

  const systemPrompt = `You extract cutting tool parameters from Korean user messages.
The system just asked about field: "${lastField}".
Extract any relevant values. Respond with JSON only.
  {"fluteCount": null, "coating": null, "toolSubtype": null, "seriesName": null, "diameterMm": null, "material": null, "operationType": null, "productCode": null, "rawValue": "the cleaned value"}

If the user requests multiple values for the same field, return an array.
Examples:
- "4날 또는 5날" -> "fluteCount": [4, 5]
- "TiAlN이나 AlTiN" -> "coating": ["TiAlN", "AlTiN"]`

  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: message }],
    1500,
    PARAMETER_EXTRACTOR_MODEL,
    "parameter-extractor"
  )

  try {
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))
    const result: Partial<ExtractedParameters> = {}
    if (parsed.fluteCount != null) result.fluteCount = parsed.fluteCount
    if (parsed.coating) result.coating = parsed.coating
    if (parsed.toolSubtype) result.toolSubtype = parsed.toolSubtype
    if (parsed.seriesName) result.seriesName = parsed.seriesName
    if (parsed.diameterMm != null) result.diameterMm = parsed.diameterMm
    if (parsed.material) result.material = parsed.material
    if (parsed.operationType) result.operationType = parsed.operationType
    if (parsed.productCode) result.productCode = parsed.productCode
    if (parsed.rawValue) result.rawValue = parsed.rawValue
    return result
  } catch {
    return {}
  }
}

function extractDeterministicParameters(clean: string): Partial<ExtractedParameters> {
  const params: Partial<ExtractedParameters> = {}

  // "(15개)" chip count suffix removal, "— label" removal
  const chipClean = clean.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()

  const fluteMatch = clean.match(/(\d+)\s*날/)
  if (fluteMatch) params.fluteCount = parseInt(fluteMatch[1])

  const diamMatch = clean.match(/([\d.]+)\s*mm/)
  if (diamMatch) params.diameterMm = parseFloat(diamMatch[1])

  const coatingMap: Record<string, string> = {
    "altin": "AlTiN", "tialn": "TiAlN", "dlc": "DLC",
    "무코팅": "Uncoated", "y-코팅": "Y-Coating", "y코팅": "Y-Coating", "ticn": "TiCN",
  }
  for (const [key, val] of Object.entries(coatingMap)) {
    if (clean.includes(key)) { params.coating = val; break }
  }

  const subtypeMap: Record<string, string> = {
    "square": "Square", "스퀘어": "Square",
    "ball": "Ball", "볼": "Ball",
    "radius": "Radius", "라디우스": "Radius",
    "하이피드": "High-Feed", "high-feed": "High-Feed", "high feed": "High-Feed",
    "황삭": "Roughing", "roughing": "Roughing",
    "테이퍼": "Taper", "taper": "Taper",
  }
  for (const [key, val] of Object.entries(subtypeMap)) {
    if (chipClean.includes(key) || clean.includes(key)) { params.toolSubtype = val; break }
  }

  const seriesMatch = clean.match(/(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+|e\d+[a-z]\d+)/i)
  if (seriesMatch) params.seriesName = seriesMatch[1].toUpperCase()

  const productCodeMatch = clean.match(/^([a-z]{2,4}\d{4,}[a-z]*\d*)/i)
  if (productCodeMatch) params.productCode = productCodeMatch[1].toUpperCase()

  const compareTargets: string[] = []
  const numMatches = clean.matchAll(/(\d+)\s*번/g)
  for (const m of numMatches) compareTargets.push(`${m[1]}번`)
  if (compareTargets.length > 0) params.comparisonTargets = compareTargets

  params.rawValue = chipClean
  return params
}

function validateExtractedParameters(params: Partial<ExtractedParameters>): Partial<ExtractedParameters> {
  const result: Partial<ExtractedParameters> = {}

  if (params.fluteCount != null) {
    const filter = buildAppliedFilterFromValue("fluteCount", params.fluteCount, 0)
    if (filter) result.fluteCount = filter.rawValue as number | number[]
  }

  if (params.diameterMm != null) {
    const filter = buildAppliedFilterFromValue("diameterMm", params.diameterMm, 0)
    if (filter) result.diameterMm = filter.rawValue as number | number[]
  }

  if (params.coating) {
    const filter = buildAppliedFilterFromValue("coating", params.coating, 0)
    if (filter) result.coating = filter.rawValue as string | string[]
  }

  if (params.toolSubtype) {
    const filter = buildAppliedFilterFromValue("toolSubtype", params.toolSubtype, 0)
    if (filter) result.toolSubtype = filter.rawValue as string | string[]
  }

  if (params.seriesName) {
    const filter = buildAppliedFilterFromValue("seriesName", params.seriesName, 0)
    if (filter) result.seriesName = filter.rawValue as string | string[]
  }

  if (params.operationType) {
    const filter = buildAppliedFilterFromValue("cuttingType", params.operationType, 0)
    if (filter) result.operationType = filter.rawValue as string | string[]
  }

  if (params.material) {
    if (Array.isArray(params.material)) {
      const materials = params.material.map(value => String(value).trim()).filter(Boolean)
      if (materials.length > 0) result.material = materials
    } else if (params.material.trim()) {
      result.material = params.material.trim()
    }
  }

  if (params.productCode && /^[a-z0-9-]{3,}$/i.test(params.productCode.trim())) {
    result.productCode = params.productCode.trim().toUpperCase()
  }

  if (Array.isArray(params.comparisonTargets)) {
    const validTargets = params.comparisonTargets
      .filter(target => typeof target === "string" && /\d+\s*번/.test(target))
      .map(target => target.replace(/\s+/g, ""))
    if (validTargets.length > 0) result.comparisonTargets = validTargets
  }

  if (params.rawValue && params.rawValue.trim()) {
    result.rawValue = params.rawValue.trim()
  }

  return result
}
