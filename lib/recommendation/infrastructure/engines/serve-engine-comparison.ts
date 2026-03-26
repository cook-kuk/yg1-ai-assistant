import { carryForwardState } from "@/lib/recommendation/domain/recommendation-domain"
import { classifyQueryTarget } from "@/lib/recommendation/domain/context/query-target-classifier"
import {
  buildComparisonOptionState,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"
import {
  compareProducts,
  resolveProductReferences,
} from "@/lib/recommendation/infrastructure/agents/recommendation-agents"

import type { ActionHandlerContext } from "@/lib/recommendation/infrastructure/engines/serve-engine-handler-types"
import type { OrchestratorAction } from "@/lib/recommendation/infrastructure/agents/types"
import type { TraceCollector } from "@/lib/debug/agent-trace"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type {
  CandidateSnapshot,
  EvidenceSummary,
  ExplorationSessionState,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

type CompareProductsAction = Extract<OrchestratorAction, { type: "compare_products" }>

type BuildActionMeta = (
  actionType: string,
  orchResult: { agentsInvoked: unknown; escalatedToOpus: boolean },
  debugTrace?: import("@/lib/debug/agent-trace").TurnDebugTrace | null,
) => Record<string, unknown>

export interface ComparisonHandlerContext extends ActionHandlerContext {
  deps: {
    handleDirectEntityProfileQuestion: (
      userMessage: string,
      currentInput: RecommendationInput,
      prevState: ExplorationSessionState | null,
    ) => Promise<{ text: string; chips: string[] } | null>
    buildCandidateSnapshot: (
      candidates: ScoredProduct[],
      evidenceMap: Map<string, EvidenceSummary>,
    ) => CandidateSnapshot[]
  }
  provider: LLMProvider
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  lastUserText: string
  trace: TraceCollector
  buildActionMeta: BuildActionMeta
}

export async function handleCompareProducts(
  action: CompareProductsAction,
  ctx: ComparisonHandlerContext,
): Promise<Response> {
  const {
    jsonRecommendationResponse,
    prevState,
    filters,
    narrowingHistory,
    currentInput,
    turnCount,
    orchResult,
    deps,
    provider,
    candidates,
    evidenceMap,
    lastUserText,
    trace,
    buildActionMeta,
  } = ctx

  trace.add("comparison", "answer", { targets: action.targets }, {}, "Product comparison requested")

  const compareQueryTarget = classifyQueryTarget(
    lastUserText,
    prevState.appliedFilters?.find(f => f.op !== "skip")?.field,
    prevState.lastAskedField,
  )

  // ── Branch 1: Entity profile comparison (series/brand names) ──
  const entityProfileReply =
    compareQueryTarget.type === "series_comparison" || compareQueryTarget.type === "brand_comparison"
      ? await deps.handleDirectEntityProfileQuestion(lastUserText, currentInput, prevState)
      : null

  if (entityProfileReply) {
    const comparisonOptionState = buildComparisonOptionState()
    const sessionState = carryForwardState(prevState, {
      candidateCount: prevState.candidateCount ?? candidates.length,
      appliedFilters: filters,
      narrowingHistory,
      resolutionStatus: prevState.resolutionStatus ?? "broad",
      resolvedInput: currentInput,
      turnCount,
      displayedCandidates: prevState.displayedCandidates ?? [],
      displayedChips: comparisonOptionState.chips,
      displayedOptions: comparisonOptionState.displayedOptions,
      currentMode: "comparison",
      lastAction: "compare_products",
      lastComparisonArtifact: {
        comparedProductCodes: action.targets,
        comparedRanks: [],
        text: entityProfileReply.text,
        timestamp: Date.now(),
      },
    })

    const entityComparisonValidation = validateOptionFirstPipeline(
      entityProfileReply.text,
      comparisonOptionState.chips,
      comparisonOptionState.displayedOptions,
    )
    const comparisonText = entityComparisonValidation.correctedAnswer ?? entityProfileReply.text

    return jsonRecommendationResponse({
      text: comparisonText,
      purpose: "comparison",
      chips: comparisonOptionState.chips,
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevState.displayedCandidates ?? null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
      meta: buildActionMeta(action.type, orchResult, trace.build({
        latestUserMessage: lastUserText,
        currentMode: prevState.currentMode ?? null,
        routeAction: action.type,
      })),
    })
  }

  // ── Branch 2: Product comparison (resolveProductReferences + compareProducts) ──
  const snapshot = prevState.displayedCandidates?.length
    ? prevState.displayedCandidates
    : deps.buildCandidateSnapshot(candidates, evidenceMap)
  const targets = resolveProductReferences(action.targets, snapshot)
  const comparison = await compareProducts(targets, evidenceMap, provider)
  const comparisonOptionState = buildComparisonOptionState()

  const sessionState = carryForwardState(prevState, {
    // Preserve candidateCount from prevState when retrieval was skipped (candidates=[])
    candidateCount: candidates.length > 0 ? candidates.length : (prevState.candidateCount ?? 0),
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "broad",
    resolvedInput: currentInput,
    turnCount,
    displayedCandidates: snapshot,
    displayedChips: comparisonOptionState.chips,
    displayedOptions: comparisonOptionState.displayedOptions,
    currentMode: "comparison",
    lastAction: "compare_products",
  })

  let comparisonText = comparison.text
  trace.add("comparison-result", "answer", {}, { textLength: comparisonText.length, chips: comparisonOptionState.chips }, "Comparison completed")
  const comparisonValidation = validateOptionFirstPipeline(
    comparisonText,
    comparisonOptionState.chips,
    comparisonOptionState.displayedOptions,
  )
  if (comparisonValidation.correctedAnswer) {
    comparisonText = comparisonValidation.correctedAnswer
    console.log(`[answer-validator:compare] Softened: ${comparisonValidation.unauthorizedActions.map(actionItem => actionItem.phrase).join(",")}`)
  }

  return jsonRecommendationResponse({
    text: comparisonText,
    purpose: "comparison",
    chips: comparisonOptionState.chips,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: snapshot,
    requestPreparation: null,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
    meta: buildActionMeta(action.type, orchResult, trace.build({
      latestUserMessage: lastUserText,
      currentMode: prevState.currentMode ?? null,
      routeAction: action.type,
    })),
  })
}
