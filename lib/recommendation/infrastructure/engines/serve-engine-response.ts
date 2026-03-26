import { notifyRecommendation } from "@/lib/recommendation/infrastructure/notifications/recommendation-notifier"
import {
  BrandReferenceRepo,
  SeriesMaterialStatusRepo,
  type SeriesMaterialStatusValue,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { getSessionCache } from "@/lib/recommendation/infrastructure/cache/session-cache"
import {
  buildExplanation,
  buildDeterministicSummary,
  buildProductLabel,
  buildRationale,
  buildSessionState,
  buildWarnings,
  checkResolution,
  classifyHybridResults,
  explainQuestionFieldReplayFailure,
  getQuestionFieldPriority,
  groupCandidatesBySeries,
  prepareRequest,
  runFactCheck,
  selectNextQuestion,
  selectQuestionForField,
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
import { buildFilterValueScope } from "@/lib/recommendation/shared/filter-field-registry"

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

function normalizeSeriesKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\-·ㆍ./(),]+/g, "")
}

function normalizeQuestionOptionToken(value: string): string {
  return value
    .replace(/\s*\(\d+개\)\s*$/, "")
    .replace(/\s*—\s*.+$/, "")
    .trim()
    .toLowerCase()
}

const QUESTION_FIELD_HINTS: Record<string, RegExp[]> = {
  workPieceName: [/피삭재/u, /세부\s*피삭재/u, /소재/u, /재질/u, /강종/u, /hardened/i, /hrc/i],
  diameterRefine: [/직경/u, /\bmm\b/i, /파이/u, /지름/u],
  fluteCount: [/날\s*수/u, /몇\s*날/u, /플루트/u, /flute/i],
  coating: [/코팅/u, /coat/i, /tialn/i, /alcrn/i, /ticn/i],
  toolSubtype: [/형상/u, /타입/u, /엔드밀/u, /볼/u, /스퀘어/u, /corner\s*radius/i],
  seriesName: [/시리즈/u, /brand/i, /브랜드/u],
  cuttingType: [/가공/u, /절삭/u, /포켓/u, /슬롯/u, /측면/u, /평면/u, /홀\s*가공/u],
}

const QUESTION_FIELD_LABELS: Record<string, string> = {
  workPieceName: "세부 피삭재",
  fluteCount: "날 수",
  coating: "코팅",
  toolSubtype: "공구 세부 타입",
  seriesName: "시리즈",
  cuttingType: "가공 종류",
  diameterRefine: "직경",
}

export function inferQuestionFieldFromText(text: string): string | null {
  const clean = text.trim().toLowerCase()
  if (!clean) return null

  let bestField: string | null = null
  let bestScore = 0

  for (const [field, patterns] of Object.entries(QUESTION_FIELD_HINTS)) {
    let score = 0
    for (const pattern of patterns) {
      if (pattern.test(clean)) score += 1
    }
    if (score > bestScore) {
      bestField = field
      bestScore = score
    }
  }

  return bestScore > 0 ? bestField : null
}

export function shouldFallbackToDeterministicQuestionText(params: {
  questionField: string
  questionText: string
  responseText: string
  displayedOptions: { label: string; value: string; field?: string | null }[]
}): boolean {
  const { questionField, questionText, responseText, displayedOptions } = params
  const inferredField = inferQuestionFieldFromText(responseText)
  if (inferredField && inferredField !== questionField) return true

  const normalizedResponse = responseText.toLowerCase()
  const normalizedQuestion = questionText.toLowerCase()

  if (normalizedResponse.includes(normalizedQuestion)) return false

  const optionTokens = displayedOptions
    .filter(option => option.field === questionField || option.field === "_action" || option.value === "skip")
    .flatMap(option => [option.label, option.value])
    .map(normalizeQuestionOptionToken)
    .filter(token => token && !["skip", "상관없음"].includes(token))

  if (optionTokens.some(token => normalizedResponse.includes(token))) return false

  const ownHints = QUESTION_FIELD_HINTS[questionField] ?? []
  if (ownHints.some(pattern => pattern.test(responseText))) return false

  return true
}

async function loadSeriesMaterialRatings(
  candidates: CandidateSnapshot[],
  input: RecommendationInput
): Promise<Map<string, SeriesMaterialStatusValue>> {
  const isoGroup = resolveSingleIsoGroup(input.material)
  if (!isoGroup) return new Map()

  const seriesNames = Array.from(
    new Set(
      candidates
        .map(candidate => candidate.seriesName)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  )
  if (seriesNames.length === 0) return new Map()

  const ratings = await SeriesMaterialStatusRepo.findRatingsBySeries({
    isoGroup,
    seriesNames,
    workPieceName: input.workPieceName ?? null,
  })

  return new Map(
    [...ratings.entries()].map(([seriesName, rating]) => [normalizeSeriesKey(seriesName), rating])
  )
}

async function buildDisplayedSeriesGroups(
  candidates: CandidateSnapshot[],
  input: RecommendationInput
) {
  const ratingBySeries = await loadSeriesMaterialRatings(candidates, input)
  return groupCandidatesBySeries(candidates, ratingBySeries)
}

async function buildWorkPieceQuestion(
  input: RecommendationInput,
  history: NarrowingTurn[],
  filters: AppliedFilter[],
  candidates?: ScoredProduct[],
  excludeValues?: string[]
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

  const allWorkPieceNames = await getSessionCache().getOrFetch(
    `workPieceNames:${isoGroup}`,
    () => BrandReferenceRepo.listDistinctWorkPieceNames({ isoGroup, limit: 20 })
  )
  if (allWorkPieceNames.length <= 1) return null

  // 0-candidate guard에서 제외 요청된 값 필터링
  let relevantNames = excludeValues?.length
    ? allWorkPieceNames.filter(name => !excludeValues.includes(name))
    : allWorkPieceNames

  // ── 현재 candidates에 실제로 있는 workPiece만 남기기 ──
  var workPieceCounts: Map<string, number> | undefined
  if (candidates && candidates.length > 0) {
    const candidateSeriesSet = new Set(
      candidates.map(c => (c.product.seriesName ?? "").trim().toUpperCase()).filter(Boolean)
    )
    // 각 workPiece에 대해 시리즈가 candidates에 있는지 확인 + 개수 계산
    const validNamesWithCount: { name: string; count: number }[] = []
    for (const name of relevantNames) {
      const series = await getSessionCache().getOrFetch(
        `seriesNames:${isoGroup}|${name}`,
        () => BrandReferenceRepo.listDistinctSeriesNames({ isoGroup, workPieceName: name, limit: 30 })
      )
      const seriesUpper = new Set(series.map(s => s.toUpperCase()))
      const count = candidates.filter(c => {
        const cs = (c.product.seriesName ?? "").trim().toUpperCase()
        return cs && seriesUpper.has(cs)
      }).length
      if (count > 0) validNamesWithCount.push({ name, count })
    }
    const removed = relevantNames.length - validNamesWithCount.length
    if (removed > 0) console.log(`[workpiece-filter] Removed ${removed} workPieces with 0 matching candidates`)
    relevantNames = validNamesWithCount.map(v => v.name)
    // 개수 정보를 칩 생성 시 사용하기 위해 저장
    var workPieceCounts = new Map(validNamesWithCount.map(v => [v.name, v.count]))
  }

  // 중복 제거 (공백 차이: "알루미늄(연질)" vs "알루미늄 (연질)")
  const normalizedSeen = new Set<string>()
  relevantNames = relevantNames.filter(name => {
    const normalized = name.replace(/\s+/g, "").toLowerCase()
    if (normalizedSeen.has(normalized)) return false
    normalizedSeen.add(normalized)
    return true
  })

  // 현재 후보 기준으로 의미 있는 선택지가 없으면 질문하지 않는다.
  if (relevantNames.length <= 1) return null

  const materialLabel = getMaterialDisplay(isoGroup).ko
  const chips = relevantNames.slice(0, 10).map(name => {
    const count = workPieceCounts?.get(name)
    return count != null ? `${name} (${count}개)` : name
  })
  chips.push("상관없음")
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
  existingStageHistory?: NarrowingStage[],
  excludeWorkPieceValues?: string[],
  preferredQuestionField?: string,
  responsePrefix?: string
): Promise<Response> {
  const chooseHigherPriorityQuestion = <T extends { field: string }>(left: T | null, right: T | null): T | null => {
    if (!left) return right
    if (!right) return left

    const leftPriority = getQuestionFieldPriority(left.field)
    const rightPriority = getQuestionFieldPriority(right.field)
    if (leftPriority !== rightPriority) {
      return leftPriority < rightPriority ? left : right
    }

    return left
  }

  const preferredQuestion = preferredQuestionField
    ? (
        preferredQuestionField === "workPieceName"
          ? await buildWorkPieceQuestion(input, history, filters, candidates, excludeWorkPieceValues)
          : selectQuestionForField(input, candidates, history, preferredQuestionField, totalCandidateCount)
      )
    : null
  const replayFailureReason = preferredQuestionField && !preferredQuestion
    ? explainQuestionFieldReplayFailure(input, candidates, preferredQuestionField)
    : null
  // ── Resolution guard: if already resolved, skip all questions → show recommendation ──
  const preCheckStatus = checkResolution(candidates, history, totalCandidateCount)
  const alreadyResolved = preCheckStatus.startsWith("resolved")

  const workPieceQuestion = alreadyResolved ? null : await buildWorkPieceQuestion(input, history, filters, candidates, excludeWorkPieceValues)
  const nextQuestion = alreadyResolved ? null : selectNextQuestion(input, candidates, history, totalCandidateCount)
  const question = alreadyResolved ? null : (preferredQuestion
    ?? chooseHigherPriorityQuestion(workPieceQuestion, nextQuestion))
  const stageHistory = existingStageHistory
    ? [...existingStageHistory]
    : buildStageHistoryFromFilters(filters, input, totalCandidateCount)

  const snapshotCandidates = displayCandidates ?? candidates
  const snapshotEvidenceMap = displayEvidenceMap ?? evidenceMap
  const candidateSnapshot = buildCandidateSnapshot(snapshotCandidates, snapshotEvidenceMap)
  const filterValueScope = buildFilterValueScope(candidates as unknown as Array<Record<string, unknown>>)

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
  const displayedSeriesGroups = await buildDisplayedSeriesGroups(candidateSnapshot, input)

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
    filterValueScope,
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
      const raw = await provider.complete(systemPrompt, [{ role: "user", content: greetingPrompt }], 1500)
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
      const chipList = question?.chips?.length ? question.chips.join(", ") : ""
      const chipInstruction = chipList
        ? `\n선택지(칩): [${chipList}]\n★ 응답에서 질문할 때 반드시 위 선택지와 일치하는 표현을 사용하라. 선택지에 없는 옵션을 제시하지 마라. 선택지를 자연스럽게 안내하되 그대로 나열하지 말고 맥락에 맞게 질문하라.`
        : ""
      const raw = await provider.complete(systemPrompt, [
        { role: "user", content: `${sessionCtx}\n\n현재 진행 중인 질문: "${question?.questionText ?? ""}"\n현재 후보 ${totalCandidateCount}개.\n\n사용자의 최신 메시지: "${lastUserText}"\n\n사용자 메시지가 현재 질문과 관련 없는 내용(회사 정보, 영업소, 공장 등)이면 【YG-1 회사 정보】에서 답변한 뒤 자연스럽게 현재 질문으로 돌아와라.\n사용자 메시지가 현재 질문에 대한 답변이면 질문을 자연스럽게 다듬어서 응답하라.\nJSON으로 응답: { "responseText": "...", "extractedParams": {}, "isComplete": false, "skipQuestion": false }` }
      ], 1500)
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

    if (
      !overrideText &&
      shouldFallbackToDeterministicQuestionText({
        questionField: question.field,
        questionText: question.questionText,
        responseText,
        displayedOptions: finalDisplayedOptions,
      })
    ) {
      console.warn(`[field-consistency:text] Response text drifted from field "${question.field}" — reverting to deterministic question text`)
      responseText = question.questionText
    }
  }

  if (responsePrefix) {
    responseText = `${responsePrefix}\n\n${responseText}`.trim()
  }

  if (replayFailureReason && question && preferredQuestionField && question.field !== preferredQuestionField) {
    const nextLabel = QUESTION_FIELD_LABELS[question.field] ?? question.field
    responseText = `${replayFailureReason} 그래서 ${nextLabel} 기준으로 이어서 질문드릴게요.\n\n${responseText}`.trim()
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
        filterValueScope: buildFilterValueScope(candidates as unknown as Array<Record<string, unknown>>),
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
  // Full candidate snapshot for option planning — uses ALL candidates, not just display page,
  // so the planner can detect diversity in coating/flute/series across the full result set.
  const fullCandidateSnapshot = buildCandidateSnapshot(candidates, evidenceMap)
  const filterValueScope = buildFilterValueScope(candidates as unknown as Array<Record<string, unknown>>)
  const recLastUserMsg = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  // ── Option-first: structured options FIRST, then derive chips ──
  // NEVER generate chips from answer text. displayedOptions → chips.
  const postRecOptions = generateSmartOptionsForRecommendation(
    fullCandidateSnapshot, filters, input, form, null, recLastUserMsg
  )
  const postRecDisplayedOptions = postRecOptions.length > 0
    ? smartOptionsToDisplayedOptions(postRecOptions)
    : []
  // Derive chips from structured options; fallback to minimal safe navigation
  const followUpChips = postRecOptions.length > 0
    ? smartOptionsToChips(postRecOptions)
    : buildMinimalPostRecChips(recommendation, filters)

  const displayedSeriesGroups = await buildDisplayedSeriesGroups(candidateSnapshot, input)
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
    filterValueScope,
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
    }).catch((err) => { console.warn("[notify] Recommendation notification failed:", err) })
  }

  // ── Post-Answer Validator: strip unauthorized actions from answer ──
  // Direction: displayedOptions → constrain answer (NEVER answer → add chips)
  const finalRecChips = followUpChips
  const hasCandidatePool = totalCandidateCount > 0 && !!primary
  let finalResponseText = status === "none"
    ? hasCandidatePool
      ? `조건에 완전히 맞는 제품은 없지만 유사 후보 ${totalCandidateCount}개를 찾았습니다. 직경이나 소재 조건을 조정하거나 현재 후보를 검토해보세요.`
      : "조건에 맞는 제품을 찾지 못했습니다. 직경이나 소재 조건을 조정해보세요."
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
    toolSubtype: candidate.toolSubtype ?? null,
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
  _filters: AppliedFilter[],
  history: NarrowingTurn[],
  fallbackCandidateCount: number
): UINarrowingPathEntry[] {
  const entries: UINarrowingPathEntry[] = []
  for (const turn of history) {
    for (const filter of turn.extractedFilters) {
      if (filter.op === "skip") continue
      entries.push({
        kind: "filter" as const,
        label: `${filter.field}=${filter.value}`,
        field: filter.field,
        value: filter.value,
        candidateCount: turn.candidateCountAfter ?? fallbackCandidateCount,
        candidateCountBefore: turn.candidateCountBefore,
      })
    }
  }
  return entries
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
  if (!result.primaryProduct) {
    if (filters.length > 0) chips.push("⟵ 이전 단계")
    chips.push("처음부터 다시")
    return chips
  }

  const primary = result.primaryProduct
  const alts = result.alternatives

  // 동적: 후보 데이터 기반 칩 생성
  const coatings = new Set(alts.map(a => a.product.coating).filter(Boolean))
  const flutes = new Set(alts.map(a => a.product.fluteCount).filter(Boolean))
  const series = new Set(alts.map(a => a.product.seriesName).filter(Boolean))

  if (primary.product.displayCode) {
    chips.push(`${primary.product.displayCode} 상세 정보`)
  }
  if (alts.length > 0) {
    chips.push(`상위 ${Math.min(alts.length + 1, 3)}개 비교`)
  }
  if (flutes.size >= 2) {
    chips.push(`날수별 비교 (${[...flutes].sort().join("/")}날)`)
  }
  if (coatings.size >= 2) {
    chips.push(`코팅별 비교 (${[...coatings].slice(0, 3).join("/")})`)
  }
  if (primary.stockStatus === "outofstock" || primary.stockStatus === "limited") {
    chips.push("재고 있는 대안 보기")
  }
  if (series.size >= 2) {
    chips.push(`시리즈 비교 (${[...series].slice(0, 2).join(" vs ")})`)
  }
  if (filters.length > 0) chips.push("조건 변경")
  return chips.slice(0, 6)
}

/**
 * Data-driven follow-up chips for recommendation results.
 * Generates contextual chips from actual product data — no hardcoded strings.
 */
export function getFollowUpChips(
  result: RecommendationResult,
  sessionState?: ExplorationSessionState | null,
): string[] {
  const chips: string[] = []
  const primary = result.primaryProduct
  const alts = result.alternatives
  const altCount = alts.length
  const hasHistory = (sessionState?.stageHistory?.length ?? 0) > 1
  const filterCount = sessionState?.appliedFilters?.length ?? 0

  // ── No result: suggest broadening or restart ──
  if (!primary) {
    if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
    if (filterCount > 0) chips.push("조건 완화하기")
    chips.push("처음부터 다시")
    return chips.slice(0, 6)
  }

  // ── Low-confidence match: suggest compare, broaden, refine ──
  if (isApproximate || isNone) {
    if (altCount > 0) chips.push(`후보 ${altCount + 1}개 비교하기`)
    chips.push("절삭조건 알려줘")
    if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
    chips.push("다른 직경 검색")
    chips.push("처음부터 다시")
    return chips.slice(0, 6)
  }

  // 2순위: 비교 (후보 있을 때)
  if (altCount > 0) {
    chips.push(`상위 ${Math.min(altCount + 1, 3)}개 비교`)
  }

  // 3순위: 분포 기반 필터
  if (flutes.size >= 2) {
    chips.push(`날수별 (${[...flutes].sort().join("/")}날)`)
  }
  if (coatings.size >= 2) {
    chips.push(`코팅별 (${[...coatings].slice(0, 3).join("/")})`)
  }

  // 4순위: 재고 상태 기반
  if (primary.stockStatus === "outofstock") {
    chips.push("재고 있는 대안")
  } else if (primary.stockStatus === "limited") {
    chips.push("재고 상세")
  }

  // 5순위: 시리즈 비교
  if (series.size >= 2) {
    chips.push(`${[...series].slice(0, 2).join(" vs ")} 비교`)
  }

  // 네비게이션
  if (hasHistory) chips.push("⟵ 이전 단계")
  chips.push("조건 변경")
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
