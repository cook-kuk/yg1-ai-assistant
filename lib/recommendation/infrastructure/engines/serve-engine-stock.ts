import { carryForwardState } from "@/lib/recommendation/domain/recommendation-domain"
import { buildFilterValueScope } from "@/lib/recommendation/shared/filter-field-registry"

import type { OrchestratorAction } from "@/lib/recommendation/infrastructure/agents/types"
import type { ActionHandlerContext } from "@/lib/recommendation/infrastructure/engines/serve-engine-handler-types"
import type { CandidateSnapshot } from "@/lib/recommendation/domain/types"

type FilterByStockAction = Extract<OrchestratorAction, { type: "filter_by_stock" }>

export function handleFilterByStock(
  action: FilterByStockAction,
  ctx: ActionHandlerContext
): Response {
  const {
    jsonRecommendationResponse,
    prevState,
    filters,
    narrowingHistory,
    currentInput,
    turnCount,
    orchResult,
  } = ctx

  // ── Post-scoring stock filter ──
  // Filters from already-displayed candidates (no re-retrieval).
  // Uses prevState.displayedCandidates snapshots to avoid re-running full search.
  const prevCandidates = prevState?.displayedCandidates ?? []
  const stockFilter = action.stockFilter
  const stockThreshold = action.stockThreshold ?? null

  let filteredSnapshots: CandidateSnapshot[]
  if (stockThreshold != null && stockThreshold > 0) {
    // Numeric threshold: "재고 50개 이상" → totalStock >= 50
    filteredSnapshots = prevCandidates.filter(c => (c.totalStock ?? 0) >= stockThreshold)
  } else if (stockFilter === "instock") {
    filteredSnapshots = prevCandidates.filter(c => (c.totalStock ?? 0) > 0)
  } else if (stockFilter === "limited") {
    filteredSnapshots = prevCandidates.filter(c => c.stockStatus === "instock" || c.stockStatus === "limited")
  } else {
    filteredSnapshots = prevCandidates // "all" = no filter
  }

  if (filteredSnapshots.length === 0) {
    // No candidates match stock filter — inform user
    const stockLabel = stockThreshold != null
      ? `재고 ${stockThreshold}개 이상인`
      : stockFilter === "instock" ? "재고 있는" : "재고 제한적 이상인"
    const noStockChips = ["⟵ 이전 단계", "처음부터 다시"]
    if (prevCandidates.length > 0) {
      noStockChips.unshift(`전체 ${prevCandidates.length}개 보기`)
    }
    const sessionState = carryForwardState(prevState, {
      candidateCount: prevState.candidateCount ?? prevCandidates.length,
      appliedFilters: filters,
      narrowingHistory,
      resolutionStatus: prevState.resolutionStatus ?? "broad",
      resolvedInput: currentInput,
      turnCount,
      displayedCandidates: prevCandidates,
      displayedChips: noStockChips,
      displayedOptions: [],
      currentMode: prevState.currentMode ?? "recommendation",
      lastAction: "filter_by_stock",
    })
    return jsonRecommendationResponse({
      text: `${stockLabel} 후보가 없습니다. 현재 ${prevCandidates.length}개 후보 중 재고 조건에 맞는 제품이 없어요.\n재고 조건을 완화하거나 '전체 보기'를 선택해주세요.`,
      purpose: "question",
      chips: noStockChips,
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: prevCandidates,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
      meta: {
        orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
      },
    })
  }

  // Build response from filtered snapshots without re-running full search
  console.log(`[stock-filter] ${stockFilter}: ${prevCandidates.length} → ${filteredSnapshots.length} candidates (from displayed)`)

  // Rebuild filterValueScope from filtered candidates so follow-up filters reflect actual options
  const filteredValueScope = buildFilterValueScope(filteredSnapshots as unknown as Array<Record<string, unknown>>)

  // Contextual chips: offer useful next actions after stock filtering
  const stockChips: string[] = []
  if (filteredSnapshots.length >= 2) stockChips.push("상위 2개 비교")
  if (filteredSnapshots.length < prevCandidates.length) stockChips.push(`전체 ${prevCandidates.length}개 보기`)
  stockChips.push("⟵ 이전 단계", "처음부터 다시")

  const sessionState = carryForwardState(prevState, {
    candidateCount: filteredSnapshots.length,
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "broad",
    resolvedInput: currentInput,
    turnCount,
    displayedCandidates: filteredSnapshots,
    displayedChips: stockChips,
    displayedOptions: [],
    currentMode: prevState.currentMode ?? "recommendation",
    lastAction: "filter_by_stock",
    filterValueScope: filteredValueScope,
  })
  const stockLabel = stockThreshold != null
    ? `재고 ${stockThreshold}개 이상인`
    : stockFilter === "instock" ? "재고 있는" : stockFilter === "limited" ? "재고 제한적 이상인" : "전체"
  // Build deterministic stock summary per candidate to prevent LLM hallucination
  const stockDetails = filteredSnapshots
    .map(c => `- ${c.displayCode}: 재고 ${c.totalStock ?? 0}개`)
    .join("\n")
  const responseText = stockDetails
    ? `${stockLabel} 후보 ${filteredSnapshots.length}개입니다.\n\n${stockDetails}`
    : `${stockLabel} 후보 ${filteredSnapshots.length}개입니다.`
  return jsonRecommendationResponse({
    text: responseText,
    purpose: "recommendation",
    chips: stockChips,
    isComplete: true,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: filteredSnapshots,
    requestPreparation: null,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
    meta: {
      orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
    },
  })
}
