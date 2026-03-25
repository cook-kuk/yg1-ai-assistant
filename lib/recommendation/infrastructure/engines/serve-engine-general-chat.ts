import { carryForwardState } from "@/lib/recommendation/domain/recommendation-domain"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import {
  recordConfusion,
  recordDelegation,
  recordExplanationPreference,
  recordHighlight,
  recordQA,
  recordSkip,
} from "@/lib/recommendation/domain/memory/conversation-memory"
import { createEmptyConversationLog, recordTurn, type ProcessTrace, type RichTurnRecord } from "@/lib/recommendation/domain/memory/memory-compressor"
import { buildUnifiedTurnContext } from "@/lib/recommendation/domain/context/turn-context-builder"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import {
  buildGeneralChatOptionState,
  buildQuestionAssistOptions,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { shouldAttemptWebSearchFallback } from "@/lib/recommendation/infrastructure/engines/serve-engine-assist"
import { buildFinalChipsFromLLM } from "@/lib/recommendation/domain/options/llm-chip-pipeline"
import { resolveYG1Query } from "@/lib/knowledge/knowledge-router"
import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { OrchestratorAction, OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  CandidateSnapshot,
  ChatMessage,
  DisplayedOption,
  EvidenceSummary,
  ExplorationSessionState,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

type QuestionReply = { text: string; chips: string[] } | null

// ── Reply UI Strategy ──
// Determines how displayedOptions/chips are resolved for reply paths.
export type ReplyUiStrategy =
  | "preserve_existing_question_options"  // question-assist: keep field-bound options from pending question
  | "replace_with_reply_options"          // direct factual reply: use handler-provided follow-up actions
  | "clear_options"                       // fallback: no actionable options

type GeneralChatAction =
  | Extract<OrchestratorAction, { type: "explain_product" }>
  | Extract<OrchestratorAction, { type: "answer_general" }>

interface ReplyOverrides {
  purpose: "general_chat" | "question"
  currentMode: "general_chat" | "question"
  lastAction: "answer_general" | "explain_product"
  lastAskedField?: string
  candidateSnapshot?: CandidateSnapshot[] | null
}

export interface ServeEngineGeneralChatDependencies {
  buildCandidateSnapshot: (
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>
  ) => CandidateSnapshot[]
  handleDirectInventoryQuestion: (
    userMessage: string,
    prevState: ExplorationSessionState
  ) => Promise<QuestionReply>
  handleDirectEntityProfileQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState | null
  ) => Promise<QuestionReply>
  handleDirectProductInfoQuestion?: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState | null
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
    provider: LLMProvider,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    prevState: ExplorationSessionState,
    messages?: ChatMessage[],
  ) => Promise<string | null>
  handleGeneralChat: (
    provider: LLMProvider,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    form: ProductIntakeForm,
    displayedCandidatesContext?: CandidateSnapshot[],
    messages?: ChatMessage[],
    prevState?: ExplorationSessionState,
  ) => Promise<{ text: string; chips: string[] }>
  jsonRecommendationResponse: JsonRecommendationResponse
}

interface HandleGeneralChatActionParams {
  deps: ServeEngineGeneralChatDependencies
  action: GeneralChatAction
  orchResult: OrchestratorResult
  provider: LLMProvider
  form: ProductIntakeForm
  messages: ChatMessage[]
  prevState: ExplorationSessionState
  filters: AppliedFilter[]
  narrowingHistory: NarrowingTurn[]
  currentInput: RecommendationInput
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  turnCount: number
}

function buildActionMeta(
  actionType: OrchestratorAction["type"],
  orchResult: OrchestratorResult
) {
  return {
    orchestratorResult: {
      action: actionType,
      agents: orchResult.agentsInvoked,
      opus: orchResult.escalatedToOpus,
    },
  }
}

function buildProcessTrace(params: {
  actionType: string
  pendingQuestionField: string | null
  recentFrameRelation: string | null
  displayedOptions: ExplorationSessionState["displayedOptions"]
  validatorRewrites?: string[]
  memoryTransitions?: ProcessTrace["memoryTransitions"]
}): ProcessTrace {
  const optionFamiliesGenerated = Array.from(
    new Set((params.displayedOptions ?? []).map(option => option.field ?? "_action"))
  )

  return {
    routeAction: params.actionType,
    pendingQuestionField: params.pendingQuestionField,
    recentFrameRelation: params.recentFrameRelation,
    optionFamiliesGenerated,
    selectedOptionIds: (params.displayedOptions ?? []).map(option => `${option.field}:${option.value}`),
    validatorRewrites: params.validatorRewrites ?? [],
    memoryTransitions: params.memoryTransitions ?? [],
  }
}

function inferVisibleUiBlocks(sessionState: ExplorationSessionState): string[] {
  const blocks: string[] = []
  if (sessionState.displayedOptions?.length) blocks.push("question_prompt")
  if (sessionState.displayedChips?.length) blocks.push("chips_bar")
  if (sessionState.lastRecommendationArtifact?.length || sessionState.currentMode === "recommendation") {
    blocks.push("recommendation_card")
  }
  if (sessionState.lastComparisonArtifact || sessionState.currentMode === "comparison") {
    blocks.push("comparison_table")
  }
  if (sessionState.lastAction === "answer_general" || sessionState.lastAction === "explain_product") {
    blocks.push("explanation_block")
  }
  return blocks
}

/**
 * Resolve which UI strategy to use for a reply path.
 * - question-assist (pending field + explain_product) → preserve field-bound options
 * - direct factual replies (inventory, brand, cutting) → replace with handler actions
 * - otherwise → clear
 */
export function resolveReplyUiStrategy(
  recentFrameRelation: string | null,
  prevState: ExplorationSessionState,
): ReplyUiStrategy {
  const isDirectFactual =
    recentFrameRelation === "product_info" ||
    recentFrameRelation === "inventory_reply" ||
    recentFrameRelation === "brand_reference" ||
    recentFrameRelation === "cutting_conditions"

  if (isDirectFactual) return "replace_with_reply_options"

  const hasPendingField =
    !!prevState.lastAskedField &&
    !prevState.resolutionStatus?.startsWith("resolved")

  if (recentFrameRelation === "question_assist" && hasPendingField) {
    return "preserve_existing_question_options"
  }

  return "clear_options"
}

/**
 * Convert reply follow-up chip labels into DisplayedOption[] (action-type).
 * Each chip becomes a DisplayedOption with field="_action".
 */
export function buildReplyDisplayedOptions(
  chips: string[],
): DisplayedOption[] {
  return chips.map((chip, index) => ({
    index: index + 1,
    label: chip,
    field: "_action",
    value: chip,
    count: 0,
  }))
}

function getDirectCompanyReply(userMessage: string): QuestionReply {
  const result = resolveYG1Query(userMessage)
  if (result.source !== "internal_kb" || !result.answer) return null

  return {
    text: result.answer,
    chips: [],
  }
}

function validateAnswerText(
  text: string,
  chips: string[],
  displayedOptions: ExplorationSessionState["displayedOptions"],
  label: string,
) {
  const validation = validateOptionFirstPipeline(text, chips, displayedOptions ?? [])
  if (validation.correctedAnswer) {
    console.log(`[answer-validator:${label}] Softened: ${validation.unauthorizedActions.map(action => action.phrase).join(",")}`)
    return {
      text: validation.correctedAnswer,
      validatorRewrites: validation.unauthorizedActions.map(action => action.phrase),
    }
  }
  return {
    text,
    validatorRewrites: [] as string[],
  }
}

function buildReplyResponse(
  deps: ServeEngineGeneralChatDependencies,
  prevState: ExplorationSessionState,
  filters: AppliedFilter[],
  narrowingHistory: NarrowingTurn[],
  currentInput: RecommendationInput,
  turnCount: number,
  userMessage: string,
  text: string,
  chips: string[],
  displayedOptions: ExplorationSessionState["displayedOptions"],
  overrides: ReplyOverrides,
  orchResult: OrchestratorResult,
  processTrace: ProcessTrace,
) {
  // ── Side Question Resume: restore suspended flow for early reply paths ──
  const suspended = prevState.suspendedFlow
  let finalText = text
  let finalChips = chips
  let finalDisplayedOptions = displayedOptions
  let finalOverrides = overrides

  if (suspended) {
    const journeyPhase = detectJourneyPhase(prevState)
    if (isPostResultPhase(journeyPhase)) {
      // Post-result: don't force resume of old field, just clear suspended flow
      console.log(
        `[side-question:resume:reply:skip] Post-result phase (${journeyPhase}), skip forced resume for field="${suspended.pendingField}"`
      )
    } else {
      const resumePrompt = suspended.pendingQuestion
        ? `\n\n다시 제품 추천으로 돌아갈게요. ${suspended.pendingQuestion.slice(0, 100)}`
        : `\n\n다시 제품 추천으로 돌아갈게요.`
      finalText = text + resumePrompt
      finalChips = suspended.displayedChipsSnapshot
      finalDisplayedOptions = suspended.displayedOptionsSnapshot
      finalOverrides = {
        ...overrides,
        currentMode: "question",
        lastAction: overrides.lastAction,
        lastAskedField: suspended.pendingField ?? undefined,
      }
      console.log(
        `[side-question:resume:reply] Restored flow for field="${suspended.pendingField}", options=${suspended.displayedOptionsSnapshot.length}`
      )
    }
  }

  const sessionState = carryForwardState(prevState, {
    candidateCount: prevState.candidateCount ?? (prevState.displayedCandidates?.length ?? 0),
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "broad",
    resolvedInput: currentInput,
    turnCount,
    displayedCandidates: prevState.displayedCandidates ?? [],
    displayedChips: finalChips,
    displayedOptions: finalDisplayedOptions,
    currentMode: finalOverrides.currentMode,
    lastAction: finalOverrides.lastAction,
    lastAskedField: finalOverrides.lastAskedField,
    // Clear suspendedFlow after resume
    suspendedFlow: null,
  })

  // ── Final field consistency guard (general-chat path) ──
  const finalPendingField = sessionState.lastAskedField ?? prevState.lastAskedField ?? null
  if (finalPendingField && finalDisplayedOptions.length > 0) {
    const staleInFinal = finalDisplayedOptions.some(
      opt => opt.field && opt.field !== finalPendingField && opt.field !== "_action" && opt.field !== "skip"
    )
    if (staleInFinal) {
      console.warn(`[general-chat:field-guard] Stale chips for field="${finalPendingField}" — clearing to prevent mismatch`)
      finalChips = []
      finalDisplayedOptions = []
      sessionState.displayedChips = []
      sessionState.displayedOptions = []
    }
  }

  recordTurnToLog(sessionState, userMessage, finalText, processTrace)

  return deps.jsonRecommendationResponse({
    text: finalText,
    purpose: suspended ? "question" : overrides.purpose,
    chips: finalChips,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: overrides.candidateSnapshot ?? prevState.displayedCandidates ?? null,
    requestPreparation: null,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
    meta: buildActionMeta(overrides.lastAction, orchResult),
  })
}

function buildValidatedReplyResponse(
  deps: ServeEngineGeneralChatDependencies,
  prevState: ExplorationSessionState,
  filters: AppliedFilter[],
  narrowingHistory: NarrowingTurn[],
  currentInput: RecommendationInput,
  turnCount: number,
  userMessage: string,
  reply: { text: string; chips: string[] },
  validationLabel: string,
  overrides: ReplyOverrides,
  orchResult: OrchestratorResult,
  processTrace: ProcessTrace,
  strategy: ReplyUiStrategy = "clear_options",
) {
  let chips: string[]
  let displayedOptions: DisplayedOption[]

  switch (strategy) {
    case "preserve_existing_question_options": {
      // Keep field-bound narrowing options from the pending question turn,
      // but only if they match the current pending field (no stale carry-forward)
      const pendingField = prevState.lastAskedField ?? null
      const prevOptions = prevState.displayedOptions ?? []
      const hasFieldMismatch = pendingField && prevOptions.length > 0 && prevOptions.some(
        opt => opt.field && opt.field !== pendingField && opt.field !== "_action" && opt.field !== "skip"
      )
      if (hasFieldMismatch) {
        console.warn(`[reply-ui-strategy] Stale options detected for field="${pendingField}", falling back to reply chips`)
        chips = reply.chips
        displayedOptions = reply.chips.length > 0 ? buildReplyDisplayedOptions(reply.chips) : []
      } else if (prevOptions.length > 0 && pendingField) {
        // prevOptions가 있고 field가 일치할 때만 재사용
        chips = prevOptions.map(opt => opt.label)
        displayedOptions = prevOptions
      } else {
        // prevOptions 비어있거나 field 모름 → reply chips 사용 (stale 방지)
        chips = reply.chips
        displayedOptions = reply.chips.length > 0 ? buildReplyDisplayedOptions(reply.chips) : []
      }
      break
    }

    case "replace_with_reply_options":
      // Direct factual reply: derive options from handler-provided chips
      chips = reply.chips
      displayedOptions = buildReplyDisplayedOptions(reply.chips)
      break

    case "clear_options":
    default:
      // Fallback: no stale options, use reply chips as-is
      chips = reply.chips
      displayedOptions = reply.chips.length > 0
        ? buildReplyDisplayedOptions(reply.chips)
        : []
      break
  }

  console.log(
    `[reply-ui-strategy] strategy=${strategy}, label=${validationLabel}, chips=${chips.length}, options=${displayedOptions.length}`
  )

  const validation = validateAnswerText(reply.text, chips, displayedOptions, validationLabel)

  return buildReplyResponse(
    deps,
    prevState,
    filters,
    narrowingHistory,
    currentInput,
    turnCount,
    userMessage,
    validation.text,
    chips,
    displayedOptions,
    overrides,
    orchResult,
    {
      ...processTrace,
      validatorRewrites: validation.validatorRewrites,
    },
  )
}

function recordTurnToLog(
  sessionState: ExplorationSessionState | null,
  userMessage: string,
  assistantText: string,
  processTrace: ProcessTrace,
): void {
  if (!sessionState) return

  const log = sessionState.conversationLog ?? createEmptyConversationLog()

  const uiSnapshot: RichTurnRecord["uiSnapshot"] = {
    chips: sessionState.displayedChips ?? [],
    displayedOptions: (sessionState.displayedOptions ?? []).map(option => ({
      label: option.label,
      value: option.value,
      field: option.field,
    })),
    mode: sessionState.currentMode ?? null,
    lastAskedField: sessionState.lastAskedField ?? null,
    lastAction: sessionState.lastAction ?? null,
    candidateCount: sessionState.candidateCount ?? null,
    displayedProductCodes: (sessionState.displayedCandidates ?? []).slice(0, 10).map(candidate => candidate.displayCode),
    hasRecommendation: !!sessionState.lastRecommendationArtifact,
    hasComparison: !!sessionState.lastComparisonArtifact,
    appliedFilters: (sessionState.appliedFilters ?? []).map(filter => ({
      field: filter.field,
      value: filter.value,
      op: filter.op,
    })),
    visibleUIBlocks: inferVisibleUiBlocks(sessionState),
  }

  sessionState.conversationLog = recordTurn(log, userMessage, assistantText, uiSnapshot, processTrace)
}

export async function handleServeGeneralChatAction(
  params: HandleGeneralChatActionParams
): Promise<Response> {
  const {
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
  } = params

  const lastUserMessage = [...messages].reverse().find(message => message.role === "user")?.text ?? ""

  const inventoryReply = await deps.handleDirectInventoryQuestion(lastUserMessage, prevState)
  if (inventoryReply) {
    const strategy = resolveReplyUiStrategy("inventory_reply", prevState)
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      inventoryReply,
      "inventory",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "inventory_reply",
        displayedOptions: buildReplyDisplayedOptions(inventoryReply.chips),
      }),
      strategy,
    )
  }

  const productInfoReply = await (deps.handleDirectProductInfoQuestion?.(lastUserMessage, currentInput, prevState) ?? Promise.resolve(null))
  if (productInfoReply) {
    const strategy = resolveReplyUiStrategy("product_info", prevState)
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      productInfoReply,
      "product-info",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "product_info",
        displayedOptions: buildReplyDisplayedOptions(productInfoReply.chips),
      }),
      strategy,
    )
  }

  const entityProfileReply = await deps.handleDirectEntityProfileQuestion(lastUserMessage, currentInput, prevState)
  if (entityProfileReply) {
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      entityProfileReply,
      "entity-profile",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "entity_profile",
        displayedOptions: prevState.displayedOptions ?? [],
      }),
    )
  }

  const brandReferenceReply = await deps.handleDirectBrandReferenceQuestion(lastUserMessage, currentInput, prevState)
  if (brandReferenceReply) {
    const strategy = resolveReplyUiStrategy("brand_reference", prevState)
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      brandReferenceReply,
      "brand-reference",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "brand_reference",
        displayedOptions: buildReplyDisplayedOptions(brandReferenceReply.chips),
      }),
      strategy,
    )
  }

  const cuttingConditionReply = await deps.handleDirectCuttingConditionQuestion(lastUserMessage, currentInput, prevState)
  if (cuttingConditionReply) {
    const strategy = resolveReplyUiStrategy("cutting_conditions", prevState)
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      cuttingConditionReply,
      "cutting-condition",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "cutting_conditions",
        displayedOptions: buildReplyDisplayedOptions(cuttingConditionReply.chips),
      }),
      strategy,
    )
  }

  const companyReply = getDirectCompanyReply(lastUserMessage)
  if (companyReply) {
    const hasPendingField =
      !!prevState.lastAskedField &&
      !prevState.resolutionStatus?.startsWith("resolved")
    const chips = hasPendingField ? (prevState.displayedChips ?? []) : companyReply.chips
    const displayedOptions = hasPendingField
      ? (prevState.displayedOptions ?? [])
      : buildReplyDisplayedOptions(companyReply.chips)
    const validation = validateAnswerText(companyReply.text, chips, displayedOptions, "company")

    return buildReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      validation.text,
      chips,
      displayedOptions,
      {
        purpose: hasPendingField ? "question" : "general_chat",
        currentMode: hasPendingField ? "question" : "general_chat",
        lastAction: "answer_general",
        lastAskedField: hasPendingField ? prevState.lastAskedField ?? undefined : undefined,
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "company_reply",
        displayedOptions,
        validatorRewrites: validation.validatorRewrites,
      }),
    )
  }

  if (action.type === "explain_product") {
    const contextReply = await deps.handleContextualNarrowingQuestion(
      provider,
      lastUserMessage,
      currentInput,
      candidates,
      prevState,
      messages,
    )

    if (contextReply) {
      const hasPendingField = !!prevState.lastAskedField && !prevState.resolutionStatus?.startsWith("resolved")

      if (prevState.resolutionStatus?.startsWith("resolved")) {
        const chips = prevState.displayedChips ?? ["전체 후보 보기", "절삭조건 보여줘", "처음부터 다시"]
        const displayedOptions = prevState.displayedOptions ?? []
        return buildReplyResponse(
          deps,
          prevState,
          filters,
          narrowingHistory,
          currentInput,
          turnCount,
          lastUserMessage,
          contextReply,
          chips,
          displayedOptions,
          {
            purpose: "general_chat",
            currentMode: "general_chat",
            lastAction: "explain_product",
          },
          orchResult,
          buildProcessTrace({
            actionType: "explain_product",
            pendingQuestionField: prevState.lastAskedField ?? null,
            recentFrameRelation: "followup_on_result",
            displayedOptions,
          }),
        )
      }

      if (hasPendingField) {
        const userState = detectUserState(lastUserMessage, prevState.lastAskedField)
        const assist = buildQuestionAssistOptions({
          prevState,
          currentCandidates: candidates,
          confusedAbout: userState.confusedAbout,
          includeHelpers: true,
        })

        console.log(
          `[question-assist] Explanation within pending field "${prevState.lastAskedField}", ${assist.chips.length} chips (${assist.helperCount} helpers + ${assist.originalCount} field options)`
        )

        return buildReplyResponse(
          deps,
          prevState,
          filters,
          narrowingHistory,
          currentInput,
          turnCount,
          lastUserMessage,
          contextReply,
          assist.chips,
          assist.displayedOptions,
          {
            purpose: "question",
            currentMode: "question",
            lastAction: "explain_product",
            lastAskedField: prevState.lastAskedField,
          },
          orchResult,
          buildProcessTrace({
            actionType: "explain_product",
            pendingQuestionField: prevState.lastAskedField ?? null,
            recentFrameRelation: "question_assist",
            displayedOptions: assist.displayedOptions,
            memoryTransitions: prevState.lastAskedField
              ? [{ field: prevState.lastAskedField, from: "pending", to: "explained" }]
              : [],
          }),
        )
      }
    }
  }

  const preGenerated = action.type === "answer_general" && action.preGenerated && action.message
  const canReusePreGenerated = preGenerated && !shouldAttemptWebSearchFallback(lastUserMessage)
  let llmResponse: { text: string; chips: string[] }
  if (canReusePreGenerated) {
    llmResponse = { text: action.message, chips: [] }
  } else {
    llmResponse = await deps.handleGeneralChat(
      provider,
      lastUserMessage,
      currentInput,
      candidates,
      form,
      prevState.displayedCandidates,
      messages,
      prevState,
    )
  }

  const lastAssistantText = [...messages].reverse().find(message => message.role === "ai")?.text ?? llmResponse.text
  const {
    finalChips: _rawFinalChips,
    finalDisplayedOptions,
    userStateResult,
    isQuestionAssist,
  } = await buildGeneralChatOptionState({
    form,
    prevState,
    currentInput,
    candidates,
    filters,
    userMessage: lastUserMessage,
    assistantText: lastAssistantText,
    recentMessages: messages,
    provider,
    fallbackChips: llmResponse.chips,
  })

  // Enrich sparse chips with contextual fallbacks from LLM chip pipeline
  let finalChips = _rawFinalChips
  if (finalChips.length < 3 && prevState) {
    const enrichCandidates = prevState.displayedCandidates ?? []
    const previousChips = prevState.displayedChips ?? []
    const { chips: enrichedChips } = buildFinalChipsFromLLM(
      finalChips.map(c => ({ label: c, type: "action" as const })),
      prevState,
      enrichCandidates,
      previousChips,
    )
    finalChips = enrichedChips
  }

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
    if (prevState.lastAskedField && lastUserMessage) {
      recordQA(persistedMemory, prevState.lastAskedField, lastUserMessage, prevState.lastAskedField, turnCount)
    }
  }

  const validation = validateAnswerText(llmResponse.text, finalChips, finalDisplayedOptions, "general")
  llmResponse = {
    text: validation.text,
    chips: llmResponse.chips,
  }

  const effectiveMode = isQuestionAssist ? "question" : "general_chat"
  const effectivePurpose = isQuestionAssist ? "question" : "general_chat"

  if (isQuestionAssist) {
    console.log(`[question-assist] Preserving question mode for field="${prevState.lastAskedField}" during ${userStateResult.state}`)
  }

  // ── Side Question Resume: restore suspended flow after answering off-topic ──
  const suspended = prevState.suspendedFlow
  let resumeChips = finalChips
  let resumeOptions = finalDisplayedOptions
  let resumeMode = effectiveMode
  let resumeLastAction: typeof effectiveMode extends string ? string : never = isQuestionAssist ? "explain_product" : "answer_general"
  let resumeLastAskedField = isQuestionAssist ? prevState.lastAskedField : undefined
  let resumeText = llmResponse.text

  if (suspended && !isQuestionAssist) {
    const journeyPhaseForResume = detectJourneyPhase(prevState)
    if (isPostResultPhase(journeyPhaseForResume)) {
      // Post-result: don't force resume of old field
      console.log(
        `[side-question:resume:skip] Post-result phase (${journeyPhaseForResume}), skip forced resume for field="${suspended.pendingField}"`
      )
    } else {
      // Append resume prompt to the answer text
      const pendingFieldLabel = suspended.pendingField ?? "이전 질문"
      const resumePrompt = suspended.pendingQuestion
        ? `\n\n다시 제품 추천으로 돌아갈게요. ${suspended.pendingQuestion.slice(0, 100)}`
        : `\n\n다시 제품 추천으로 돌아갈게요.`
      resumeText = resumeText + resumePrompt

      // Restore the suspended flow's options and chips
      resumeChips = suspended.displayedChipsSnapshot
      resumeOptions = suspended.displayedOptionsSnapshot
      resumeMode = "question"
      resumeLastAction = "continue_narrowing"
      resumeLastAskedField = suspended.pendingField ?? undefined

      console.log(
        `[side-question:resume] Restored flow for field="${suspended.pendingField}", options=${suspended.displayedOptionsSnapshot.length}, chips=${suspended.displayedChipsSnapshot.length}`
      )
    }
  }

  const sessionState = carryForwardState(prevState, {
    candidateCount: prevState.candidateCount ?? (candidates.length > 0 ? candidates.length : (prevState.displayedCandidates?.length ?? 0)),
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "broad",
    resolvedInput: currentInput,
    turnCount,
    displayedCandidates: prevState.displayedCandidates ?? [],
    displayedChips: resumeChips,
    displayedOptions: resumeOptions,
    currentMode: resumeMode as any,
    lastAction: resumeLastAction as any,
    lastAskedField: resumeLastAskedField,
    conversationMemory: persistedMemory ?? prevState.conversationMemory,
    // Clear suspendedFlow after resume (or if there was none)
    suspendedFlow: null,
  })
  const postTurnContext = buildUnifiedTurnContext({
    latestAssistantText: llmResponse.text,
    latestUserMessage: lastUserMessage,
    messages: [...messages, { role: "ai", text: llmResponse.text }],
    sessionState,
    resolvedInput: currentInput,
    intakeForm: form,
    candidates: sessionState.displayedCandidates ?? [],
  })
  const processTrace = buildProcessTrace({
    actionType: isQuestionAssist ? "explain_product" : "answer_general",
    pendingQuestionField: sessionState.lastAskedField ?? null,
    recentFrameRelation: postTurnContext.relationToLatestQuestion,
    displayedOptions: resumeOptions,
    validatorRewrites: validation.validatorRewrites,
    memoryTransitions: [
      ...(userStateResult.state === "confused" && prevState.lastAskedField
        ? [{ field: prevState.lastAskedField, from: "pending", to: "confused" }]
        : []),
      ...(userStateResult.state === "wants_delegation" && prevState.lastAskedField
        ? [{ field: prevState.lastAskedField, from: "pending", to: "delegated" }]
        : []),
      ...(userStateResult.state === "wants_skip" && prevState.lastAskedField
        ? [{ field: prevState.lastAskedField, from: "pending", to: "skipped" }]
        : []),
    ],
  })
  recordTurnToLog(sessionState, lastUserMessage, resumeText, {
    ...processTrace,
    recentFrameRelation: postTurnContext.relationToLatestQuestion,
  })

  return deps.jsonRecommendationResponse({
    text: resumeText,
    purpose: suspended && !isQuestionAssist ? "question" : effectivePurpose,
    chips: resumeChips,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: candidates.length > 0
      ? deps.buildCandidateSnapshot(candidates, evidenceMap)
      : (prevState.displayedCandidates ?? null),
    requestPreparation: null,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
    meta: buildActionMeta(action.type, orchResult),
  })
}
