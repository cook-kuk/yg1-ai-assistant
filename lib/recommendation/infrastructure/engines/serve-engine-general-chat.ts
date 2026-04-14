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
import { buildTurnTruth } from "@/lib/recommendation/domain/context/turn-truth"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import {
  buildGeneralChatOptionState,
  buildQuestionAssistOptions,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { shouldAttemptWebSearchFallback } from "@/lib/recommendation/infrastructure/engines/serve-engine-assist"
import {
  CUTTING_CONDITION_QUERY_PATTERN,
  DIRECT_PRODUCT_CODE_PATTERN,
  DIRECT_SERIES_CODE_PATTERN,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-assist-utils"
import { buildFinalChipsFromLLM, isUnfilterableChip } from "@/lib/recommendation/domain/options/llm-chip-pipeline"
import { resolveYG1Query } from "@/lib/knowledge/knowledge-router"
import { detectMeasurementScopeAmbiguity } from "@/lib/recommendation/shared/measurement-scope-ambiguity"
import { detectOrderQuantityInventoryAmbiguity } from "@/lib/recommendation/shared/order-quantity-ambiguity"
import { traceRecommendation } from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import type { SemanticDirectContext, SemanticReplyRoute } from "@/lib/recommendation/core/semantic-turn-extractor"
import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { OrchestratorAction, OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type { RecommendationChipGroupDto } from "@/lib/contracts/recommendation"
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
import type { DirectQuestionOptions } from "@/lib/recommendation/infrastructure/engines/serve-engine-assist"

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
  onThinking?: (text: string, opts?: { delta?: boolean; kind?: "stage" | "deep" | "agent" }) => void
  buildCandidateSnapshot: (
    candidates: ScoredProduct[],
    evidenceMap: Map<string, EvidenceSummary>
  ) => CandidateSnapshot[]
  handleDirectInventoryQuestion: (
    userMessage: string,
    prevState: ExplorationSessionState,
    options?: DirectQuestionOptions
  ) => Promise<QuestionReply>
  handleDirectEntityProfileQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState | null,
    options?: DirectQuestionOptions
  ) => Promise<QuestionReply>
  handleDirectProductInfoQuestion?: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState | null,
    options?: DirectQuestionOptions
  ) => Promise<QuestionReply>
  handleDirectBrandReferenceQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState | null,
    options?: DirectQuestionOptions
  ) => Promise<QuestionReply>
  handleCompetitorCrossReference?: (
    userMessage: string,
    prevState: ExplorationSessionState | null,
  ) => Promise<QuestionReply>
  handleDirectCuttingConditionQuestion: (
    userMessage: string,
    currentInput: RecommendationInput,
    prevState: ExplorationSessionState,
    options?: DirectQuestionOptions
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
  semanticReplyRoute?: SemanticReplyRoute | null
  semanticDirectContext?: SemanticDirectContext | null
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
  // Catch-all guard: remove any chip referencing non-filterable DB fields
  const safeChips = chips.filter(chip => {
    if (isUnfilterableChip(chip)) {
      console.log(`[buildReplyDisplayedOptions] Blocked unfilterable chip: "${chip}"`)
      return false
    }
    return true
  })
  return safeChips.map((chip, index) => ({
    index: index + 1,
    label: chip,
    field: "_action",
    value: chip,
    count: 0,
  }))
}

function getGroundedKnowledgeReply(userMessage: string): QuestionReply {
  const result = resolveYG1Query(userMessage)
  if (result.source !== "internal_kb" || !result.answer) return null

  return {
    text: result.answer,
    chips: [],
  }
}

function buildGenericMaterialRatingLegendReply(
  askedRating: string | null,
): QuestionReply {
  const focusLine =
    askedRating === "EXCELLENT"
      ? "여기서 Excellent는 지금 보고 있는 소재에 특히 잘 맞도록 전용 성격이 강하게 잡힌 후보라는 뜻입니다."
      : askedRating === "GOOD"
        ? "여기서 Good은 현재 소재에서 충분히 가공 가능하지만 Excellent보다는 범용 성격이 큰 후보를 뜻합니다."
        : askedRating === "NULL"
          ? "여기서 Null은 나쁘다는 뜻이 아니라, 현재 화면에서 소재 적합성 근거가 충분히 표시되지 않은 상태를 뜻합니다."
          : "여기 표시되는 Excellent / Good / Null은 현재 소재 기준의 적합성 등급입니다."

  const text = [
    focusLine,
    "Excellent는 현재 선택한 소재와 설계 방향이 정확히 맞고, 형상이나 코팅도 그 소재 쪽에 더 최적화된 경우에 주로 붙습니다.",
    "Good은 해당 소재에서 충분히 사용할 수 있지만 여러 소재를 함께 커버하는 범용 계열일 때 주로 보입니다.",
    "Null은 부적합 판정이 아니라 등급 근거가 부족하거나 화면에 별도 표시를 붙이지 않은 경우입니다.",
    "예를 들어 알루미늄 전용 계열이나 전용 코팅이 붙은 제품은 Excellent로, 범용 엔드밀은 Good으로 보일 수 있습니다.",
  ].join("\n\n")

  const chips = [
    askedRating === "GOOD" ? "Excellent는 뭐야?" : "Good은 뭐야?",
    "추천 제품 보기",
    "직접 입력",
  ]

  return { text, chips }
}

function getMaterialRatingLegendReply(
  userMessage: string,
  prevState: ExplorationSessionState,
): QuestionReply {
  const clean = userMessage.trim()
  if (!/(excellent|good|null)/i.test(clean)) return null
  if (!/(뭐야|무슨|뜻|의미|설명|차이|등급|grade|rating)/i.test(clean)) return null

  const groups = (prevState.displayedSeriesGroups ?? [])
    .filter((group): group is typeof group & { materialRating: "EXCELLENT" | "GOOD" | "NULL" } =>
      group?.materialRating === "EXCELLENT" || group?.materialRating === "GOOD" || group?.materialRating === "NULL"
    )
  if (groups.length === 0) {
    const askedRating = clean.match(/\b(excellent|good|null)\b/i)?.[1]?.toUpperCase() ?? null
    return buildGenericMaterialRatingLegendReply(askedRating)
  }

  const counts = new Map<string, number>()
  for (const group of groups) {
    counts.set(group.materialRating, (counts.get(group.materialRating) ?? 0) + 1)
  }

  const askedRating = clean.match(/\b(excellent|good|null)\b/i)?.[1]?.toUpperCase() ?? null
  const summary = [
    counts.has("EXCELLENT") ? `EXCELLENT ${counts.get("EXCELLENT")}개` : null,
    counts.has("GOOD") ? `GOOD ${counts.get("GOOD")}개` : null,
    counts.has("NULL") ? `NULL ${counts.get("NULL")}개` : null,
  ].filter((value): value is string => Boolean(value)).join(", ")

  const focusLine =
    askedRating === "EXCELLENT"
      ? "여기서 EXCELLENT는 현재 선택한 소재/조건에 대한 적합도가 가장 높은 우선 후보라는 뜻입니다."
      : askedRating === "GOOD"
        ? "여기서 GOOD는 현재 조건에서 사용 가능하지만, EXCELLENT보다 우선순위가 한 단계 낮은 후보라는 뜻입니다."
        : askedRating === "NULL"
          ? "여기서 NULL은 내부 소재 적합도 등급 데이터가 없어서 우선순위를 명시하지 못한 상태라는 뜻입니다."
          : "여기 표시되는 EXCELLENT / GOOD / NULL은 현재 세션 기준의 소재 적합도 우선순위 표시입니다."

  const text = [
    focusLine,
    "EXCELLENT는 상대 우선순위가 가장 높고, GOOD는 사용 가능하지만 한 단계 보수적으로 보는 등급입니다.",
    "NULL은 나쁘다는 뜻이 아니라 내부 적합도 근거가 비어 있어 별도 등급을 붙이지 못한 경우입니다.",
    summary ? `현재 화면 기준 등급 분포는 ${summary} 입니다.` : null,
  ].filter((line): line is string => Boolean(line)).join("\n\n")

  const chips = [
    askedRating === "GOOD" ? "EXCELLENT는 뭐야?" : "GOOD는 뭐야?",
    "추천 제품 보기",
    "직접 입력",
  ]

  return { text, chips }
}

function getCuttingConditionClarificationReply(
  userMessage: string,
  currentInput: RecommendationInput,
): QuestionReply {
  const clean = userMessage.trim()
  if (!CUTTING_CONDITION_QUERY_PATTERN.test(clean)) return null
  if (DIRECT_PRODUCT_CODE_PATTERN.test(clean) || DIRECT_SERIES_CODE_PATTERN.test(clean)) return null

  const requestedConditions: string[] = []
  const rpm = clean.match(/(?:rpm|회전수|스핀들(?:\s*속도)?|spindle(?:\s*speed)?)\s*([\d,]+)\s*(이상|이하|초과|미만|\+)/i)
  if (rpm) requestedConditions.push(`RPM ${rpm[1]} ${rpm[2]}`)
  const feed = clean.match(/(?:이송(?:속도)?|feed(?:\s*rate)?|fz)\s*([\d.]+)\s*(이상|이하|초과|미만|\+)/i)
  if (feed) requestedConditions.push(`이송 ${feed[1]} ${feed[2]}`)
  const cuttingSpeed = clean.match(/(?:절삭\s*속도|cutting\s*speed|vc)\s*([\d.]+)\s*(이상|이하|초과|미만|\+)/i)
  if (cuttingSpeed) requestedConditions.push(`절삭속도 ${cuttingSpeed[1]} ${cuttingSpeed[2]}`)

  const knownContext: string[] = []
  const material = currentInput.workPieceName ?? currentInput.material
  if (material) knownContext.push(`소재=${material}`)
  if (currentInput.diameterMm != null) knownContext.push(`직경=φ${currentInput.diameterMm}mm`)
  if (currentInput.operationType) knownContext.push(`가공=${currentInput.operationType}`)
  else if (currentInput.machiningCategory) knownContext.push(`가공=${currentInput.machiningCategory}`)

  const missing: string[] = []
  if (!material) missing.push("소재")
  if (currentInput.diameterMm == null) missing.push("직경")
  if (!currentInput.operationType && !currentInput.machiningCategory) missing.push("가공 방식")

  const clarificationChips =
    missing.length > 0
      ? [
          missing[0] === "소재" ? "소재 기준 추가" : missing[0] === "직경" ? "직경 기준 추가" : "가공 방식 추가",
          missing[1] === "소재" ? "소재 기준 추가" : missing[1] === "직경" ? "직경 기준 추가" : missing[1] === "가공 방식" ? "가공 방식 추가" : "황삭 기준",
          "직접 입력",
        ]
      : ["황삭 기준", "정삭 기준", "직접 입력"]

  const text = [
    requestedConditions.length > 0
      ? `${requestedConditions.join(", ")} 조건은 제품 고정 스펙이 아니라 소재·직경·가공 방식에 따라 달라지는 절삭조건입니다.`
      : "절삭조건 질문은 제품 고정 스펙이 아니라 소재·직경·가공 방식에 따라 값이 달라집니다.",
    knownContext.length > 0
      ? `현재 잡혀 있는 기준은 ${knownContext.join(", ")} 입니다.`
      : "현재 조건이 넓어서 바로 제품 리스트로 확정하면 오답 위험이 큽니다.",
    missing.length > 0
      ? `${missing.join(", ")} 중 하나 이상을 더 주시면 그 범위에서 추천이나 조건 설명을 정확히 이어갈 수 있습니다.`
      : "여기서 황삭/정삭이나 절입량을 하나만 더 주시면 현재 조건 안에서 더 정확히 좁힐 수 있습니다.",
  ].join("\n\n")

  return {
    text,
    chips: clarificationChips.slice(0, 3),
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

function deriveQuestionAssistChipGroups(
  displayedOptions: DisplayedOption[],
  pendingField: string | null | undefined,
): RecommendationChipGroupDto[] | undefined {
  if (!pendingField || displayedOptions.length === 0) return undefined

  const helperChips = displayedOptions
    .filter(option => option.field === "_action" || option.field === "skip")
    .map(option => option.label)
  const originalChips = displayedOptions
    .filter(option => option.field === pendingField)
    .map(option => option.label)

  const groups = [
    ...(helperChips.length > 0 ? [{ label: "현재 제안", chips: helperChips }] : []),
    ...(originalChips.length > 0 ? [{ label: "이전 선택지", chips: originalChips }] : []),
  ]

  return groups.length > 0 ? groups : undefined
}

function summarizeChipGroupsForLog(
  chips: string[],
  chipGroups: RecommendationChipGroupDto[] | undefined,
  displayedOptions: DisplayedOption[],
) {
  return {
    chipCount: chips.length,
    chipPreview: chips.slice(0, 6),
    chipGroupCount: chipGroups?.length ?? 0,
    chipGroups: (chipGroups ?? []).map(group => ({
      label: group.label,
      count: group.chips.length,
      preview: group.chips.slice(0, 4),
    })),
    displayedOptionCount: displayedOptions.length,
    displayedOptionFields: Array.from(new Set(displayedOptions.map(option => option.field))).slice(0, 8),
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
  chipGroups?: RecommendationChipGroupDto[],
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
        ? `\n\n다시 제품 추천으로 돌아갈게요. ${suspended.pendingQuestion}`
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
    chipGroups,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: overrides.candidateSnapshot
      ?? prevState.lastRecommendationArtifact
      ?? prevState.displayedCandidates
      ?? null,
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
    semanticReplyRoute,
    semanticDirectContext,
  } = params

  try {
  // Fire an immediate stage event so ghost heartbeat cascade gets suppressed
  // (sawRealThinking=true) as soon as general-chat is entered. Without this
  // the stream/route.ts heartbeat can emit 5 phantom stages while the
  // general-chat LLM call is in flight.
  try { deps.onThinking?.("💬 응답을 준비하는 중…", { kind: "stage" }) } catch { /* no-op */ }
  const lastUserMessage = [...messages].reverse().find(message => message.role === "user")?.text ?? ""
  const semanticForce: DirectQuestionOptions = { force: true, semanticContext: semanticDirectContext }
  const shouldRunLegacyDirectRoutes = semanticReplyRoute == null
  const turnTruth = buildTurnTruth({
    userMessage: lastUserMessage,
    sessionState: prevState,
    appliedFilters: filters,
    candidateSnapshot: prevState.displayedCandidates ?? prevState.lastRecommendationArtifact ?? [],
  })
  const orderQuantityAmbiguity =
    turnTruth.intent === "inventory_constraint"
      ? null
      : detectOrderQuantityInventoryAmbiguity(lastUserMessage)
  const measurementScopeAmbiguity = detectMeasurementScopeAmbiguity(lastUserMessage, {
    pendingField: prevState.lastAskedField ?? null,
  })

  if (orderQuantityAmbiguity) {
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      {
        text: orderQuantityAmbiguity.question,
        chips: orderQuantityAmbiguity.chips,
      },
      "order-quantity-ambiguity",
      {
        purpose: "question",
        currentMode: "question",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "order_quantity_inventory_ambiguity",
        displayedOptions: buildReplyDisplayedOptions(orderQuantityAmbiguity.chips),
      }),
    )
  }

  if (measurementScopeAmbiguity) {
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      {
        text: measurementScopeAmbiguity.question,
        chips: measurementScopeAmbiguity.chips,
      },
      "measurement-scope-ambiguity",
      {
        purpose: "question",
        currentMode: "question",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "measurement_scope_ambiguity",
        displayedOptions: buildReplyDisplayedOptions(measurementScopeAmbiguity.chips),
      }),
    )
  }

  if (semanticReplyRoute === "inventory") {
    const forcedInventoryReply = await deps.handleDirectInventoryQuestion(lastUserMessage, prevState, semanticForce)
    if (forcedInventoryReply) {
      const strategy = resolveReplyUiStrategy("inventory_reply", prevState)
      return buildValidatedReplyResponse(
        deps,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        lastUserMessage,
        forcedInventoryReply,
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
          displayedOptions: buildReplyDisplayedOptions(forcedInventoryReply.chips),
        }),
        strategy,
      )
    }
  }

  if (semanticReplyRoute === "product_info") {
    const forcedProductInfoReply = await (deps.handleDirectProductInfoQuestion?.(lastUserMessage, currentInput, prevState, semanticForce) ?? Promise.resolve(null))
    if (forcedProductInfoReply) {
      const strategy = resolveReplyUiStrategy("product_info", prevState)
      return buildValidatedReplyResponse(
        deps,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        lastUserMessage,
        forcedProductInfoReply,
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
          displayedOptions: buildReplyDisplayedOptions(forcedProductInfoReply.chips),
        }),
        strategy,
      )
    }
  }

  if (semanticReplyRoute === "entity_profile") {
    const forcedEntityProfileReply = await deps.handleDirectEntityProfileQuestion(lastUserMessage, currentInput, prevState, semanticForce)
    if (forcedEntityProfileReply) {
      return buildValidatedReplyResponse(
        deps,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        lastUserMessage,
        forcedEntityProfileReply,
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
  }

  if (semanticReplyRoute === "brand_reference") {
    const forcedBrandReferenceReply = await deps.handleDirectBrandReferenceQuestion(lastUserMessage, currentInput, prevState, semanticForce)
    if (forcedBrandReferenceReply) {
      const strategy = resolveReplyUiStrategy("brand_reference", prevState)
      return buildValidatedReplyResponse(
        deps,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        lastUserMessage,
        forcedBrandReferenceReply,
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
          displayedOptions: buildReplyDisplayedOptions(forcedBrandReferenceReply.chips),
        }),
        strategy,
      )
    }
  }

  if (semanticReplyRoute === "cutting_conditions") {
    const forcedCuttingConditionReply = await deps.handleDirectCuttingConditionQuestion(lastUserMessage, currentInput, prevState, semanticForce)
    if (forcedCuttingConditionReply) {
      const strategy = resolveReplyUiStrategy("cutting_conditions", prevState)
      return buildValidatedReplyResponse(
        deps,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        lastUserMessage,
        forcedCuttingConditionReply,
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
          displayedOptions: buildReplyDisplayedOptions(forcedCuttingConditionReply.chips),
        }),
        strategy,
      )
    }
  }

  if (shouldRunLegacyDirectRoutes) {
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

    // Competitor cross-reference: detect competitor brand/product mentions
    if (deps.handleCompetitorCrossReference) {
      const competitorReply = await deps.handleCompetitorCrossReference(lastUserMessage, prevState)
      if (competitorReply) {
        const strategy = resolveReplyUiStrategy("brand_reference", prevState)
        return buildValidatedReplyResponse(
          deps,
          prevState,
          filters,
          narrowingHistory,
          currentInput,
          turnCount,
          lastUserMessage,
          competitorReply,
          "competitor-cross-ref",
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
            displayedOptions: buildReplyDisplayedOptions(competitorReply.chips),
          }),
          strategy,
        )
      }
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
  }

  const materialRatingLegendReply = getMaterialRatingLegendReply(lastUserMessage, prevState)
  if (materialRatingLegendReply) {
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      materialRatingLegendReply,
      "material-rating-legend",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "rating_legend",
        displayedOptions: buildReplyDisplayedOptions(materialRatingLegendReply.chips),
      }),
    )
  }

  const cuttingConditionClarificationReply = getCuttingConditionClarificationReply(lastUserMessage, currentInput)
  if (cuttingConditionClarificationReply) {
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      cuttingConditionClarificationReply,
      "cutting-condition-clarification",
      {
        purpose: "question",
        currentMode: "question",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "cutting_condition_clarification",
        displayedOptions: buildReplyDisplayedOptions(cuttingConditionClarificationReply.chips),
      }),
    )
  }

  const groundedKnowledgeReply = getGroundedKnowledgeReply(lastUserMessage)
  if (groundedKnowledgeReply) {
    const hasPendingField =
      !!prevState.lastAskedField &&
      !prevState.resolutionStatus?.startsWith("resolved")
    const chips = hasPendingField ? (prevState.displayedChips ?? []) : groundedKnowledgeReply.chips
    const displayedOptions = hasPendingField
      ? (prevState.displayedOptions ?? [])
      : buildReplyDisplayedOptions(groundedKnowledgeReply.chips)
    const validation = validateAnswerText(groundedKnowledgeReply.text, chips, displayedOptions, "grounded-knowledge")

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
        recentFrameRelation: "grounded_kb_reply",
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
          [
            ...(assist.helperChips.length > 0 ? [{ label: "현재 제안", chips: assist.helperChips }] : []),
            ...(assist.originalChips.length > 0 ? [{ label: "이전 선택지", chips: assist.originalChips }] : []),
          ],
        )
      }
    }
  }

  const preGenerated = action.type === "answer_general" && action.preGenerated && action.message
  const canReusePreGenerated = preGenerated && !shouldAttemptWebSearchFallback(lastUserMessage)
  let llmResponse: { text: string; chips: string[] }
  if (canReusePreGenerated) {
    llmResponse = { text: action.message, chips: [] }
  } else if (!canReusePreGenerated && (prevState as unknown as { __qaDirectAnswer?: string })?.__qaDirectAnswer) {
    const qaFallback = (prevState as unknown as { __qaDirectAnswer?: string }).__qaDirectAnswer!
    llmResponse = { text: qaFallback, chips: [] }
    console.log(`[general-chat] __qaDirectAnswer fallback: "${qaFallback.slice(0, 60)}"`)
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

  if (turnTruth.intent === "inventory_constraint") {
    return buildValidatedReplyResponse(
      deps,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      lastUserMessage,
      llmResponse,
      "inventory-constraint",
      {
        purpose: "general_chat",
        currentMode: "general_chat",
        lastAction: "answer_general",
      },
      orchResult,
      buildProcessTrace({
        actionType: "answer_general",
        pendingQuestionField: prevState.lastAskedField ?? null,
        recentFrameRelation: "inventory_constraint",
        displayedOptions: buildReplyDisplayedOptions(llmResponse.chips),
      }),
      "replace_with_reply_options",
    )
  }

  const lastAssistantText = [...messages].reverse().find(message => message.role === "ai")?.text ?? llmResponse.text
  const {
    finalChips: _rawFinalChips,
    finalDisplayedOptions,
    userStateResult,
    isQuestionAssist,
    chipGroups,
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
  const resumeChipGroups = suspended && !isQuestionAssist
    ? undefined
    : (
      chipGroups
      ?? (isQuestionAssist
        ? deriveQuestionAssistChipGroups(finalDisplayedOptions, prevState.lastAskedField)
        : undefined)
    )

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
        ? `\n\n다시 제품 추천으로 돌아갈게요. ${suspended.pendingQuestion}`
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

  console.log("[chip-groups:server:build]", JSON.stringify({
    isQuestionAssist,
    pendingField: prevState.lastAskedField ?? null,
    ...summarizeChipGroupsForLog(resumeChips, resumeChipGroups, resumeOptions),
  }))

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
  traceRecommendation("general-chat:final-response", {
    isQuestionAssist,
    userState: userStateResult.state,
    lastAskedField: prevState.lastAskedField ?? null,
    ...summarizeChipGroupsForLog(resumeChips, resumeChipGroups, resumeOptions),
  })

  return deps.jsonRecommendationResponse({
    text: resumeText,
    purpose: suspended && !isQuestionAssist ? "question" : effectivePurpose,
    chips: resumeChips,
    chipGroups: resumeChipGroups,
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
  } catch (error) {
    console.error("[general-chat] Error:", error)
    const sessionState = carryForwardState(prevState, {
      candidateCount: prevState.candidateCount ?? 0,
      appliedFilters: prevState.appliedFilters ?? [],
      narrowingHistory: prevState.narrowingHistory ?? [],
      resolutionStatus: prevState.resolutionStatus ?? "broad",
      resolvedInput: prevState.resolvedInput ?? currentInput,
      turnCount,
      displayedCandidates: prevState.displayedCandidates ?? [],
      displayedChips: ["처음부터 다시", "⟵ 이전 단계"],
      displayedOptions: [],
      currentMode: prevState.currentMode ?? "question",
      lastAction: prevState.lastAction,
      lastAskedField: prevState.lastAskedField,
    })
    return deps.jsonRecommendationResponse({
      text: "일시적인 오류가 발생했습니다. 다시 시도해주세요.",
      purpose: "question",
      chips: ["처음부터 다시", "⟵ 이전 단계"],
      isComplete: false,
      recommendation: null,
      sessionState,
      evidenceSummaries: null,
      candidateSnapshot: null,
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
      meta: { orchestratorResult: { action: "error_fallback", agents: [], opus: false } },
    })
  }
}
