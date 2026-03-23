import {
  analyzeInquiry,
  buildDeterministicSummary,
  buildRationale,
  buildWarnings,
  carryForwardState,
  checkResolution,
  classifyHybridResults,
  getRedirectResponse,
  normalizeInput,
  prepareRequest,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"
import {
  compareProducts,
  orchestrateTurn,
  orchestrateTurnWithTools,
  resolveProductReferences,
} from "@/lib/recommendation/infrastructure/agents/recommendation-agents"
import { ENABLE_TOOL_USE_ROUTING } from "@/lib/recommendation/infrastructure/config/recommendation-feature-flags"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { buildDisplayedOptions } from "@/lib/recommendation/infrastructure/engines/serve-engine-response"
import { buildQuestionAlignedOptions, buildConfusionHelperOptions } from "@/lib/recommendation/domain/options/question-option-builder"
import { smartOptionsToDisplayedOptions, smartOptionsToChips, buildContextAwarePlannerContext } from "@/lib/recommendation/domain/options/option-bridge"
import { generateSmartOptions } from "@/lib/recommendation/domain/options"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import { buildChipContext } from "@/lib/recommendation/domain/context/chip-context-builder"
import { rerankChipsWithLLM } from "@/lib/recommendation/domain/options/llm-chip-reranker"
import { generateContextualChips, type ChipGenerationContext } from "@/lib/recommendation/domain/options/contextual-chip-generator"
import { buildRecentInteractionFrame } from "@/lib/recommendation/domain/context/recent-interaction-frame"
import {
  recordHighlight,
  recordQA,
  recordConfusion,
  recordSkip,
  recordDelegation,
  recordExplanationPreference,
  recordFrustration,
} from "@/lib/recommendation/domain/memory/conversation-memory"
import { buildUnifiedTurnContext, type UnifiedTurnContext } from "@/lib/recommendation/domain/context/turn-context-builder"
import { checkAnswerChipDivergence, fixChipDivergence } from "@/lib/recommendation/domain/options/divergence-guard"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  ChatMessage,
  DisplayedOption,
  EvidenceSummary,
  ExplorationSessionState,
  FactCheckedRecommendation,
  NarrowingStage,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationExplanation,
  RecommendationInput,
  RecommendationResult,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

type QuestionReply = { text: string; chips: string[] } | null

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

export async function handleServeExploration(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null = null,
  language: AppLanguage = "ko"
): Promise<Response> {
  console.log(
    `[recommend] request start hasPrevState=${!!prevState} messages=${messages.length} displayedProducts=${displayedProducts?.length ?? 0}`
  )
  const provider = getProvider()
  const baseInput = deps.mapIntakeToInput(form)

  const filters: AppliedFilter[] = prevState?.appliedFilters ?? []
  const resolvedInput: RecommendationInput = prevState?.resolvedInput
    ? { ...baseInput, ...prevState.resolvedInput }
    : baseInput

  // ── Early intent classification (before heavy retrieval) ──
  // For follow-up turns with existing state, check if we can skip retrieval
  const requestPrep = prepareRequest(form, messages, prevState, resolvedInput, prevState?.candidateCount ?? 0)
  console.log(`[recommend] Intent: ${requestPrep.intent} (${requestPrep.intentConfidence}), Route: ${requestPrep.route.action}`)

  // Actions that do NOT require fresh hybrid retrieval
  const SKIP_RETRIEVAL_ACTIONS = new Set([
    "compare_products", "explain_product", "answer_general", "refine_condition",
  ])
  const lastUserMsg = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")
    : null

  // Pre-classify orchestrator action for follow-up turns to decide retrieval
  let earlyAction: string | null = null
  if (messages.length > 0 && prevState && lastUserMsg) {
    const earlyTurnCtx = {
      userMessage: lastUserMsg.text,
      intakeForm: form,
      sessionState: prevState,
      resolvedInput,
      candidateCount: prevState.candidateCount ?? 0,
      displayedProducts: prevState.displayedCandidates ?? [],
      currentCandidates: [],
    }
    const earlyOrch = ENABLE_TOOL_USE_ROUTING
      ? await orchestrateTurnWithTools(earlyTurnCtx, provider)
      : await orchestrateTurn(earlyTurnCtx, provider)
    earlyAction = earlyOrch.action.type
  }

  // Skip heavy retrieval for actions that don't need fresh candidates
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

  if (requestPrep.route.action === "reset_session") {
    return deps.jsonRecommendationResponse({
      text: "처음부터 다시 시작합니다. 새로운 조건을 입력해주세요.",
      purpose: "greeting",
      chips: ["처음부터 다시"],
      isComplete: true,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
      requestPreparation: requestPrep,
    })
  }

  const narrowingHistory: NarrowingTurn[] = prevState?.narrowingHistory ?? []
  let currentInput = { ...resolvedInput }
  let turnCount = prevState?.turnCount ?? 0

  if (messages.length > 0 && prevState) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
    if (lastUserMsg) {
      const turnCtx = {
        userMessage: lastUserMsg.text,
        intakeForm: form,
        sessionState: prevState,
        resolvedInput: currentInput,
        candidateCount: candidates.length,
        displayedProducts: deps.buildCandidateSnapshot(candidates, evidenceMap),
        currentCandidates: candidates,
      }

      const orchResult = ENABLE_TOOL_USE_ROUTING
        ? await orchestrateTurnWithTools(turnCtx, provider)
        : await orchestrateTurn(turnCtx, provider)
      const action = orchResult.action

      // ── Build Unified TurnContext (shared by answer + chip generation) ──
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === "ai")
      const unifiedCtx = buildUnifiedTurnContext({
        latestAssistantText: lastAssistantMsg?.text ?? null,
        latestUserMessage: lastUserMsg.text,
        messages,
        sessionState: prevState,
        resolvedInput: currentInput,
        intakeForm: form,
        candidates: deps.buildCandidateSnapshot(candidates, evidenceMap),
      })

      if (action.type === "reset_session") {
        return deps.jsonRecommendationResponse({
          text: "처음부터 다시 시작합니다. 새로운 조건을 입력해주세요.",
          purpose: "greeting",
          chips: ["처음부터 다시"],
          isComplete: true,
          recommendation: null,
          sessionState: null,
          evidenceSummaries: null,
          candidateSnapshot: null,
          requestPreparation: requestPrep,
        })
      }

      if (action.type === "go_back_one_step" || action.type === "go_back_to_filter") {
        const restoreResult = action.type === "go_back_to_filter"
          ? restoreToBeforeFilter(prevState, action.filterValue ?? "", action.filterField, baseInput, deps.applyFilterToInput)
          : restoreOnePreviousStep(prevState, baseInput, deps.applyFilterToInput)

        const undoResult = await runHybridRetrieval(restoreResult.rebuiltInput, restoreResult.remainingFilters.filter(f => f.op !== "skip"))

        console.log(`[session-manager:undo] Reverted "${restoreResult.removedFilterDesc}": ${prevState.candidateCount} → ${undoResult.candidates.length} candidates, filters: ${prevState.appliedFilters.length} → ${restoreResult.remainingFilters.length}`)

        return deps.buildQuestionResponse(
          form, undoResult.candidates, undoResult.evidenceMap, restoreResult.rebuiltInput,
          restoreResult.remainingHistory, restoreResult.remainingFilters, restoreResult.undoTurnCount,
          messages, provider, language, undefined, restoreResult.remainingStages
        )
      }

      if (action.type === "show_recommendation") {
        return deps.buildRecommendationResponse(
          form, candidates, evidenceMap, currentInput, narrowingHistory,
          filters, turnCount, messages, provider, language, displayedProducts
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

        // ── Option-first: build structured options FIRST, then derive chips ──
        const { plannerCtx: refinePlannerCtx } = buildContextAwarePlannerContext(
          form, prevState, currentInput, lastUserMsg.text,
          candidates, filters, field
        )
        const refineSmartOptions = generateSmartOptions({
          plannerCtx: refinePlannerCtx,
          simulatorCtx: {
            candidateCount: candidates.length,
            appliedFilters: filters.map(f => ({ field: f.field, op: f.op, value: f.value, rawValue: f.rawValue })),
          },
          rankerCtx: {
            candidateCount: candidates.length,
            filterCount: filters.length,
            hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
          },
        })
        const refineDisplayedOptions = refineSmartOptions.length > 0
          ? smartOptionsToDisplayedOptions(refineSmartOptions)
          : buildDisplayedOptions(buildRefinementChips(field, "ko"), field)
        const refinementChips = refineSmartOptions.length > 0
          ? smartOptionsToChips(refineSmartOptions)
          : buildRefinementChips(field, "ko")

        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount ?? candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevState.displayedCandidates ?? [],
          displayedChips: refinementChips,
          displayedOptions: refineDisplayedOptions,
          currentMode: "question",
          lastAction: "ask_clarification",
          lastAskedField: field,
        })
        return deps.jsonRecommendationResponse({
          text: refinementText,
          purpose: "question",
          chips: refinementChips,
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

      if (action.type === "compare_products") {
        const snapshot = prevState.displayedCandidates?.length > 0
          ? prevState.displayedCandidates
          : deps.buildCandidateSnapshot(candidates, evidenceMap)
        const targets = resolveProductReferences(action.targets, snapshot)
        const compResult = await compareProducts(targets, evidenceMap, provider)

        // ── Option-first: build structured comparison options ──
        const compOptions: import("@/lib/recommendation/domain/options/types").SmartOption[] = [
          { id: "comp-recommend", family: "action", label: "추천해주세요", value: "추천해주세요", plan: { type: "apply_filter", patches: [] }, projectedCount: null, projectedDelta: null, preservesContext: true, destructive: false, recommended: true, priorityScore: 90 },
          { id: "comp-other", family: "explore", label: "다른 조건으로", value: "다른 조건으로", plan: { type: "branch_session", patches: [] }, projectedCount: null, projectedDelta: null, preservesContext: false, destructive: false, recommended: false, priorityScore: 70 },
          { id: "comp-back", family: "action", label: "⟵ 이전 단계", value: "⟵ 이전 단계", plan: { type: "apply_filter", patches: [] }, projectedCount: null, projectedDelta: null, preservesContext: true, destructive: false, recommended: false, priorityScore: 50 },
          { id: "comp-reset", family: "reset", label: "처음부터 다시", value: "처음부터 다시", plan: { type: "reset_session", patches: [] }, projectedCount: null, projectedDelta: null, preservesContext: false, destructive: true, recommended: false, priorityScore: 10 },
        ]
        const compDisplayedOptions = smartOptionsToDisplayedOptions(compOptions)
        const compChips = smartOptionsToChips(compOptions)

        const sessionState = carryForwardState(prevState, {
          candidateCount: candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: snapshot,
          displayedChips: compChips,
          displayedOptions: compDisplayedOptions,
          currentMode: "comparison",
          lastAction: "compare_products",
        })

        // ── Post-Answer Validator: constrain comparison answer ──
        let compAnswerText = compResult.text
        const compValidation = validateOptionFirstPipeline(compAnswerText, compChips, compDisplayedOptions)
        if (compValidation.correctedAnswer) {
          compAnswerText = compValidation.correctedAnswer
          console.log(`[answer-validator:compare] Softened: ${compValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
        }

        return deps.jsonRecommendationResponse({
          text: compAnswerText,
          purpose: "comparison",
          chips: compChips,
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
          meta: {
            orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
          },
        })
      }

      if (action.type === "explain_product" || action.type === "answer_general") {
        const inventoryReply = await deps.handleDirectInventoryQuestion(lastUserMsg.text, prevState)
        if (inventoryReply) {
          // ── Option-first: preserve existing state displayedOptions ──
          // Handler-generated chips are informational context, not actionable options.
          // Carry forward structured displayedOptions from previous state.
          const invChips = prevState.displayedChips?.length > 0
            ? prevState.displayedChips
            : inventoryReply.chips
          const invDisplayedOptions = prevState.displayedOptions ?? []

          // ── Post-Answer Validator ──
          let invAnswerText = inventoryReply.text
          const invValidation = validateOptionFirstPipeline(invAnswerText, invChips, invDisplayedOptions)
          if (invValidation.correctedAnswer) {
            invAnswerText = invValidation.correctedAnswer
            console.log(`[answer-validator:inventory] Softened: ${invValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
          }

          const sessionState = carryForwardState(prevState, {
            candidateCount: prevState.candidateCount ?? candidates.length,
            appliedFilters: filters,
            narrowingHistory,
            resolutionStatus: prevState.resolutionStatus ?? "broad",
            resolvedInput: currentInput,
            turnCount,
            displayedCandidates: prevState.displayedCandidates ?? [],
            displayedChips: invChips,
            displayedOptions: invDisplayedOptions,
            currentMode: "general_chat",
            lastAction: "answer_general",
          })
          return deps.jsonRecommendationResponse({
            text: invAnswerText,
            purpose: "general_chat",
            chips: invChips,
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

        const cuttingConditionReply = await deps.handleDirectCuttingConditionQuestion(lastUserMsg.text, currentInput, prevState)
        if (cuttingConditionReply) {
          // ── Option-first: preserve existing state displayedOptions ──
          const ccChips = prevState.displayedChips?.length > 0
            ? prevState.displayedChips
            : cuttingConditionReply.chips
          const ccDisplayedOptions = prevState.displayedOptions ?? []

          // ── Post-Answer Validator ──
          let ccAnswerText = cuttingConditionReply.text
          const ccValidation = validateOptionFirstPipeline(ccAnswerText, ccChips, ccDisplayedOptions)
          if (ccValidation.correctedAnswer) {
            ccAnswerText = ccValidation.correctedAnswer
            console.log(`[answer-validator:cutting-condition] Softened: ${ccValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
          }

          const sessionState = carryForwardState(prevState, {
            candidateCount: prevState.candidateCount ?? candidates.length,
            appliedFilters: filters,
            narrowingHistory,
            resolutionStatus: prevState.resolutionStatus ?? "broad",
            resolvedInput: currentInput,
            turnCount,
            displayedCandidates: prevState.displayedCandidates ?? [],
            displayedChips: ccChips,
            displayedOptions: ccDisplayedOptions,
            currentMode: "general_chat",
            lastAction: "answer_general",
          })
          return deps.jsonRecommendationResponse({
            text: ccAnswerText,
            purpose: "general_chat",
            chips: ccChips,
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

        if (action.type === "explain_product") {
          const contextReply = await deps.handleContextualNarrowingQuestion(
            provider, lastUserMsg.text, currentInput, candidates, prevState
          )
          if (contextReply) {
            // ── Question Assist Mode ──
            // If a pending question exists (lastAskedField), this is explanation
            // WITHIN the question flow. Preserve the question anchor.
            const hasPendingField = !!prevState.lastAskedField && !prevState.resolutionStatus?.startsWith("resolved")

            if (prevState.resolutionStatus?.startsWith("resolved")) {
              // ── Option-first: preserve existing structured options from state ──
              // Do NOT parse contextReply text to generate chips.
              const ctxChips = prevState.displayedChips ?? ["대체 후보 보기", "절삭조건 알려줘", "처음부터 다시"]
              const ctxDisplayedOptions = prevState.displayedOptions ?? []

              const sessionState = carryForwardState(prevState, {
                candidateCount: prevState.candidateCount ?? candidates.length,
                appliedFilters: filters,
                narrowingHistory,
                resolutionStatus: prevState.resolutionStatus,
                resolvedInput: currentInput,
                turnCount,
                displayedCandidates: prevState.displayedCandidates ?? [],
                displayedChips: ctxChips,
                displayedOptions: ctxDisplayedOptions,
                currentMode: "general_chat",
                lastAction: "explain_product",
              })
              return deps.jsonRecommendationResponse({
                text: contextReply,
                purpose: "general_chat",
                chips: ctxChips,
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

            if (hasPendingField) {
              // ── Question Assist: explain within pending question ──
              // Preserve lastAskedField, keep currentMode as "question",
              // generate helper chips merged with original field options
              const prevQuestion = reconstructPreviousQuestion(prevState)
              const userState = detectUserState(lastUserMsg.text, prevState.lastAskedField)
              const helperOptions = buildConfusionHelperOptions(prevQuestion, userState.confusedAbout)

              // Merge: helpers first, then original field options
              const originalOptions = prevQuestion
                ? buildQuestionAlignedOptions(prevQuestion)
                : []
              const mergedOptions = [...helperOptions, ...originalOptions]
              const assistChips = smartOptionsToChips(mergedOptions)
              const assistDisplayedOptions = smartOptionsToDisplayedOptions(mergedOptions)

              console.log(`[question-assist] Explanation within pending field "${prevState.lastAskedField}", ${assistChips.length} chips (${helperOptions.length} helpers + ${originalOptions.length} field options)`)

              const sessionState = carryForwardState(prevState, {
                candidateCount: prevState.candidateCount ?? candidates.length,
                appliedFilters: filters,
                narrowingHistory,
                resolutionStatus: prevState.resolutionStatus ?? "narrowing",
                resolvedInput: currentInput,
                turnCount,
                displayedCandidates: prevState.displayedCandidates ?? [],
                displayedChips: assistChips,
                displayedOptions: assistDisplayedOptions,
                // CRITICAL: preserve question mode and field anchor
                currentMode: "question",
                lastAction: "explain_product",
                lastAskedField: prevState.lastAskedField,
              })
              return deps.jsonRecommendationResponse({
                text: contextReply,
                purpose: "question",
                chips: assistChips,
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

            return deps.buildQuestionResponse(
              form, candidates, evidenceMap, currentInput,
              narrowingHistory, filters, turnCount, messages, provider, language,
              contextReply
            )
          }
        }

        const preGenerated = action.type === "answer_general" && action.preGenerated && action.message
        let llmResponse: { text: string; chips: string[] }
        if (preGenerated) {
          llmResponse = { text: action.message, chips: [] }
        } else {
          llmResponse = await deps.handleGeneralChat(provider, lastUserMsg.text, currentInput, candidates, form, prevState.displayedCandidates)
        }

        // ── Option-first Chip Pipeline ──
        // STEP 1: Build structured options from state (SmartOption engine)
        // STEP 2: Build recentFrame for contextual awareness
        // STEP 3: LLM rerank for semantic ordering
        // Handler-generated chips are NEVER used as source of truth.
        const userStateResult = detectUserState(lastUserMsg.text, prevState.lastAskedField)

        // STEP 1: SmartOption engine — structural options from session state
        const { plannerCtx: generalPlannerCtx, interpretation: generalInterpretation } = buildContextAwarePlannerContext(
          form, prevState, currentInput, lastUserMsg.text,
          candidates, filters, prevState.lastAskedField ?? undefined
        )
        const generalSmartOptions = generateSmartOptions({
          plannerCtx: generalPlannerCtx,
          simulatorCtx: {
            candidateCount: candidates.length,
            appliedFilters: filters.map(f => ({ field: f.field, op: f.op, value: f.value, rawValue: f.rawValue })),
          },
          rankerCtx: {
            candidateCount: candidates.length,
            filterCount: filters.length,
            hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
            userMessage: lastUserMsg.text,
            contextInterpretation: generalInterpretation,
          },
        })

        // STEP 2: Build recentFrame for contextual signal
        const lastAssistantForFrame = [...messages].reverse().find(m => m.role === "ai")
        const generalFrame = buildRecentInteractionFrame(
          lastAssistantForFrame?.text ?? llmResponse.text,
          lastUserMsg.text,
          prevState
        )

        // STEP 3: LLM rerank if smart options available
        let finalChips: string[]
        let finalDisplayedOptions: DisplayedOption[]
        if (generalSmartOptions.length > 0) {
          const chipCtxForRerank = buildChipContext(
            prevState, currentInput, lastUserMsg.text,
            lastAssistantForFrame?.text ?? llmResponse.text,
            null, userStateResult.state, userStateResult.confusedAbout,
            messages.map(m => ({ role: m.role, text: m.text }))
          )
          const reranked = await rerankChipsWithLLM(generalSmartOptions, chipCtxForRerank, provider)
          finalChips = smartOptionsToChips(reranked.options)
          finalDisplayedOptions = smartOptionsToDisplayedOptions(reranked.options)
          console.log(`[option-first:general] SmartOptions=${generalSmartOptions.length}, reranked=${reranked.rerankedByLLM}, frame=${generalFrame.relation}, chips=${finalChips.join(",")}`)
        } else {
          // Fallback: preserve state chips if no smart options generated
          finalChips = prevState.displayedChips?.length > 0
            ? prevState.displayedChips
            : llmResponse.chips
          finalDisplayedOptions = prevState.displayedOptions ?? []
        }

        // ── Record user signals into persistent memory ──
        const persistedMemory = prevState.conversationMemory
        if (persistedMemory) {
          if (userStateResult.state === "confused") {
            recordConfusion(persistedMemory, prevState.lastAskedField ?? "unknown")
            recordHighlight(persistedMemory, turnCount, "confusion", `${prevState.lastAskedField ?? "unknown"} 필드에서 혼란`, prevState.lastAskedField ?? undefined)
          }
          if (userStateResult.state === "wants_delegation") {
            recordDelegation(persistedMemory)
            recordHighlight(persistedMemory, turnCount, "preference", "사용자가 시스템에 위임 선호")
          }
          if (userStateResult.state === "wants_explanation") {
            recordExplanationPreference(persistedMemory)
          }
          if (userStateResult.state === "wants_skip" && prevState.lastAskedField) {
            recordSkip(persistedMemory, prevState.lastAskedField)
          }
          // Record Q&A pair
          if (prevState.lastAskedField && lastUserMsg.text) {
            recordQA(persistedMemory, prevState.lastAskedField, lastUserMsg.text, prevState.lastAskedField, turnCount)
          }
        }

        // Priority 1: State-based pending question from session (NOT answer text)
        // lastAskedField가 있고 resolved가 아니면 pending question이 있는 것.
        // displayedOptions가 비어있어도 reconstructPreviousQuestion으로 복원 가능.
        const hasStatePendingQuestion = !!prevState.lastAskedField
          && !prevState.resolutionStatus?.startsWith("resolved")
        if (hasStatePendingQuestion) {
          let prevQuestion = reconstructPreviousQuestion(prevState)

          // Safety net: if reconstructPreviousQuestion fails (displayedOptions AND chips empty),
          // build question options directly from candidate field values
          if (!prevQuestion && prevState.lastAskedField && candidates.length > 0) {
            const fieldKey = prevState.lastAskedField
            const fieldGetter: Record<string, (p: ScoredProduct) => string | number | null> = {
              fluteCount: p => p.product.fluteCount,
              coating: p => p.product.coating,
              seriesName: p => p.product.seriesName,
              toolSubtype: p => p.product.toolSubtype,
            }
            const getter = fieldGetter[fieldKey]
            if (getter) {
              const valueCounts = new Map<string, number>()
              for (const c of candidates) {
                const val = getter(c)
                if (val != null) {
                  const strVal = fieldKey === "fluteCount" ? `${val}날` : String(val)
                  valueCounts.set(strVal, (valueCounts.get(strVal) ?? 0) + 1)
                }
              }
              if (valueCounts.size > 0) {
                const extractedOptions = Array.from(valueCounts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([v]) => v)
                prevQuestion = {
                  shape: "constrained_options",
                  questionText: "",
                  extractedOptions,
                  field: fieldKey,
                  isBinary: false,
                  hasExplicitChoices: true,
                }
                console.log(`[option-first:safety] Rebuilt pending question from candidates: field=${fieldKey}, options=${extractedOptions.join(",")}`)
              }
            }
          }

          let questionOptions = prevQuestion ? buildQuestionAlignedOptions(prevQuestion) : []

          // Priority 2: If user is confused, merge helper chips
          if (userStateResult.state === "confused" || userStateResult.state === "wants_explanation" || userStateResult.state === "wants_delegation") {
            const helperOptions = buildConfusionHelperOptions(prevQuestion, userStateResult.confusedAbout)
            questionOptions = [...helperOptions, ...questionOptions]
            console.log(`[option-first] User state: ${userStateResult.state}, ${helperOptions.length} helpers merged (field=${prevQuestion?.field ?? "none"})`)
          }

          if (questionOptions.length > 0) {
            finalChips = smartOptionsToChips(questionOptions)
            finalDisplayedOptions = smartOptionsToDisplayedOptions(questionOptions)
            console.log(`[option-first] State-based pending question field="${prevState.lastAskedField}", ${finalChips.length} chips`)
          }
        } else if (userStateResult.state === "confused" || userStateResult.state === "wants_explanation" || userStateResult.state === "wants_delegation") {
          // No pending question in current response, but user is confused
          // → reconstruct previous question context AND merge original field options
          const prevQuestion = reconstructPreviousQuestion(prevState)
          const helperOptions = buildConfusionHelperOptions(prevQuestion, userStateResult.confusedAbout)
          // Also include original field options so user can still answer the question
          const originalOptions = prevQuestion
            ? buildQuestionAlignedOptions(prevQuestion)
            : []
          const mergedOptions = [...helperOptions, ...originalOptions]
          if (mergedOptions.length > 0) {
            finalChips = smartOptionsToChips(mergedOptions)
            finalDisplayedOptions = smartOptionsToDisplayedOptions(mergedOptions)
            console.log(`[question-assist] User ${userStateResult.state}, ${helperOptions.length} helpers + ${originalOptions.length} field options (field=${prevQuestion?.field ?? "none"})`)
          }
        }

        // ── Post-Answer Validator: strip unauthorized actions from answer ──
        // Direction: displayedOptions → constrain answer (NEVER answer → add chips)
        const answerValidation = validateOptionFirstPipeline(llmResponse.text, finalChips, finalDisplayedOptions)
        if (answerValidation.correctedAnswer) {
          llmResponse = { text: answerValidation.correctedAnswer, chips: llmResponse.chips }
          console.log(`[answer-validator:general] Softened unauthorized actions: ${answerValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
        }

        // ── Question Assist: preserve question mode if pending field exists ──
        const isQuestionAssist = !!prevState.lastAskedField
          && !prevState.resolutionStatus?.startsWith("resolved")
          && (userStateResult.state === "confused" || userStateResult.state === "wants_explanation" || userStateResult.state === "wants_delegation")
        const effectiveMode = isQuestionAssist ? "question" : "general_chat"
        const effectivePurpose = isQuestionAssist ? "question" : "general_chat"

        if (isQuestionAssist) {
          console.log(`[question-assist] Preserving question mode for field="${prevState.lastAskedField}" during ${userStateResult.state}`)
        }

        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount ?? candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevState.displayedCandidates ?? [],
          displayedChips: finalChips,
          displayedOptions: finalDisplayedOptions,
          currentMode: effectiveMode,
          lastAction: isQuestionAssist ? "explain_product" : "answer_general",
          lastAskedField: isQuestionAssist ? prevState.lastAskedField : undefined,
          conversationMemory: persistedMemory ?? prevState.conversationMemory,
        })
        return deps.jsonRecommendationResponse({
          text: llmResponse.text,
          purpose: effectivePurpose as any,
          chips: finalChips,
          isComplete: false,
          recommendation: null,
          sessionState,
          evidenceSummaries: null,
          candidateSnapshot: candidates.length > 0 ? deps.buildCandidateSnapshot(candidates, evidenceMap) : null,
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
        const skipFilter: AppliedFilter = {
          field: skipField, op: "skip", value: "상관없음", rawValue: "skip", appliedAt: turnCount,
        }
        filters.push(skipFilter)
        currentInput = deps.applyFilterToInput(currentInput, skipFilter)

        const newResult = await runHybridRetrieval(currentInput, filters.filter(f => f.op !== "skip"))
        narrowingHistory.push({
          question: "follow-up",
          answer: lastUserMsg.text,
          extractedFilters: [skipFilter],
          candidateCountBefore: candidates.length,
          candidateCountAfter: newResult.candidates.length,
        })
        turnCount++

        const statusAfterSkip = checkResolution(newResult.candidates, narrowingHistory)
        if (statusAfterSkip.startsWith("resolved")) {
          return deps.buildRecommendationResponse(form, newResult.candidates, newResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, displayedProducts)
        }
        return deps.buildQuestionResponse(form, newResult.candidates, newResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language)
      }

      if (action.type === "continue_narrowing") {
        const filter = { ...action.filter, appliedAt: turnCount }
        const testInput = deps.applyFilterToInput(currentInput, filter)
        const testFilters = [...filters, filter]
        const testResult = await runHybridRetrieval(testInput, testFilters)

        if (testResult.candidates.length === 0) {
          console.log(`[orchestrator:guard] Filter ${filter.field}=${filter.value} would result in 0 candidates — BLOCKED`)
          return deps.buildQuestionResponse(
            form, candidates, evidenceMap, currentInput,
            narrowingHistory, filters, turnCount, messages, provider, language,
            `"${filter.value}" 조건을 적용하면 후보가 없습니다. 현재 ${candidates.length}개 후보에서 다른 조건을 선택해주세요.`
          )
        }

        filters.push(filter)
        currentInput = testInput
        const newCandidates = testResult.candidates
        const prevCandidateCount = candidates.length

        narrowingHistory.push({
          question: prevState.narrowingHistory?.length ? "follow-up" : "initial",
          answer: lastUserMsg.text,
          extractedFilters: [filter],
          candidateCountBefore: prevCandidateCount,
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

        console.log(`[orchestrator:filter] ${filter.field}=${filter.value} | ${prevCandidateCount}→${newCandidates.length} candidates | stages: ${updatedStages.map(s => s.stageName).join(" → ")}`)

        turnCount++

        const newStatus = checkResolution(newCandidates, narrowingHistory)
        if (newStatus.startsWith("resolved")) {
          return deps.buildRecommendationResponse(form, newCandidates, testResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, displayedProducts)
        }

        return deps.buildQuestionResponse(form, newCandidates, testResult.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, undefined, updatedStages)
      }
    }
  }

  const status = checkResolution(candidates, narrowingHistory)
  if (status.startsWith("resolved") && turnCount > 0) {
    return deps.buildRecommendationResponse(
      form, candidates, evidenceMap, currentInput, narrowingHistory,
      filters, turnCount, messages, provider, language, displayedProducts
    )
  }

  return deps.buildQuestionResponse(
    form, candidates, evidenceMap, currentInput, narrowingHistory,
    filters, turnCount, messages, provider, language
  )
}

export async function handleServeSimpleChat(
  deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse" | "getFollowUpChips" | "buildSourceSummary">,
  messages: ChatMessage[],
  mode: string
): Promise<Response> {
  if (!messages.length) {
    return deps.jsonRecommendationResponse({
      error: "bad_request",
      detail: "messages required",
      text: "메시지가 필요합니다.",
      purpose: "question",
      chips: [],
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    }, { status: 400 })
  }

  const latestUserMsg = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
  const baseInput = normalizeInput(latestUserMsg)
  const hasEnough = !!(baseInput.diameterMm || (baseInput.material && baseInput.operationType))

  if (hasEnough) {
    const result = await runHybridRetrieval(baseInput, [], 5)
    const { primary, alternatives, status } = classifyHybridResults(result)
    const warnings = primary ? buildWarnings(primary, baseInput) : []
    const rationale = primary ? buildRationale(primary, baseInput) : []

    const deterministicSummary = buildDeterministicSummary({
      status,
      query: baseInput,
      primaryProduct: primary,
      alternatives,
      warnings,
      rationale,
      sourceSummary: [],
      deterministicSummary: "",
      llmSummary: null,
      totalCandidatesConsidered: result.totalConsidered,
    })

    const recommendation: RecommendationResult = {
      status,
      query: baseInput,
      primaryProduct: primary,
      alternatives,
      warnings,
      rationale,
      sourceSummary: primary ? deps.buildSourceSummary(primary) : [],
      deterministicSummary,
      llmSummary: null,
      totalCandidatesConsidered: result.totalConsidered,
    }

    let quickText = deterministicSummary
    if (primary && primary.product.brand) {
      const brandName = primary.product.brand
      const hasBrand = quickText.includes(brandName) || /브랜드명/.test(quickText)
      if (!hasBrand) {
        quickText = `**브랜드명:** ${brandName} | **제품코드:** ${primary.product.displayCode}\n\n${quickText}`
      }
    }

    return deps.jsonRecommendationResponse({
      text: quickText,
      purpose: "recommendation",
      chips: deps.getFollowUpChips(recommendation),
      isComplete: true,
      recommendation,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    })
  }

  return deps.jsonRecommendationResponse({
    text: getNextQuestion(baseInput),
    purpose: "question",
    chips: getDefaultChips(baseInput),
    isComplete: false,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
  })
}

function getNextQuestion(input: RecommendationInput): string {
  if (!input.material) return "어떤 소재를 가공하실 예정인가요?"
  if (!input.operationType) return "어떤 가공 방식이 필요하신가요? (황삭/정삭/고이송 등)"
  if (!input.diameterMm) return "공구 직경은 몇 mm가 필요하신가요?"
  if (!input.flutePreference) return "날 수(flute) 선호도가 있으신가요?"
  return "추가로 확인이 필요한 조건이 있으신가요?"
}

function getDefaultChips(input: RecommendationInput): string[] {
  if (!input.material) return ["알루미늄", "스테인리스", "탄소강", "주철", "티타늄", "고경도강"]
  if (!input.operationType) return ["황삭", "정삭", "고이송", "슬롯가공", "측면가공"]
  if (!input.diameterMm) return ["2mm", "4mm", "6mm", "8mm", "10mm", "12mm"]
  if (!input.flutePreference) return ["2날", "3날", "4날", "6날", "상관없음"]
  return ["추천 받기", "다른 조건으로", "경쟁사 비교"]
}

/**
 * Reconstruct a PendingQuestion from the previous session state.
 * Used when the user is confused about options that were shown in the previous turn.
 */
function reconstructPreviousQuestion(
  prevState: ExplorationSessionState
): import("@/lib/recommendation/domain/context/pending-question-detector").PendingQuestion | null {
  const field = prevState.lastAskedField ?? null
  const prevOptions = prevState.displayedOptions ?? []
  const prevChips = prevState.displayedChips ?? []

  // Extract option values from displayedOptions (structured)
  let extractedOptions: string[] = []
  if (prevOptions.length > 0) {
    extractedOptions = prevOptions
      .map(o => o.value)
      .filter(v => v && !["상관없음", "skip", "처음부터 다시", "⟵ 이전 단계", "추천해주세요"].includes(v))
  } else if (prevChips.length > 0) {
    // Fallback: extract from chips
    extractedOptions = prevChips
      .filter(c => !["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요"].includes(c))
      .map(c => c.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim())
      .filter(c => c.length > 0)
  }

  if (extractedOptions.length === 0) return null

  return {
    shape: "constrained_options",
    questionText: "",
    extractedOptions,
    field,
    isBinary: false,
    hasExplicitChoices: true,
  }
}

function generateFollowUpChips(userMessage: string, candidateCount: number): string[] {
  const lower = userMessage.toLowerCase()

  if (/코팅|tialn|alcrn|dlc/i.test(lower)) {
    return ["코팅별 적합 소재", "무코팅 vs DLC", "소재별 추천 코팅", "제품 추천"]
  }
  if (/소재|알루|스테인|주철|티타늄|가공/i.test(lower)) {
    return ["절삭조건 알려줘", "추천 코팅은?", "주의사항 더 알려줘", "제품 추천"]
  }
  if (/시스템|점수|매칭|어떻게/i.test(lower)) {
    return ["점수 기준 설명", "소재 태그 뜻", "팩트 체크란?", "제품 추천"]
  }
  if (candidateCount > 0) {
    return ["후보 제품 보기", "절삭조건 문의", "코팅 비교", "처음부터 다시"]
  }
  return ["제품 추천", "절삭조건 문의", "코팅 비교", "시리즈 검색"]
}

function buildRefinementChips(field: string, _language: AppLanguage): string[] {
  switch (field) {
    case "material":
      return ["알루미늄 / 비철", "일반강 / 탄소강", "스테인리스 (SUS)", "주철", "티타늄 / 내열합금", "고경도강 (HRC40+)", "처음부터 다시"]
    case "diameter":
      return ["2mm", "4mm", "6mm", "8mm", "10mm", "12mm", "처음부터 다시"]
    case "coating":
      return ["TiAlN", "AlCrN", "DLC", "무코팅", "Y-코팅", "처음부터 다시"]
    case "fluteCount":
      return ["1날", "2날", "3날", "4날", "6날", "처음부터 다시"]
    default:
      return ["현재 필터 유지하고 추천 보기", "처음부터 다시"]
  }
}

/**
 * Build ChipGenerationContext from runtime state for contextual chip generation.
 */
function buildChipGenContext(
  assistantText: string,
  userMessage: string | null,
  mode: ChipGenerationContext["mode"],
  resolvedInput: RecommendationInput,
  filters: AppliedFilter[],
  sessionState: ExplorationSessionState | null,
  messages: ChatMessage[],
  currentCandidates?: ScoredProduct[]
): ChipGenerationContext {
  // Extract actual candidate field value distributions
  let candidateFieldValues: Record<string, Array<{ value: string; count: number }>> | undefined
  if (currentCandidates && currentCandidates.length > 0) {
    candidateFieldValues = {}
    const fieldExtractors: Array<{ key: string; getter: (p: ScoredProduct) => string | number | null | undefined }> = [
      { key: "fluteCount", getter: p => p.product.fluteCount },
      { key: "coating", getter: p => p.product.coating },
      { key: "seriesName", getter: p => p.product.seriesName },
      { key: "toolSubtype", getter: p => p.product.toolSubtype },
    ]
    for (const { key, getter } of fieldExtractors) {
      const counts = new Map<string, number>()
      for (const c of currentCandidates) {
        const val = getter(c)
        if (val != null) {
          const strVal = key === "fluteCount" ? `${val}날` : String(val)
          counts.set(strVal, (counts.get(strVal) ?? 0) + 1)
        }
      }
      if (counts.size > 1) {
        const sorted = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({ value, count }))
        candidateFieldValues[key] = sorted
      }
    }
  } else if (sessionState?.displayedCandidates && sessionState.displayedCandidates.length > 0) {
    // Fall back to session snapshot data
    candidateFieldValues = {}
    const snapFields: Array<{ key: string; getter: (c: CandidateSnapshot) => string | number | null }> = [
      { key: "fluteCount", getter: c => c.fluteCount },
      { key: "coating", getter: c => c.coating },
      { key: "seriesName", getter: c => c.seriesName },
    ]
    for (const { key, getter } of snapFields) {
      const counts = new Map<string, number>()
      for (const c of sessionState.displayedCandidates) {
        const val = getter(c)
        if (val != null) {
          const strVal = key === "fluteCount" ? `${val}날` : String(val)
          counts.set(strVal, (counts.get(strVal) ?? 0) + 1)
        }
      }
      if (counts.size > 1) {
        candidateFieldValues[key] = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([value, count]) => ({ value, count }))
      }
    }
  }

  return {
    assistantText,
    userMessage,
    mode,
    resolvedConditions: {
      material: resolvedInput.material ?? null,
      operationType: resolvedInput.operationType ?? null,
      diameterMm: resolvedInput.diameterMm ?? null,
      fluteCount: resolvedInput.flutePreference ?? null,
      coating: resolvedInput.coatingPreference ?? null,
    },
    appliedFilters: filters.filter(f => f.op !== "skip").map(f => ({ field: f.field, value: f.value })),
    candidateCount: sessionState?.candidateCount ?? currentCandidates?.length ?? 0,
    displayedProducts: (sessionState?.displayedCandidates ?? []).slice(0, 5).map(c => ({
      code: c.displayCode,
      series: c.seriesName,
      coating: c.coating,
    })),
    lastAskedField: sessionState?.lastAskedField ?? null,
    recentTurns: messages.slice(-8).map(m => ({ role: m.role, text: m.text })),
    recommendationStatus: sessionState?.resolutionStatus ?? null,
    candidateFieldValues,
    conversationMemory: sessionState?.conversationMemory ?? null,
    recentFrame: userMessage
      ? buildRecentInteractionFrame(assistantText, userMessage, sessionState)
      : null,
  }
}
