import {
  restoreOnePreviousStep,
  restoreToBeforeFilter,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"

import type { OrchestratorAction } from "@/lib/recommendation/infrastructure/agents/types"
import type { ActionHandlerContext } from "@/lib/recommendation/infrastructure/engines/serve-engine-handler-types"
import type { ServeEngineRuntimeDependencies } from "@/lib/recommendation/infrastructure/engines/serve-engine-runtime"
import type { prepareRequest } from "@/lib/recommendation/domain/request-preparation"
import type {
  AppLanguage,
  ChatMessage,
  EvidenceSummary,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

type GoBackAction = Extract<OrchestratorAction, { type: "go_back_one_step" | "go_back_to_filter" }>
type CandidatePaginationRequest = { page: number; pageSize: number }
type CandidatePageSlice = {
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
}

/**
 * Extended context for navigation handlers that need access to
 * retrieval results, deps, and presentation helpers.
 */
export interface NavigationHandlerContext extends ActionHandlerContext {
  deps: Pick<
    ServeEngineRuntimeDependencies,
    "jsonRecommendationResponse" | "buildQuestionResponse" | "buildRecommendationResponse" | "applyFilterToInput"
  >
  form: ProductIntakeForm
  messages: ChatMessage[]
  provider: ReturnType<typeof getProvider>
  language: AppLanguage
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null
  baseInput: RecommendationInput
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  totalCandidateCount: number
  displayCandidates: ScoredProduct[]
  displayEvidenceMap: Map<string, EvidenceSummary>
  resolvedPagination: CandidatePaginationRequest
  paginationDto: (totalItems: number) => RecommendationPaginationDto | null
  requestPrep: ReturnType<typeof prepareRequest> | null
  sliceCandidatesForPage: (
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>,
    pagination: CandidatePaginationRequest
  ) => CandidatePageSlice
}

// ── reset_session ──────────────────────────────────────────────

export function handleResetSession(
  ctx: Pick<NavigationHandlerContext, "deps" | "requestPrep">
): Response {
  return ctx.deps.jsonRecommendationResponse({
    text: "처음부터 다시 시작합니다. 새로 조건을 입력해주세요.",
    purpose: "greeting",
    chips: ["처음부터 다시"],
    isComplete: true,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
    requestPreparation: ctx.requestPrep,
  })
}

// ── go_back_one_step / go_back_to_filter ───────────────────────

export async function handleGoBack(
  action: GoBackAction,
  ctx: NavigationHandlerContext
): Promise<Response> {
  const {
    deps,
    prevState,
    baseInput,
    form,
    messages,
    provider,
    language,
    resolvedPagination,
    paginationDto,
    sliceCandidatesForPage,
  } = ctx

  const restoreResult = action.type === "go_back_to_filter"
    ? restoreToBeforeFilter(prevState, action.filterValue ?? "", action.filterField, baseInput, deps.applyFilterToInput)
    : restoreOnePreviousStep(prevState, baseInput, deps.applyFilterToInput)

  const undoResult = await runHybridRetrieval(
    restoreResult.rebuiltInput,
    restoreResult.remainingFilters.filter(filter => filter.op !== "skip"),
    0,
    null
  )
  const undoDisplayPage = sliceCandidatesForPage(undoResult.candidates, undoResult.evidenceMap, resolvedPagination)

  console.log(
    `[session-manager:undo] Reverted "${restoreResult.removedFilterDesc}": ${prevState.candidateCount} -> ${undoResult.candidates.length} candidates, filters: ${prevState.appliedFilters.length} -> ${restoreResult.remainingFilters.length}`
  )

  return deps.buildQuestionResponse(
    form,
    undoResult.candidates,
    undoResult.evidenceMap,
    undoResult.totalConsidered,
    paginationDto(undoResult.totalConsidered),
    undoDisplayPage.candidates,
    undoDisplayPage.evidenceMap,
    restoreResult.rebuiltInput,
    restoreResult.remainingHistory,
    restoreResult.remainingFilters,
    restoreResult.undoTurnCount,
    messages,
    provider,
    language,
    undefined,
    restoreResult.remainingStages
  )
}

// ── show_recommendation ────────────────────────────────────────

export async function handleShowRecommendation(
  ctx: NavigationHandlerContext
): Promise<Response> {
  const {
    deps,
    form,
    candidates,
    evidenceMap,
    totalCandidateCount,
    displayCandidates,
    displayEvidenceMap,
    currentInput,
    narrowingHistory,
    filters,
    turnCount,
    messages,
    provider,
    language,
    displayedProducts,
    paginationDto,
  } = ctx

  return deps.buildRecommendationResponse(
    form,
    candidates,
    evidenceMap,
    totalCandidateCount,
    paginationDto(totalCandidateCount),
    displayCandidates,
    displayEvidenceMap,
    currentInput,
    narrowingHistory,
    filters,
    turnCount,
    messages,
    provider,
    language,
    displayedProducts
  )
}
