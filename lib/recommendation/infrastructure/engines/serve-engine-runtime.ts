import {
  analyzeInquiry,
  carryForwardState,
  checkResolution,
  getRedirectResponse,
  prepareRequest,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"
import { BrandReferenceRepo } from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import {
  compareProducts,
  orchestrateTurn,
  orchestrateTurnWithTools,
  resolveProductReferences,
} from "@/lib/recommendation/infrastructure/agents/recommendation-agents"
import { ENABLE_TOOL_USE_ROUTING } from "@/lib/recommendation/infrastructure/config/recommendation-feature-flags"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import {
  buildComparisonOptionState,
  buildRefinementOptionState,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { replaceFieldFilter } from "@/lib/recommendation/infrastructure/engines/serve-engine-filter-state"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import { buildUnifiedTurnContext } from "@/lib/recommendation/domain/context/turn-context-builder"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"
import { normalizeFilterValue, extractDistinctFieldValues } from "@/lib/recommendation/domain/value-normalizer"
import { classifyQueryTarget } from "@/lib/recommendation/domain/context/query-target-classifier"
import { TraceCollector, isDebugEnabled } from "@/lib/debug/agent-trace"
import { handleServeGeneralChatAction } from "@/lib/recommendation/infrastructure/engines/serve-engine-general-chat"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  ChatMessage,
  EvidenceSummary,
  ExplorationSessionState,
  NarrowingStage,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationInput,
  RecommendationResult,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

export { handleServeSimpleChat } from "@/lib/recommendation/infrastructure/engines/serve-engine-simple-chat"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

type QuestionReply = { text: string; chips: string[] } | null

function normalizePendingSelectionText(value: string): string {
  return value
    .trim()
    .replace(/\s*\(\d+개\)\s*$/, "")
    .replace(/\s*—\s*.+$/, "")
    .replace(/(으로요|로요|이에요|예요|입니다|으로|로|요)$/u, "")
    .trim()
    .toLowerCase()
}

function resolveSingleIsoGroup(material: string | undefined): string | null {
  if (!material) return null

  const tags = Array.from(
    new Set(
      material
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => resolveMaterialTag(part))
        .filter((tag): tag is string => Boolean(tag))
    )
  )

  return tags.length === 1 ? tags[0] : null
}

function dropDependentWorkPieceFilters(filters: AppliedFilter[]): void {
  for (let index = filters.length - 1; index >= 0; index--) {
    const field = filters[index]?.field
    if (field === "workPieceName" || field === "edpBrandName" || field === "edpSeriesName") {
      filters.splice(index, 1)
    }
  }
}

async function enrichWorkPieceFilterWithSeriesScope(
  filter: AppliedFilter,
  currentInput: RecommendationInput
): Promise<AppliedFilter> {
  if (filter.field !== "workPieceName") return filter

  const isoGroup = resolveSingleIsoGroup(currentInput.material)
  const workPieceName = String(filter.rawValue ?? "").trim()
  if (!isoGroup || !workPieceName) return filter

  const seriesNames = await BrandReferenceRepo.listDistinctSeriesNames({
    isoGroup,
    workPieceName,
    limit: 30,
  })
  if (seriesNames.length === 0) return filter

  const seriesScopeFilter: AppliedFilter = {
    field: "edpSeriesName",
    op: "in",
    value: seriesNames.length <= 3 ? seriesNames.join(", ") : `${seriesNames.length}개 시리즈`,
    rawValue: seriesNames.join("||"),
    appliedAt: filter.appliedAt,
  }

  return {
    ...filter,
    _sideFilters: [seriesScopeFilter],
  } as AppliedFilter
}

function buildPendingWorkPieceSelectionFilter(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null
): AppliedFilter | null {
  if (!sessionState || sessionState.lastAskedField !== "workPieceName") return null
  if (sessionState.resolutionStatus?.startsWith("resolved")) return null
  if (!userMessage) return null

  const raw = userMessage.trim()
  if (!raw || raw.length > 40) return null
  if (/[?？]/.test(raw)) return null
  if (/뭐야|뭔지|설명|차이|왜|어떻게|몇개|종류|비교|추천|결과|처음부터|이전 단계/u.test(raw)) return null

  const clean = normalizePendingSelectionText(raw)
  if (!clean) return null

  const optionMatch = sessionState.displayedOptions?.find(option => {
    if (option.field !== "workPieceName") return false
    const normalizedValue = normalizePendingSelectionText(option.value)
    const normalizedLabel = normalizePendingSelectionText(option.label)
    return clean === normalizedValue || clean === normalizedLabel || clean.startsWith(normalizedValue) || normalizedValue.startsWith(clean)
  })

  const chipMatch = sessionState.displayedChips?.find(chip => {
    const normalizedChip = normalizePendingSelectionText(chip)
    return normalizedChip && (clean === normalizedChip || clean.startsWith(normalizedChip) || normalizedChip.startsWith(clean))
  })

  const selectedValue = optionMatch?.value ?? chipMatch ?? raw.trim()
  return parseAnswerToFilter("workPieceName", selectedValue)
}

export interface ServeEngineRuntimeDependencies {
  mapIntakeToInput: (form: ProductIntakeForm) => RecommendationInput
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
  buildQuestionResponse: (
    form: ProductIntakeForm,
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>,
    input: RecommendationInput,
    history: NarrowingTurn[],
    filters: AppliedFilter[],
    turnCount: number,
    messages: ChatMessage[],
    provider: ReturnType<typeof getProvider>,
    language: AppLanguage,
    overrideText?: string,
    existingStageHistory?: NarrowingStage[]
  ) => Promise<Response>
  buildRecommendationResponse: (
    form: ProductIntakeForm,
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>,
    input: RecommendationInput,
    history: NarrowingTurn[],
    filters: AppliedFilter[],
    turnCount: number,
    messages: ChatMessage[],
    provider: ReturnType<typeof getProvider>,
    language: AppLanguage,
    displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  ) => Promise<Response>
  buildCandidateSnapshot: (
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>
  ) => CandidateSnapshot[]
  handleDirectInventoryQuestion: (
    userMessage: string,
    prevState: ExplorationSessionState
  ) => Promise<QuestionReply>
  handleDirectBrandReferenceQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState | null
  ) => Promise<QuestionReply>
  handleDirectCuttingConditionQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState
  ) => Promise<QuestionReply>
  handleContextualNarrowingQuestion: (
    provider: ReturnType<typeof getProvider>,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    prevState: ExplorationSessionState
  ) => Promise<string | null>
  handleGeneralChat: (
    provider: ReturnType<typeof getProvider>,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    form: ProductIntakeForm,
    displayedCandidatesContext?: CandidateSnapshot[]
  ) => Promise<{ text: string; chips: string[] }>
  jsonRecommendationResponse: JsonRecommendationResponse
  getFollowUpChips: (result: RecommendationResult) => string[]
  buildSourceSummary: (primary: { product: { rawSourceFile: string; rawSourceSheet?: string | null; sourceConfidence?: string | null } } | null) => string[]
}

const SKIP_RETRIEVAL_ACTIONS = new Set([
  "compare_products",
  "explain_product",
  "answer_general",
  "refine_condition",
])

function buildResetResponse(
  deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse">,
  requestPreparation: ReturnType<typeof prepareRequest> | null
) {
  return deps.jsonRecommendationResponse({
    text: "처음부터 다시 시작합니다. 새로 조건을 입력해주세요.",
    purpose: "greeting",
    chips: ["처음부터 다시"],
    isComplete: true,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
    requestPreparation,
  })
}

function buildActionMeta(
  actionType: string,
  orchResult: { agentsInvoked: unknown; escalatedToOpus: boolean },
  debugTrace?: import("@/lib/debug/agent-trace").TurnDebugTrace | null
) {
  return {
    orchestratorResult: {
      action: actionType,
      agents: orchResult.agentsInvoked,
      opus: orchResult.escalatedToOpus,
    },
    debugTrace: debugTrace ?? undefined,
  }
}

export async function handleServeExploration(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null = null,
  language: AppLanguage = "ko"
): Promise<Response> {
  const trace = new TraceCollector()
  const response = await handleServeExplorationInner(deps, form, messages, prevState, displayedProducts, language, trace)

  // Inject debug trace into every response
  if (isDebugEnabled()) {
    try {
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === "ai")
      const debugTrace = trace.build({
        latestUserMessage: lastUserMsg?.text ?? "",
        latestAssistantQuestion: lastAssistantMsg?.text?.slice(0, 100) ?? null,
        currentMode: prevState?.currentMode ?? null,
        routeAction: null,
        pendingField: prevState?.lastAskedField ?? null,
        candidateCount: prevState?.candidateCount ?? null,
        filterCount: prevState?.appliedFilters?.length ?? 0,
        summary: `${prevState?.currentMode ?? "initial"} | ${prevState?.candidateCount ?? "?"}개 후보 | 필터 ${prevState?.appliedFilters?.length ?? 0}개`,
      })
      if (debugTrace) {
        const json = await response.json()
        const meta = (json as any).meta ?? {}
        meta.debugTrace = debugTrace
        ;(json as any).meta = meta
        return new Response(JSON.stringify(json), {
          status: response.status,
          headers: response.headers,
        })
      }
    } catch { /* response already consumed or not JSON — return as-is */ }
  }

  return response
}

async function handleServeExplorationInner(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null = null,
  language: AppLanguage = "ko",
  trace: TraceCollector = new TraceCollector()
): Promise<Response> {
  console.log(
    `[recommend] request start hasPrevState=${!!prevState} messages=${messages.length} displayedProducts=${displayedProducts?.length ?? 0}`
  )

  const provider = getProvider()
  const baseInput = deps.mapIntakeToInput(form)
  const filters: AppliedFilter[] = [...(prevState?.appliedFilters ?? [])]
  const resolvedInput: RecommendationInput = prevState?.resolvedInput
    ? { ...baseInput, ...prevState.resolvedInput }
    : baseInput

  const requestPrep = prepareRequest(form, messages, prevState, resolvedInput, prevState?.candidateCount ?? 0)
  console.log(`[recommend] Intent: ${requestPrep.intent} (${requestPrep.intentConfidence}), Route: ${requestPrep.route.action}`)

  const lastUserMsg = messages.length > 0
    ? [...messages].reverse().find(message => message.role === "user")
    : null
  const pendingWorkPieceFilter = buildPendingWorkPieceSelectionFilter(prevState, lastUserMsg?.text ?? null)

  let earlyAction: string | null = null
  if (pendingWorkPieceFilter) {
    earlyAction = "continue_narrowing"
  } else if (messages.length > 0 && prevState && lastUserMsg) {
    const earlyUnifiedTurnContext = buildUnifiedTurnContext({
      latestAssistantText: [...messages].reverse().find(message => message.role === "ai")?.text ?? null,
      latestUserMessage: lastUserMsg.text,
      messages,
      sessionState: prevState,
      resolvedInput,
      intakeForm: form,
      candidates: prevState.displayedCandidates ?? [],
    })
    const earlyTurnContext = {
      userMessage: lastUserMsg.text,
      intakeForm: form,
      sessionState: prevState,
      resolvedInput,
      candidateCount: prevState.candidateCount ?? 0,
      displayedProducts: prevState.displayedCandidates ?? [],
      currentCandidates: [],
      unifiedTurnContext: earlyUnifiedTurnContext,
    }
    const earlyResult = ENABLE_TOOL_USE_ROUTING
      ? await orchestrateTurnWithTools(earlyTurnContext, provider)
      : await orchestrateTurn(earlyTurnContext, provider)
    earlyAction = earlyResult.action.type
  }

  const needsRetrieval = !earlyAction || !SKIP_RETRIEVAL_ACTIONS.has(earlyAction)
  let candidates: ScoredProduct[]
  let evidenceMap: Map<string, EvidenceSummary>
  if (needsRetrieval) {
    const hybridResult = await runHybridRetrieval(resolvedInput, filters)
    candidates = hybridResult.candidates
    evidenceMap = hybridResult.evidenceMap
    console.log(`[recommend] Retrieval executed: ${candidates.length} candidates`)
  } else {
    candidates = []
    evidenceMap = new Map()
    console.log(`[recommend] Retrieval SKIPPED for action: ${earlyAction}`)
  }

  trace.add("search", "search", {
    needsRetrieval,
    earlyAction,
    filterCount: filters.length,
  }, {
    candidateCount: candidates.length,
    skipped: !needsRetrieval,
  }, needsRetrieval ? `Retrieved ${candidates.length} candidates` : `Skipped retrieval for ${earlyAction}`)

  if (requestPrep.route.action === "reset_session") {
    return buildResetResponse(deps, requestPrep)
  }

  const narrowingHistory: NarrowingTurn[] = [...(prevState?.narrowingHistory ?? [])]
  let currentInput = { ...resolvedInput }
  let turnCount = prevState?.turnCount ?? 0

  if (messages.length > 0 && prevState && lastUserMsg) {
    const currentCandidateSnapshot = deps.buildCandidateSnapshot(candidates, evidenceMap)
    const unifiedTurnContext = buildUnifiedTurnContext({
      latestAssistantText: [...messages].reverse().find(message => message.role === "ai")?.text ?? null,
      latestUserMessage: lastUserMsg.text,
      messages,
      sessionState: prevState,
      resolvedInput: currentInput,
      intakeForm: form,
      candidates: currentCandidateSnapshot,
    })
    const turnContext = {
      userMessage: lastUserMsg.text,
      intakeForm: form,
      sessionState: prevState,
      resolvedInput: currentInput,
      candidateCount: candidates.length,
      displayedProducts: currentCandidateSnapshot,
      currentCandidates: candidates,
      unifiedTurnContext,
    }

    const orchResult = ENABLE_TOOL_USE_ROUTING
      ? await orchestrateTurnWithTools(turnContext, provider)
      : await orchestrateTurn(turnContext, provider)
    let action = orchResult.action

    trace.add("orchestrator", "router", {
      userMessage: lastUserMsg.text,
      mode: prevState.currentMode,
      lastAskedField: prevState.lastAskedField,
      candidateCount: candidates.length,
      filterCount: filters.length,
      resolutionStatus: prevState.resolutionStatus,
    }, {
      action: action.type,
      agents: orchResult.agentsInvoked,
      escalatedToOpus: orchResult.escalatedToOpus,
    }, orchResult.reasoning)

    // ── Deep debug: memory snapshot ──
    if (prevState.conversationMemory) {
      const mem = prevState.conversationMemory
      trace.setMemory({
        resolvedFacts: mem.items.filter(i => i.status === "resolved").map(i => ({ field: i.field, value: i.value, source: i.source })),
        activeFilters: (prevState.appliedFilters ?? []).filter(f => f.op !== "skip").map(f => ({ field: f.field, value: f.value, op: f.op })),
        tentativeReferences: mem.items.filter(i => i.status === "tentative").map(i => ({ field: i.field, value: i.value })),
        pendingQuestions: prevState.lastAskedField ? [{ field: prevState.lastAskedField, kind: prevState.currentMode ?? "narrowing" }] : [],
        recentQACount: mem.recentQA?.length ?? 0,
        highlightCount: mem.highlights?.length ?? 0,
        userSignals: {
          confusedFields: mem.userSignals.confusedFields,
          skippedFields: mem.userSignals.skippedFields,
          prefersDelegate: mem.userSignals.prefersDelegate,
          frustrationCount: mem.userSignals.frustrationCount,
        },
      })
    }

    // ── Deep debug: UI artifacts ──
    trace.setUIArtifacts({
      artifacts: [
        ...(prevState.resolutionStatus?.startsWith("resolved") && prevState.displayedCandidates?.length
          ? [{ kind: "recommendation_card", summary: `추천 ${prevState.displayedCandidates.length}개`, productCodes: prevState.displayedCandidates.slice(0, 5).map(c => c.displayCode), isPrimaryFocus: prevState.currentMode === "recommendation" }]
          : []),
        ...(prevState.lastComparisonArtifact
          ? [{ kind: "comparison_table", summary: `비교 ${prevState.lastComparisonArtifact.comparedProductCodes?.length ?? 0}개`, productCodes: prevState.lastComparisonArtifact.comparedProductCodes ?? [], isPrimaryFocus: prevState.currentMode === "comparison" }]
          : []),
        ...(prevState.displayedChips?.length
          ? [{ kind: "chips_bar", summary: `칩 ${prevState.displayedChips.length}개`, productCodes: [], isPrimaryFocus: prevState.currentMode === "question" }]
          : []),
        ...(prevState.displayedOptions?.length
          ? [{ kind: "options", summary: `옵션 ${prevState.displayedOptions.length}개 (${prevState.lastAskedField ?? "?"})`, productCodes: [], isPrimaryFocus: prevState.currentMode === "narrowing" }]
          : []),
      ],
      likelyReferencedBlock: prevState.currentMode === "recommendation" ? "recommendation_card"
        : prevState.currentMode === "comparison" ? "comparison_table"
        : prevState.currentMode === "question" ? "question_prompt"
        : null,
    })

    // ── Deep debug: recent conversation turns ──
    trace.setRecentTurns(
      messages.slice(-10).map(m => ({
        role: m.role,
        text: m.text.slice(0, 150),
        mode: undefined,
      }))
    )

    const hasPendingQuestion = !!prevState.lastAskedField
      && !prevState.resolutionStatus?.startsWith("resolved")
    if (hasPendingQuestion) {
      const userState = detectUserState(lastUserMsg.text, prevState.lastAskedField)
      const isQuestionAssistSignal =
        userState.state === "confused"
        || userState.state === "wants_explanation"
        || userState.state === "wants_delegation"
        || userState.state === "wants_skip"

      // ── Query Target Override ──
      // If user is asking about a DIFFERENT entity (series/product/comparison),
      // do NOT intercept into question-assist mode.
      // Active filters are constraints, not the topic.
      const queryTarget = classifyQueryTarget(
        lastUserMsg.text,
        prevState.appliedFilters?.find(f => f.op !== "skip")?.field,
        prevState.lastAskedField
      )

      trace.add("query-target-classifier", "context", {
        userMessage: lastUserMsg.text,
        activeFilterField: prevState.appliedFilters?.find(f => f.op !== "skip")?.field,
        pendingField: prevState.lastAskedField,
      }, {
        type: queryTarget.type,
        entities: queryTarget.entities,
        overridesActiveFilter: queryTarget.overridesActiveFilter,
        answerTopic: queryTarget.answerTopic,
        searchScopeOnly: queryTarget.searchScopeOnly,
      }, queryTarget.overridesActiveFilter
        ? `User target "${queryTarget.answerTopic}" overrides pending field "${prevState.lastAskedField}"`
        : `Query about pending field "${prevState.lastAskedField}"`)

      if (queryTarget.overridesActiveFilter) {
        trace.add("question-assist-bypass", "router", {
          reason: "query target overrides active filter",
          pendingField: prevState.lastAskedField,
        }, {
          queryTarget: queryTarget.answerTopic,
          entities: queryTarget.entities,
          originalAction: action.type,
        }, `User asked about "${queryTarget.answerTopic}" — bypassing question-assist for pending "${prevState.lastAskedField}"`)
        console.log(`[query-target:override] User query target="${queryTarget.answerTopic}" overrides pending field="${prevState.lastAskedField}" (entities: ${queryTarget.entities.join(",")})`)
        // Don't intercept — let the orchestrator's original routing stand
      } else if (isQuestionAssistSignal) {
        if (userState.state === "wants_skip" || userState.state === "wants_delegation") {
          action = { type: "skip_field" }
          trace.add("question-assist-intercept", "router", { userState: userState.state, pendingField: prevState.lastAskedField }, { action: "skip_field" }, `${userState.state} → skip_field for "${prevState.lastAskedField}"`)
          console.log(`[question-assist:intercept] ${userState.state} -> skip_field for "${prevState.lastAskedField}"`)
        } else if (action.type === "answer_general" || action.type === "redirect_off_topic") {
          const originalAction = action.type
          action = { type: "explain_product", target: lastUserMsg.text }
          trace.add("question-assist-intercept", "router", { userState: userState.state, pendingField: prevState.lastAskedField, originalAction }, { action: "explain_product" }, `${userState.state} overrides ${originalAction} → explain_product (pending: ${prevState.lastAskedField})`)
          console.log(`[question-assist:intercept] ${userState.state} overrides ${originalAction} -> explain_product (pending: ${prevState.lastAskedField})`)
        }
      }
    }

    if (pendingWorkPieceFilter && (
      action.type === "answer_general" ||
      action.type === "redirect_off_topic"
    )) {
      action = { type: "continue_narrowing", filter: pendingWorkPieceFilter }
    }

    if (action.type === "reset_session") {
      return buildResetResponse(deps, requestPrep)
    }

    if (action.type === "go_back_one_step" || action.type === "go_back_to_filter") {
      const restoreResult = action.type === "go_back_to_filter"
        ? restoreToBeforeFilter(prevState, action.filterValue ?? "", action.filterField, baseInput, deps.applyFilterToInput)
        : restoreOnePreviousStep(prevState, baseInput, deps.applyFilterToInput)

      const undoResult = await runHybridRetrieval(
        restoreResult.rebuiltInput,
        restoreResult.remainingFilters.filter(filter => filter.op !== "skip")
      )

      console.log(
        `[session-manager:undo] Reverted "${restoreResult.removedFilterDesc}": ${prevState.candidateCount} -> ${undoResult.candidates.length} candidates, filters: ${prevState.appliedFilters.length} -> ${restoreResult.remainingFilters.length}`
      )

      return deps.buildQuestionResponse(
        form,
        undoResult.candidates,
        undoResult.evidenceMap,
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

    if (action.type === "show_recommendation") {
      return deps.buildRecommendationResponse(
        form,
        candidates,
        evidenceMap,
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

    if (action.type === "filter_by_stock") {
      // ── Post-scoring stock filter ──
      // Uses existing ScoredProduct[] from retrieval (no new DB query).
      // If candidates are empty (retrieval skipped), use prevState snapshot.
      const stockCandidates = candidates.length > 0 ? candidates : []
      const stockFilter = action.stockFilter

      let filtered: ScoredProduct[]
      if (stockFilter === "instock") {
        filtered = stockCandidates.filter(c => c.stockStatus === "instock")
      } else if (stockFilter === "limited") {
        filtered = stockCandidates.filter(c => c.stockStatus === "instock" || c.stockStatus === "limited")
      } else {
        filtered = stockCandidates // "all" = no filter
      }

      if (filtered.length === 0) {
        // No candidates match stock filter — inform user
        const stockLabel = stockFilter === "instock" ? "재고 있는" : "재고 제한적 이상인"
        const noStockChips = ["⟵ 이전 단계", "처음부터 다시"]
        if (stockCandidates.length > 0) {
          noStockChips.unshift(`전체 ${stockCandidates.length}개 보기`)
        }
        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount ?? candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevState.displayedCandidates ?? [],
          displayedChips: noStockChips,
          displayedOptions: [],
          currentMode: prevState.currentMode ?? "recommendation",
          lastAction: "filter_by_stock",
        })
        return deps.jsonRecommendationResponse({
          text: `${stockLabel} 후보가 없습니다. 현재 ${stockCandidates.length}개 후보 중 재고 조건에 맞는 제품이 없어요.`,
          purpose: "question",
          chips: noStockChips,
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
          meta: {
            orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
          },
        })
      }

      // Rebuild recommendation with stock-filtered candidates
      console.log(`[stock-filter] ${stockFilter}: ${stockCandidates.length} → ${filtered.length} candidates`)
      return deps.buildRecommendationResponse(
        form, filtered, evidenceMap, currentInput,
        narrowingHistory, filters, turnCount, messages, provider, language, displayedProducts
      )
    }

    if (action.type === "refine_condition") {
      const field = action.field
      const refinementText = field === "material"
        ? "어떤 소재로 변경하시겠어요?"
        : field === "diameter"
          ? "어떤 직경으로 변경하시겠어요?"
          : field === "coating"
            ? "어떤 코팅으로 변경하시겠어요?"
            : field === "fluteCount"
              ? "몇 날로 변경하시겠어요?"
              : "어떤 조건을 변경하시겠어요?"

      const refinementOptionState = buildRefinementOptionState({
        form,
        prevState,
        currentInput,
        candidates,
        filters,
        field,
        language,
        userMessage: lastUserMsg.text,
      })

      const sessionState = carryForwardState(prevState, {
        candidateCount: prevState.candidateCount ?? candidates.length,
        appliedFilters: filters,
        narrowingHistory,
        resolutionStatus: prevState.resolutionStatus ?? "broad",
        resolvedInput: currentInput,
        turnCount,
        displayedCandidates: prevState.displayedCandidates ?? [],
        displayedChips: refinementOptionState.chips,
        displayedOptions: refinementOptionState.displayedOptions,
        currentMode: "question",
        lastAction: "ask_clarification",
        lastAskedField: field,
      })

      return deps.jsonRecommendationResponse({
        text: refinementText,
        purpose: "question",
        chips: refinementOptionState.chips,
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
          latestUserMessage: lastUserMsg.text,
          currentMode: prevState.currentMode ?? null,
          routeAction: action.type,
        })),
      })
    }

    if (action.type === "compare_products") {
      const snapshot = prevState.displayedCandidates?.length
        ? prevState.displayedCandidates
        : deps.buildCandidateSnapshot(candidates, evidenceMap)
      const targets = resolveProductReferences(action.targets, snapshot)
      const comparison = await compareProducts(targets, evidenceMap, provider)
      const comparisonOptionState = buildComparisonOptionState()

      const sessionState = carryForwardState(prevState, {
        candidateCount: candidates.length,
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
      const comparisonValidation = validateOptionFirstPipeline(
        comparisonText,
        comparisonOptionState.chips,
        comparisonOptionState.displayedOptions,
      )
      if (comparisonValidation.correctedAnswer) {
        comparisonText = comparisonValidation.correctedAnswer
        console.log(`[answer-validator:compare] Softened: ${comparisonValidation.unauthorizedActions.map(actionItem => actionItem.phrase).join(",")}`)
      }

      return deps.jsonRecommendationResponse({
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
          latestUserMessage: lastUserMsg.text,
          currentMode: prevState.currentMode ?? null,
          routeAction: action.type,
        })),
      })
    }

    if (action.type === "explain_product" || action.type === "answer_general") {
      return handleServeGeneralChatAction({
        deps,
        action,
        orchResult,
        provider,
        form,
        messages,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        candidates,
        evidenceMap,
        turnCount,
      })
    }

    if (action.type === "redirect_off_topic") {
      const inquiry = analyzeInquiry(lastUserMsg.text)
      const redirect = getRedirectResponse(inquiry)
      const sessionState = carryForwardState(prevState, {
        candidateCount: prevState.candidateCount,
        appliedFilters: filters,
        narrowingHistory,
        resolutionStatus: prevState.resolutionStatus ?? "broad",
        resolvedInput: currentInput,
        turnCount,
        displayedCandidates: prevState.displayedCandidates ?? [],
        displayedChips: redirect.chips,
        displayedOptions: prevState.displayedOptions ?? [],
        currentMode: "question",
        lastAction: "redirect_off_topic",
      })

      return deps.jsonRecommendationResponse({
        text: redirect.text,
        purpose: "question",
        chips: redirect.chips,
        isComplete: false,
        recommendation: null,
        sessionState,
        evidenceSummaries: null,
        candidateSnapshot: redirect.showCandidates ? deps.buildCandidateSnapshot(candidates, evidenceMap) : null,
        requestPreparation: null,
        primaryExplanation: null,
        primaryFactChecked: null,
        altExplanations: [],
        altFactChecked: [],
      })
    }

    if (action.type === "skip_field") {
      const skipField = prevState.lastAskedField ?? "unknown"
      if (skipField === "material") {
        dropDependentWorkPieceFilters(filters)
      }
      const skipFilter: AppliedFilter = {
        field: skipField,
        op: "skip",
        value: "상관없음",
        rawValue: "skip",
        appliedAt: turnCount,
      }
      const replacedSkipState = replaceFieldFilter(
        baseInput,
        filters,
        skipFilter,
        deps.applyFilterToInput
      )
      filters.splice(0, filters.length, ...replacedSkipState.nextFilters)
      currentInput = replacedSkipState.nextInput

      const newResult = await runHybridRetrieval(currentInput, filters.filter(filter => filter.op !== "skip"))
      narrowingHistory.push({
        question: "follow-up",
        answer: lastUserMsg.text,
        extractedFilters: [skipFilter],
        candidateCountBefore: candidates.length,
        candidateCountAfter: newResult.candidates.length,
      })
      turnCount += 1

      if (replacedSkipState.replacedExisting) {
        console.log(`[orchestrator:replace] ${skipField} -> skip | filters rebuilt=${filters.length}`)
      }

      const statusAfterSkip = checkResolution(newResult.candidates, narrowingHistory)
      if (statusAfterSkip.startsWith("resolved")) {
        return deps.buildRecommendationResponse(
          form,
          newResult.candidates,
          newResult.evidenceMap,
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

      return deps.buildQuestionResponse(
        form,
        newResult.candidates,
        newResult.evidenceMap,
        currentInput,
        narrowingHistory,
        filters,
        turnCount,
        messages,
        provider,
        language
      )
    }

    if (action.type === "continue_narrowing") {
      let filter = { ...action.filter, appliedAt: turnCount }
      if (filter.field === "material") {
        dropDependentWorkPieceFilters(filters)
      }

      // ── Value Normalizer: match user input to actual DB values ──
      // Tier 1-2: exact/fuzzy (instant), Tier 3: Haiku LLM translation (~200ms)
      const candidateFieldVals = extractDistinctFieldValues(candidates as any[], filter.field)
      if (candidateFieldVals.length > 0 && typeof filter.rawValue === "string") {
        const { normalized, matchType } = await normalizeFilterValue(
          String(filter.rawValue),
          filter.field,
          candidateFieldVals,
          provider
        )
        if (matchType !== "none" && normalized !== String(filter.rawValue)) {
          console.log(`[value-normalizer] "${filter.rawValue}" → "${normalized}" (${matchType}) for field=${filter.field}`)
          filter.rawValue = normalized
          if (!filter.value.includes("(") && !filter.value.includes("개")) {
            filter.value = normalized
          }
        }
      }

      filter = await enrichWorkPieceFilterWithSeriesScope(filter, currentInput)

      const nextFilterState = replaceFieldFilter(
        baseInput,
        filters,
        filter,
        deps.applyFilterToInput
      )
      const testInput = nextFilterState.nextInput
      const testFilters = nextFilterState.nextFilters
      const testResult = await runHybridRetrieval(testInput, testFilters)

      if (testResult.candidates.length === 0) {
        console.log(`[orchestrator:guard] Filter ${filter.field}=${filter.value} would result in 0 candidates -> BLOCKED`)
        return deps.buildQuestionResponse(
          form,
          candidates,
          evidenceMap,
          currentInput,
          narrowingHistory,
          filters,
          turnCount,
          messages,
          provider,
          language,
          `"${filter.value}" 조건을 적용하면 후보가 없습니다. 현재 ${candidates.length}개 후보에서 다른 조건을 선택해주세요.`
        )
      }

      filters.splice(0, filters.length, ...testFilters)
      currentInput = testInput
      const newCandidates = testResult.candidates
      const previousCandidateCount = candidates.length

      narrowingHistory.push({
        question: prevState.narrowingHistory?.length ? "follow-up" : "initial",
        answer: lastUserMsg.text,
        extractedFilters: [filter],
        candidateCountBefore: previousCandidateCount,
        candidateCountAfter: newCandidates.length,
      })

      const existingStages = prevState.stageHistory ?? []
      const newStage: NarrowingStage = {
        stepIndex: turnCount,
        stageName: `${filter.field}_${filter.value}`,
        filterApplied: filter,
        candidateCount: newCandidates.length,
        resolvedInputSnapshot: { ...currentInput },
        filtersSnapshot: [...filters],
      }
      const updatedStages = [...existingStages, newStage]

      console.log(
        `[orchestrator:filter] ${filter.field}=${filter.value} | ${previousCandidateCount}->${newCandidates.length} candidates | stages: ${updatedStages.map(stage => stage.stageName).join(" -> ")}`
      )
      if (nextFilterState.replacedExisting) {
        console.log(`[orchestrator:replace] ${filter.field} updated to ${filter.value}`)
      }

      turnCount += 1
      const newStatus = checkResolution(newCandidates, narrowingHistory)
      if (newStatus.startsWith("resolved")) {
        return deps.buildRecommendationResponse(
          form,
          newCandidates,
          testResult.evidenceMap,
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

      return deps.buildQuestionResponse(
        form,
        newCandidates,
        testResult.evidenceMap,
        currentInput,
        narrowingHistory,
        filters,
        turnCount,
        messages,
        provider,
        language,
        undefined,
        updatedStages
      )
    }
  }

  const status = checkResolution(candidates, narrowingHistory)
  if (status.startsWith("resolved") && turnCount > 0) {
    return deps.buildRecommendationResponse(
      form,
      candidates,
      evidenceMap,
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

  return deps.buildQuestionResponse(
    form,
    candidates,
    evidenceMap,
    currentInput,
    narrowingHistory,
    filters,
    turnCount,
    messages,
    provider,
    language
  )
}
