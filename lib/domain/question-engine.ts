/**
 * Question Engine — Information-Gain-Based Question Selection
 *
 * Deterministic: analyzes the current candidate pool and selects the
 * next question that maximally reduces uncertainty (highest entropy split).
 *
 * No LLM needed for question selection — only for polishing question text.
 */

import type { RecommendationInput, ScoredProduct } from "@/lib/types/canonical"
import type { NarrowingTurn, AppliedFilter, ResolutionStatus } from "@/lib/types/exploration"

// ── Return type ──────────────────────────────────────────────
export interface NextQuestion {
  field: string
  questionText: string     // Korean
  chips: string[]          // from actual candidate data
  expectedInfoGain: number // 0-1, higher = more useful
}

// ── Resolution check ─────────────────────────────────────────
export function checkResolution(
  candidates: ScoredProduct[],
  history: NarrowingTurn[]
): ResolutionStatus {
  if (candidates.length === 0) return "resolved_none"

  const top = candidates[0]

  // If top match is exact and clearly ahead
  if (top.matchStatus === "exact" && candidates.length <= 3) return "resolved_exact"
  if (top.matchStatus === "exact" && candidates.length > 1) {
    const gap = top.score - candidates[1].score
    if (gap >= 15) return "resolved_exact"
  }

  // If we've asked too many questions
  if (history.length >= 4) {
    if (top.matchStatus === "exact") return "resolved_exact"
    if (top.matchStatus === "approximate") return "resolved_approximate"
    return "resolved_none"
  }

  // 3 or fewer candidates → resolved
  if (candidates.length <= 3) {
    if (top.matchStatus === "exact") return "resolved_exact"
    return "resolved_approximate"
  }

  // Still many candidates
  if (history.length === 0) return "broad"
  return "narrowing"
}

// ── Main: Select next best question ──────────────────────────
export function selectNextQuestion(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  history: NarrowingTurn[]
): NextQuestion | null {
  // Check if we should stop asking
  const status = checkResolution(candidates, history)
  if (status.startsWith("resolved")) return null

  // Collect candidate fields for analysis
  const fields = analyzeFields(input, candidates, history)

  // Sort by information gain (highest first)
  fields.sort((a, b) => b.infoGain - a.infoGain)

  // Return the best question
  const best = fields[0]
  if (!best || best.infoGain < 0.1) return null

  return {
    field: best.field,
    questionText: best.questionText,
    chips: best.chips,
    expectedInfoGain: best.infoGain,
  }
}

// ── Field analysis ───────────────────────────────────────────
interface FieldAnalysis {
  field: string
  questionText: string
  chips: string[]
  infoGain: number
}

function analyzeFields(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  history: NarrowingTurn[]
): FieldAnalysis[] {
  const results: FieldAnalysis[] = []
  const askedFields = new Set(history.flatMap(h => h.extractedFilters.map(f => f.field)))

  // ── Flute count ────────────────────────────────────────────
  if (!input.flutePreference && !askedFields.has("fluteCount")) {
    const fluteCounts = new Map<number, number>()
    for (const c of candidates) {
      if (c.product.fluteCount != null) {
        fluteCounts.set(c.product.fluteCount, (fluteCounts.get(c.product.fluteCount) || 0) + 1)
      }
    }
    if (fluteCounts.size > 1) {
      const gain = computeEntropy(fluteCounts, candidates.length)
      const chips = [...fluteCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => `${k}날`)
      chips.push("상관없음")

      results.push({
        field: "fluteCount",
        questionText: `현재 ${candidates.length}개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?`,
        chips,
        infoGain: gain,
      })
    }
  }

  // ── Coating ────────────────────────────────────────────────
  if (!input.coatingPreference && !askedFields.has("coating")) {
    const coatings = new Map<string, number>()
    for (const c of candidates) {
      const coating = c.product.coating || "미확인"
      coatings.set(coating, (coatings.get(coating) || 0) + 1)
    }
    if (coatings.size > 1) {
      const gain = computeEntropy(coatings, candidates.length)
      const chips = [...coatings.entries()]
        .filter(([k]) => k !== "미확인")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => k)
      chips.push("상관없음")

      results.push({
        field: "coating",
        questionText: `코팅 종류 선호가 있으신가요? 후보 중에 ${[...coatings.keys()].filter(k => k !== "미확인").slice(0, 3).join(", ")} 등이 있습니다.`,
        chips,
        infoGain: gain,
      })
    }
  }

  // ── Series ─────────────────────────────────────────────────
  if (!askedFields.has("seriesName")) {
    const series = new Map<string, number>()
    for (const c of candidates) {
      const s = c.product.seriesName || "미확인"
      series.set(s, (series.get(s) || 0) + 1)
    }
    if (series.size > 1 && series.size <= 8) {
      const gain = computeEntropy(series, candidates.length)
      const chips = [...series.entries()]
        .filter(([k]) => k !== "미확인")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => k)
      if (chips.length > 1) {
        chips.push("상관없음")
        results.push({
          field: "seriesName",
          questionText: `시리즈 선호가 있으신가요? ${chips.slice(0, 3).join(", ")} 등의 시리즈가 있습니다.`,
          chips,
          infoGain: gain * 0.8, // slight penalty — series is less user-friendly
        })
      }
    }
  }

  // ── Tool subtype ───────────────────────────────────────────
  if (!input.toolSubtype && !askedFields.has("toolSubtype")) {
    const subtypes = new Map<string, number>()
    for (const c of candidates) {
      const st = c.product.toolSubtype || "미확인"
      subtypes.set(st, (subtypes.get(st) || 0) + 1)
    }
    if (subtypes.size > 1) {
      const gain = computeEntropy(subtypes, candidates.length)
      const chips = [...subtypes.entries()]
        .filter(([k]) => k !== "미확인")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k]) => k)
      if (chips.length > 1) {
        chips.push("상관없음")
        results.push({
          field: "toolSubtype",
          questionText: `공구 세부 타입이 중요한가요? ${chips.slice(0, 3).join(", ")} 등이 있습니다.`,
          chips,
          infoGain: gain * 0.9,
        })
      }
    }
  }

  // ── Cutting type (from evidence) — useful if we have evidence data ──
  if (!askedFields.has("cuttingType")) {
    // Infer from operation if not already set
    if (!input.operationType) {
      results.push({
        field: "cuttingType",
        questionText: "어떤 종류의 가공을 하실 예정인가요?",
        chips: ["슬롯가공", "측면가공", "프로파일", "황삭", "상관없음"],
        infoGain: 0.4, // moderate gain
      })
    }
  }

  // ── Diameter refinement (if no exact match and many close matches) ──
  if (input.diameterMm && !askedFields.has("diameterRefine")) {
    const uniqueDiameters = new Set(
      candidates.map(c => c.product.diameterMm).filter((d): d is number => d !== null)
    )
    if (uniqueDiameters.size > 3) {
      const sortedDiams = [...uniqueDiameters].sort((a, b) => a - b)
      const closestDiams = sortedDiams
        .filter(d => Math.abs(d - input.diameterMm!) <= 2)
        .slice(0, 5)

      if (closestDiams.length > 1) {
        results.push({
          field: "diameterRefine",
          questionText: `직경 ${input.diameterMm}mm 근처에 ${closestDiams.join(", ")}mm가 있습니다. 정확한 직경을 선택해주세요.`,
          chips: closestDiams.map(d => `${d}mm`),
          infoGain: 0.6,
        })
      }
    }
  }

  return results
}

// ── Entropy computation ──────────────────────────────────────
// Higher entropy = more even distribution = asking about this field
// would divide candidates more evenly (higher information gain)
function computeEntropy<T>(
  distribution: Map<T, number>,
  total: number
): number {
  if (total === 0 || distribution.size <= 1) return 0

  let entropy = 0
  for (const count of distribution.values()) {
    if (count === 0) continue
    const p = count / total
    entropy -= p * Math.log2(p)
  }

  // Normalize to 0-1 range
  const maxEntropy = Math.log2(distribution.size)
  return maxEntropy > 0 ? entropy / maxEntropy : 0
}

// ── Build filter from user answer ────────────────────────────
export function parseAnswerToFilter(
  field: string,
  answer: string
): AppliedFilter | null {
  const clean = answer.trim()

  // "상관없음" / "모름" → no filter
  if (["상관없음", "모름", "skip", "상관 없음"].includes(clean.toLowerCase())) {
    return null
  }

  switch (field) {
    case "fluteCount": {
      const match = clean.match(/(\d+)/)
      if (match) {
        return {
          field: "fluteCount",
          op: "eq",
          value: `${match[1]}날`,
          rawValue: parseInt(match[1]),
          appliedAt: 0, // will be set by caller
        }
      }
      break
    }
    case "coating": {
      return {
        field: "coating",
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    }
    case "seriesName": {
      return {
        field: "seriesName",
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    }
    case "toolSubtype": {
      return {
        field: "toolSubtype",
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    }
    case "diameterRefine": {
      const match = clean.match(/([\d.]+)/)
      if (match) {
        return {
          field: "diameterMm",
          op: "eq",
          value: `${match[1]}mm`,
          rawValue: parseFloat(match[1]),
          appliedAt: 0,
        }
      }
      break
    }
    case "cuttingType": {
      const typeMap: Record<string, string> = {
        "슬롯가공": "Slotting",
        "슬롯": "Slotting",
        "측면가공": "Side Cutting",
        "측면": "Side Cutting",
        "프로파일": "Profiling",
        "황삭": "Roughing",
        "정삭": "Finishing",
      }
      const mapped = typeMap[clean] || clean
      return {
        field: "cuttingType",
        op: "eq",
        value: clean,
        rawValue: mapped,
        appliedAt: 0,
      }
    }
  }

  return null
}
