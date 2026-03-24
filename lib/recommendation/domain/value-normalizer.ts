/**
 * Value Normalizer — Fuzzy-matches user input (Korean/English) against actual candidate data.
 *
 * Instead of hardcoding every Korean→English mapping, this looks at the real values
 * in the current candidate pool and finds the best match.
 *
 * Examples:
 * - "카바이드" → candidates have "Carbide" → match
 * - "고속도강" → candidates have "HSS" → match via alias
 * - "브라이트 피니시" → candidates have "Bright Finish" → match
 * - "DLC" → candidates have "DLC" → exact match
 *
 * Deterministic. No LLM calls.
 */

// ── Known aliases: Korean common names → English DB values ──
// This is a SEED list, not exhaustive. The fuzzy matcher does the heavy lifting.
const KNOWN_ALIASES: Record<string, string[]> = {
  // Tool materials
  "카바이드": ["Carbide", "carbide"],
  "초경": ["Carbide", "carbide"],
  "초경합금": ["Carbide", "carbide"],
  "고속도강": ["HSS", "hss"],
  "하이스": ["HSS", "hss"],
  "서멧": ["Cermet", "cermet"],

  // Coatings
  "무코팅": ["Uncoated", "uncoated", "Bright Finish"],
  "브라이트피니시": ["Bright Finish"],
  "다이아몬드": ["Diamond", "DLC"],

  // Tool subtypes
  "스퀘어": ["Square"],
  "볼": ["Ball"],
  "라디우스": ["Radius"],
  "테이퍼": ["Taper"],
  "황삭": ["Roughing"],
  "정삭": ["Finishing"],
  "고이송": ["High-Feed", "High Feed"],

  // Stock status
  "재고있음": ["instock"],
  "제한적": ["limited"],
  "품절": ["outofstock"],

  // ISO material tags
  "탄소강": ["P"],
  "스테인리스": ["M"],
  "주철": ["K"],
  "알루미늄": ["N"],
  "비철": ["N"],
  "티타늄": ["S"],
  "내열합금": ["S"],
  "고경도강": ["H"],
}

/**
 * Normalize a user-provided value against actual candidate values.
 *
 * Priority:
 * 1. Exact match (case-insensitive)
 * 2. Known alias match
 * 3. Substring/prefix match
 * 4. Original value (if no match found)
 */
export function normalizeFilterValue(
  userValue: string,
  field: string,
  candidateValues: string[]
): { normalized: string; matchType: "exact" | "alias" | "fuzzy" | "none" } {
  const clean = userValue.trim()
  const cleanLower = clean.toLowerCase().replace(/\s+/g, "")

  if (candidateValues.length === 0) {
    return { normalized: clean, matchType: "none" }
  }

  // 1. Exact match (case-insensitive)
  const exactMatch = candidateValues.find(v => v.toLowerCase() === cleanLower)
  if (exactMatch) {
    return { normalized: exactMatch, matchType: "exact" }
  }

  // 2. Known alias match
  const aliasTargets = KNOWN_ALIASES[cleanLower] ?? KNOWN_ALIASES[clean] ?? []
  for (const alias of aliasTargets) {
    const match = candidateValues.find(v =>
      v.toLowerCase() === alias.toLowerCase() ||
      v.toLowerCase().includes(alias.toLowerCase())
    )
    if (match) {
      return { normalized: match, matchType: "alias" }
    }
  }

  // Also check reverse: candidate value as key in alias table
  for (const candidateVal of candidateValues) {
    for (const [korean, englishList] of Object.entries(KNOWN_ALIASES)) {
      if (englishList.some(e => e.toLowerCase() === candidateVal.toLowerCase())) {
        if (cleanLower.includes(korean) || korean.includes(cleanLower)) {
          return { normalized: candidateVal, matchType: "alias" }
        }
      }
    }
  }

  // 3. Substring/prefix match
  const substringMatch = candidateValues.find(v =>
    v.toLowerCase().includes(cleanLower) ||
    cleanLower.includes(v.toLowerCase())
  )
  if (substringMatch) {
    return { normalized: substringMatch, matchType: "fuzzy" }
  }

  // 4. Partial overlap (at least 3 chars in common)
  if (cleanLower.length >= 3) {
    for (const candidateVal of candidateValues) {
      const candLower = candidateVal.toLowerCase()
      // Check if any 3-char substring of user input appears in candidate value
      for (let i = 0; i <= cleanLower.length - 3; i++) {
        const sub = cleanLower.slice(i, i + 3)
        if (candLower.includes(sub)) {
          return { normalized: candidateVal, matchType: "fuzzy" }
        }
      }
    }
  }

  // No match — return original
  return { normalized: clean, matchType: "none" }
}

/**
 * Extract distinct values for a given field from candidates.
 * Works with both ScoredProduct[] and CandidateSnapshot[].
 */
export function extractDistinctFieldValues(
  candidates: Array<Record<string, unknown>>,
  field: string
): string[] {
  const FIELD_GETTERS: Record<string, (p: Record<string, unknown>) => unknown> = {
    coating: p => (p as any).product?.coating ?? (p as any).coating,
    toolMaterial: p => (p as any).product?.toolMaterial ?? (p as any).toolMaterial,
    toolType: p => (p as any).product?.toolType ?? (p as any).toolType,
    toolSubtype: p => (p as any).product?.toolSubtype ?? (p as any).toolSubtype,
    seriesName: p => (p as any).product?.seriesName ?? (p as any).seriesName,
    brand: p => (p as any).product?.brand ?? (p as any).brand,
    country: p => (p as any).product?.country ?? (p as any).country,
    stockStatus: p => (p as any).stockStatus,
  }

  const getter = FIELD_GETTERS[field]
  if (!getter) return []

  const values = new Set<string>()
  for (const c of candidates) {
    const val = getter(c)
    if (val != null && val !== "") values.add(String(val))
  }
  return Array.from(values)
}
