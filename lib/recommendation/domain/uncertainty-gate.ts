/**
 * Uncertainty Gate — FAST / VERIFY / ASK Decision Engine
 *
 * Pure deterministic function. No LLM calls.
 * Runs AFTER hybrid retrieval + scoring, BEFORE response composition.
 *
 * Philosophy:
 *   - 쉬운 것은 빠르게 (FAST)
 *   - 위험한 것은 검증하고 (VERIFY)
 *   - 모르는 것은 1개만 질문 (ASK)
 *
 * All inputs are already computed in the retrieval stage — zero additional
 * DB/LLM calls. The gate only READS existing data and DECIDES the mode.
 */

import type {
  AppliedFilter,
  EvidenceSummary,
  RecommendationInput,
  ScoreBreakdown,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

// ── Types ────────────────────────────────────────────────────

export type DecisionMode = "FAST" | "VERIFY" | "ASK"

export interface UncertaintySignal {
  /** Critical input slots still missing (diameter, material, operation) */
  missingCriticalSlots: string[]
  /** Total candidate count after filtering */
  candidateCount: number
  /** Score gap between #1 and #2 (0 if <2 candidates) */
  topScoreGap: number
  /** Fraction of top candidates with evidence (cutting conditions) */
  evidenceCoverage: number
  /** User's input constraints conflict with each other */
  hasConstraintConflict: boolean
  /** Task type has high error cost (cutting conditions, competitor replacement) */
  highRiskTask: boolean
  /** Top candidate match quality is poor (matchStatus = "none") */
  lowConfidenceMapping: boolean
  /** Zero results OR too-wide (>5000 unfiltered) */
  zeroOrTooWideResults: boolean
  /** User intent is ambiguous (could be recommend, compare, or general Q) */
  userIntentAmbiguous: boolean
  /** Top match percentage from score breakdown (0-100) */
  topMatchPct: number
  /** Number of meaningful filters applied */
  meaningfulFilterCount: number
}

export type RecommendationReasonCode =
  | "material_fit"
  | "operation_fit"
  | "diameter_match"
  | "flute_match"
  | "tool_shape_fit"
  | "coating_match"
  | "roughing_fit"
  | "finishing_fit"
  | "inventory_advantage"
  | "regional_availability"
  | "evidence_grounded"
  | "safe_default"
  | "performance_priority"
  | "supply_priority"
  | "series_match"
  | "high_completeness"

export interface RecommendationMeta {
  confidence: "high" | "medium" | "low"
  risk: "low" | "medium" | "high"
  missing_info: string[]
  reason_codes: RecommendationReasonCode[]
  mode: DecisionMode
  /** Present only in ASK mode */
  followup_question?: string
  /** Why this question matters */
  followup_reason?: string
  /** Short Korean summary of reason codes + confidence */
  reason_summary?: string | null
  /** Perspective labels for primary + alternatives */
  perspectives?: {
    primary?: { label: PerspectiveLabel; labelKo: string }
    alternatives?: Array<{ code: string; label: PerspectiveLabel; labelKo: string }>
  }
  /** Raw signal for debugging */
  signal?: UncertaintySignal
}

// ── Perspective Labels ───────────────────────────────────────

export type PerspectiveLabel = "balanced" | "performance_priority" | "supply_priority"

/**
 * Label a candidate with a perspective based on its score and stock.
 * Pure deterministic — no LLM call.
 */
export function assignPerspectiveLabel(
  scored: ScoredProduct,
  topMatchPct: number,
): PerspectiveLabel {
  const hasStock = scored.totalStock != null && scored.totalStock > 0
  const matchPct = scored.scoreBreakdown?.matchPct ?? 0

  // High match + evidence = performance pick
  if (matchPct >= 70 && scored.evidence.length > 0) return "performance_priority"
  // Low match but has stock = supply pick
  if (matchPct < 60 && hasStock) return "supply_priority"
  return "balanced"
}

const PERSPECTIVE_KO: Record<PerspectiveLabel, string> = {
  balanced: "무난한 선택",
  performance_priority: "성능 우선",
  supply_priority: "수급 우선",
}

// ── Reason Code Labels & Assembly ───────────────────────────

const REASON_CODE_KO: Record<RecommendationReasonCode, string> = {
  material_fit: "소재 적합",
  operation_fit: "가공형상 적합",
  diameter_match: "직경 일치",
  flute_match: "날수 일치",
  tool_shape_fit: "공구 형상 적합",
  coating_match: "코팅 적합",
  roughing_fit: "황삭 적합",
  finishing_fit: "정삭 적합",
  inventory_advantage: "재고 유리",
  regional_availability: "판매국 적합",
  evidence_grounded: "절삭조건 근거 있음",
  safe_default: "범용성 높음",
  performance_priority: "성능 우선",
  supply_priority: "수급 우선",
  series_match: "시리즈 일치",
  high_completeness: "스펙 충족률 높음",
}

/**
 * Build a short Korean summary line from reason codes + confidence + risk.
 * E.g. "✅ 직경 일치 · 소재 적합 · 재고 유리 (신뢰도: 높음)"
 * Returns null if no reason codes.
 */
export function buildReasonSummary(meta: RecommendationMeta): string | null {
  if (meta.reason_codes.length === 0) return null
  const labels = meta.reason_codes
    .slice(0, 4) // max 4 for brevity
    .map(c => REASON_CODE_KO[c])
    .filter(Boolean)
  if (labels.length === 0) return null

  const confLabel = meta.confidence === "high" ? "높음" : meta.confidence === "medium" ? "보통" : "낮음"
  const icon = meta.confidence === "high" ? "✅" : meta.confidence === "medium" ? "🔶" : "⚠️"
  return `${icon} ${labels.join(" · ")} (신뢰도: ${confLabel})`
}

/**
 * Build a perspective label string for the primary recommendation.
 */
export function getPerspectiveKo(label: PerspectiveLabel): string {
  return PERSPECTIVE_KO[label]
}

const CRITICAL_SLOTS = ["diameterMm", "material", "operationType"] as const

const SLOT_LABELS: Record<string, string> = {
  diameterMm: "직경",
  material: "소재",
  operationType: "가공 방식",
  toolSubtype: "공구 타입",
  fluteCount: "날수",
  coating: "코팅",
}

export function buildReasonCodes(
  primary: ScoredProduct,
  input: RecommendationInput,
  evidenceSummary: EvidenceSummary | null,
): RecommendationReasonCode[] {
  const codes: RecommendationReasonCode[] = []
  const bd = primary.scoreBreakdown

  if (bd) {
    if (bd.diameter.score > 0) codes.push("diameter_match")
    if (bd.materialTag.score > 0) codes.push("material_fit")
    if (bd.operation.score > 0) codes.push("operation_fit")
    if (bd.flutes.score > 0) codes.push("flute_match")
    if (bd.toolShape.score > 0) codes.push("tool_shape_fit")
    if (bd.coating.score > 0) codes.push("coating_match")
    if (bd.evidence.score > 0) codes.push("evidence_grounded")
    if (bd.completeness.score > 0) codes.push("high_completeness")
    if (bd.matchPct >= 80) codes.push("performance_priority")
  }

  if (primary.totalStock != null && primary.totalStock > 0) {
    codes.push("inventory_advantage")
  }

  if (evidenceSummary && evidenceSummary.sourceCount > 0) {
    if (!codes.includes("evidence_grounded")) codes.push("evidence_grounded")
  }

  // Dedupe
  return [...new Set(codes)]
}

// ── Signal Computation ───────────────────────────────────────

export function computeUncertaintySignal(
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  input: RecommendationInput,
  filters: AppliedFilter[],
  totalCandidateCount: number,
  opts?: {
    intentAmbiguous?: boolean
    isCompetitorReplacement?: boolean
    isCuttingConditionTask?: boolean
    isRegionalTask?: boolean
  },
): UncertaintySignal {
  // Missing critical slots
  // workPieceName ("Stainless Steels" etc.) counts as material info —
  // KG maps "SUS304"→workPieceName, not material field directly.
  // machiningIntent ("roughing"/"finishing") counts as operationType info.
  const missingCriticalSlots: string[] = []
  if (input.diameterMm == null) missingCriticalSlots.push("diameterMm")
  if (!input.material && !input.workPieceName) missingCriticalSlots.push("material")
  if (!input.operationType && !input.machiningIntent) missingCriticalSlots.push("operationType")

  // Top score gap
  const top = candidates[0]
  const second = candidates[1]
  const topScoreGap = (top && second) ? top.score - second.score : (top ? 100 : 0)

  // Evidence coverage (top 5 candidates)
  const topN = candidates.slice(0, 5)
  const withEvidence = topN.filter(c => {
    const ev = evidenceMap.get(c.product.normalizedCode) ?? evidenceMap.get(c.product.displayCode)
    return ev && ev.sourceCount > 0
  }).length
  const evidenceCoverage = topN.length > 0 ? withEvidence / topN.length : 0

  // Constraint conflict detection
  const hasConstraintConflict = detectConstraintConflict(input, filters)

  // High risk tasks
  const highRiskTask = !!(
    opts?.isCompetitorReplacement ||
    opts?.isCuttingConditionTask ||
    opts?.isRegionalTask
  )

  // Low confidence mapping
  const lowConfidenceMapping = !top || top.matchStatus === "none"

  // Zero or too wide
  const zeroOrTooWideResults = totalCandidateCount === 0 || (
    totalCandidateCount > 5000 && filters.filter(f => f.op !== "skip").length < 2
  )

  // Match pct
  const topMatchPct = top?.scoreBreakdown?.matchPct ?? 0

  // Meaningful filters
  const meaningfulFilterCount = filters.filter(f => f.op !== "skip" && f.field !== "none").length

  return {
    missingCriticalSlots,
    candidateCount: totalCandidateCount,
    topScoreGap,
    evidenceCoverage,
    hasConstraintConflict,
    highRiskTask,
    lowConfidenceMapping,
    zeroOrTooWideResults,
    userIntentAmbiguous: opts?.intentAmbiguous ?? false,
    topMatchPct,
    meaningfulFilterCount,
  }
}

function detectConstraintConflict(input: RecommendationInput, filters: AppliedFilter[]): boolean {
  // E.g. user specified "4날" but also "drilling" (drills are 2-flute)
  const fluteFilter = filters.find(f => f.field === "fluteCount")
  const opFilter = filters.find(f => f.field === "operationType" || f.field === "toolType")
  if (fluteFilter && opFilter) {
    const fluteVal = Number(fluteFilter.value)
    const opVal = String(opFilter.value).toLowerCase()
    if (opVal.includes("drill") && fluteVal > 2) return true
    if (opVal.includes("tap") && fluteVal > 6) return true
  }
  return false
}

// ── Gate Decision ────────────────────────────────────────────

export function decideMode(signal: UncertaintySignal): DecisionMode {
  // ── ASK: critical information missing + ambiguous ──
  if (signal.missingCriticalSlots.length >= 2 && signal.candidateCount > 3000) {
    return "ASK"
  }
  if (signal.userIntentAmbiguous && signal.missingCriticalSlots.length >= 1) {
    return "ASK"
  }

  // ── VERIFY: high risk or low confidence ──
  if (signal.highRiskTask) return "VERIFY"
  if (signal.hasConstraintConflict) return "VERIFY"
  if (signal.lowConfidenceMapping && signal.candidateCount > 0) return "VERIFY"
  // Close race → VERIFY, unless all critical slots filled + high match + good evidence
  if (signal.topScoreGap < 3 && signal.candidateCount >= 2) {
    const allSlotsFilled = signal.missingCriticalSlots.length === 0
    const strongMatch = signal.topMatchPct >= 60 && signal.evidenceCoverage >= 0.5
    if (!(allSlotsFilled && strongMatch)) return "VERIFY"
  }
  if (signal.evidenceCoverage < 0.2 && signal.candidateCount > 0 && signal.candidateCount <= 50) return "VERIFY"
  if (signal.zeroOrTooWideResults) return "VERIFY"

  // ── FAST: confident ──
  return "FAST"
}

// ── Confidence / Risk Derivation ─────────────────────────────

export function deriveConfidence(signal: UncertaintySignal): "high" | "medium" | "low" {
  if (signal.topMatchPct >= 70 && signal.evidenceCoverage >= 0.5 && signal.topScoreGap >= 10) {
    return "high"
  }
  if (signal.topMatchPct >= 40 || (signal.meaningfulFilterCount >= 2 && signal.candidateCount <= 100)) {
    return "medium"
  }
  return "low"
}

export function deriveRisk(signal: UncertaintySignal): "low" | "medium" | "high" {
  if (signal.highRiskTask || signal.hasConstraintConflict) return "high"
  if (signal.lowConfidenceMapping || signal.zeroOrTooWideResults) return "high"
  if (signal.topScoreGap < 5 && signal.candidateCount >= 3) return "medium"
  if (signal.missingCriticalSlots.length >= 1) return "medium"
  return "low"
}

// ── Main Entry Point ─────────────────────────────────────────

export function evaluateUncertainty(
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  input: RecommendationInput,
  filters: AppliedFilter[],
  totalCandidateCount: number,
  primary: ScoredProduct | null,
  evidenceSummary: EvidenceSummary | null,
  opts?: {
    intentAmbiguous?: boolean
    isCompetitorReplacement?: boolean
    isCuttingConditionTask?: boolean
    isRegionalTask?: boolean
  },
): RecommendationMeta {
  const signal = computeUncertaintySignal(
    candidates, evidenceMap, input, filters, totalCandidateCount, opts,
  )
  const mode = decideMode(signal)
  const confidence = deriveConfidence(signal)
  const risk = deriveRisk(signal)
  const missing_info = signal.missingCriticalSlots.map(s => SLOT_LABELS[s] ?? s)
  const reason_codes = primary
    ? buildReasonCodes(primary, input, evidenceSummary)
    : []

  const meta: RecommendationMeta = {
    confidence,
    risk,
    missing_info,
    reason_codes,
    mode,
    signal,
  }

  console.log(
    `[uncertainty-gate] mode=${mode} confidence=${confidence} risk=${risk}` +
    ` missing=[${missing_info.join(",")}] reasons=[${reason_codes.join(",")}]` +
    ` gap=${signal.topScoreGap.toFixed(1)} evidence=${(signal.evidenceCoverage * 100).toFixed(0)}%` +
    ` matchPct=${signal.topMatchPct.toFixed(0)} candidates=${signal.candidateCount}`
  )

  return meta
}

// ── Info-Gain Question Selection for ASK mode ────────────────

export interface InfoGainQuestion {
  field: string
  label: string
  /** Estimated fraction of candidates eliminated by answering this question */
  reductionRatio: number
}

/**
 * Compute the highest info-gain question from the candidate pool.
 * Returns the single question that would maximally change the ranking.
 */
export function selectHighestInfoGainQuestion(
  candidates: ScoredProduct[],
  input: RecommendationInput,
  filters: AppliedFilter[],
): InfoGainQuestion | null {
  const alreadyFiltered = new Set(filters.map(f => f.field))
  const questions: InfoGainQuestion[] = []

  // For each possible filter field, compute how many distinct values exist
  // and what fraction of candidates each value covers.
  const fieldAccessors: Array<{
    field: string
    label: string
    getValue: (c: ScoredProduct) => string | null
    isSet: () => boolean
  }> = [
    {
      field: "toolSubtype",
      label: "공구 타입 (엔드밀/드릴/탭 등)",
      getValue: c => c.product.toolSubtype,
      isSet: () => !!input.toolSubtype,
    },
    {
      field: "fluteCount",
      label: "날수",
      getValue: c => c.product.fluteCount != null ? String(c.product.fluteCount) : null,
      isSet: () => input.flutePreference != null,
    },
    {
      field: "coating",
      label: "코팅",
      getValue: c => c.product.coating,
      isSet: () => !!input.coatingPreference,
    },
    {
      field: "diameterMm",
      label: "직경",
      getValue: c => c.product.diameterMm != null ? String(c.product.diameterMm) : null,
      isSet: () => input.diameterMm != null,
    },
    {
      field: "material",
      label: "소재",
      getValue: c => (c.product.materialTags ?? [])[0] ?? null,
      isSet: () => !!input.material || !!input.workPieceName,
    },
    {
      field: "operationType",
      label: "가공 방식 (황삭/정삭 등)",
      getValue: c => c.product.toolSubtype, // rough proxy
      isSet: () => !!input.operationType || !!input.machiningIntent,
    },
  ]

  for (const fa of fieldAccessors) {
    if (fa.isSet() || alreadyFiltered.has(fa.field)) continue

    const valueCounts = new Map<string, number>()
    let nullCount = 0
    for (const c of candidates) {
      const v = fa.getValue(c)
      if (v == null) { nullCount++; continue }
      valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1)
    }

    if (valueCounts.size <= 1) continue // nothing to discriminate

    // Reduction ratio = 1 - (largest group / total).
    // If one value has 80% of candidates, answering reduces by only 20%.
    // If values are evenly spread, reduction is high.
    const total = candidates.length
    const largestGroup = Math.max(...valueCounts.values(), nullCount)
    const reductionRatio = 1 - (largestGroup / total)

    questions.push({
      field: fa.field,
      label: fa.label,
      reductionRatio,
    })
  }

  if (questions.length === 0) return null

  // Sort by reduction ratio descending
  questions.sort((a, b) => b.reductionRatio - a.reductionRatio)
  return questions[0]
}
