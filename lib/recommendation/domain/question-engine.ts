/**
 * Question Engine — Information-Gain-Based Question Selection
 *
 * Deterministic: analyzes the current candidate pool and selects the
 * next question that maximally reduces uncertainty (highest entropy split).
 *
 * No LLM needed for question selection — only for polishing question text.
 */

import { buildProductLabel } from "@/lib/recommendation/domain/product-label"
import { OPERATION_SHAPE_OPTIONS } from "@/lib/types/intake"

import type {
  AppliedFilter,
  NarrowingTurn,
  RecommendationInput,
  ResolutionStatus,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

export interface NextQuestion {
  field: string
  questionText: string
  chips: string[]
  expectedInfoGain: number
}

export function checkResolution(
  candidates: ScoredProduct[],
  history: NarrowingTurn[],
  candidateCountHint: number = candidates.length
): ResolutionStatus {
  if (candidateCountHint === 0 || candidates.length === 0) return "resolved_none"

  const top = candidates[0]
  if (top.matchStatus === "exact" && candidateCountHint <= 3) return "resolved_exact"
  if (top.matchStatus === "exact" && candidates.length > 1) {
    const gap = top.score - candidates[1].score
    if (gap >= 15) return "resolved_exact"
  }

  if (history.length >= 3) {
    if (top.matchStatus === "exact") return "resolved_exact"
    if (top.matchStatus === "approximate") return "resolved_approximate"
    return "resolved_approximate"
  }

  if (candidateCountHint <= 10) {
    if (top.matchStatus === "exact") return "resolved_exact"
    // Only resolve if top candidate has minimum quality (score >= 30)
    // to avoid showing very poor matches when candidates are few but bad
    if (top.score >= 30) return "resolved_approximate"
    // Low quality + few candidates: keep narrowing if possible
    if (history.length > 0) return "narrowing"
    return "resolved_approximate" // first turn fallback
  }

  if (history.length === 0) return "broad"
  return "narrowing"
}

export function selectNextQuestion(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  history: NarrowingTurn[],
  candidateCountHint: number = candidates.length
): NextQuestion | null {
  const status = checkResolution(candidates, history, candidateCountHint)
  if (status.startsWith("resolved")) return null

  const fields = analyzeFields(input, candidates, history)

  // ── 도메인 우선순위 기반 가중 랜덤 선택 ──
  // 직경 → 날형상 → 날수 → 피삭재 순이 도메인 권장이지만,
  // 매번 같은 순서 대신 가중 랜덤으로 다양성을 부여.
  // 우선순위가 높을수록 선택 확률이 높지만 절대적이지 않음.
  const FIELD_PRIORITY_BOOST: Record<string, number> = {
    toolSubtype: 4.0,      // 날형상 (Square/Radius/Ball): 최우선
    diameterRefine: 3.0,   // 직경 정제
    fluteCount: 2.0,       // 날수
    workPieceName: 1.5,    // 피삭재
    coating: 1.0,          // 코팅 (기본)
    seriesName: 0.8,       // 시리즈
    cuttingType: 0.6,      // 가공방식
  }

  for (const f of fields) {
    const boost = FIELD_PRIORITY_BOOST[f.field] ?? 1.0
    f.infoGain = f.infoGain * boost
  }

  // 최소 infoGain 필터
  const viable = fields.filter(f => f.infoGain >= 0.1)
  if (viable.length === 0) return null

  // 가중 랜덤 선택: infoGain을 가중치로 사용
  const totalWeight = viable.reduce((sum, f) => sum + f.infoGain, 0)
  let random = Math.random() * totalWeight
  let best = viable[0]
  for (const f of viable) {
    random -= f.infoGain
    if (random <= 0) {
      best = f
      break
    }
  }

  const chips = [...best.chips]
  if (history.length > 0) chips.push("⟵ 이전 단계")

  return {
    field: best.field,
    questionText: best.questionText,
    chips,
    expectedInfoGain: best.infoGain,
  }
}

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
  const askedFields = new Set(history.flatMap(turn => turn.extractedFilters.map(filter => filter.field)))

  if (!input.flutePreference && !askedFields.has("fluteCount")) {
    const fluteCounts = new Map<number, number>()
    for (const candidate of candidates) {
      if (candidate.product.fluteCount != null) {
        fluteCounts.set(candidate.product.fluteCount, (fluteCounts.get(candidate.product.fluteCount) || 0) + 1)
      }
    }
    if (fluteCounts.size > 1) {
      const gain = computeEntropy(fluteCounts, candidates.length)
      const chips = [...fluteCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([value, count]) => `${value}날 (${count}개)`)
      chips.push("상관없음")

      results.push({
        field: "fluteCount",
        questionText: `현재 ${candidates.length}개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?`,
        chips,
        infoGain: gain,
      })
    }
  }

  if (!input.coatingPreference && !askedFields.has("coating")) {
    const coatings = new Map<string, number>()
    for (const candidate of candidates) {
      const coating = candidate.product.coating || "미확인"
      coatings.set(coating, (coatings.get(coating) || 0) + 1)
    }
    if (coatings.size > 1) {
      const gain = computeEntropy(coatings, candidates.length)
      const chips = [...coatings.entries()]
        .filter(([value]) => value !== "미확인")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([value, count]) => `${value} (${count}개)`)
      chips.push("상관없음")

      results.push({
        field: "coating",
        questionText: `코팅 종류 선호가 있으신가요? 후보 중에 ${[...coatings.keys()].filter(value => value !== "미확인").slice(0, 3).join(", ")} 등이 있습니다.`,
        chips,
        infoGain: gain,
      })
    }
  }

  if (!askedFields.has("seriesName")) {
    const series = new Map<string, number>()
    const seriesRepProduct = new Map<string, ScoredProduct>()
    for (const candidate of candidates) {
      const seriesName = candidate.product.seriesName || "미확인"
      series.set(seriesName, (series.get(seriesName) || 0) + 1)
      if (!seriesRepProduct.has(seriesName) || candidate.score > (seriesRepProduct.get(seriesName)?.score ?? 0)) {
        seriesRepProduct.set(seriesName, candidate)
      }
    }
    if (series.size > 1 && series.size <= 8) {
      const gain = computeEntropy(series, candidates.length)
      const chips = [...series.entries()]
        .filter(([value]) => value !== "미확인")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([value, count]) => {
          const representative = seriesRepProduct.get(value)
          const label = representative ? buildProductLabel(representative.product) : null
          return label ? `${value} — ${label} (${count}개)` : `${value} (${count}개)`
        })
      if (chips.length > 1) {
        chips.push("상관없음")
        results.push({
          field: "seriesName",
          questionText: `시리즈 선호가 있으신가요? ${chips.slice(0, 3).join(", ")} 등의 시리즈가 있습니다.`,
          chips,
          infoGain: gain,
        })
      }
    }
  }

  if (!input.toolSubtype && !askedFields.has("toolSubtype")) {
    const subtypes = new Map<string, number>()
    for (const candidate of candidates) {
      const subtype = candidate.product.toolSubtype || "미확인"
      subtypes.set(subtype, (subtypes.get(subtype) || 0) + 1)
    }
    if (subtypes.size > 1) {
      const gain = computeEntropy(subtypes, candidates.length)
      const chips = [...subtypes.entries()]
        .filter(([value]) => value !== "미확인")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([value, count]) => `${value} (${count}개)`)
      if (chips.length > 1) {
        chips.push("상관없음")
        results.push({
          field: "toolSubtype",
          questionText: `날 형상을 선택해주세요. ${chips.slice(0, 3).join(", ")} 등이 있습니다.`,
          chips,
          infoGain: gain,
        })
      }
    }
  }

  if (!askedFields.has("cuttingType")) {
    if (!input.operationType) {
      results.push({
        field: "cuttingType",
        questionText: "어떤 종류의 가공을 하실 예정인가요?",
        chips: [...OPERATION_SHAPE_OPTIONS.map(option => option.value), "상관없음"],
        infoGain: 0.4,
      })
    }
  }

  if (input.diameterMm && !askedFields.has("diameterRefine")) {
    const uniqueDiameters = new Set(
      candidates.map(candidate => candidate.product.diameterMm).filter((diameter): diameter is number => diameter !== null)
    )
    if (uniqueDiameters.size > 3) {
      const sortedDiameters = [...uniqueDiameters].sort((a, b) => a - b)
      const closestDiameters = sortedDiameters
        .filter(diameter => Math.abs(diameter - input.diameterMm!) <= 2)
        .slice(0, 5)

      if (closestDiameters.length > 1) {
        results.push({
          field: "diameterRefine",
          questionText: `직경 ${input.diameterMm}mm 근처에 ${closestDiameters.join(", ")}mm가 있습니다. 정확한 직경을 선택해주세요.`,
          chips: closestDiameters.map(diameter => `${diameter}mm`),
          infoGain: 0.6,
        })
      }
    }
  }

  // workPieceName (세부 피삭재) — 도메인 우선순위 가중치로 순서 제어
  if (!input.workPieceName && !askedFields.has("workPieceName") && input.material) {
    results.push({
      field: "workPieceName",
      questionText: "세부 피삭재를 선택해주세요.",
      chips: ["상관없음"],
      infoGain: 0.5,  // FIELD_PRIORITY_BOOST에서 1.5× → 실효 0.75
    })
  }

  return results
}

function computeEntropy<T>(
  distribution: Map<T, number>,
  total: number
): number {
  if (total === 0 || distribution.size <= 1) return 0

  let entropy = 0
  for (const count of distribution.values()) {
    if (count === 0) continue
    const probability = count / total
    entropy -= probability * Math.log2(probability)
  }

  const maxEntropy = Math.log2(distribution.size)
  return maxEntropy > 0 ? entropy / maxEntropy : 0
}

export function parseAnswerToFilter(
  field: string,
  answer: string
): AppliedFilter | null {
  const clean = answer.trim().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()

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
          appliedAt: 0,
        }
      }
      break
    }
    case "coating":
      return {
        field: "coating",
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    case "seriesName":
      return {
        field: "seriesName",
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    case "toolSubtype":
      return {
        field: "toolSubtype",
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
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
      return {
        field: "cuttingType",
        op: "eq",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    }
    case "material":
      return {
        field: "material",
        op: "eq",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    // ── Extended numeric fields ──
    case "lengthOfCutMm":
    case "overallLengthMm":
    case "shankDiameterMm":
    case "helixAngleDeg":
    case "ballRadiusMm":
    case "taperAngleDeg": {
      const match = clean.match(/([\d.]+)/)
      if (match) {
        const numVal = parseFloat(match[1])
        const unitMap: Record<string, string> = {
          lengthOfCutMm: "mm", overallLengthMm: "mm", shankDiameterMm: "mm",
          helixAngleDeg: "°", ballRadiusMm: "mm", taperAngleDeg: "°",
        }
        return {
          field,
          op: "eq",
          value: `${numVal}${unitMap[field] ?? ""}`,
          rawValue: numVal,
          appliedAt: 0,
        }
      }
      break
    }
    // ── Extended string fields ──
    case "toolMaterial":
    case "toolType":
    case "brand":
    case "country":
    case "workPieceName":
      return {
        field,
        op: "includes",
        value: clean,
        rawValue: clean,
        appliedAt: 0,
      }
    case "coolantHole":
      return {
        field,
        op: "eq",
        value: /있|yes|true|유/i.test(clean) ? "true" : "false",
        rawValue: /있|yes|true|유/i.test(clean) ? "true" : "false",
        appliedAt: 0,
      }
  }

  return null
}
