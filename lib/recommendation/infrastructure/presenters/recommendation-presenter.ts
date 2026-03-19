import {
  recommendationResponseSchema,
  type RecommendationAppliedFilterDto,
  type RecommendationCandidateDto,
  type RecommendationCapabilityDto,
  type RecommendationDisplayedOptionDto,
  type RecommendationPublicSessionDto,
  type RecommendationResponseDto,
  type RecommendationResponseMetaDto,
  type RecommendationSessionEnvelopeDto,
} from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  CandidateSnapshot,
  DisplayedOption,
  ExplorationSessionState,
  NarrowingTurn,
  EvidenceSummary,
  RecommendationExplanation,
  RecommendationResult,
  RequestPreparationResult,
} from "@/lib/recommendation/domain/types"

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
  return {
    canCompare: true,
    canRestoreTask: Boolean(sessionState && (sessionState.stageHistory?.length ?? 0) > 1),
    canGroupBySeries: false,
    canFilterDisplayed: Boolean(sessionState?.displayedCandidates?.length),
  }
}

export function toRecommendationCandidateDto(
  candidate: CandidateSnapshot
): RecommendationCandidateDto {
  return {
    rank: candidate.rank,
    productCode: candidate.productCode,
    displayCode: candidate.displayCode,
    displayLabel: candidate.displayLabel,
    brand: candidate.brand,
    seriesName: candidate.seriesName,
    seriesIconUrl: candidate.seriesIconUrl,
    diameterMm: candidate.diameterMm,
    fluteCount: candidate.fluteCount,
    coating: candidate.coating,
    toolMaterial: candidate.toolMaterial,
    shankDiameterMm: candidate.shankDiameterMm,
    lengthOfCutMm: candidate.lengthOfCutMm,
    overallLengthMm: candidate.overallLengthMm,
    helixAngleDeg: candidate.helixAngleDeg,
    description: candidate.description,
    featureText: candidate.featureText,
    materialTags: [...candidate.materialTags],
    score: candidate.score,
    scoreBreakdown: candidate.scoreBreakdown,
    matchStatus: candidate.matchStatus,
    stockStatus: candidate.stockStatus,
    totalStock: candidate.totalStock,
    inventorySnapshotDate: candidate.inventorySnapshotDate,
    inventoryLocations: candidate.inventoryLocations.map(location => ({
      warehouseOrRegion: location.warehouseOrRegion,
      quantity: location.quantity,
    })),
    hasEvidence: candidate.hasEvidence,
    bestCondition: toBestConditionDto(candidate.bestCondition),
  }
}

export function toRecommendationPublicSessionDto(
  sessionState: ExplorationSessionState | null
): RecommendationPublicSessionDto | null {
  if (!sessionState) return null

  return {
    sessionId: sessionState.sessionId ?? null,
    candidateCount: sessionState.candidateCount,
    appliedFilters: sessionState.appliedFilters.map(toAppliedFilterDto),
    narrowingHistory: sessionState.narrowingHistory.map(toNarrowingTurnDto),
    resolutionStatus: sessionState.resolutionStatus,
    turnCount: sessionState.turnCount,
    lastAskedField: sessionState.lastAskedField ?? null,
    lastAction: sessionState.lastAction ?? null,
    displayedChips: [...(sessionState.displayedChips ?? [])],
    displayedOptions: (sessionState.displayedOptions ?? []).map(toDisplayedOptionDto),
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
  isComplete: boolean
  recommendation?: RecommendationResult | null
  sessionState?: ExplorationSessionState | null
  candidateSnapshot?: CandidateSnapshot[] | null
  evidenceSummaries?: EvidenceSummary[] | null
  requestPreparation?: RequestPreparationResult | null
  primaryExplanation?: RecommendationExplanation | null
  primaryFactChecked?: Record<string, unknown> | null
  altExplanations?: RecommendationExplanation[]
  altFactChecked?: Array<Record<string, unknown>>
  meta?: RecommendationResponseMetaDto
  error?: string
  detail?: string
}

export function buildRecommendationResponseDto(
  params: BuildRecommendationResponseDtoParams
): RecommendationResponseDto {
  const sessionState = params.sessionState ?? null
  const capabilities = getRecommendationCapabilities(sessionState)

  const dto: RecommendationResponseDto = {
    text: params.text,
    purpose: params.purpose,
    chips: params.chips ?? [],
    isComplete: params.isComplete,
    recommendation: params.recommendation ?? null,
    session: toRecommendationSessionEnvelope(sessionState),
    candidates: params.candidateSnapshot
      ? params.candidateSnapshot.map(toRecommendationCandidateDto)
      : null,
    evidenceSummaries: params.evidenceSummaries ?? null,
    requestPreparation: params.requestPreparation ?? null,
    primaryExplanation: params.primaryExplanation ?? null,
    primaryFactChecked: params.primaryFactChecked ?? null,
    altExplanations: params.altExplanations ?? [],
    altFactChecked: params.altFactChecked ?? [],
    capabilities,
    meta: params.meta,
    error: params.error,
    detail: params.detail,
  }

  recommendationResponseSchema.parse(dto)

  return dto
}
