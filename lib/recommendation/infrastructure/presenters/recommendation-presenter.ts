import {
  type RecommendationArchivedTaskDto,
  recommendationResponseSchema,
  type RecommendationAppliedFilterDto,
  type RecommendationCandidateDto,
  type RecommendationCapabilityDto,
  type RecommendationChipGroupDto,
  type RecommendationCheckpointSummaryDto,
  type RecommendationDisplayedOptionDto,
  type RecommendationPaginationDto,
  type RecommendationPublicSessionDto,
  type RecommendationResponseDto,
  type RecommendationResponseMetaDto,
  type RecommendationSeriesGroupSummaryDto,
  type RecommendationSessionEnvelopeDto,
  type RecommendationUINarrowingPathEntryDto,
} from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  ArchivedTask,
  CandidateSnapshot,
  DisplayedOption,
  ExplorationSessionState,
  NarrowingTurn,
  RecommendationCheckpoint,
  EvidenceSummary,
  RecommendationExplanation,
  RecommendationResult,
  RequestPreparationResult,
  SeriesGroup,
  UINarrowingPathEntry,
} from "@/lib/recommendation/domain/types"
import { findHallucinatedSeries } from "@/lib/recommendation/infrastructure/knowledge/series-validator"
import {
  assertAnswerCardEvidenceConsistency,
  buildTruthConsistentAnswerFallback,
  buildTurnTruth,
  detectStaleReasoningSummary,
  sanitizeReasoningSummary,
} from "@/lib/recommendation/domain/context/turn-truth"

function toAppliedFilterDto(filter: AppliedFilter): RecommendationAppliedFilterDto {
  return {
    field: filter.field,
    op: filter.op,
    value: filter.value,
    rawValue: filter.rawValue,
    appliedAt: filter.appliedAt,
  }
}

function toNarrowingTurnDto(turn: NarrowingTurn) {
  return {
    question: turn.question,
    answer: turn.answer,
    extractedFilters: turn.extractedFilters.map(toAppliedFilterDto),
    candidateCountBefore: turn.candidateCountBefore,
    candidateCountAfter: turn.candidateCountAfter,
  }
}

function toDisplayedOptionDto(option: DisplayedOption): RecommendationDisplayedOptionDto {
  return {
    index: option.index,
    label: option.label,
    field: option.field,
    value: option.value,
    count: option.count,
  }
}

function toSeriesGroupSummaryDto(group: SeriesGroup): RecommendationSeriesGroupSummaryDto {
  return {
    seriesKey: group.seriesKey,
    seriesName: group.seriesName,
    candidateCount: group.candidateCount,
    materialRating: group.materialRating ?? null,
    materialRatingScore: group.materialRatingScore ?? null,
  }
}

function toUINarrowingPathEntryDto(entry: UINarrowingPathEntry): RecommendationUINarrowingPathEntryDto {
  return {
    kind: entry.kind,
    label: entry.label,
    field: entry.field,
    value: entry.value,
    candidateCount: entry.candidateCount,
    candidateCountBefore: entry.candidateCountBefore,
  }
}

function toCheckpointSummaryDto(
  checkpoint: RecommendationCheckpoint
): RecommendationCheckpointSummaryDto {
  return {
    checkpointId: checkpoint.checkpointId,
    stepIndex: checkpoint.stepIndex,
    summary: checkpoint.summary,
    candidateCount: checkpoint.candidateCount,
    timestamp: checkpoint.timestamp,
  }
}

function toArchivedTaskDto(task: ArchivedTask): RecommendationArchivedTaskDto {
  return {
    taskId: task.taskId,
    createdAt: task.createdAt,
    intakeSummary: task.intakeSummary,
    checkpointCount: task.checkpointCount,
    status: task.status,
  }
}

function toBestConditionDto(
  bestCondition: CandidateSnapshot["bestCondition"]
): CandidateSnapshot["bestCondition"] | null {
  if (!bestCondition) return null

  return {
    Vc: bestCondition.Vc ?? null,
    fz: bestCondition.fz ?? null,
    ap: bestCondition.ap ?? null,
    ae: bestCondition.ae ?? null,
    n: bestCondition.n ?? null,
    vf: bestCondition.vf ?? null,
  }
}

export function getRecommendationCapabilities(
  sessionState: ExplorationSessionState | null
): RecommendationCapabilityDto {
  const groups = sessionState?.displayedSeriesGroups ?? sessionState?.displayedGroups ?? []

  return {
    canCompare: true,
    canRestoreTask: Boolean(sessionState && (sessionState.stageHistory?.length ?? 0) > 1),
    canGroupBySeries: groups.length >= 2,
    canFilterDisplayed: Boolean(sessionState?.displayedCandidates?.length),
  }
}

export function toRecommendationCandidateDto(
  candidate: CandidateSnapshot
): RecommendationCandidateDto {
  const record = candidate as unknown as Record<string, unknown>
  const pickString = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "string") return value
    }
    return null
  }
  const pickNumber = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "number" && Number.isFinite(value)) return value
    }
    return null
  }
  const pickBoolean = (...keys: string[]): boolean | null => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "boolean") return value
    }
    return null
  }
  const materialTags = Array.isArray(record.materialTags)
    ? record.materialTags.map(tag => String(tag ?? "").trim()).filter(Boolean)
    : []
  const inventoryLocations = Array.isArray(record.inventoryLocations)
    ? record.inventoryLocations
    : []
  const displayCode =
    pickString("displayCode", "code", "normalizedCode", "productCode", "normalized_code", "display_code")
    ?? ""
  const productCode =
    pickString("productCode", "normalizedCode", "code", "normalized_code", "displayCode", "display_code")
    ?? displayCode
  const rank = pickNumber("rank") ?? 0
  const matchStatusValue = pickString("matchStatus", "match_status")
  const matchStatus: RecommendationCandidateDto["matchStatus"] =
    matchStatusValue === "exact" || matchStatusValue === "approximate" || matchStatusValue === "none"
      ? matchStatusValue
      : "none"

  return {
    rank,
    productCode,
    displayCode,
    displayLabel: pickString("displayLabel", "display_label") ?? (displayCode || null),
    brand: pickString("brand", "manufacturer"),
    seriesName: pickString("seriesName", "series", "series_name"),
    seriesIconUrl: pickString("seriesIconUrl", "series_icon_url"),
    diameterMm: pickNumber("diameterMm", "diameter", "diameter_mm"),
    fluteCount: pickNumber("fluteCount", "flute", "flute_count"),
    coating: pickString("coating", "search_coating"),
    toolSubtype: pickString("toolSubtype", "tool_subtype", "search_subtype"),
    toolMaterial: pickString("toolMaterial", "tool_material"),
    shankDiameterMm: pickNumber("shankDiameterMm", "shankDiameter", "shank_diameter_mm"),
    shankType: pickString("shankType", "shank_type"),
    lengthOfCutMm: pickNumber("lengthOfCutMm", "lengthOfCut", "loc", "length_of_cut_mm"),
    overallLengthMm: pickNumber("overallLengthMm", "overallLength", "oal", "overall_length_mm"),
    helixAngleDeg: pickNumber("helixAngleDeg", "helixAngle", "helix_angle_deg"),
    coolantHole: pickBoolean("coolantHole", "coolant_hole"),
    ballRadiusMm: pickNumber("ballRadiusMm", "ballRadius", "ball_radius_mm"),
    taperAngleDeg: pickNumber("taperAngleDeg", "taperAngle", "taper_angle_deg"),
    pointAngleDeg: pickNumber("pointAngleDeg", "pointAngle", "point_angle_deg"),
    threadPitchMm: pickNumber("threadPitchMm", "threadPitch", "thread_pitch_mm"),
    description: pickString("description", "materialDescription", "material_description"),
    featureText: pickString("featureText", "feature_text"),
    materialTags: [...materialTags],
    score: pickNumber("score") ?? 0,
    scoreBreakdown: (record.scoreBreakdown as RecommendationCandidateDto["scoreBreakdown"] | null | undefined) ?? null,
    matchStatus,
    stockStatus: pickString("stockStatus", "stock_status") ?? "unknown",
    totalStock: pickNumber("totalStock", "total_stock"),
    inventorySnapshotDate: pickString("inventorySnapshotDate", "inventory_snapshot_date"),
    inventoryLocations: inventoryLocations.map(location => ({
      warehouseOrRegion:
        (location as { warehouseOrRegion?: string | null; warehouse_or_region?: string | null }).warehouseOrRegion
        ?? (location as { warehouseOrRegion?: string | null; warehouse_or_region?: string | null }).warehouse_or_region
        ?? "",
      quantity:
        (location as { quantity?: number | null }).quantity
        ?? 0,
    })),
    hasEvidence: pickBoolean("hasEvidence", "has_evidence") ?? false,
    bestCondition: toBestConditionDto((record.bestCondition as CandidateSnapshot["bestCondition"] | null | undefined) ?? null),
    xaiNarrative: pickString("xaiNarrative", "xai_narrative"),
  }
}

export function toRecommendationPublicSessionDto(
  sessionState: ExplorationSessionState | null
): RecommendationPublicSessionDto | null {
  if (!sessionState) return null

  return {
    sessionId: sessionState.sessionId ?? null,
    candidateCount: sessionState.candidateCount,
    // Defensive dedup: 상위 레이어에서 같은 (field, op, rawValue) 조합이 두 번
    // 박힐 경우 UI 에 "10mm 이상 / 10mm 이상" 이 두 줄로 보이는 문제가 있음. 마지막
    // 적용분을 유지한다. 정상 경로는 replaceFieldFilter 로 이미 dedup 되지만
    // narrowingHistory replay · KG + SCR 동시 emit · 이전 턴 state merge 등에서
    // 새는 경우를 최종 방어한다.
    appliedFilters: (() => {
      const seen = new Map<string, number>()
      sessionState.appliedFilters.forEach((f, i) => {
        const key = `${f.field}|${f.op ?? "eq"}|${JSON.stringify(f.rawValue ?? f.value ?? null)}`
        seen.set(key, i)
      })
      return sessionState.appliedFilters
        .map((f, i) => {
          const key = `${f.field}|${f.op ?? "eq"}|${JSON.stringify(f.rawValue ?? f.value ?? null)}`
          return seen.get(key) === i ? f : null
        })
        .filter((f): f is AppliedFilter => f !== null)
        .map(toAppliedFilterDto)
    })(),
    narrowingHistory: sessionState.narrowingHistory.map(toNarrowingTurnDto),
    resolutionStatus: sessionState.resolutionStatus,
    turnCount: sessionState.turnCount,
    lastAskedField: sessionState.lastAskedField ?? null,
    lastAction: sessionState.lastAction ?? null,
    displayedChips: [...(sessionState.displayedChips ?? [])],
    displayedStructuredChips: sessionState.displayedStructuredChips
      ? [...sessionState.displayedStructuredChips]
      : undefined,
    displayedOptions: (sessionState.displayedOptions ?? []).map(toDisplayedOptionDto),
    displayedSeriesGroups: (sessionState.displayedSeriesGroups ?? sessionState.displayedGroups ?? []).map(toSeriesGroupSummaryDto),
    uiNarrowingPath: (sessionState.uiNarrowingPath ?? []).map(toUINarrowingPathEntryDto),
    currentMode: sessionState.currentMode ?? null,
    activeGroupKey: sessionState.activeGroupKey ?? null,
    currentTask: sessionState.currentTask ? {
      taskId: sessionState.currentTask.taskId,
      createdAt: sessionState.currentTask.createdAt,
      intakeSummary: sessionState.currentTask.intakeSummary,
      checkpoints: sessionState.currentTask.checkpoints.map(toCheckpointSummaryDto),
      finalCandidateCount: sessionState.currentTask.finalCandidateCount,
      status: sessionState.currentTask.status,
    } : null,
    taskHistory: (sessionState.taskHistory ?? []).map(toArchivedTaskDto),
    capabilities: getRecommendationCapabilities(sessionState),
  }
}

export function toRecommendationSessionEnvelope(
  sessionState: ExplorationSessionState | null
): RecommendationSessionEnvelopeDto {
  return {
    publicState: toRecommendationPublicSessionDto(sessionState),
    engineState: sessionState,
  }
}

export function getEngineSessionState(
  session: RecommendationSessionEnvelopeDto | null | undefined
): ExplorationSessionState | null {
  const engineState = session?.engineState
  if (!engineState || typeof engineState !== "object") return null
  return engineState as ExplorationSessionState
}

interface BuildRecommendationResponseDtoParams {
  text: string
  purpose: RecommendationResponseDto["purpose"]
  chips?: string[]
  structuredChips?: (import("@/lib/contracts/recommendation").StructuredChipDto | null)[]
  chipGroups?: RecommendationChipGroupDto[]
  isComplete: boolean
  recommendation?: RecommendationResult | null
  sessionState?: ExplorationSessionState | null
  candidateSnapshot?: CandidateSnapshot[] | null
  pagination?: RecommendationPaginationDto | null
  evidenceSummaries?: EvidenceSummary[] | null
  requestPreparation?: RequestPreparationResult | null
  primaryExplanation?: RecommendationExplanation | null
  primaryFactChecked?: Record<string, unknown> | null
  altExplanations?: RecommendationExplanation[]
  altFactChecked?: Array<Record<string, unknown>>
  meta?: RecommendationResponseMetaDto
  recommendationMeta?: RecommendationResponseDto["recommendationMeta"]
  reasoningVisibility?: RecommendationResponseDto["reasoningVisibility"]
  thinkingProcess?: string | null
  thinkingDeep?: string | null
  error?: string
  detail?: string
}

/**
 * Synthesize a Korean reasoning sentence from a session's appliedFilters.
 *
 * Used as the last-tier fallback when no upstream reasoning source has populated
 * thinkingProcess. Deterministic, no LLM, no network — assembles a 2-sentence
 * "intent + slots" explanation from field/op/value tuples. Returns null when
 * the session has no meaningful filters.
 */
function synthesizeThinkingFromSessionFilters(
  sessionState: ExplorationSessionState | null
): string | null {
  if (!sessionState) return null
  const filters = (sessionState.appliedFilters ?? []).filter(f => f.op !== "skip")
  if (filters.length === 0) return null

  const FIELD_LABEL: Record<string, string> = {
    workPieceName: "피삭재",
    material: "ISO 소재군",
    diameterMm: "공구 직경",
    fluteCount: "날수",
    coating: "코팅",
    toolSubtype: "공구 형상",
    toolMaterial: "공구 재질",
    seriesName: "시리즈",
    brand: "브랜드",
    cuttingType: "가공 방식",
    overallLengthMm: "전체 길이",
    lengthOfCutMm: "날장 길이",
    shankDiameterMm: "생크 직경",
    helixAngleDeg: "헬릭스각",
    taperAngleDeg: "테이퍼각",
    ballRadiusMm: "코너/볼 R",
    pointAngleDeg: "포인트 각도",
    threadPitchMm: "나사 피치",
    stockStatus: "재고",
    country: "생산국",
    toolType: "공구 종류",
  }
  const formatPhrase = (op: string, value: string): string => {
    const trimmed = value.trim()
    switch (op) {
      case "neq": return /제외\s*$/u.test(trimmed) ? trimmed : `${trimmed} 제외`
      case "gte": return /이상\s*$/u.test(trimmed) ? trimmed : `${trimmed} 이상`
      case "lte": return /이하\s*$/u.test(trimmed) ? trimmed : `${trimmed} 이하`
      case "between": return /범위\s*$/u.test(trimmed) ? trimmed : `${trimmed} 범위`
      default: return trimmed
    }
  }

  const parts = filters.map(f => {
    const label = FIELD_LABEL[f.field] ?? f.field
    const valueStr = String(f.value ?? f.rawValue ?? "")
    return `${label} ${formatPhrase(f.op, valueStr)}`
  })

  const priority = ["workPieceName", "material", "materialTags", "diameterMm", "fluteCount", "toolSubtype", "coating"]
  const sorted = [...filters].sort((a, b) => {
    const ia = priority.indexOf(a.field)
    const ib = priority.indexOf(b.field)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  const lead = sorted[0]
  const leadLabel = FIELD_LABEL[lead.field] ?? lead.field
  const leadValue = String(lead.value ?? lead.rawValue ?? "")

  return `사용자 요청에서 ${leadLabel} '${leadValue}' 을(를) 핵심 조건으로 파악했습니다. 다음 조건으로 필터링합니다: ${parts.join(", ")}.`
}

export function buildRecommendationResponseDto(
  params: BuildRecommendationResponseDtoParams
): RecommendationResponseDto {
  const sessionState = params.sessionState ?? null
  const capabilities = getRecommendationCapabilities(sessionState)
  const synthesizedThinkingProcess = synthesizeThinkingFromSessionFilters(sessionState)
  const stableCandidateSnapshot =
    params.purpose === "recommendation"
      ? (params.candidateSnapshot ?? sessionState?.lastRecommendationArtifact ?? null)
      : (sessionState?.lastRecommendationArtifact ?? params.candidateSnapshot ?? null)
  const truth = buildTurnTruth({
    userMessage: params.text,
    sessionState,
    appliedFilters: sessionState?.appliedFilters ?? [],
    candidateSnapshot: stableCandidateSnapshot,
    evidenceSummaries: params.evidenceSummaries,
  })
  const rawThinkingProcess =
    params.thinkingProcess
    ?? sessionState?.thinkingProcess
    ?? synthesizedThinkingProcess
    ?? null
  const staleReasoningIssues = detectStaleReasoningSummary(rawThinkingProcess, truth)
  const resolvedThinkingProcess =
    sanitizeReasoningSummary(rawThinkingProcess, truth)
  const resolvedThinkingDeep =
    staleReasoningIssues.length > 0
      ? null
      : (
          params.thinkingDeep
          ?? sessionState?.thinkingDeep
          ?? null
        )
  const reasoningVisibility =
    params.reasoningVisibility
    ?? (resolvedThinkingDeep ? "full" : resolvedThinkingProcess ? "simple" : "hidden")
  const hideReasoning = reasoningVisibility === "hidden"

  // ── LLM 환각 시리즈명 감지 ──
  // LLM이 카탈로그에 없는 시리즈명(예: "3S MILL")을 만들어낼 경우 disclaimer 추가.
  // knowledge JSON 기반 known-set과 대조. 텍스트 자체는 수정하지 않음.
  let finalText = params.text
  try {
    const hits = findHallucinatedSeries(finalText)
    if (hits.length > 0) {
      const names = hits.map(h => h.raw).join(", ")
      console.warn(`[series-validator] hallucinated series in response: ${names}`)
      finalText = `${finalText}\n\n> ⚠️ 안내: 위 응답에 카탈로그에서 확인되지 않은 시리즈명(${names})이 포함되어 있을 수 있습니다. 정확한 제품명은 YG-1 본사(032-526-0909)로 확인 부탁드립니다.`
    }
  } catch (e) {
    console.warn(`[series-validator] check failed:`, (e as Error).message)
  }

  try {
    assertAnswerCardEvidenceConsistency({
      text: finalText,
      truth,
    })
  } catch (error) {
    console.warn("[turn-truth] answer/card/evidence consistency fallback:", (error as Error).message)
    finalText = buildTruthConsistentAnswerFallback(truth, finalText)
  }

  const dto: RecommendationResponseDto = {
    text: finalText,
    purpose: params.purpose,
    chips: params.chips ?? [],
    structuredChips: params.structuredChips,
    chipGroups: params.chipGroups,
    isComplete: params.isComplete,
    recommendation: params.recommendation ?? null,
    session: toRecommendationSessionEnvelope(sessionState),
    candidates: stableCandidateSnapshot
      ? stableCandidateSnapshot.map(toRecommendationCandidateDto)
      : null,
    pagination: params.pagination ?? null,
    evidenceSummaries: params.evidenceSummaries ?? null,
    requestPreparation: params.requestPreparation ?? null,
    primaryExplanation: params.primaryExplanation ?? null,
    primaryFactChecked: params.primaryFactChecked ?? null,
    altExplanations: params.altExplanations ?? [],
    altFactChecked: params.altFactChecked ?? [],
    capabilities,
    meta: params.meta,
    recommendationMeta: params.recommendationMeta,
    reasoningVisibility,
    // Three-tier fallback:
    //   1. explicit param (rarely set)
    //   2. runtime stashed it on session (SQL agent natural-language reasoning)
    //   3. synthesize from the session's appliedFilters (covers det-SCR / KG /
    //      v2-bridge / orchestrator paths that don't emit prose reasoning)
    thinkingProcess:
      hideReasoning
        ? null
        : resolvedThinkingProcess,
    thinkingDeep:
      hideReasoning
        ? null
        : resolvedThinkingDeep,
    error: params.error,
    detail: params.detail,
  }

  recommendationResponseSchema.parse(dto)

  return dto
}
