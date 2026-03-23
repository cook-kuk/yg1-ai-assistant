import { notifyRecommendation } from "@/lib/recommendation/infrastructure/notifications/recommendation-notifier"
import {
  buildExplanation,
  buildDeterministicSummary,
  buildProductLabel,
  buildRationale,
  buildSessionState,
  buildWarnings,
  checkResolution,
  classifyHybridResults,
  groupCandidatesBySeries,
  prepareRequest,
  runFactCheck,
  runHybridRetrieval,
  selectNextQuestion,
} from "@/lib/recommendation/domain/recommendation-domain"
import {
  buildExplanationResultPrompt,
  buildGreetingPrompt,
  buildSessionContext,
  buildSystemPrompt,
  getProvider,
} from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
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
  UINarrowingPathEntry,
  ChatMessage,
} from "@/lib/recommendation/domain/types"
import {
  generateSmartOptions,
  type SmartOption,
} from "@/lib/recommendation/domain/options"
import {
  extractCandidateFieldValues,
  smartOptionsToDisplayedOptions,
  smartOptionsToChips,
  buildNarrowingPlannerContext,
  buildPostRecommendationPlannerContext,
  buildContextAwarePlannerContext,
} from "@/lib/recommendation/domain/options/option-bridge"
import { buildQuestionAlignedOptions, buildConfusionHelperOptions } from "@/lib/recommendation/domain/options/question-option-builder"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import { buildChipContext } from "@/lib/recommendation/domain/context/chip-context-builder"
import { rerankChipsWithLLM } from "@/lib/recommendation/domain/options/llm-chip-reranker"
import { generateContextualChips } from "@/lib/recommendation/domain/options/contextual-chip-generator"
import { checkAnswerChipDivergence, fixChipDivergence } from "@/lib/recommendation/domain/options/divergence-guard"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"

type DisplayedProduct = RecommendationDisplayedProductRequestDto
type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

export interface ServeResponseBuilderDependencies {
  jsonRecommendationResponse: JsonRecommendationResponse
}

export async function buildQuestionResponse(
  deps: ServeResponseBuilderDependencies,
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
): Promise<Response> {
  const question = selectNextQuestion(input, candidates, history)
  const stageHistory = existingStageHistory
    ? [...existingStageHistory]
    : buildStageHistoryFromFilters(filters, input, candidates.length)

  const candidateSnapshot = buildCandidateSnapshot(candidates, evidenceMap)

  // ── Smart Option Engine: context-aware option generation ──
  const lastUserMsg = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null
  const smartOptions = generateSmartOptionsForQuestion(
    candidates, filters, input, question?.field,
    form, null, lastUserMsg
  )
  const hasSmartOptions = smartOptions.length > 0

  // Use smart options for displayedOptions when available, fallback to chip-based
  const chips = question?.chips ?? []
  const displayedOptions = hasSmartOptions
    ? smartOptionsToDisplayedOptions(smartOptions)
    : buildDisplayedOptions(chips, question?.field ?? "unknown")
  const displayedSeriesGroups = groupCandidatesBySeries(candidateSnapshot)

  const sessionState = buildSessionState({
    candidateCount: candidates.length,
    appliedFilters: filters,
    narrowingHistory: history,
    stageHistory,
    resolutionStatus: checkResolution(candidates, history),
    resolvedInput: input,
    turnCount,
    lastAskedField: question?.field ?? undefined,
    displayedProducts: candidateSnapshot,
    fullDisplayedProducts: candidateSnapshot,
    displayedSeriesGroups,
    uiNarrowingPath: buildUINarrowingPath(filters, history, candidates.length),
    currentMode: messages.length === 0 ? "question" : "narrowing",
    displayedCandidates: candidateSnapshot,
    displayedChips: chips,
    displayedOptions,
    lastAction: "continue_narrowing",
  })

  logNarrowingState("question", sessionState, question?.field ?? null)

  if (!question && !overrideText) {
    return buildRecommendationResponse(
      deps,
      form,
      candidates,
      evidenceMap,
      input,
      history,
      filters,
      turnCount,
      messages,
      provider,
      language,
      snapshotToDisplayed(candidateSnapshot)
    )
  }

  let responseText = overrideText ?? question?.questionText ?? ""
  let responseChips = question?.chips ?? chips

  if (overrideText) {
    // no-op
  } else if (provider.available() && messages.length === 0) {
    try {
      const systemPrompt = buildSystemPrompt(language)
      const sessionCtx = buildSessionContext(form, sessionState, candidates.length, snapshotToDisplayed(candidateSnapshot))
      const greetingPrompt = buildGreetingPrompt(sessionCtx, question, candidates.length, language)
      const raw = await provider.complete(systemPrompt, [{ role: "user", content: greetingPrompt }], 800)
      const parsed = safeParseJSON(raw)
      if (typeof parsed?.responseText === "string") {
        responseText = parsed.responseText
      }
    } catch (error) {
      console.warn("[recommend] LLM greeting failed:", error)
    }
  } else if (provider.available() && messages.length > 0) {
    try {
      const systemPrompt = buildSystemPrompt(language)
      const sessionCtx = buildSessionContext(form, sessionState, candidates.length, snapshotToDisplayed(candidateSnapshot))
      const raw = await provider.complete(systemPrompt, [
        { role: "user", content: `${sessionCtx}\n\n다음 질문을 자연스럽고 간결한 ${language === "ko" ? "한국어" : "영어"}로 다듬어주세요: "${question?.questionText ?? ""}"\n현재 후보 ${candidates.length}개.\nJSON으로 응답: { "responseText": "...", "extractedParams": {}, "isComplete": false, "skipQuestion": false }` }
      ], 300)
      const parsed = safeParseJSON(raw)
      if (typeof parsed?.responseText === "string") {
        responseText = parsed.responseText
      }
    } catch (error) {
      console.warn("[recommend] LLM question polish failed:", error)
    }
  }

  const requestPrep = prepareRequest(form, messages, sessionState, input, candidates.length)

  // ── Option-first: chips are derived from structured displayedOptions (built above) ──
  // Text-to-chip synthesis is NOT allowed on the main path.
  // displayedOptions (from smart options or question engine) is the source of truth.
  let finalResponseChips = responseChips
  let finalDisplayedOptions = displayedOptions
  const lastUserMsgText = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  // Only apply confusion-helper merge if user is confused AND structured options exist
  if (lastUserMsgText && displayedOptions.length > 0) {
    const userStateResult = detectUserState(lastUserMsgText, question?.field)
    if (userStateResult.state === "confused" || userStateResult.state === "wants_explanation" || userStateResult.state === "wants_delegation") {
      // Reconstruct pending question from STATE (not answer text)
      const statePendingQ = question?.field ? {
        shape: "constrained_options" as const,
        questionText: question.questionText,
        extractedOptions: question.chips.filter((c: string) => c !== "상관없음" && c !== "⟵ 이전 단계"),
        field: question.field,
        isBinary: false,
        hasExplicitChoices: true,
      } : null
      if (statePendingQ) {
        const helperOptions = buildConfusionHelperOptions(statePendingQ, userStateResult.confusedAbout)
        const existingSmartOptions = hasSmartOptions ? smartOptions : []
        const mergedOptions = [...helperOptions, ...existingSmartOptions]

        // LLM rerank (optional)
        const chipContext = buildChipContext(
          sessionState, input, lastUserMsgText, responseText,
          statePendingQ, userStateResult.state, userStateResult.confusedAbout,
          messages.map(m => ({ role: m.role, text: m.text }))
        )
        const reranked = await rerankChipsWithLLM(mergedOptions, chipContext, provider)

        finalResponseChips = smartOptionsToChips(reranked.options)
        finalDisplayedOptions = smartOptionsToDisplayedOptions(reranked.options)
        sessionState.displayedChips = finalResponseChips
        sessionState.displayedOptions = finalDisplayedOptions
        console.log(`[option-first:confusion] User ${userStateResult.state}, ${helperOptions.length} helpers merged (field=${question?.field ?? "none"})`)
      }
    }
  }

  // ── Post-Answer Validator: strip unauthorized actions from answer ──
  // Direction: displayedOptions → constrain answer (NEVER answer → add chips)
  const questionValidation = validateOptionFirstPipeline(responseText, finalResponseChips, finalDisplayedOptions)
  if (questionValidation.correctedAnswer) {
    responseText = questionValidation.correctedAnswer
    console.log(`[answer-validator:question] Softened unauthorized actions: ${questionValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
  }

  return deps.jsonRecommendationResponse({
    text: responseText,
    purpose: messages.length === 0 ? "greeting" : "question",
    chips: finalResponseChips,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot,
    requestPreparation: requestPrep,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
  })
}

export async function buildRecommendationResponse(
  deps: ServeResponseBuilderDependencies,
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
  displayedProducts: DisplayedProduct[] | null = null
): Promise<Response> {
  const { primary, alternatives, status } = classifyHybridResults({ candidates, evidenceMap, totalConsidered: candidates.length, filtersApplied: filters })
  const warnings = primary ? buildWarnings(primary, input) : ["조건에 맞는 제품을 찾지 못했습니다"]
  const rationale = primary ? buildRationale(primary, input) : []

  if (form.material.status === "unknown") warnings.push("소재 미지정 — 전체 소재 대상 검색")
  if (form.diameterInfo.status === "unknown") warnings.push("직경 미지정 — 직경 기준 필터 없음")

  const deterministicSummary = buildDeterministicSummary({
    status,
    query: input,
    primaryProduct: primary,
    alternatives,
    warnings,
    rationale,
    sourceSummary: [],
    deterministicSummary: "",
    llmSummary: null,
    totalCandidatesConsidered: candidates.length,
  })

  const evidenceSummaries: EvidenceSummary[] = []
  if (primary) {
    const primarySummary = evidenceMap.get(primary.product.normalizedCode)
    if (primarySummary) evidenceSummaries.push(primarySummary)
  }
  for (const alt of alternatives) {
    const summary = evidenceMap.get(alt.product.normalizedCode)
    if (summary) evidenceSummaries.push(summary)
  }

  let primaryExplanation: RecommendationExplanation | null = null
  let primaryFactChecked: FactCheckedRecommendation | null = null
  const altExplanations: RecommendationExplanation[] = []
  const altFactChecked: FactCheckedRecommendation[] = []

  if (primary) {
    const primaryEvidence = evidenceMap.get(primary.product.normalizedCode) ?? null
    primaryExplanation = buildExplanation(primary, input, primaryEvidence)
    primaryFactChecked = await runFactCheck(primary, input, primaryEvidence, primaryExplanation)

    for (const alt of alternatives) {
      const altEvidence = evidenceMap.get(alt.product.normalizedCode) ?? null
      const altExplanation = buildExplanation(alt, input, altEvidence)
      altExplanations.push(altExplanation)
      altFactChecked.push(await runFactCheck(alt, input, altEvidence, altExplanation))
    }
  }

  const recommendation: RecommendationResult = {
    status,
    query: input,
    primaryProduct: primary,
    alternatives,
    warnings,
    rationale,
    sourceSummary: primary ? buildSourceSummary(primary) : [],
    deterministicSummary,
    llmSummary: null,
    totalCandidatesConsidered: candidates.length,
  }

  if (provider.available() && primary && primaryFactChecked && primaryExplanation) {
    try {
      const systemPrompt = buildSystemPrompt(language)
      const llmSessionState = buildSessionState({
        candidateCount: candidates.length,
        appliedFilters: filters,
        narrowingHistory: history,
        stageHistory: buildStageHistoryFromFilters(filters, input, candidates.length),
        resolutionStatus: checkResolution(candidates, history),
        resolvedInput: input,
        turnCount,
        displayedCandidates: buildCandidateSnapshot(candidates, evidenceMap),
        displayedChips: [],
        displayedOptions: [],
        lastAction: "show_recommendation",
      })
      const sessionCtx = buildSessionContext(form, llmSessionState, candidates.length, snapshotToDisplayed(llmSessionState.displayedCandidates))
      const resultPrompt = buildExplanationResultPrompt(
        sessionCtx,
        primaryFactChecked,
        primaryExplanation,
        alternatives.map(alt => {
          const altEvidence = evidenceMap.get(alt.product.normalizedCode)
          return {
            displayCode: alt.product.displayCode,
            matchStatus: alt.matchStatus,
            score: alt.score,
            bestCondition: altEvidence?.bestCondition
              ? { ...altEvidence.bestCondition } as Record<string, string | null>
              : null,
            sourceCount: altEvidence?.sourceCount ?? 0,
          }
        }),
        warnings,
        language
      )

      const raw = await provider.complete(systemPrompt, [{ role: "user", content: resultPrompt }], 1500)
      const parsed = safeParseJSON(raw)
      if (parsed?.responseText) {
        recommendation.llmSummary = parsed.responseText as string
      } else if (raw.trim() && !raw.trim().startsWith("{") && !raw.trim().startsWith("[")) {
        recommendation.llmSummary = raw.trim()
      }
    } catch (error) {
      console.warn("[recommend] LLM result summary failed:", error)
    }
  }

  const candidateSnapshot = buildCandidateSnapshot(candidates, evidenceMap)
  const recLastUserMsg = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  // ── Option-first: structured options FIRST, then derive chips ──
  // NEVER generate chips from answer text. displayedOptions → chips.
  const postRecOptions = generateSmartOptionsForRecommendation(
    candidateSnapshot, filters, input, form, null, recLastUserMsg
  )
  const postRecDisplayedOptions = postRecOptions.length > 0
    ? smartOptionsToDisplayedOptions(postRecOptions)
    : []
  // Derive chips from structured options; fallback to deterministic if no smart options
  const followUpChips = postRecOptions.length > 0
    ? smartOptionsToChips(postRecOptions)
    : getFollowUpChips(recommendation)

  const displayedSeriesGroups = groupCandidatesBySeries(candidateSnapshot)
  const sessionState = buildSessionState({
    candidateCount: candidates.length,
    appliedFilters: filters,
    narrowingHistory: history,
    stageHistory: buildStageHistoryFromFilters(filters, input, candidates.length),
    resolutionStatus: checkResolution(candidates, history),
    resolvedInput: input,
    turnCount,
    displayedProducts: candidateSnapshot,
    fullDisplayedProducts: candidateSnapshot,
    displayedSeriesGroups,
    uiNarrowingPath: buildUINarrowingPath(filters, history, candidates.length),
    currentMode: "recommendation",
    displayedCandidates: candidateSnapshot,
    displayedChips: followUpChips,
    displayedOptions: postRecDisplayedOptions,
    lastAction: "show_recommendation",
  })

  const requestPrep = prepareRequest(form, messages, sessionState, input, candidates.length)
  let responseText = recommendation.llmSummary ?? deterministicSummary

  if (primary && primary.product.brand) {
    const brandName = primary.product.brand
    const hasBrand = responseText.includes(brandName) || /브랜드명/.test(responseText)
    if (!hasBrand) {
      responseText = `**브랜드명:** ${brandName} | **제품코드:** ${primary.product.displayCode}\n\n${responseText}`
    }
  }

  if (primary) {
    notifyRecommendation({
      productCode: primary.product.displayCode,
      brand: primary.product.brand,
      seriesName: primary.product.seriesName,
      matchStatus: status,
      score: primary.score,
      query: `직경:${input.diameterMm ?? "?"}mm 소재:${input.material ?? "?"} 가공:${input.operationType ?? "?"}`,
    }).catch(() => {})
  }

  // ── Post-Answer Validator: strip unauthorized actions from answer ──
  // Direction: displayedOptions → constrain answer (NEVER answer → add chips)
  const finalRecChips = followUpChips
  let finalResponseText = status === "none"
    ? "조건에 맞는 제품을 찾지 못했습니다. 직경이나 소재 조건을 조정해보세요."
    : responseText
  const recValidation = validateOptionFirstPipeline(finalResponseText, finalRecChips, postRecDisplayedOptions)
  if (recValidation.correctedAnswer) {
    finalResponseText = recValidation.correctedAnswer
    console.log(`[answer-validator:recommendation] Softened unauthorized actions: ${recValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
  }

  return deps.jsonRecommendationResponse({
    text: finalResponseText,
    purpose: "recommendation",
    chips: finalRecChips,
    isComplete: true,
    recommendation,
    sessionState,
    evidenceSummaries: evidenceSummaries.length > 0 ? evidenceSummaries : null,
    candidateSnapshot,
    requestPreparation: requestPrep,
    primaryExplanation,
    primaryFactChecked: primaryFactChecked ? serializeFactChecked(primaryFactChecked) : null,
    altExplanations,
    altFactChecked: altFactChecked.map(item => serializeFactChecked(item)),
  })
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

export function snapshotToDisplayed(snapshot: CandidateSnapshot[]): DisplayedProduct[] {
  return snapshot.slice(0, 10).map(candidate => ({
    rank: candidate.rank,
    code: candidate.displayCode,
    brand: candidate.brand,
    series: candidate.seriesName,
    diameter: candidate.diameterMm,
    flute: candidate.fluteCount,
    coating: candidate.coating,
    materialTags: candidate.materialTags,
    score: candidate.score,
    matchStatus: candidate.matchStatus,
  }))
}

export function buildCandidateSnapshot(
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>
): CandidateSnapshot[] {
  return candidates.map((candidate, index) => {
    const evidence = evidenceMap.get(candidate.product.normalizedCode)
    const inventoryLocations = Array.from(
      candidate.inventory.reduce((acc, row) => {
        if (row.quantity === null || row.quantity <= 0) return acc
        const key = row.warehouseOrRegion?.trim()
        if (!key) return acc
        acc.set(key, (acc.get(key) ?? 0) + row.quantity)
        return acc
      }, new Map<string, number>())
    )
      .map(([warehouseOrRegion, quantity]) => ({ warehouseOrRegion, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.warehouseOrRegion.localeCompare(b.warehouseOrRegion))
    const inventorySnapshotDate = candidate.inventory
      .map(row => row.snapshotDate)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort()
      .at(-1) ?? null

    return {
      rank: index + 1,
      productCode: candidate.product.normalizedCode,
      displayCode: candidate.product.displayCode,
      displayLabel: buildProductLabel(candidate.product),
      brand: candidate.product.brand ?? null,
      seriesName: candidate.product.seriesName,
      seriesIconUrl: candidate.product.seriesIconUrl ?? null,
      diameterMm: candidate.product.diameterMm,
      fluteCount: candidate.product.fluteCount,
      coating: candidate.product.coating,
      toolMaterial: candidate.product.toolMaterial ?? null,
      shankDiameterMm: candidate.product.shankDiameterMm ?? null,
      lengthOfCutMm: candidate.product.lengthOfCutMm ?? null,
      overallLengthMm: candidate.product.overallLengthMm ?? null,
      helixAngleDeg: candidate.product.helixAngleDeg ?? null,
      description: candidate.product.description ?? null,
      featureText: candidate.product.featureText ?? null,
      materialTags: candidate.product.materialTags,
      score: candidate.score,
      scoreBreakdown: candidate.scoreBreakdown,
      matchStatus: candidate.matchStatus,
      stockStatus: candidate.stockStatus,
      totalStock: candidate.totalStock,
      inventorySnapshotDate,
      inventoryLocations,
      hasEvidence: !!evidence && evidence.chunks.length > 0,
      bestCondition: evidence?.bestCondition ?? null,
    }
  })
}

export function buildStageHistoryFromFilters(
  filters: AppliedFilter[],
  currentInput: RecommendationInput,
  currentCandidateCount: number
): NarrowingStage[] {
  const stages: NarrowingStage[] = [{
    stepIndex: -1,
    stageName: "initial_search",
    filterApplied: null,
    candidateCount: currentCandidateCount,
    resolvedInputSnapshot: { ...currentInput },
    filtersSnapshot: [],
  }]

  let accumulatedFilters: AppliedFilter[] = []
  for (const filter of filters) {
    accumulatedFilters = [...accumulatedFilters, filter]
    stages.push({
      stepIndex: filter.appliedAt,
      stageName: `${filter.field}_${filter.value}`,
      filterApplied: filter,
      candidateCount: currentCandidateCount,
      resolvedInputSnapshot: { ...currentInput },
      filtersSnapshot: [...accumulatedFilters],
    })
  }

  return stages
}

function buildUINarrowingPath(
  filters: AppliedFilter[],
  history: NarrowingTurn[],
  fallbackCandidateCount: number
): UINarrowingPathEntry[] {
  return filters
    .filter(filter => filter.op !== "skip")
    .map((filter, index) => ({
      kind: "filter",
      label: `${filter.field}=${filter.value}`,
      field: filter.field,
      value: filter.value,
      candidateCount: history[index]?.candidateCountAfter ?? fallbackCandidateCount,
    }))
}

export function logNarrowingState(
  phase: string,
  state: ExplorationSessionState,
  currentField: string | null
): void {
  console.log(`[narrowing:${phase}] ───────────────────────────`)
  console.log(`[narrowing:${phase}] Session: ${state.sessionId}`)
  console.log(`[narrowing:${phase}] Candidates: ${state.candidateCount}`)
  console.log(`[narrowing:${phase}] Status: ${state.resolutionStatus}`)
  console.log(`[narrowing:${phase}] Turn: ${state.turnCount}`)
  console.log(`[narrowing:${phase}] Filters: ${state.appliedFilters.map(filter => `${filter.field}=${filter.value}`).join(", ") || "(none)"}`)
  console.log(`[narrowing:${phase}] Stages: ${state.stageHistory?.map(stage => stage.stageName).join(" → ") || "(none)"}`)
  if (currentField) {
    console.log(`[narrowing:${phase}] Next question field: ${currentField}`)
  }
  console.log(`[narrowing:${phase}] ───────────────────────────`)
}

export function getFollowUpChips(
  result: RecommendationResult,
  sessionState?: ExplorationSessionState | null,
): string[] {
  const chips: string[] = []
  const altCount = result.alternatives.length
  const hasHistory = (sessionState?.stageHistory?.length ?? 0) > 1
  const primary = result.primaryProduct
  const isExact = result.status === "exact"
  const isApproximate = result.status === "approximate"
  const isNone = result.status === "none"
  const filterCount = sessionState?.appliedFilters?.length ?? 0

  // ── No result: suggest broadening or restart ──
  if (isNone || !primary) {
    if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
    if (filterCount > 0) chips.push("조건 완화하기")
    chips.push("처음부터 다시")
    return chips.slice(0, 6)
  }

  // ── Approximate match: suggest compare, broaden, refine ──
  if (isApproximate) {
    if (altCount > 0) chips.push(`후보 ${altCount + 1}개 비교하기`)
    chips.push("절삭조건 알려줘")
    if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
    chips.push("다른 직경 검색")
    chips.push("처음부터 다시")
    return chips.slice(0, 6)
  }

  // ── Exact match: context-aware follow-ups ──
  if (altCount > 0) chips.push(`대체 후보 ${altCount}개 비교하기`)
  chips.push("절삭조건 알려줘")

  if (altCount >= 2) chips.push("코팅 비교")

  if (primary.stockStatus === "outofstock") {
    chips.push("납기 확인")
  } else if (primary.stockStatus === "limited") {
    chips.push("재고 상세 확인")
  }

  if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
  chips.push("다른 직경 검색")
  chips.push("처음부터 다시")
  return chips.slice(0, 6)
}

export function buildSourceSummary(
  primary: { product: { rawSourceFile: string; rawSourceSheet?: string | null; sourceConfidence?: string | null } } | null
): string[] {
  if (!primary) return []
  const product = primary.product
  return [
    `Source: ${product.rawSourceFile}${product.rawSourceSheet ? ` / ${product.rawSourceSheet}` : ""}`,
    `Confidence: ${product.sourceConfidence ?? "unknown"}`,
  ]
}

export function serializeFactChecked(fc: FactCheckedRecommendation): Record<string, unknown> {
  return {
    productCode: fc.productCode,
    displayCode: fc.displayCode,
    seriesName: fc.seriesName,
    manufacturer: fc.manufacturer,
    diameterMm: fc.diameterMm,
    fluteCount: fc.fluteCount,
    coating: fc.coating,
    toolMaterial: fc.toolMaterial,
    materialTags: fc.materialTags,
    lengthOfCutMm: fc.lengthOfCutMm,
    overallLengthMm: fc.overallLengthMm,
    hasCuttingConditions: fc.hasCuttingConditions,
    bestCondition: fc.bestCondition,
    conditionConfidence: fc.conditionConfidence,
    conditionSourceCount: fc.conditionSourceCount,
    stockStatus: fc.stockStatus,
    totalStock: fc.totalStock,
    minLeadTimeDays: fc.minLeadTimeDays,
    matchPct: fc.matchPct,
    matchStatus: fc.matchStatus,
    score: fc.score,
    explanation: fc.explanation,
    factCheckReport: fc.factCheckReport,
  }
}

export function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

/**
 * Extract field value distributions from candidate snapshots (data-driven, no hardcoding).
 */
function extractFieldValuesFromSnapshot(
  snapshots: CandidateSnapshot[]
): Record<string, Array<{ value: string; count: number }>> {
  const result: Record<string, Array<{ value: string; count: number }>> = {}
  const fields: Array<{ key: string; getter: (c: CandidateSnapshot) => string | number | null }> = [
    { key: "fluteCount", getter: c => c.fluteCount },
    { key: "coating", getter: c => c.coating },
    { key: "seriesName", getter: c => c.seriesName },
  ]
  for (const { key, getter } of fields) {
    const counts = new Map<string, number>()
    for (const c of snapshots) {
      const val = getter(c)
      if (val != null) {
        const strVal = key === "fluteCount" ? `${val}날` : String(val)
        counts.set(strVal, (counts.get(strVal) ?? 0) + 1)
      }
    }
    if (counts.size > 1) {
      result[key] = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }))
    }
  }
  return result
}

// ════════════════════════════════════════════════════════════════
// SMART OPTION ENGINE INTEGRATION
// ════════════════════════════════════════════════════════════════

function generateSmartOptionsForQuestion(
  candidates: ScoredProduct[],
  filters: AppliedFilter[],
  input: RecommendationInput,
  lastAskedField?: string | null,
  form?: ProductIntakeForm | null,
  sessionState?: ExplorationSessionState | null,
  userMessage?: string | null
): SmartOption[] {
  if (candidates.length === 0) return []

  // Use context-aware planning when form and session are available
  if (form) {
    const { plannerCtx, interpretation } = buildContextAwarePlannerContext(
      form, sessionState ?? null, input, userMessage ?? null,
      candidates, filters, lastAskedField ?? undefined
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

  // Fallback: basic planning
  const plannerCtx = buildNarrowingPlannerContext(candidates, filters, input, lastAskedField ?? undefined)
  const fieldValues = extractCandidateFieldValues(candidates)

  return generateSmartOptions({
    plannerCtx,
    simulatorCtx: {
      candidateCount: candidates.length,
      appliedFilters: filters,
      candidateFieldValues: fieldValues,
    },
    rankerCtx: {
      candidateCount: candidates.length,
      filterCount: filters.length,
      hasRecommendation: false,
    },
  })
}

function generateSmartOptionsForRecommendation(
  candidateSnapshot: CandidateSnapshot[],
  filters: AppliedFilter[],
  input: RecommendationInput,
  form?: ProductIntakeForm | null,
  sessionState?: ExplorationSessionState | null,
  userMessage?: string | null
): SmartOption[] {
  if (candidateSnapshot.length === 0) return []

  // Use context-aware planning when form and session are available
  if (form && sessionState) {
    // Build a lightweight ScoredProduct-like array for the bridge
    const { plannerCtx, interpretation } = buildContextAwarePlannerContext(
      form, sessionState, input, userMessage ?? null,
      [], // no raw candidates needed for post-rec
      filters
    )
    // Override with actual snapshot data for top candidates
    plannerCtx.topCandidates = candidateSnapshot.slice(0, 5).map(c => ({
      displayCode: c.displayCode,
      seriesName: c.seriesName,
      coating: c.coating,
      fluteCount: c.fluteCount,
      diameterMm: c.diameterMm,
      score: c.score,
      matchStatus: c.matchStatus,
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

  // Fallback: basic planning
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
