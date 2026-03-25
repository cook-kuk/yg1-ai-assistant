import { notifyRecommendation } from "@/lib/recommendation/infrastructure/notifications/recommendation-notifier"
import { BrandReferenceRepo } from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
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
  selectNextQuestion,
} from "@/lib/recommendation/domain/recommendation-domain"
import {
  buildExplanationResultPrompt,
  buildGreetingPrompt,
  buildSessionContext,
  buildSystemPrompt,
  getProvider,
} from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import {
  buildDisplayedOptions,
  buildQuestionFieldOptions,
  buildQuestionResponseOptionState,
  generateSmartOptionsForRecommendation,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { getMaterialDisplay, resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
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
  smartOptionsToChips,
  smartOptionsToDisplayedOptions,
} from "@/lib/recommendation/domain/options/option-bridge"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"

type DisplayedProduct = RecommendationDisplayedProductRequestDto
type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

export interface ServeResponseBuilderDependencies {
  jsonRecommendationResponse: JsonRecommendationResponse
}

export function buildPaginationDto(page: number, pageSize: number, totalItems: number): RecommendationPaginationDto {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  }
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

async function buildWorkPieceQuestion(
  input: RecommendationInput,
  history: NarrowingTurn[],
  filters: AppliedFilter[],
  candidates?: ScoredProduct[]
): Promise<{
  field: string
  questionText: string
  chips: string[]
  expectedInfoGain: number
} | null> {
  if (input.workPieceName) return null

  const isoGroup = resolveSingleIsoGroup(input.material)
  if (!isoGroup) return null

  const lastWorkPieceFilterIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "workPieceName" ? index : lastIndex
  ), -1)
  const lastMaterialFilterIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "material" ? index : lastIndex
  ), -1)
  if (lastWorkPieceFilterIndex !== -1 && lastWorkPieceFilterIndex >= lastMaterialFilterIndex) {
    return null
  }

  const allWorkPieceNames = await BrandReferenceRepo.listDistinctWorkPieceNames({
    isoGroup,
    limit: 20,
  })
  if (allWorkPieceNames.length <= 1) return null

  // Show workPiece names within the ISO group, but only those with actual matching candidates.
  // 0개 후보인 workPiece는 칩에서 제외 (선택해도 "후보 없음" 나오므로).
  let relevantNames = allWorkPieceNames
  if (candidates && candidates.length > 0) {
    const namesWithCandidates = relevantNames.filter(name => {
      const nameLower = name.toLowerCase()
      return candidates.some(c => {
        const tags = (c.product.materialTags as string[]) ?? []
        const desc = ((c.product as Record<string, unknown>).description as string ?? "").toLowerCase()
        const series = (c.product.seriesName ?? "").toLowerCase()
        const feature = ((c.product as Record<string, unknown>).featureText as string ?? "").toLowerCase()
        return tags.some(t => nameLower.includes(t.toLowerCase()) || t.toLowerCase().includes(nameLower)) ||
          desc.includes(nameLower) || series.includes(nameLower) || feature.includes(nameLower)
      })
    })
    if (namesWithCandidates.length >= 2) {
      relevantNames = namesWithCandidates
      console.log(`[workpiece-filter] ${allWorkPieceNames.length} → ${namesWithCandidates.length} (removed ${allWorkPieceNames.length - namesWithCandidates.length} with 0 candidates)`)
    }
  }

  const materialLabel = getMaterialDisplay(isoGroup).ko
  const chips = [...relevantNames.slice(0, 10), "상관없음"]
  if (history.length > 0) chips.push("⟵ 이전 단계")

  return {
    field: "workPieceName",
    questionText: `선택하신 소재는 ISO ${isoGroup} (${materialLabel})군입니다. 세부 피삭재를 선택해주세요.`,
    chips,
    expectedInfoGain: 0.5,
  }
}

export async function buildQuestionResponse(
  deps: ServeResponseBuilderDependencies,
  form: ProductIntakeForm,
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  totalCandidateCount: number,
  pagination: RecommendationPaginationDto | null,
  displayCandidates: ScoredProduct[] | null,
  displayEvidenceMap: Map<string, EvidenceSummary> | null,
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
  const question = await buildWorkPieceQuestion(input, history, filters, candidates) ?? selectNextQuestion(input, candidates, history, totalCandidateCount)
  const stageHistory = existingStageHistory
    ? [...existingStageHistory]
    : buildStageHistoryFromFilters(filters, input, totalCandidateCount)

  const snapshotCandidates = displayCandidates ?? candidates
  const snapshotEvidenceMap = displayEvidenceMap ?? evidenceMap
  const candidateSnapshot = buildCandidateSnapshot(snapshotCandidates, snapshotEvidenceMap)

  // ── Option-first: question engine provides field + candidate data ──
  // Structured SmartOptions are built FIRST, then displayedOptions, then chips.
  // The question engine's raw chips are input data, NOT the source of truth.
  const questionFieldResult = question
    ? buildQuestionFieldOptions(question.field, question.chips, history.length > 0)
    : null

  let chips = questionFieldResult?.chips ?? []
  let displayedOptions = questionFieldResult?.displayedOptions ?? []

  // Safety: if no question field options (e.g. 0-candidate guard with overrideText),
  // provide minimal navigation chips
  if (chips.length === 0) {
    const fallbackChips: string[] = []
    if (filters.length > 0) fallbackChips.push("⟵ 이전 단계")
    fallbackChips.push("처음부터 다시")
    chips = fallbackChips
    displayedOptions = buildDisplayedOptions(chips, question?.field ?? "unknown")
  }
  const displayedSeriesGroups = groupCandidatesBySeries(candidateSnapshot)

  const sessionState = buildSessionState({
    candidateCount: totalCandidateCount,
    appliedFilters: filters,
    narrowingHistory: history,
    stageHistory,
    resolutionStatus: checkResolution(candidates, history, totalCandidateCount),
    resolvedInput: input,
    turnCount,
    lastAskedField: question?.field ?? undefined,
    displayedProducts: candidateSnapshot,
    fullDisplayedProducts: candidateSnapshot,
    displayedSeriesGroups,
    uiNarrowingPath: buildUINarrowingPath(filters, history, totalCandidateCount),
    currentMode: messages.length === 0 ? "question" : "narrowing",
    displayedCandidates: candidateSnapshot,
    displayedChips: chips,
    displayedOptions,
    lastAction: "continue_narrowing",
  })

  // ── Set pendingAction when there's a single recommended option ──
  if (question && displayedOptions.length > 0) {
    const recommendedOption = displayedOptions.find(o => {
      // The first narrowing option (index 1) is recommended by buildQuestionFieldOptions
      return o.index === 1 && o.field === question.field
    })
    if (recommendedOption && recommendedOption.field && recommendedOption.value) {
      sessionState.pendingAction = {
        type: "apply_filter",
        label: recommendedOption.label,
        payload: { field: recommendedOption.field, value: recommendedOption.value },
        sourceTurnId: `turn-${Date.now()}`,
        createdAt: turnCount,
        expiresAfterTurns: 2,
      }
      console.log(`[pending-action:set] "${recommendedOption.label}" (field=${recommendedOption.field}, value=${recommendedOption.value})`)
    }
  }

  logNarrowingState("question", sessionState, question?.field ?? null)

  if (!question && !overrideText) {
    return buildRecommendationResponse(
      deps,
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      pagination,
      displayCandidates,
      displayEvidenceMap,
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
  const latestTurnWasSkip = didLatestNarrowingTurnSkip(history)

  if (overrideText) {
    // no-op
  } else if (provider.available() && messages.length === 0) {
    try {
      const systemPrompt = buildSystemPrompt(language)
      const sessionCtx = buildSessionContext(form, sessionState, totalCandidateCount, snapshotToDisplayed(candidateSnapshot))
      const greetingPrompt = buildGreetingPrompt(sessionCtx, question, totalCandidateCount, language)
      const raw = await provider.complete(systemPrompt, [{ role: "user", content: greetingPrompt }], 800)
      const parsed = safeParseJSON(raw)
      if (typeof parsed?.responseText === "string") {
        responseText = parsed.responseText
      }
    } catch (error) {
      console.warn("[recommend] LLM greeting failed:", error)
    }
  } else if (provider.available() && messages.length > 0 && !latestTurnWasSkip) {
    try {
      const lastUserText = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
      const systemPrompt = buildSystemPrompt(language)
      const sessionCtx = buildSessionContext(form, sessionState, totalCandidateCount, snapshotToDisplayed(candidateSnapshot))
      const raw = await provider.complete(systemPrompt, [
        { role: "user", content: `${sessionCtx}\n\n현재 진행 중인 질문: "${question?.questionText ?? ""}"\n현재 후보 ${totalCandidateCount}개.\n\n사용자의 최신 메시지: "${lastUserText}"\n\n사용자 메시지가 현재 질문과 관련 없는 내용(회사 정보, 영업소, 공장 등)이면 【YG-1 회사 정보】에서 답변한 뒤 자연스럽게 현재 질문으로 돌아와라.\n사용자 메시지가 현재 질문에 대한 답변이면 질문을 자연스럽게 다듬어서 응답하라.\nJSON으로 응답: { "responseText": "...", "extractedParams": {}, "isComplete": false, "skipQuestion": false }` }
      ], 400)
      const parsed = safeParseJSON(raw)
      if (typeof parsed?.responseText === "string") {
        responseText = parsed.responseText
      }
    } catch (error) {
      console.warn("[recommend] LLM question polish failed:", error)
    }
  } else if (latestTurnWasSkip) {
    console.log("[recommend] Skipping LLM question polish after skip_field; using deterministic question text")
  }

  const requestPrep = prepareRequest(form, messages, sessionState, input, totalCandidateCount)

  // ── Option-first: chips are derived from structured displayedOptions (built above) ──
  // Text-to-chip synthesis is NOT allowed on the main path.
  // displayedOptions (from smart options or question engine) is the source of truth.
  let finalResponseChips = responseChips
  let finalDisplayedOptions = displayedOptions
  const lastUserMsgText = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  const questionOptionState = await buildQuestionResponseOptionState({
    chips: responseChips,
    question: question
      ? {
          questionText: question.questionText,
          chips: question.chips,
          field: question.field,
        }
      : null,
    displayedOptions,
    sessionState,
    input,
    userMessage: lastUserMsgText,
    responseText,
    messages,
    provider,
  })
  finalResponseChips = questionOptionState.chips
  finalDisplayedOptions = questionOptionState.displayedOptions

  // ── Field consistency guard: ensure displayedOptions match current question field ──
  if (question?.field) {
    if (finalDisplayedOptions.length > 0) {
      const staleOptions = finalDisplayedOptions.filter(
        opt => opt.field && opt.field !== question.field && opt.field !== "_action" && opt.field !== "skip"
      )
      if (staleOptions.length > 0) {
        console.warn(`[field-consistency] Removing ${staleOptions.length} stale options from field "${staleOptions[0].field}" (current: ${question.field})`)
        finalDisplayedOptions = finalDisplayedOptions.filter(
          opt => !opt.field || opt.field === question.field || opt.field === "_action" || opt.field === "skip"
        )
        finalResponseChips = finalDisplayedOptions.map(opt => opt.label)
      }
    }

    // Absolute guard: if chips still don't match question field, rebuild from question engine
    if (finalResponseChips.length > 0 && questionFieldResult) {
      const questionChipSet = new Set(questionFieldResult.chips)
      const hasAnyQuestionChip = finalResponseChips.some(c => questionChipSet.has(c) || c === "상관없음" || c === "⟵ 이전 단계" || c === "처음부터 다시")
      if (!hasAnyQuestionChip) {
        console.warn(`[field-consistency:absolute] Chips completely mismatch question field "${question.field}" — rebuilding from question engine`)
        finalResponseChips = questionFieldResult.chips
        finalDisplayedOptions = questionFieldResult.displayedOptions
      }
    }

    // Last resort: if displayedOptions still empty, use question engine
    if (finalDisplayedOptions.length === 0 && questionFieldResult && questionFieldResult.displayedOptions.length > 0) {
      console.warn(`[field-consistency:fallback] Empty displayedOptions, using question engine result for field "${question.field}"`)
      finalDisplayedOptions = questionFieldResult.displayedOptions
      finalResponseChips = questionFieldResult.chips
    }
  }

  sessionState.displayedChips = finalResponseChips
  sessionState.displayedOptions = finalDisplayedOptions

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
    pagination,
    requestPreparation: requestPrep,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
  })
}

export function didLatestNarrowingTurnSkip(history: NarrowingTurn[]): boolean {
  const latestTurn = history[history.length - 1]
  if (!latestTurn) return false
  return latestTurn.extractedFilters.some(filter => filter.op === "skip")
}

export async function buildRecommendationResponse(
  deps: ServeResponseBuilderDependencies,
  form: ProductIntakeForm,
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  totalCandidateCount: number,
  pagination: RecommendationPaginationDto | null,
  displayCandidates: ScoredProduct[] | null,
  displayEvidenceMap: Map<string, EvidenceSummary> | null,
  input: RecommendationInput,
  history: NarrowingTurn[],
  filters: AppliedFilter[],
  turnCount: number,
  messages: ChatMessage[],
  provider: ReturnType<typeof getProvider>,
  language: AppLanguage,
  displayedProducts: DisplayedProduct[] | null = null
): Promise<Response> {
  const workPieceQuestion = await buildWorkPieceQuestion(input, history, filters, candidates)
  if (workPieceQuestion) {
    return buildQuestionResponse(
      deps,
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      pagination,
      displayCandidates,
      displayEvidenceMap,
      input,
      history,
      filters,
      turnCount,
      messages,
      provider,
      language
    )
  }

  const { primary, alternatives, status } = classifyHybridResults({ candidates, evidenceMap, totalConsidered: totalCandidateCount, filtersApplied: filters })
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
    totalCandidatesConsidered: totalCandidateCount,
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
    totalCandidatesConsidered: totalCandidateCount,
  }

  if (provider.available() && primary && primaryFactChecked && primaryExplanation) {
    try {
      const systemPrompt = buildSystemPrompt(language)
      const llmSessionState = buildSessionState({
        candidateCount: totalCandidateCount,
        appliedFilters: filters,
        narrowingHistory: history,
        stageHistory: buildStageHistoryFromFilters(filters, input, totalCandidateCount),
        resolutionStatus: checkResolution(candidates, history, totalCandidateCount),
        resolvedInput: input,
        turnCount,
        displayedCandidates: buildCandidateSnapshot(candidates, evidenceMap),
        displayedChips: [],
        displayedOptions: [],
        lastAction: "show_recommendation",
      })
      const sessionCtx = buildSessionContext(form, llmSessionState, totalCandidateCount, snapshotToDisplayed(llmSessionState.displayedCandidates))
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

  const snapshotCandidates = displayCandidates ?? candidates
  const snapshotEvidenceMap = displayEvidenceMap ?? evidenceMap
  const candidateSnapshot = buildCandidateSnapshot(snapshotCandidates, snapshotEvidenceMap)
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
  // Derive chips from structured options; fallback to minimal safe navigation
  const followUpChips = postRecOptions.length > 0
    ? smartOptionsToChips(postRecOptions)
    : buildMinimalPostRecChips(recommendation, filters)

  const displayedSeriesGroups = groupCandidatesBySeries(candidateSnapshot)
  const sessionState = buildSessionState({
    candidateCount: totalCandidateCount,
    appliedFilters: filters,
    narrowingHistory: history,
    stageHistory: buildStageHistoryFromFilters(filters, input, totalCandidateCount),
    resolutionStatus: checkResolution(candidates, history, totalCandidateCount),
    resolvedInput: input,
    turnCount,
    displayedProducts: candidateSnapshot,
    fullDisplayedProducts: candidateSnapshot,
    displayedSeriesGroups,
    uiNarrowingPath: buildUINarrowingPath(filters, history, totalCandidateCount),
    currentMode: "recommendation",
    displayedCandidates: candidateSnapshot,
    displayedChips: followUpChips,
    displayedOptions: postRecDisplayedOptions,
    lastAction: "show_recommendation",
  })

  const requestPrep = prepareRequest(form, messages, sessionState, input, totalCandidateCount)
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
    pagination,
    requestPreparation: requestPrep,
    primaryExplanation,
    primaryFactChecked: primaryFactChecked ? serializeFactChecked(primaryFactChecked) : null,
    altExplanations,
    altFactChecked: altFactChecked.map(item => serializeFactChecked(item)),
  })
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
      toolSubtype: candidate.product.toolSubtype ?? null,
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

/**
 * Minimal deterministic post-recommendation chips.
 * Used ONLY when SmartOption engine produces zero options.
 * No regex, no LLM, no answer-text parsing.
 */
function buildMinimalPostRecChips(
  result: RecommendationResult,
  filters: AppliedFilter[]
): string[] {
  const chips: string[] = []
  if (result.status === "none" || !result.primaryProduct) {
    if (filters.length > 0) chips.push("⟵ 이전 단계")
    chips.push("처음부터 다시")
    return chips
  }
  if (result.alternatives.length > 0) {
    chips.push(`대체 후보 ${result.alternatives.length}개 비교하기`)
  }
  chips.push("절삭조건 알려줘")
  if (filters.length > 0) chips.push("⟵ 이전 단계")
  chips.push("처음부터 다시")
  return chips.slice(0, 5)
}

/**
 * @deprecated Legacy chip generator — replaced by SmartOption engine + buildMinimalPostRecChips.
 * Kept for backward compatibility in handleServeSimpleChat only.
 */
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
