/**
 * Input Normalizer
 * Parses free-form Korean/English text into structured RecommendationInput.
 * Used by the LLM prompt builder and deterministic fallback.
 */

import type { RecommendationInput } from "@/lib/recommendation/domain/types"

// ── Diameter extraction ───────────────────────────────────────
const DIAMETER_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*mm/i,
  /(\d+(?:\.\d+)?)\s*파이/,
  /(\d+(?:\.\d+)?)\s*φ/,
  /(\d+(?:\.\d+)?)\s*직경/,
  /직경\s*(\d+(?:\.\d+)?)/,
  /파이\s*(\d+(?:\.\d+)?)/,
  /φ\s*(\d+(?:\.\d+)?)/,
  /D(\d+(?:\.\d+)?)/i,
  // Korean number + 파이 pattern
  /([0-9]+(?:\.[0-9]+)?)\s*[Pp]/,
]

export function extractDiameter(text: string): number | null {
  for (const pattern of DIAMETER_PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      const val = parseFloat(m[1])
      if (!isNaN(val) && val > 0 && val < 200) return val
    }
  }
  return null
}

// ── Flute count extraction ────────────────────────────────────
const FLUTE_PATTERNS = [
  /(\d+)\s*날/,
  /(\d+)\s*flute/i,
  /(\d+)F\b/i,
  /(\d+)\s*fl\b/i,
]

export function extractFluteCount(text: string): number | null {
  for (const pattern of FLUTE_PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      const val = parseInt(m[1], 10)
      if (!isNaN(val) && val >= 2 && val <= 12) return val
    }
  }
  return null
}

// ── Material extraction ───────────────────────────────────────
const MATERIAL_KEYWORDS: Record<string, string[]> = {
  "알루미늄": ["알루미늄", "알루", "aluminum", "aluminium", "AL", "alu"],
  "스테인리스": ["스테인리스", "스테인레스", "스텐", "STS", "sus", "stainless"],
  "주철": ["주철", "cast iron", "GC", "FC"],
  "탄소강": ["탄소강", "일반강", "합금강", "구조강", "carbon", "S45C"],
  "티타늄": ["티타늄", "티타", "titanium", "Ti"],
  "인코넬": ["인코넬", "inconel", "내열합금"],
  "고경도강": ["고경도", "경화강", "hardened", "HRC", "담금질", "die steel"],
  "구리": ["구리", "동", "황동", "copper", "brass"],
  "그라파이트": ["그라파이트", "graphite"],
  "CFRP": ["CFRP", "탄소섬유"],
}

export function extractMaterial(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [mat, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k.toLowerCase()))) return mat
  }
  return null
}

// ── Operation type extraction ─────────────────────────────────
const OPERATION_KEYWORDS: Record<string, string[]> = {
  "황삭": ["황삭", "roughing", "rough", "헤비컷"],
  "정삭": ["정삭", "finishing", "finish", "마무리", "fine"],
  "중삭": ["중삭", "semi", "반정삭"],
  "고이송": ["고이송", "high feed", "highfeed", "hfm", "빠른이송"],
  "슬롯": ["슬롯", "slot", "홈가공", "홈"],
  "측면": ["측면", "side milling", "윤곽", "contour"],
}

export function extractOperation(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [op, keywords] of Object.entries(OPERATION_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k.toLowerCase()))) return op
  }
  return null
}

// ── Coating extraction ────────────────────────────────────────
export function extractCoating(text: string): string | null {
  const coatings = ["TiAlN", "AlCrN", "DLC", "nACo", "TiN", "AlTiN", "CrN", "uncoated"]
  const lower = text.toLowerCase()
  const match = coatings.find(c => lower.includes(c.toLowerCase()))
  return match ?? null
}

// ── Main normalizer ───────────────────────────────────────────
export function normalizeInput(text: string): RecommendationInput {
  const diameterMm = extractDiameter(text) ?? undefined
  const flutePreference = extractFluteCount(text) ?? undefined
  const material = extractMaterial(text) ?? undefined
  const operationType = extractOperation(text) ?? undefined
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
