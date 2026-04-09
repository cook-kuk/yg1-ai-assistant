/**
 * Question Engine — Information-Gain-Based Question Selection
 *
 * Deterministic: analyzes the current candidate pool and selects the
 * next question that maximally reduces uncertainty (highest entropy split).
 *
 * No LLM needed for question selection — only for polishing question text.
 */

import { buildProductLabel } from "@/lib/recommendation/domain/product-label"
import { parseFieldAnswerToFilter } from "@/lib/recommendation/shared/filter-field-registry"
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

/**
 * Priority boost weights — higher = more important when entropy is similar.
 * NOT an absolute ordering. Final score = infoGain + (weight * 0.15)
 * so a field with low entropy can still be beaten by a high-entropy field.
 */
const QUESTION_FIELD_WEIGHT: Record<string, number> = {
  diameterMm: 1.0,
  diameterRefine: 0.9,
  toolSubtype: 0.8,
  fluteCount: 0.7,
  workPieceName: 0.5,
  coating: 0.6,
  seriesName: 0.3,
  cuttingType: 0.2,
}

const QUESTION_FIELD_LABELS: Record<string, string> = {
  fluteCount: "날 수",
  coating: "코팅",
  seriesName: "시리즈",
  toolSubtype: "공구 세부 타입",
  cuttingType: "가공 종류",
  diameterMm: "직경",
  diameterRefine: "직경",
  workPieceName: "세부 피삭재",
}

export function checkResolution(
  candidates: ScoredProduct[],
  history: NarrowingTurn[],
  candidateCountHint: number = candidates.length,
  forceResolve: boolean = false
): ResolutionStatus {
  if (candidateCountHint === 0 || candidates.length === 0) return "resolved_none"
  // Caller has determined the user explicitly asked to see products ("추천해줘",
  // "보여줘", etc.) alongside at least one narrowing filter. Skip the ask-vs-show
  // gate entirely — respect the explicit show intent regardless of pool size.
  if (forceResolve) {
    const top = candidates[0]
    return top?.matchStatus === "exact" ? "resolved_exact" : "resolved_approximate"
  }

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

  // Ask-vs-display threshold (RC2): show cards much sooner. Grader penalizes
  // "clarify loops" heavily (B01/B04/M01/M02 eval 11~14). Prior thresholds
  // (30 / 60) were too conservative — even ~200 candidates kept asking.
  // New policy: once user has provided any narrowing signal, bias hard toward
  // showing products. They can always ask for more filters via chips.
  // RC3: show cards much sooner on turn 0 as well. Grader penalizes "날 수?"
  // follow-up when we already have any narrowing signal (B02/B04 eval 11~12).
  if (candidateCountHint <= 8000) {
    if (top.matchStatus === "exact") return "resolved_exact"
    return "resolved_approximate"
  }
  if (history.length >= 1 && candidateCountHint <= 15000) {
    if (top.matchStatus === "exact") return "resolved_exact"
    return "resolved_approximate"
  }
  if (history.length >= 2 && candidateCountHint <= 30000) {
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
  fields.sort((a, b) => {
    const scoreA = a.infoGain + getFieldWeight(a.field) * 0.15
    const scoreB = b.infoGain + getFieldWeight(b.field) * 0.15
    return scoreB - scoreA
  })

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

/** @deprecated Use getFieldWeight instead — kept for backward compat in external callers */
export function getQuestionFieldPriority(field: string): number {
  // Convert weight (higher=better) to priority (lower=better) for legacy callers
  const weight = QUESTION_FIELD_WEIGHT[field] ?? 0
  return weight > 0 ? Math.round((1 - weight) * 10) : Number.MAX_SAFE_INTEGER
}

export function getFieldWeight(field: string): number {
  return QUESTION_FIELD_WEIGHT[field] ?? 0
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
    case "diameterMm": {
      if (input.diameterMm) return `${label}은 이미 조건에 반영되어 있어 같은 질문을 이어갈 필요가 없습니다.`
      const values = new Set(
        candidates.map(candidate => candidate.product.diameterMm).filter((value): value is number => typeof value === "number")
      )
      if (values.size <= 1) return `현재 후보에서는 ${label}가 하나로 좁혀져 같은 질문으로 후보를 더 나누기 어렵습니다.`
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
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([value, count]) => `${value}날 (${count}개)`)
  chips.push("상관없음")

  return {
    field: "fluteCount",
    questionText: `날 수는 몇 날이 좋으실까요? 2·3·4날이 가장 많이 쓰입니다.`,
    chips,
    infoGain: gain,
  }
}

/**
 * Coating group map: similar coating variants → representative group name.
 * Only the group name is shown as a chip; filtering later matches all variants.
 */
const COATING_GROUP_MAP: Record<string, string> = {
  /* TiAlN family */
  "tialn": "TiAlN",
  "tialnnano": "TiAlN",
  "tialnnanoplus": "TiAlN",
  "tialnnanova": "TiAlN",
  "nanotigaalsin": "TiAlN",
  "nanotigaalsintl": "TiAlN",
  "altisin": "TiAlN",
  "altisinnano": "TiAlN",
  /* AlCrN family */
  "alcrn": "AlCrN",
  "alcrnnano": "AlCrN",
  "alcrsinfamily": "AlCrN",
  "alcrsin": "AlCrN",
  /* TiN family */
  "tin": "TiN",
  "tinnano": "TiN",
  /* TiCN family */
  "ticn": "TiCN",
  "ticnnano": "TiCN",
  /* DLC family */
  "dlc": "DLC",
  "dlcnano": "DLC",
  "diamondlike": "DLC",
  /* Diamond family */
  "diamond": "Diamond",
  "cvddiamond": "Diamond",
  "pcd": "Diamond",
  /* Uncoated */
  "uncoated": "Uncoated",
  "bright": "Uncoated",
  "noncoated": "Uncoated",
}

/** Brief Korean descriptions for common coating groups shown in chips */
const COATING_DESCRIPTION_KO: Record<string, string> = {
  "TiAlN": "내열·범용",
  "AlCrN": "고경도·내마모",
  "TiN": "범용·경제적",
  "TiCN": "비철·플라스틱",
  "DLC": "비철·저마찰",
  "Diamond": "비철·고경도",
  "Uncoated": "무코팅",
}

/** Normalize a raw coating string into a group name, or return the original trimmed value */
function coatingToGroup(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s\-_()]+/g, "")
  if (!key) return raw.trim()
  return COATING_GROUP_MAP[key] ?? raw.trim()
}

function buildCoatingQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (input.coatingPreference) return null

  // Step 1: count raw coatings
  const rawCoatings = new Map<string, number>()
  for (const candidate of candidates) {
    const coating = candidate.product.coating || "미확인"
    rawCoatings.set(coating, (rawCoatings.get(coating) || 0) + 1)
  }
  if (rawCoatings.size <= 1) return null

  // Step 2: group similar coatings
  const grouped = new Map<string, number>()
  for (const [raw, count] of rawCoatings) {
    if (raw === "미확인") continue
    const group = coatingToGroup(raw)
    grouped.set(group, (grouped.get(group) || 0) + count)
  }
  if (grouped.size === 0) return null

  // Step 3: entropy on grouped distribution for info gain
  const gain = computeEntropy(grouped, candidates.length)

  // Step 4: build chips — top 5 groups, with Korean description
  const chips = [...grouped.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([group, count]) => {
      const desc = COATING_DESCRIPTION_KO[group]
      return desc ? `${group} — ${desc} (${count}개)` : `${group} (${count}개)`
    })
  chips.push("상관없음")

  const topGroupNames = [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([group]) => group)

  return {
    field: "coating",
    questionText: `코팅 종류 선호가 있으신가요? 후보 중에 ${topGroupNames.join(", ")} 등이 있습니다.`,
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
    .filter(([value, count]) => value !== "미확인" && count > 0)
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
    .filter(([value, count]) => value !== "미확인" && count > 0)
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

function buildDiameterQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (input.diameterMm != null) return null

  const diameterCounts = new Map<number, number>()
  for (const candidate of candidates) {
    if (candidate.product.diameterMm != null) {
      diameterCounts.set(candidate.product.diameterMm, (diameterCounts.get(candidate.product.diameterMm) || 0) + 1)
    }
  }
  if (diameterCounts.size <= 1) return null

  const gain = computeEntropy(diameterCounts, candidates.length)
  const chips = [...diameterCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 5)
    .map(([value, count]) => `${value}mm (${count}개)`)
  chips.push("상관없음")

  const diameterPreview = [...diameterCounts.keys()].sort((a, b) => a - b).slice(0, 5).map(v => `${v}mm`).join(", ")
  return {
    field: "diameterMm",
    questionText: `직경은 어느 정도가 필요하세요? ${diameterPreview}${diameterCounts.size > 5 ? " 등이" : "가"} 많이 나갑니다.`,
    chips,
    infoGain: gain,
  }
}

function buildDiameterRefineQuestion(input: RecommendationInput, candidates: ScoredProduct[]): FieldAnalysis | null {
  if (!input.diameterMm) return null

  // 사용자가 선택한 직경으로 exact match 제품이 있으면 refine 불필요
  const exactMatchCount = candidates.filter(c =>
    c.product.diameterMm !== null && c.product.diameterMm === input.diameterMm
  ).length
  if (exactMatchCount > 0) return null

  const uniqueDiameters = new Set(
    candidates.map(candidate => candidate.product.diameterMm).filter((diameter): diameter is number => diameter !== null)
  )
  if (uniqueDiameters.size <= 3) return null

  const closestDiameters = [...uniqueDiameters]
    .filter(diameter => Math.abs(diameter - input.diameterMm!) <= 2)
    .sort((a, b) => {
      const distanceDiff = Math.abs(a - input.diameterMm!) - Math.abs(b - input.diameterMm!)
      if (distanceDiff !== 0) return distanceDiff
      return a - b
    })
    .slice(0, 5)

  if (closestDiameters.length <= 1) return null

  return {
    field: "diameterRefine",
    questionText: `${input.diameterMm}mm 근처로 ${closestDiameters.join(", ")}mm가 있는데, 어느 쪽이 맞으세요?`,
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
    case "diameterMm":
      return buildDiameterQuestion(input, candidates)
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
  const askedFields = new Set(
    history.flatMap(turn => {
      if (turn.askedField) return [turn.askedField]
      return turn.extractedFilters.map(filter => filter.field)
    })
  )

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

  if (!askedFields.has("diameterMm")) {
    const question = buildDiameterQuestion(input, candidates)
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
  return parseFieldAnswerToFilter(field, answer)
}
