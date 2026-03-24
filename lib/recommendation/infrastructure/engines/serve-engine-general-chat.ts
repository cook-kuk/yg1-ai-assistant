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
import {
  buildGeneralChatOptionState,
  buildQuestionAssistOptions,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { OrchestratorAction, OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  CandidateSnapshot,
  ChatMessage,
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
    prevState: ExplorationSessionState
  ) => Promise<string | null>
  handleGeneralChat: (
    provider: LLMProvider,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    form: ProductIntakeForm,
    displayedCandidatesContext?: CandidateSnapshot[]
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
  const sessionState = carryForwardState(prevState, {
    candidateCount: prevState.candidateCount,
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "broad",
    resolvedInput: currentInput,
    turnCount,
    displayedCandidates: prevState.displayedCandidates ?? [],
    displayedChips: chips,
    displayedOptions,
    currentMode: overrides.currentMode,
    lastAction: overrides.lastAction,
    lastAskedField: overrides.lastAskedField,
  })

  recordTurnToLog(sessionState, userMessage, text, processTrace)

  return deps.jsonRecommendationResponse({
    text,
    purpose: overrides.purpose,
    chips,
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
) {
  const chips = prevState.displayedChips?.length ? prevState.displayedChips : reply.chips
  const displayedOptions = prevState.displayedOptions ?? []
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
        displayedOptions: prevState.displayedOptions ?? [],
      }),
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
        displayedOptions: prevState.displayedOptions ?? [],
      }),
    )
  }

  const cuttingConditionReply = await deps.handleDirectCuttingConditionQuestion(lastUserMessage, currentInput, prevState)
  if (cuttingConditionReply) {
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
        displayedOptions: prevState.displayedOptions ?? [],
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
  let llmResponse: { text: string; chips: string[] }
  if (preGenerated) {
    llmResponse = { text: action.message, chips: [] }
  } else {
    llmResponse = await deps.handleGeneralChat(
      provider,
      lastUserMessage,
      currentInput,
      candidates,
      form,
      prevState.displayedCandidates,
    )
  }

  const lastAssistantText = [...messages].reverse().find(message => message.role === "ai")?.text ?? llmResponse.text
  const {
    finalChips,
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
    displayedOptions: finalDisplayedOptions,
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
  recordTurnToLog(sessionState, lastUserMessage, llmResponse.text, {
    ...processTrace,
    recentFrameRelation: postTurnContext.relationToLatestQuestion,
  })

  return deps.jsonRecommendationResponse({
    text: llmResponse.text,
    purpose: effectivePurpose,
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
    meta: buildActionMeta(action.type, orchResult),
  })
}
