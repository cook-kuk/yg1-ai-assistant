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
import { detectMeasurementScopeAmbiguity } from "@/lib/recommendation/shared/measurement-scope-ambiguity"

export const extractFluteCount = _extractFluteCount
export { matchMaterial as extractMaterial }
export { matchOperation as extractOperation }

const EXPLICIT_DIAMETER_CUE_RE = /(?:직경|지름|diameter|파이|dia(?:meter)?|φ|Φ|ø|\bD\d)/iu
const NON_DIAMETER_MEASUREMENT_CUE_RE =
  /(?:전장|전체\s*길이|overall\s*length|\boal\b|절삭\s*길이|날\s*길이|날장|\bloc\b|\bcl\b|length\s*of\s*cut|샹크|생크|싱크|쌩크|shank|헬릭스|helix|테이퍼|taper|포인트\s*각도|point\s*angle|코너\s*r|corner\s*r|corner\s*radius|볼\s*반경|ball\s*radius|피치|thread\s*pitch|\bpitch\b)/iu

// Re-export for existing consumers, but avoid committing bare fieldless length phrases to diameter.
export function extractDiameter(text: string): number | null {
  const clean = text.normalize("NFKC").replace(/\s+/g, " ").trim()
  if (!clean) return null

  const hasExplicitDiameterCue = EXPLICIT_DIAMETER_CUE_RE.test(clean)
  if (!hasExplicitDiameterCue && NON_DIAMETER_MEASUREMENT_CUE_RE.test(clean)) return null
  if (!hasExplicitDiameterCue && detectMeasurementScopeAmbiguity(clean)?.kind === "length") return null

  return _extractDiameter(clean)
}

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
