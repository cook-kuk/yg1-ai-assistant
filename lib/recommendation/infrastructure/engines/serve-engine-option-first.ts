import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type {
  AppliedFilter,
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
  buildNarrowingPlannerContext,
  buildPostRecommendationPlannerContext,
  extractCandidateFieldValues,
  smartOptionsToChips,
  smartOptionsToDisplayedOptions,
} from "@/lib/recommendation/domain/options/option-bridge"
import { buildQuestionAlignedOptions, buildConfusionHelperOptions } from "@/lib/recommendation/domain/options/question-option-builder"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import { buildChipContext } from "@/lib/recommendation/domain/context/chip-context-builder"
import { rerankChipsWithLLM } from "@/lib/recommendation/domain/options/llm-chip-reranker"
import { buildRecentInteractionFrame } from "@/lib/recommendation/domain/context/recent-interaction-frame"

export interface GeneralChatOptionState {
  finalChips: string[]
  finalDisplayedOptions: DisplayedOption[]
  userStateResult: UserStateResult
  isQuestionAssist: boolean
}

interface QuestionAssistOptionsInput {
  prevState: ExplorationSessionState
  currentCandidates: ScoredProduct[]
  confusedAbout: string | null
  includeHelpers: boolean
}

interface QuestionAssistOptionsResult {
  question: PendingQuestion | null
  options: SmartOption[]
  chips: string[]
  displayedOptions: DisplayedOption[]
  helperCount: number
  originalCount: number
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

  const userStateResult = detectUserState(userMessage, prevState.lastAskedField)

  const { plannerCtx, interpretation } = buildContextAwarePlannerContext(
    form,
    prevState,
    currentInput,
    userMessage,
    candidates,
    filters,
    prevState.lastAskedField ?? undefined
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
    },
  })

  const frame = buildRecentInteractionFrame(assistantText, userMessage, prevState)

  let finalChips: string[]
  let finalDisplayedOptions: DisplayedOption[]

  if (generalSmartOptions.length > 0) {
    const chipContext = buildChipContext(
      prevState,
      currentInput,
      userMessage,
      assistantText,
      null,
      userStateResult.state,
      userStateResult.confusedAbout,
      recentMessages.map(message => ({ role: message.role, text: message.text }))
    )
    const reranked = await rerankChipsWithLLM(generalSmartOptions, chipContext, provider)
    finalChips = smartOptionsToChips(reranked.options)
    finalDisplayedOptions = smartOptionsToDisplayedOptions(reranked.options)
    console.log(
      `[option-first:general] SmartOptions=${generalSmartOptions.length}, reranked=${reranked.rerankedByLLM}, frame=${frame.relation}, chips=${finalChips.join(",")}`
    )
  } else {
    finalChips = prevState.displayedChips?.length > 0 ? prevState.displayedChips : fallbackChips
    finalDisplayedOptions = prevState.displayedOptions ?? []
  }

  const shouldMergeHelpers = shouldUseQuestionAssistHelpers(userStateResult)
  const hasStatePendingQuestion =
    !!prevState.lastAskedField && !prevState.resolutionStatus?.startsWith("resolved")

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
      console.log(
        `[question-assist] User ${userStateResult.state}, ${assist.helperCount} helpers + ${assist.originalCount} field options (field=${assist.question?.field ?? "none"})`
      )
    }
  }

  const isQuestionAssist =
    !!prevState.lastAskedField &&
    !prevState.resolutionStatus?.startsWith("resolved") &&
    shouldMergeHelpers

  return {
    finalChips,
    finalDisplayedOptions,
    userStateResult,
    isQuestionAssist,
  }
}

export function buildQuestionAssistOptions(
  input: QuestionAssistOptionsInput
): QuestionAssistOptionsResult {
  const question = reconstructPreviousQuestionFromCandidates(input.prevState, input.currentCandidates)
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
    helperCount: helperOptions.length,
    originalCount: originalOptions.length,
  }
}

export function generateSmartOptionsForQuestion(
  candidates: ScoredProduct[],
  filters: AppliedFilter[],
  input: RecommendationInput,
  lastAskedField?: string | null,
  form?: ProductIntakeForm | null,
  sessionState?: ExplorationSessionState | null,
  userMessage?: string | null
): SmartOption[] {
  if (candidates.length === 0) return []

  if (form) {
    const { plannerCtx, interpretation } = buildContextAwarePlannerContext(
      form,
      sessionState ?? null,
      input,
      userMessage ?? null,
      candidates,
      filters,
      lastAskedField ?? undefined
    )

    return generateSmartOptions({
      plannerCtx,
      simulatorCtx: {
        candidateCount: candidates.length,
        appliedFilters: filters,
        candidateFieldValues: extractCandidateFieldValues(candidates),
      },
      rankerCtx: {
        candidateCount: candidates.length,
        filterCount: filters.length,
        hasRecommendation: false,
        contextInterpretation: interpretation,
      },
    })
  }

  const plannerCtx = buildNarrowingPlannerContext(candidates, filters, input, lastAskedField ?? undefined)

  return generateSmartOptions({
    plannerCtx,
    simulatorCtx: {
      candidateCount: candidates.length,
      appliedFilters: filters,
      candidateFieldValues: extractCandidateFieldValues(candidates),
    },
    rankerCtx: {
      candidateCount: candidates.length,
      filterCount: filters.length,
      hasRecommendation: false,
    },
  })
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
  })
}

function shouldUseQuestionAssistHelpers(userStateResult: UserStateResult): boolean {
  return (
    userStateResult.state === "confused" ||
    userStateResult.state === "wants_explanation" ||
    userStateResult.state === "wants_delegation"
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
  currentCandidates: ScoredProduct[]
): PendingQuestion | null {
  const field = prevState.lastAskedField ?? null
  if (!field) return null

  const fieldGetter: Record<string, (product: { product: Record<string, unknown> }) => string | number | null> = {
    fluteCount: product => (product.product.fluteCount as number) ?? null,
    coating: product => (product.product.coating as string) ?? null,
    seriesName: product => (product.product.seriesName as string) ?? null,
    toolSubtype: product => (product.product.toolSubtype as string) ?? null,
    toolMaterial: product => (product.product.toolMaterial as string) ?? null,
    diameterRefine: product => (product.product.diameterMm as number) ?? null,
  }
  const getter = fieldGetter[field]
  if (!getter) return reconstructPreviousQuestion(prevState)

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
      const label = field === "fluteCount" ? `${value}날` : String(value)
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
