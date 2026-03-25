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

const QUESTION_FIELD_LABELS: Record<string, string> = {
  fluteCount: "날 수",
  coating: "코팅",
  seriesName: "시리즈",
  toolSubtype: "공구 세부 타입",
  cuttingType: "가공 종류",
  diameterRefine: "직경",
  workPieceName: "세부 피삭재",
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
    return "resolved_approximate"
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
  fields.sort((a, b) => b.infoGain - a.infoGain)

  const best = fields[0]
  if (!best || best.infoGain < 0.1) return null

  const chips = [...best.chips]
  if (history.length > 0) chips.push("⟵ 이전 단계")

  return {
    field: best.field,
    questionText: best.questionText,
    chips,
    expectedInfoGain: best.infoGain,
  }
}

export function selectQuestionForField(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  history: NarrowingTurn[],
  field: string,
  candidateCountHint: number = candidates.length
): NextQuestion | null {
  const status = checkResolution(candidates, history, candidateCountHint)
  if (status.startsWith("resolved")) return null

  const matched = analyzeFieldDirect(input, candidates, field)
  if (!matched) return null

  const chips = [...matched.chips]
  if (history.length > 0) chips.push("⟵ 이전 단계")

  return {
    field: matched.field,
    questionText: matched.questionText,
    chips,
    expectedInfoGain: matched.infoGain,
  }
}

export function explainQuestionFieldReplayFailure(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  field: string
): string | null {
  const label = QUESTION_FIELD_LABELS[field] ?? field

  switch (field) {
    case "toolSubtype": {
      if (input.toolSubtype) return `${label}은 이미 조건에 반영되어 있어 같은 질문을 이어갈 필요가 없습니다.`
      const values = new Set(
        candidates.map(candidate => candidate.product.toolSubtype).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      )
      if (values.size === 0) return `현재 후보에서는 ${label} 정보가 충분히 구분되지 않아 같은 질문으로 후보를 더 나누기 어렵습니다.`
      if (values.size === 1) return `현재 후보에서는 ${label}이 모두 ${[...values][0]}로 좁혀져 같은 질문으로 후보를 더 나누기 어렵습니다.`
      return null
    }
    case "coating": {
      if (input.coatingPreference) return `${label}은 이미 조건에 반영되어 있어 같은 질문을 이어갈 필요가 없습니다.`
      const values = new Set(
        candidates
          .map(candidate => candidate.product.coating)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value !== "미확인")
      )
      if (values.size === 0) return `현재 후보에서는 ${label} 정보가 충분히 구분되지 않아 같은 질문으로 후보를 더 나누기 어렵습니다.`
      if (values.size === 1) return `현재 후보에서는 ${label}이 모두 ${[...values][0]}로 좁혀져 같은 질문으로 후보를 더 나누기 어렵습니다.`
      return null
    }
    case "seriesName": {
      const values = new Set(
        candidates
          .map(candidate => candidate.product.seriesName)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value !== "미확인")
      )
      if (values.size <= 1) return `현재 후보에서는 ${label}가 하나로 좁혀져 같은 질문으로 후보를 더 나누기 어렵습니다.`
      if (values.size > 8) return `현재 후보에서는 ${label} 종류가 너무 넓게 퍼져 있어 다른 조건부터 묻는 편이 더 적절합니다.`
      return null
    }
    case "fluteCount": {
      if (input.flutePreference) return `${label}는 이미 조건에 반영되어 있어 같은 질문을 이어갈 필요가 없습니다.`
      const values = new Set(
        candidates.map(candidate => candidate.product.fluteCount).filter((value): value is number => typeof value === "number")
      )
      if (values.size <= 1) return `현재 후보에서는 ${label}가 하나로 좁혀져 같은 질문으로 후보를 더 나누기 어렵습니다.`
      return null
    }
    case "diameterRefine": {
      if (!input.diameterMm) return `${label} 기준이 아직 없어서 같은 질문을 이어갈 수 없습니다.`
      const values = new Set(
        candidates.map(candidate => candidate.product.diameterMm).filter((value): value is number => typeof value === "number")
      )
      if (values.size <= 3) return `현재 후보에서는 ${label} 선택지가 충분히 갈리지 않아 같은 질문으로 후보를 더 나누기 어렵습니다.`
      return null
    }
    case "cuttingType":
      return input.operationType
        ? `${label}는 이미 조건에 반영되어 있어 같은 질문을 이어갈 필요가 없습니다.`
        : null
    case "workPieceName":
      return input.workPieceName
        ? `${label}는 이미 조건에 반영되어 있어 같은 질문을 이어갈 필요가 없습니다.`
        : null
    default:
      return `현재 후보에서는 ${label} 기준으로 더 이상 후보를 나누기 어려워 다른 질문으로 이어갑니다.`
  }
}

interface FieldAnalysis {
  field: string
  questionText: string
  chips: string[]
  infoGain: number
}

function buildFluteQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (input.flutePreference) return null

  const fluteCounts = new Map<number, number>()
  for (const candidate of candidates) {
    if (candidate.product.fluteCount != null) {
      fluteCounts.set(candidate.product.fluteCount, (fluteCounts.get(candidate.product.fluteCount) || 0) + 1)
    }
  }
  if (fluteCounts.size <= 1) return null

  const gain = computeEntropy(fluteCounts, candidates.length)
  const chips = [...fluteCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([value, count]) => `${value}날 (${count}개)`)
  chips.push("상관없음")

  return {
    field: "fluteCount",
    questionText: `현재 ${candidates.length}개 후보가 있습니다. 날 수(flute) 선호가 있으신가요?`,
    chips,
    infoGain: gain,
  }
}

function buildCoatingQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (input.coatingPreference) return null

  const coatings = new Map<string, number>()
  for (const candidate of candidates) {
    const coating = candidate.product.coating || "미확인"
    coatings.set(coating, (coatings.get(coating) || 0) + 1)
  }
  if (coatings.size <= 1) return null

  const gain = computeEntropy(coatings, candidates.length)
  const chips = [...coatings.entries()]
    .filter(([value]) => value !== "미확인")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([value, count]) => `${value} (${count}개)`)
  chips.push("상관없음")

  return {
    field: "coating",
    questionText: `코팅 종류 선호가 있으신가요? 후보 중에 ${[...coatings.keys()].filter(value => value !== "미확인").slice(0, 3).join(", ")} 등이 있습니다.`,
    chips,
    infoGain: gain,
  }
}

function buildSeriesQuestion(candidates: ScoredProduct[]): FieldAnalysis | null {
  const series = new Map<string, number>()
  const seriesRepProduct = new Map<string, ScoredProduct>()
  for (const candidate of candidates) {
    const seriesName = candidate.product.seriesName || "미확인"
    series.set(seriesName, (series.get(seriesName) || 0) + 1)
    if (!seriesRepProduct.has(seriesName) || candidate.score > (seriesRepProduct.get(seriesName)?.score ?? 0)) {
      seriesRepProduct.set(seriesName, candidate)
    }
  }
  if (series.size <= 1 || series.size > 8) return null

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
  if (chips.length <= 1) return null

  chips.push("상관없음")
  return {
    field: "seriesName",
    questionText: `시리즈 선호가 있으신가요? ${chips.slice(0, 3).join(", ")} 등의 시리즈가 있습니다.`,
    chips,
    infoGain: gain * 0.8,
  }
}

function buildToolSubtypeQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (input.toolSubtype) return null

  const subtypes = new Map<string, number>()
  for (const candidate of candidates) {
    const subtype = candidate.product.toolSubtype || "미확인"
    subtypes.set(subtype, (subtypes.get(subtype) || 0) + 1)
  }
  if (subtypes.size <= 1) return null

  const gain = computeEntropy(subtypes, candidates.length)
  const chips = [...subtypes.entries()]
    .filter(([value]) => value !== "미확인")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([value, count]) => `${value} (${count}개)`)
  if (chips.length <= 1) return null

  chips.push("상관없음")
  return {
    field: "toolSubtype",
    questionText: `공구 세부 타입이 중요한가요? ${chips.slice(0, 3).join(", ")} 등이 있습니다.`,
    chips,
    infoGain: gain * 0.9,
  }
}

function buildCuttingTypeQuestion(input: RecommendationInput): FieldAnalysis | null {
  if (input.operationType) return null

  return {
    field: "cuttingType",
    questionText: "어떤 종류의 가공을 하실 예정인가요?",
    chips: [...OPERATION_SHAPE_OPTIONS.map(option => option.value), "상관없음"],
    infoGain: 0.4,
  }
}

function buildDiameterRefineQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (!input.diameterMm) return null

  const uniqueDiameters = new Set(
    candidates.map(candidate => candidate.product.diameterMm).filter((diameter): diameter is number => diameter !== null)
  )
  if (uniqueDiameters.size <= 3) return null

  const sortedDiameters = [...uniqueDiameters].sort((a, b) => a - b)
  const closestDiameters = sortedDiameters
    .filter(diameter => Math.abs(diameter - input.diameterMm!) <= 2)
    .slice(0, 5)

  if (closestDiameters.length <= 1) return null

  return {
    field: "diameterRefine",
    questionText: `직경 ${input.diameterMm}mm 근처에 ${closestDiameters.join(", ")}mm가 있습니다. 정확한 직경을 선택해주세요.`,
    chips: closestDiameters.map(diameter => `${diameter}mm`),
    infoGain: 0.6,
  }
}

function analyzeFieldDirect(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  field: string
): FieldAnalysis | null {
  switch (field) {
    case "fluteCount":
      return buildFluteQuestion(input, candidates)
    case "coating":
      return buildCoatingQuestion(input, candidates)
    case "seriesName":
      return buildSeriesQuestion(candidates)
    case "toolSubtype":
      return buildToolSubtypeQuestion(input, candidates)
    case "cuttingType":
      return buildCuttingTypeQuestion(input)
    case "diameterRefine":
      return buildDiameterRefineQuestion(input, candidates)
    default:
      return null
  }
}

function analyzeFields(
  input: RecommendationInput,
  candidates: ScoredProduct[],
  history: NarrowingTurn[]
): FieldAnalysis[] {
  const results: FieldAnalysis[] = []
  const askedFields = new Set(history.flatMap(turn => turn.extractedFilters.map(filter => filter.field)))

  if (!askedFields.has("fluteCount")) {
    const question = buildFluteQuestion(input, candidates)
    if (question) results.push(question)
  }

  if (!askedFields.has("coating")) {
    const question = buildCoatingQuestion(input, candidates)
    if (question) results.push(question)
  }

  if (!askedFields.has("seriesName")) {
    const question = buildSeriesQuestion(candidates)
    if (question) results.push(question)
  }

  if (!askedFields.has("toolSubtype")) {
    const question = buildToolSubtypeQuestion(input, candidates)
    if (question) results.push(question)
  }

  if (!askedFields.has("cuttingType")) {
    const question = buildCuttingTypeQuestion(input)
    if (question) results.push(question)
  }

  if (input.diameterMm && !askedFields.has("diameterRefine")) {
    const question = buildDiameterRefineQuestion(input, candidates)
    if (question) results.push(question)
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
