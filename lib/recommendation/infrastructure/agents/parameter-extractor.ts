/**
 * Parameter Extraction Agent - Haiku
 *
 * Extracts structured parameters from user messages.
 * Haiku LLM first, deterministic extraction as a guarded fallback.
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { ExtractedParameters } from "./types"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import {
  COATING_ALIAS_MAP,
  MATERIAL_ALIAS_MAP,
  TOOL_SUBTYPE_ALIAS_MAP,
  normalizeCompactText,
} from "@/lib/recommendation/shared/canonical-values"
import {
  canonicalizeKnownEntityValue,
  findKnownEntityMentions,
} from "@/lib/recommendation/shared/entity-registry"
import { isGroundedCategoricalValue } from "@/lib/recommendation/core/deterministic-scr"

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
      llmValidated = validateExtractedParameters(haikuResult, message)
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

  const diamMatch = clean.match(/([\d.]+)\s*(?:mm|미리|밀리|파이)/)
  if (diamMatch) params.diameterMm = parseFloat(diamMatch[1])

  // Fractional inch -> mm: "3/8\"", "3/8"", "1/2 inch", "1-1/2\""
  if (params.diameterMm == null) {
    const fractionMatch = clean.match(/(\d+)\s*\/\s*(\d+)\s*(?:\"|''|inch|in|인치)/)
    if (fractionMatch) {
      const num = parseInt(fractionMatch[1], 10)
      const den = parseInt(fractionMatch[2], 10)
      if (den !== 0) params.diameterMm = Math.round(num / den * 25.4 * 10000) / 10000
    }
    // Mixed number: "1-1/2""
    if (params.diameterMm == null) {
      const mixedMatch = clean.match(/(\d+)[\s-]+(\d+)\s*\/\s*(\d+)\s*(?:\"|''|inch|in|인치)/)
      if (mixedMatch) {
        const whole = parseInt(mixedMatch[1], 10)
        const num = parseInt(mixedMatch[2], 10)
        const den = parseInt(mixedMatch[3], 10)
        if (den !== 0) params.diameterMm = Math.round((whole + num / den) * 25.4 * 10000) / 10000
      }
    }
  }

  const seriesMatch = clean.match(/(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+|e\d+[a-z]\d+)/i)
  if (seriesMatch) params.seriesName = seriesMatch[1].toUpperCase()

  const normalizedClean = normalizeCompactText(clean)
  const normalizedChipClean = normalizeCompactText(chipClean)

  for (const [key, val] of Object.entries(COATING_ALIAS_MAP)) {
    if (normalizedClean.includes(normalizeCompactText(key))) {
      params.coating = val
      break
    }
  }

  for (const [key, val] of Object.entries(TOOL_SUBTYPE_ALIAS_MAP)) {
    const alias = normalizeCompactText(key)
    if (normalizedChipClean.includes(alias) || normalizedClean.includes(alias)) {
      params.toolSubtype = val
      break
    }
  }

  for (const [key, val] of Object.entries(MATERIAL_ALIAS_MAP)) {
    if (normalizedClean.includes(normalizeCompactText(key))) {
      params.material = val
      break
    }
  }

  const knownSeries = findKnownEntityMentions("series", clean)
  if (knownSeries.length > 0) {
    params.seriesName = knownSeries[0]
  }

  const productCodeMatch = clean.match(/^([a-z]{2,4}\d{4,}[a-z]*\d*)/i)
  if (productCodeMatch) params.productCode = productCodeMatch[1].toUpperCase()

  const compareTargets: string[] = []
  const numMatches = clean.matchAll(/(\d+)\s*번/g)
  for (const m of numMatches) compareTargets.push(`${m[1]}번`)
  if (compareTargets.length > 0) params.comparisonTargets = compareTargets

  params.rawValue = chipClean
  return params
}

function validateExtractedParameters(
  params: Partial<ExtractedParameters>,
  userMessage: string = "",
): Partial<ExtractedParameters> {
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
    const canonicalSeries = Array.isArray(params.seriesName)
      ? params.seriesName
          .map(value => canonicalizeKnownEntityValue("series", String(value)))
          .filter((value): value is string => Boolean(value))
      : canonicalizeKnownEntityValue("series", params.seriesName)
    const filter = buildAppliedFilterFromValue("seriesName", canonicalSeries ?? params.seriesName, 0)
    if (filter) result.seriesName = filter.rawValue as string | string[]
  }

  if (params.operationType) {
    const filter = buildAppliedFilterFromValue("cuttingType", params.operationType, 0)
    if (filter) result.operationType = filter.rawValue as string | string[]
  }

  if (params.material) {
    // Phantom guard: LLM output must be grounded in the user message (bounded
    // mention OR known alias). Prevents industry-to-material hallucination —
    // e.g. "aerospace" / "에어로스페이스" must NOT silently become "Titanium".
    const isGrounded = (canonical: string) =>
      !userMessage || isGroundedCategoricalValue("material", canonical, userMessage)

    if (Array.isArray(params.material)) {
      const materials = params.material
        .map(value => {
          const trimmed = String(value).trim()
          if (!trimmed) return null
          for (const [key, canonical] of Object.entries(MATERIAL_ALIAS_MAP)) {
            if (normalizeCompactText(trimmed).includes(normalizeCompactText(key))) {
              return canonical
            }
          }
          return trimmed
        })
        .filter((value): value is string => Boolean(value) && isGrounded(value as string))
      if (materials.length > 0) result.material = materials
    } else if (params.material.trim()) {
      const trimmed = params.material.trim()
      let canonicalMaterial = trimmed
      for (const [key, canonical] of Object.entries(MATERIAL_ALIAS_MAP)) {
        if (normalizeCompactText(trimmed).includes(normalizeCompactText(key))) {
          canonicalMaterial = canonical
          break
        }
      }
      if (isGrounded(canonicalMaterial)) result.material = canonicalMaterial
      else console.warn(`[param-extractor] phantom material dropped: "${canonicalMaterial}" not grounded in "${userMessage.slice(0, 80)}"`)
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
