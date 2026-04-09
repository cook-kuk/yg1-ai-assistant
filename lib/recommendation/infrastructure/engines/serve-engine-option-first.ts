import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  ChatMessage,
  DisplayedOption,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import type { PendingQuestion } from "@/lib/recommendation/domain/context/pending-question-detector"
import type { UserStateResult } from "@/lib/recommendation/domain/context/user-understanding-detector"
import type { SmartOption } from "@/lib/recommendation/domain/options"

import { generateSmartOptions } from "@/lib/recommendation/domain/options"
import {
  buildContextAwarePlannerContext,
  buildPostRecommendationPlannerContext,
  smartOptionsToChips,
  smartOptionsToDisplayedOptions,
} from "@/lib/recommendation/domain/options/option-bridge"
import { buildQuestionAlignedOptions, buildConfusionHelperOptions } from "@/lib/recommendation/domain/options/question-option-builder"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import { performUnifiedJudgment, type UnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"
import { buildChipContext, buildChipContextFromUnifiedTurnContext } from "@/lib/recommendation/domain/context/chip-context-builder"
import { rankChipsDeterministic } from "@/lib/recommendation/domain/options/chip-ranker"
import { buildRecentInteractionFrame } from "@/lib/recommendation/domain/context/recent-interaction-frame"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import { inferLikelyReferencedBlock } from "@/lib/recommendation/domain/context/ui-context-extractor"
import { selectChipsWithLLM } from "@/lib/recommendation/domain/options/llm-chip-selector"
import { buildUnifiedTurnContext } from "@/lib/recommendation/domain/context/turn-context-builder"

export interface GeneralChatOptionState {
  finalChips: string[]
  finalDisplayedOptions: DisplayedOption[]
  userStateResult: UserStateResult
  isQuestionAssist: boolean
  chipGroups?: Array<{
    label: string
    chips: string[]
  }>
}

interface QuestionAssistOptionsInput {
  prevState: ExplorationSessionState
  currentCandidates: ScoredProduct[]
  confusedAbout: string | null
  includeHelpers: boolean
  /** 현재 턴의 질문 필드 (prevState.lastAskedField와 다를 수 있음) */
  currentQuestionField?: string | null
}

interface QuestionAssistOptionsResult {
  question: PendingQuestion | null
  options: SmartOption[]
  chips: string[]
  displayedOptions: DisplayedOption[]
  helperChips: string[]
  originalChips: string[]
  helperCount: number
  originalCount: number
}

export interface QuestionResponseOptionState {
  chips: string[]
  displayedOptions: DisplayedOption[]
}

export interface RefinementOptionState {
  chips: string[]
  displayedOptions: DisplayedOption[]
}

export async function buildGeneralChatOptionState(input: {
  form: ProductIntakeForm
  prevState: ExplorationSessionState
  currentInput: RecommendationInput
  candidates: ScoredProduct[]
  filters: AppliedFilter[]
  userMessage: string
  assistantText: string
  recentMessages: ChatMessage[]
  provider: LLMProvider
  fallbackChips: string[]
}): Promise<GeneralChatOptionState> {
  const {
    form,
    prevState,
    currentInput,
    candidates,
    filters,
    userMessage,
    assistantText,
    recentMessages,
    provider,
    fallbackChips,
  } = input

  try {
  // ── Haiku 판단 + 턴 컨텍스트 병렬 실행 (속도 최적화) ──
  const [judgment, unifiedTurnContext] = await Promise.all([
    performUnifiedJudgment({
      userMessage,
      assistantText,
      pendingField: prevState.lastAskedField ?? null,
      currentMode: prevState.currentMode ?? null,
      displayedChips: prevState.displayedChips ?? [],
      filterCount: filters.length,
      candidateCount: candidates.length,
      hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
    }, provider),
    Promise.resolve(buildUnifiedTurnContext({
      latestAssistantText: assistantText,
      latestUserMessage: userMessage,
      messages: recentMessages,
      sessionState: prevState,
      resolvedInput: currentInput,
      intakeForm: form,
      candidates: (prevState.displayedCandidates?.length ? prevState.displayedCandidates : []).slice(0, 20),
    })),
  ])

  // Haiku 판단을 기존 형식으로 변환 (호환성 유지)
  const userStateResult = judgment.fromLLM
    ? { state: judgment.userState, confidence: judgment.confidence, confusedAbout: judgment.confusedAbout, boundField: null }
    : detectUserState(userMessage, prevState.lastAskedField)

  const { plannerCtx, interpretation } = buildContextAwarePlannerContext(
    form,
    prevState,
    currentInput,
    userMessage,
    candidates,
    filters,
    prevState.lastAskedField ?? undefined,
    unifiedTurnContext,
  )
  const generalSmartOptions = generateSmartOptions({
    plannerCtx,
    simulatorCtx: {
      candidateCount: candidates.length,
      appliedFilters: filters.map(f => ({ field: f.field, op: f.op, value: f.value, rawValue: f.rawValue })),
    },
    rankerCtx: {
      candidateCount: candidates.length,
      filterCount: filters.length,
      hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
      userMessage,
      contextInterpretation: interpretation,
      likelyReferencedUIBlock: inferLikelyReferencedBlock(prevState, userMessage),
    },
  })

  const frame = buildRecentInteractionFrame(assistantText, userMessage, prevState)

  let finalChips: string[]
  let finalDisplayedOptions: DisplayedOption[]
  let chipGroups: GeneralChatOptionState["chipGroups"]

  if (generalSmartOptions.length > 0) {
    // LLM Chip Selector: Haiku가 전체 맥락 보고 최적 칩 선택
    const chipSelection = await selectChipsWithLLM(generalSmartOptions, {
      userMessage,
      assistantText,
      mode: prevState.currentMode ?? null,
      pendingField: prevState.lastAskedField ?? null,
      candidateCount: candidates.length,
      appliedFilters: filters.filter(f => f.op !== "skip").map(f => ({ field: f.field, value: f.value })),
      resolutionStatus: prevState.resolutionStatus ?? null,
      displayedProducts: (prevState.displayedCandidates ?? []).slice(0, 5).map(c => c.displayCode),
      userState: judgment.fromLLM ? judgment.userState : (userStateResult.state ?? null),
      confusedAbout: judgment.fromLLM ? judgment.confusedAbout : (userStateResult.confusedAbout ?? null),
      intentShift: judgment.fromLLM ? judgment.intentShift : (interpretation.intentShift ?? null),
      referencedUIBlock: frame.likelyReferencedUIBlock ?? null,
      frameRelation: judgment.fromLLM ? judgment.frameRelation : (frame.relation ?? null),
      answeredFields: interpretation.answeredFields ?? [],
      conversationDepth: interpretation.conversationDepth ?? 0,
      suggestedNextAction: interpretation.suggestedNextAction ?? null,
      hasConflict: interpretation.hasConflict ?? false,
      recentTurns: (unifiedTurnContext.recentTurns ?? []).slice(-14).map(t => ({ role: t.role, text: t.text })),
    }, provider)
    finalChips = chipSelection.chips
    finalDisplayedOptions = chipSelection.displayedOptions
    console.log(
      `[option-first:general] SmartOptions=${generalSmartOptions.length}, selectedByLLM=${chipSelection.selectedByLLM}, frame=${frame.relation}, chips=${finalChips.join(",")}`
    )
  } else {
    // Fallback: preserve state chips or provide minimal safe navigation.
    // NEVER use handler-generated chips (fallbackChips) as source of truth.
    // Guard: only reuse prevState chips if they match the current pending field
    const pendingField = prevState.lastAskedField ?? null
    const prevOptions = prevState.displayedOptions ?? []
    // prevState chips 재사용 조건: displayedOptions가 있고, 모두 현재 field와 일치
    const prevChipsValid = prevState.displayedChips?.length > 0
      && prevOptions.length > 0
      && (!pendingField || prevOptions.every(opt => !opt.field || opt.field === pendingField || opt.field === "_action" || opt.field === "skip"))
    if (prevChipsValid) {
      finalChips = prevOptions.map(opt => opt.label) // chips를 displayedOptions에서 derive
      finalDisplayedOptions = prevOptions
    } else {
      // Minimal deterministic fallback — navigation only
      const safeChips: string[] = []
      if (filters.length > 0) safeChips.push("⟵ 이전 단계")
      safeChips.push("처음부터 다시")
      finalChips = safeChips
      finalDisplayedOptions = []
    }
  }

  const shouldMergeHelpers = shouldUseQuestionAssistHelpers(userStateResult)
  const journeyPhase = detectJourneyPhase(prevState)
  const hasStatePendingQuestion =
    !!prevState.lastAskedField && !prevState.resolutionStatus?.startsWith("resolved")
    && !isPostResultPhase(journeyPhase)

  if (hasStatePendingQuestion) {
    const assist = buildQuestionAssistOptions({
      prevState,
      currentCandidates: candidates,
      confusedAbout: userStateResult.confusedAbout,
      includeHelpers: shouldMergeHelpers,
    })
    if (assist.options.length > 0) {
      finalChips = assist.chips
      finalDisplayedOptions = assist.displayedOptions
      chipGroups = [
        ...(assist.helperChips.length > 0 ? [{ label: "현재 제안", chips: assist.helperChips }] : []),
        ...(assist.originalChips.length > 0 ? [{ label: "이전 선택지", chips: assist.originalChips }] : []),
      ]
      if (shouldMergeHelpers) {
        console.log(
          `[option-first] User state: ${userStateResult.state}, ${assist.helperCount} helpers merged (field=${assist.question?.field ?? "none"})`
        )
      }
      console.log(
        `[option-first] State-based pending question field="${prevState.lastAskedField}", ${finalChips.length} chips`
      )
    }
  } else if (shouldMergeHelpers) {
    const assist = buildQuestionAssistOptions({
      prevState,
      currentCandidates: candidates,
      confusedAbout: userStateResult.confusedAbout,
      includeHelpers: true,
    })
    if (assist.options.length > 0) {
      finalChips = assist.chips
      finalDisplayedOptions = assist.displayedOptions
      chipGroups = [
        ...(assist.helperChips.length > 0 ? [{ label: "현재 제안", chips: assist.helperChips }] : []),
        ...(assist.originalChips.length > 0 ? [{ label: "이전 선택지", chips: assist.originalChips }] : []),
      ]
      console.log(
        `[question-assist] User ${userStateResult.state}, ${assist.helperCount} helpers + ${assist.originalCount} field options (field=${assist.question?.field ?? "none"})`
      )
    }
  }

  const isQuestionAssist =
    !!prevState.lastAskedField &&
    !prevState.resolutionStatus?.startsWith("resolved") &&
    !isPostResultPhase(journeyPhase) &&
    shouldMergeHelpers

  return {
    finalChips,
    finalDisplayedOptions,
    userStateResult,
    isQuestionAssist,
    chipGroups,
  }
  } catch (error) {
    console.error("[option-first] Error:", error)
    return {
      finalChips: ["처음부터 다시"],
      finalDisplayedOptions: [],
      userStateResult: { state: "normal", confidence: 0, confusedAbout: null, boundField: null },
      isQuestionAssist: false,
      chipGroups: undefined,
    }
  }
}

export async function buildQuestionResponseOptionState(params: {
  chips: string[]
  question: { questionText: string; chips: string[]; field?: string | null } | null
  displayedOptions: DisplayedOption[]
  sessionState: ExplorationSessionState
  input: RecommendationInput
  userMessage: string | null
  responseText: string
  messages: ChatMessage[]
  provider: LLMProvider
}): Promise<QuestionResponseOptionState> {
  const { chips, question, displayedOptions, sessionState, input, userMessage, responseText, messages, provider } = params

  try {
  if (!userMessage || displayedOptions.length === 0) {
    return { chips, displayedOptions }
  }

  const userStateResult = detectUserState(userMessage, question?.field)
  if (userStateResult.state === "wants_skip" || userStateResult.state === "wants_delegation") {
    return { chips, displayedOptions }
  }
  if (!shouldUseQuestionAssistHelpers(userStateResult)) {
    return { chips, displayedOptions }
  }

  const statePendingQuestion = question?.field
    ? {
        shape: "constrained_options" as const,
        questionText: question.questionText,
        extractedOptions: question.chips.filter(chip => chip !== "상관없음" && chip !== "⟵ 이전 단계"),
        field: question.field,
        isBinary: false,
        hasExplicitChoices: true,
      }
    : null

  if (!statePendingQuestion) {
    return { chips, displayedOptions }
  }

  const helperOptions = buildConfusionHelperOptions(statePendingQuestion, userStateResult.confusedAbout)
  const questionAlignedOptions = buildQuestionAlignedOptions(statePendingQuestion)
  const mergedOptions = deduplicateOptions([...helperOptions, ...questionAlignedOptions])

  const chipContext = buildChipContext(
    sessionState,
    input,
    userMessage,
    responseText,
    statePendingQuestion,
    userStateResult.state,
    userStateResult.confusedAbout,
    messages.map(message => ({ role: message.role, text: message.text }))
  )
  const unifiedTurnContext = buildUnifiedTurnContext({
    latestAssistantText: responseText,
    latestUserMessage: userMessage,
    messages,
    sessionState,
    resolvedInput: input,
    intakeForm: {} as ProductIntakeForm,
    candidates: sessionState.displayedCandidates ?? [],
  })
  const unifiedChipContext = buildChipContextFromUnifiedTurnContext(
    unifiedTurnContext,
    statePendingQuestion,
    userStateResult.state,
    userStateResult.confusedAbout,
  )
  const reranked = rankChipsDeterministic(
    mergedOptions,
    unifiedChipContext.recentTurnsSummary.length > 0 ? unifiedChipContext : chipContext,
  )

  const finalChips = smartOptionsToChips(reranked.options)
  const finalDisplayedOptions = smartOptionsToDisplayedOptions(reranked.options)
  console.log(
    `[option-first:confusion] User ${userStateResult.state}, ${helperOptions.length} helpers merged (field=${question?.field ?? "none"})`
  )

  return {
    chips: finalChips,
    displayedOptions: finalDisplayedOptions,
  }
  } catch (error) {
    console.error("[option-first] Error:", error)
    return { chips, displayedOptions }
  }
}

export function buildQuestionAssistOptions(
  input: QuestionAssistOptionsInput
): QuestionAssistOptionsResult {
  const question = reconstructPreviousQuestionFromCandidates(input.prevState, input.currentCandidates, input.currentQuestionField)
  const originalOptions = question ? buildQuestionAlignedOptions(question) : []
  const helperOptions = input.includeHelpers
    ? buildConfusionHelperOptions(question, input.confusedAbout)
    : []
  const options = deduplicateOptions([...helperOptions, ...originalOptions])

  return {
    question,
    options,
    chips: smartOptionsToChips(options),
    displayedOptions: smartOptionsToDisplayedOptions(options),
    helperChips: smartOptionsToChips(helperOptions),
    originalChips: smartOptionsToChips(originalOptions),
    helperCount: helperOptions.length,
    originalCount: originalOptions.length,
  }
}

export function generateSmartOptionsForRecommendation(
  candidateSnapshot: CandidateSnapshot[],
  filters: AppliedFilter[],
  input: RecommendationInput,
  form?: ProductIntakeForm | null,
  sessionState?: ExplorationSessionState | null,
  userMessage?: string | null
): SmartOption[] {
  if (candidateSnapshot.length === 0) return []

  if (form && sessionState) {
    const { plannerCtx, interpretation } = buildContextAwarePlannerContext(
      form,
      sessionState,
      input,
      userMessage ?? null,
      [],
      filters
    )

    plannerCtx.topCandidates = candidateSnapshot.slice(0, 5).map(candidate => ({
      displayCode: candidate.displayCode,
      seriesName: candidate.seriesName,
      coating: candidate.coating,
      fluteCount: candidate.fluteCount,
      diameterMm: candidate.diameterMm,
      score: candidate.score,
      matchStatus: candidate.matchStatus,
    }))
    plannerCtx.candidateCount = candidateSnapshot.length

    return generateSmartOptions({
      plannerCtx,
      simulatorCtx: {
        candidateCount: candidateSnapshot.length,
        appliedFilters: filters,
      },
      rankerCtx: {
        candidateCount: candidateSnapshot.length,
        filterCount: filters.length,
        hasRecommendation: true,
        contextInterpretation: interpretation,
      },
      portfolioConfig: { maxOptions: 6 },
    })
  }

  const plannerCtx = buildPostRecommendationPlannerContext(candidateSnapshot, filters, input)

  return generateSmartOptions({
    plannerCtx,
    simulatorCtx: {
      candidateCount: candidateSnapshot.length,
      appliedFilters: filters,
    },
    rankerCtx: {
      candidateCount: candidateSnapshot.length,
      filterCount: filters.length,
      hasRecommendation: true,
    },
    portfolioConfig: { maxOptions: 6 },
  })
}

export function buildRefinementOptionState(input: {
  form: ProductIntakeForm
  prevState: ExplorationSessionState
  currentInput: RecommendationInput
  candidates: ScoredProduct[]
  filters: AppliedFilter[]
  field: string
  language: AppLanguage
  userMessage: string
}): RefinementOptionState {
  const { form, prevState, currentInput, candidates, filters, field, language, userMessage } = input
  const { plannerCtx } = buildContextAwarePlannerContext(
    form,
    prevState,
    currentInput,
    userMessage,
    candidates,
    filters,
    field
  )
  const refineSmartOptions = generateSmartOptions({
    plannerCtx,
    simulatorCtx: {
      candidateCount: candidates.length,
      appliedFilters: filters.map(filter => ({
        field: filter.field,
        op: filter.op,
        value: filter.value,
        rawValue: filter.rawValue,
      })),
    },
    rankerCtx: {
      candidateCount: candidates.length,
      filterCount: filters.length,
      hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
    },
  })

  if (refineSmartOptions.length > 0) {
    return {
      chips: smartOptionsToChips(refineSmartOptions),
      displayedOptions: smartOptionsToDisplayedOptions(refineSmartOptions),
    }
  }

  // ── Candidate-based fallback: 현재 candidates에서 해당 필드의 실제 값 추출 ──
  const currentFilterValue = filters.find(f => f.field === field && f.op !== "skip")?.rawValue
  const candidateChips = buildCandidateBasedRefinementChips(field, candidates, currentFilterValue)
  if (candidateChips.length > 0) {
    return {
      chips: candidateChips,
      displayedOptions: buildDisplayedOptions(candidateChips, field),
    }
  }

  const fallbackChips = buildRefinementChips(field, language)
  return {
    chips: fallbackChips,
    displayedOptions: buildDisplayedOptions(fallbackChips, field),
  }
}

export function buildComparisonOptionState(): {
  chips: string[]
  displayedOptions: DisplayedOption[]
} {
  const options: SmartOption[] = [
    {
      id: "comp-recommend",
      family: "action",
      label: "추천해주세요",
      value: "추천해주세요",
      plan: { type: "apply_filter", patches: [] },
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 90,
    },
    {
      id: "comp-other",
      family: "explore",
      label: "다른 조건으로",
      value: "다른 조건으로",
      plan: { type: "branch_session", patches: [] },
      projectedCount: null,
      projectedDelta: null,
      preservesContext: false,
      destructive: false,
      recommended: false,
      priorityScore: 70,
    },
    {
      id: "comp-back",
      family: "action",
      label: "⟵ 이전 단계",
      value: "⟵ 이전 단계",
      plan: { type: "apply_filter", patches: [] },
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 50,
    },
    {
      id: "comp-reset",
      family: "reset",
      label: "처음부터 다시",
      value: "처음부터 다시",
      plan: { type: "reset_session", patches: [] },
      projectedCount: null,
      projectedDelta: null,
      preservesContext: false,
      destructive: true,
      recommended: false,
      priorityScore: 10,
    },
  ]

  return {
    chips: smartOptionsToChips(options),
    displayedOptions: smartOptionsToDisplayedOptions(options),
  }
}

export function buildDisplayedOptions(chips: string[], field: string): DisplayedOption[] {
  const options: DisplayedOption[] = []
  let index = 1
  for (const chip of chips) {
    if (["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요"].includes(chip)) continue
    const countMatch = chip.match(/\((\d+)개\)/)
    const count = countMatch ? parseInt(countMatch[1]) : 0
    const value = chip.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    if (value) {
      options.push({ index, label: chip, field, value, count })
      index++
    }
  }
  return options
}

function shouldUseQuestionAssistHelpers(userStateResult: UserStateResult): boolean {
  return (
    userStateResult.state === "confused" ||
    userStateResult.state === "wants_explanation"
  )
}

function reconstructPreviousQuestion(
  prevState: ExplorationSessionState
): PendingQuestion | null {
  const field = prevState.lastAskedField ?? null
  const prevOptions = prevState.displayedOptions ?? []
  const prevChips = prevState.displayedChips ?? []

  let extractedOptions: string[] = []
  if (prevOptions.length > 0) {
    extractedOptions = prevOptions
      .map(option => option.value)
      .filter(
        value =>
          value &&
          !["상관없음", "skip", "처음부터 다시", "⟵ 이전 단계", "추천해주세요"].includes(value)
      )
  } else if (prevChips.length > 0) {
    extractedOptions = prevChips
      .filter(chip => !["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요"].includes(chip))
      .map(chip => chip.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim())
      .filter(chip => chip.length > 0)
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

function reconstructPreviousQuestionFromCandidates(
  prevState: ExplorationSessionState,
  currentCandidates: ScoredProduct[],
  /** 현재 턴의 질문 필드 (있으면 prevState.lastAskedField 대신 사용) */
  currentQuestionField?: string | null
): PendingQuestion | null {
  const field = currentQuestionField ?? prevState.lastAskedField ?? null
  if (!field) return null
  const alreadySkipped = (prevState.appliedFilters ?? []).some(filter => filter.field === field && filter.op === "skip")
  if (alreadySkipped) {
    console.log(`[reconstruct-question] Skip filter already applied for "${field}", suppressing stale question rebuild`)
    return null
  }

  const fieldGetter: Record<string, (product: { product: Record<string, unknown> }) => string | number | null> = {
    fluteCount: product => (product.product.fluteCount as number) ?? null,
    coating: product => (product.product.coating as string) ?? null,
    seriesName: product => (product.product.seriesName as string) ?? null,
    toolSubtype: product => (product.product.toolSubtype as string) ?? null,
    toolMaterial: product => (product.product.toolMaterial as string) ?? null,
    diameterMm: product => (product.product.diameterMm as number) ?? null,
    diameterRefine: product => (product.product.diameterMm as number) ?? null,
  }
  const getter = fieldGetter[field]
  if (!getter) return reconstructPreviousQuestion(prevState)

  // 현재 질문 필드가 명시적으로 전달되었고 prevState 필드와 다르면
  // prevState의 displayedOptions/chips를 사용하지 않음 (stale 방지)
  if (currentQuestionField && currentQuestionField !== prevState.lastAskedField) {
    console.log(`[reconstruct-question] Field transition: ${prevState.lastAskedField} → ${currentQuestionField}, invalidating stale options`)
  }

  const candidateSource: Array<{ product: Record<string, unknown> }> =
    currentCandidates.length > 0
      ? currentCandidates
      : (prevState.displayedCandidates ?? []).map(candidate => ({
          product: {
            fluteCount: candidate.fluteCount,
            coating: candidate.coating,
            seriesName: candidate.seriesName,
            toolSubtype: (candidate as { toolSubtype?: unknown }).toolSubtype,
            toolMaterial: candidate.toolMaterial,
            diameterMm: candidate.diameterMm,
          },
        }))

  if (candidateSource.length === 0) return reconstructPreviousQuestion(prevState)

  const valueCounts = new Map<string, number>()
  for (const candidate of candidateSource) {
    const value = getter(candidate)
    if (value != null) {
      const label = field === "fluteCount"
        ? `${value}날`
        : field === "diameterMm" || field === "diameterRefine"
          ? `${value}mm`
          : String(value)
      valueCounts.set(label, (valueCounts.get(label) ?? 0) + 1)
    }
  }

  if (valueCounts.size === 0) return reconstructPreviousQuestion(prevState)

  return {
    shape: "constrained_options",
    questionText: "",
    extractedOptions: Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value),
    field,
    isBinary: false,
    hasExplicitChoices: true,
  }
}

function deduplicateOptions(options: SmartOption[]): SmartOption[] {
  const seen = new Set<string>()
  const labelMap: Record<string, string> = {
    explain: "쉽게 설명해줘",
    delegate: "추천으로 골라줘",
  }

  return options.flatMap(option => {
    const label = labelMap[option.label] ?? option.label
    const key = label.toLowerCase().replace(/\s+/g, "")
    if (seen.has(key)) return []
    seen.add(key)
    return [{ ...option, label }]
  })
}

// ════════════════════════════════════════════════════════════════
// QUESTION FIELD OPTIONS — option-first question path
// ════════════════════════════════════════════════════════════════

/**
 * Convert question engine output (field + candidate chips) into structured SmartOptions.
 * This is the option-first entry point for the question path.
 *
 * The question engine provides: field, candidateChips (e.g. ["2날 (216개)", "3날 (173개)"])
 * This function produces: SmartOption[] → displayedOptions → chips
 *
 * Option families:
 * - question_choice: direct field value selection
 * - skip_choice: "상관없음"
 * - navigation: "⟵ 이전 단계"
 */
export function buildQuestionFieldOptions(
  field: string,
  candidateChips: string[],
  hasHistory: boolean
): { options: SmartOption[]; displayedOptions: DisplayedOption[]; chips: string[] } {
  let optionIndex = 0
  const nextId = () => `qfield_${field}_${++optionIndex}`

  const options: SmartOption[] = []

  // Field value choices from candidate distribution
  for (const chip of candidateChips) {
    if (["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요"].includes(chip)) continue

    const countMatch = chip.match(/\((\d+)개\)/)
    const count = countMatch ? parseInt(countMatch[1]) : null
    const value = chip.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()

    if (!value) continue
    // 0개 후보인 옵션은 칩에서 제외
    if (count === 0) continue

    options.push({
      id: nextId(),
      family: "narrowing",
      label: chip,
      subtitle: count != null ? `${count}개 후보` : undefined,
      field,
      value,
      reason: "후보 분포 기반 선택지",
      projectedCount: count,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: optionIndex === 1, // first option is recommended
      priorityScore: count ?? 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field, value }],
      },
    })
  }

  // Skip option
  options.push({
    id: nextId(),
    family: "action" as SmartOption["family"],
    label: "상관없음",
    subtitle: "이 조건 건너뛰기",
    field,
    value: "skip",
    reason: "조건 무관",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0,
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field, value: "skip" }],
    },
  })

  // Navigation: back
  if (hasHistory) {
    options.push({
      id: nextId(),
      family: "action" as SmartOption["family"],
      label: "⟵ 이전 단계",
      value: "undo",
      reason: "이전 필터 단계로 복귀",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: -1,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "undo" }],
      },
    })
  }

  const displayedOptions = smartOptionsToDisplayedOptions(options)
  const chips = smartOptionsToChips(options)

  return { options, displayedOptions, chips }
}

/**
 * candidates에서 해당 field의 실제 값을 추출하여 칩 생성.
 * 현재 적용된 필터값은 제외, 각 값의 후보 개수 표시.
 */
function buildCandidateBasedRefinementChips(
  field: string,
  candidates: ScoredProduct[],
  currentFilterValue: string | number | undefined
): string[] {
  if (candidates.length === 0) return []

  const valueCounts = new Map<string, number>()
  const fieldKey = field === "diameter" || field === "diameterMm" || field === "diameterRefine" ? "diameterMm"
    : field === "fluteCount" ? "fluteCount"
    : field === "coating" ? "coating"
    : field === "toolSubtype" ? "toolSubtype"
    : field === "seriesName" ? "seriesName"
    : null
  if (!fieldKey) return []

  // ── Dominant category 결정 (Milling vs Holemaking vs Threading 등) ──
  // candidates는 ±2mm 범위라 다른 카테고리(드릴 등)가 섞여있을 수 있음
  // applicationShapes로 dominant category를 판별하고, 해당 카테고리 제품만 카운트
  const MILLING_SHAPES = new Set(["Side_Milling","Slotting","Profiling","Facing","Die-Sinking","Trochoidal","Helical_Interpolation","Corner_Radius","Taper_Side_Milling","Small_Part","Ramping","Plunging","Chamfering"])
  const HOLEMAKING_SHAPES = new Set(["Drilling","Reaming_Blind","Reaming_Through"])
  const THREADING_SHAPES = new Set(["Threading_Blind","Threading_Through"])

  let millingCount = 0, holemakerCount = 0, threadingCount = 0
  for (const c of candidates) {
    const shapes: string[] = (c.product as Record<string, unknown>).applicationShapes as string[] ?? []
    if (shapes.some(s => MILLING_SHAPES.has(s))) millingCount++
    else if (shapes.some(s => HOLEMAKING_SHAPES.has(s))) holemakerCount++
    else if (shapes.some(s => THREADING_SHAPES.has(s))) threadingCount++
    else millingCount++ // default to milling
  }

  const dominantCategory = millingCount >= holemakerCount && millingCount >= threadingCount ? "milling"
    : holemakerCount > millingCount ? "holemaking"
    : "threading"

  for (const c of candidates) {
    // dominant category에 속하는 제품만 카운트
    const shapes: string[] = (c.product as Record<string, unknown>).applicationShapes as string[] ?? []
    const isMilling = shapes.some(s => MILLING_SHAPES.has(s)) || shapes.length === 0
    const isHolemaking = shapes.some(s => HOLEMAKING_SHAPES.has(s))
    const isThreading = shapes.some(s => THREADING_SHAPES.has(s))

    const matchesDominant =
      (dominantCategory === "milling" && isMilling) ||
      (dominantCategory === "holemaking" && isHolemaking) ||
      (dominantCategory === "threading" && isThreading)

    if (!matchesDominant) continue

    const raw = (c.product as Record<string, unknown>)[fieldKey]
    if (raw == null) continue
    const val = String(raw)
    if (!val || val === "미확인") continue
    valueCounts.set(val, (valueCounts.get(val) ?? 0) + 1)
  }

  // 현재 필터값 제외
  if (currentFilterValue != null) {
    valueCounts.delete(String(currentFilterValue))
  }

  if (valueCounts.size === 0) return []

  const sorted = [...valueCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const chips = sorted.map(([val, count]) => {
    if (fieldKey === "fluteCount") return `${val}날 (${count}개)`
    if (fieldKey === "diameterMm") return `${val}mm (${count}개)`
    return `${val} (${count}개)`
  })
  chips.push("상관없음")
  return chips
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
