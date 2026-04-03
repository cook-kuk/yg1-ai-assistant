/**
 * Input Normalizer
 * Parses free-form Korean/English text into structured RecommendationInput.
 * Used by the LLM prompt builder and deterministic fallback.
 */

import type { RecommendationInput } from "@/lib/recommendation/domain/types"
import {
  extractDiameter as _extractDiameter,
  extractFluteCount as _extractFluteCount,
  matchMaterial,
  matchOperation,
  COATING_KEYWORDS,
} from "@/lib/recommendation/shared/patterns"

// Re-export for existing consumers
export const extractDiameter = _extractDiameter
export const extractFluteCount = _extractFluteCount
export { matchMaterial as extractMaterial }
export { matchOperation as extractOperation }

// ── Coating extraction ────────────────────────────────────────
export function extractCoating(text: string): string | null {
  const lower = text.toLowerCase()
  const match = COATING_KEYWORDS.find(c => lower.includes(c.toLowerCase()))
  return match ?? null
}

// ── Main normalizer ───────────────────────────────────────────
export function normalizeInput(text: string): RecommendationInput {
  const diameterMm = extractDiameter(text) ?? undefined
  const flutePreference = extractFluteCount(text) ?? undefined
  const material = matchMaterial(text) ?? undefined
  const operationType = matchOperation(text) ?? undefined
  const coatingPreference = extractCoating(text) ?? undefined

  return {
    queryText: text,
    material,
    operationType,
    diameterMm,
    flutePreference,
    coatingPreference,
    manufacturerScope: "yg1-only",
    locale: "ko",
  }
}

/** Merge LLM-extracted fields with normalizer output (LLM wins on explicit fields) */
export function mergeInputs(
  base: RecommendationInput,
  override: Partial<RecommendationInput>
): RecommendationInput {
  return { ...base, ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)) }
}
