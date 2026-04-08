import { notifyRecommendation } from "@/lib/recommendation/infrastructure/notifications/recommendation-notifier"
import {
  EntityProfileRepo,
  SeriesMaterialStatusRepo,
  type SeriesMaterialStatusValue,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
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
  buildRecommendationSummarySystemPrompt,
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
import type { NextQuestion } from "@/lib/recommendation/domain/question-engine"
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
import { traceRecommendation } from "@/lib/recommendation/infrastructure/observability/recommendation-trace"

type DisplayedProduct = RecommendationDisplayedProductRequestDto
const RECOMMENDATION_SUMMARY_MAX_TOKENS = 4000

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

function normalizeWorkPieceKey(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase()
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
  diameterMm: [/어떤\s*직경/u, /직경은\s*어느/u, /직경을\s*선택/u, /직접\s*입력/u],
  diameterRefine: [/정확한\s*직경/u, /근처에/u, /직경\s*\d+(?:\.\d+)?mm/u],
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
  diameterMm: "직경",
  diameterRefine: "직경",
}

function summarizeRecommendationInputForTrace(input: RecommendationInput) {
  return {
    manufacturerScope: input.manufacturerScope ?? null,
    locale: input.locale ?? null,
    material: input.material ?? null,
    workPieceName: input.workPieceName ?? null,
    diameterMm: input.diameterMm ?? null,
    machiningCategory: input.machiningCategory ?? null,
    operationType: input.operationType ?? null,
    toolSubtype: input.toolSubtype ?? null,
    flutePreference: input.flutePreference ?? null,
    coatingPreference: input.coatingPreference ?? null,
    seriesName: input.seriesName ?? null,
  }
}

function summarizeFiltersForTrace(filters: AppliedFilter[]) {
  return filters.map(filter => ({
    field: filter.field,
    op: filter.op,
    value: filter.value,
    rawValue: filter.rawValue,
    appliedAt: filter.appliedAt,
  }))
}

function summarizeHistoryForTrace(history: NarrowingTurn[]) {
  return history.slice(-4).map(turn => ({
    question: turn.question,
    answer: turn.answer,
    extractedFilters: turn.extractedFilters.map(filter => ({
      field: filter.field,
      op: filter.op,
      value: filter.value,
      rawValue: filter.rawValue,
      appliedAt: filter.appliedAt,
    })),
    candidateCountBefore: turn.candidateCountBefore,
    candidateCountAfter: turn.candidateCountAfter,
  }))
}

function summarizePaginationForTrace(pagination: RecommendationPaginationDto | null) {
  if (!pagination) return null
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems: pagination.totalItems,
    totalPages: pagination.totalPages,
  }
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
  // material이 없으면 workPieceName으로 ISO 그룹 resolve fallback
  const isoGroup = resolveSingleIsoGroup(input.material) ?? resolveSingleIsoGroup(input.workPieceName)
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
  filters: AppliedFilter[],
  candidates?: ScoredProduct[],
  excludeValues?: string[]
): Promise<NextQuestion | null> {
  traceRecommendation("response.buildWorkPieceQuestion:input", {
    input: summarizeRecommendationInputForTrace(input),
    filters: summarizeFiltersForTrace(filters),
    filterCount: filters.length,
    candidateCount: candidates?.length ?? 0,
    excludeValues,
  })
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
  if (!candidates || candidates.length === 0) return null

  const seriesNames = Array.from(new Set(candidates.flatMap(candidate => {
    const values = [
      candidate.product.seriesName,
      (candidate.product as Record<string, unknown>).edpSeriesName as string | undefined,
    ]
    return values.map(value => String(value ?? "").trim()).filter(Boolean)
  })))
  if (seriesNames.length === 0) return null

  const profiles = await EntityProfileRepo.findSeriesProfiles(seriesNames)
  const profileBySeriesKey = new Map(
    profiles.map(profile => [normalizeSeriesKey(profile.normalizedSeriesName), profile])
  )

  const preferWorkPieceName = (left: string, right: string) => {
    if (left.length !== right.length) return left.length > right.length ? left : right
    return left.localeCompare(right, "ko") <= 0 ? left : right
  }

  const excludedKeys = new Set((excludeValues ?? []).map(normalizeWorkPieceKey))
  const workPieceEntries = new Map<string, { name: string; candidateKeys: Set<string> }>()
  let unmappedCandidateCount = 0
  for (const candidate of candidates) {
    const candidateKey = candidate.product.normalizedCode ?? candidate.product.displayCode
    const candidateSeriesNames = Array.from(new Set([
      candidate.product.seriesName,
      (candidate.product as Record<string, unknown>).edpSeriesName as string | undefined,
    ].map(value => String(value ?? "").trim()).filter(Boolean)))

    const candidateWorkPieces = new Map<string, string>()
    for (const seriesName of candidateSeriesNames) {
      const profile = profileBySeriesKey.get(normalizeSeriesKey(seriesName))
      if (!profile) continue
      for (const rawName of profile.materialWorkPieceNames) {
        const name = rawName.trim()
        if (!name) continue
        const key = normalizeWorkPieceKey(name)
        if (excludedKeys.has(key)) continue
        const existing = candidateWorkPieces.get(key)
        candidateWorkPieces.set(key, existing ? preferWorkPieceName(existing, name) : name)
      }
    }

    if (candidateWorkPieces.size === 0) {
      unmappedCandidateCount += 1
      continue
    }

    for (const [key, name] of candidateWorkPieces.entries()) {
      const existing = workPieceEntries.get(key)
      if (!existing) {
        workPieceEntries.set(key, { name, candidateKeys: new Set([candidateKey]) })
        continue
      }
      existing.name = preferWorkPieceName(existing.name, name)
      existing.candidateKeys.add(candidateKey)
    }
  }

  const relevantEntries = Array.from(workPieceEntries.values())
    .map(entry => ({ name: entry.name, count: entry.candidateKeys.size, candidateKeys: Array.from(entry.candidateKeys) }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ko"))
  if (relevantEntries.length <= 1) return null

  const workPieceCounts = new Map(relevantEntries.map(entry => [entry.name, entry.count]))
  const workPieceCandidateKeys = new Map(relevantEntries.map(entry => [entry.name, entry.candidateKeys]))
  const relevantNames = relevantEntries.map(entry => entry.name)

  const materialLabel = getMaterialDisplay(isoGroup).ko
  const chips = relevantNames
    .filter(name => {
      const count = workPieceCounts?.get(name)
      return count == null || count > 0
    })
    .slice(0, 10).map(name => {
      const count = workPieceCounts?.get(name)
      return count != null ? `${name} (${count}개)` : name
    })
  if (unmappedCandidateCount > 0) {
    chips.push(`ETC (${unmappedCandidateCount}개)`)
  }
  traceRecommendation("response.buildWorkPieceQuestion:output", {
    field: "workPieceName",
    isoGroup,
    relevantNames,
    workPieceCounts,
    workPieceCandidateKeys: Array.from(workPieceCandidateKeys.entries()).map(([name, keys]) => ({
      name,
      count: keys.length,
      preview: keys.slice(0, 5),
    })),
    unmappedCandidateCount,
    chips,
  })
  return {
    field: "workPieceName",
    questionText: `선택하신 소재는 ISO ${isoGroup} (${materialLabel})군입니다. 세부 피삭재를 선택해주세요. (일부 제품은 세부 분류가 없어 "상관없음" 선택 시 전체 후보에서 추천합니다)`,
    chips,
  }
}

async function selectNextQuestionForResponse(params: {
  input: RecommendationInput
  candidates: ScoredProduct[]
  history: NarrowingTurn[]
  filters: AppliedFilter[]
  totalCandidateCount: number
  excludeWorkPieceValues?: string[]
}): Promise<NextQuestion | null> {
  const { input, candidates, history, filters, totalCandidateCount, excludeWorkPieceValues } = params
  const workPieceQuestion = await buildWorkPieceQuestion(input, filters, candidates, excludeWorkPieceValues)
  return selectNextQuestion(
    input,
    candidates,
    history,
    totalCandidateCount,
    workPieceQuestion ? [workPieceQuestion] : [],
    filters
  )
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
  responsePrefix?: string,
  overrideChips?: string[],
): Promise<Response> {
  traceRecommendation("response.buildQuestionResponse:input", {
    totalCandidateCount,
    turnCount,
    input: summarizeRecommendationInputForTrace(input),
    historyCount: history.length,
    history: summarizeHistoryForTrace(history),
    filterCount: filters.length,
    filters: summarizeFiltersForTrace(filters),
    messageCount: messages.length,
    pagination: summarizePaginationForTrace(pagination),
    overrideText: overrideText ?? null,
    excludeWorkPieceValues,
    responsePrefix: responsePrefix ?? null,
  })
  // ── Resolution guard: if already resolved, skip all questions → show recommendation ──
  const preCheckStatus = checkResolution(candidates, history, totalCandidateCount)
  const alreadyResolved = preCheckStatus.startsWith("resolved")

  const question = alreadyResolved
    ? null
    : await selectNextQuestionForResponse({
        input,
        candidates,
        history,
        filters,
        totalCandidateCount,
        excludeWorkPieceValues,
      })
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

  // Override chips when caller provides explicit alternatives (e.g. 0-result recovery)
  if (overrideChips && Array.isArray(overrideChips) && overrideChips.length > 0) {
    chips = [...overrideChips]
    displayedOptions = buildDisplayedOptions(chips, question?.field ?? "unknown")
  }

  // Safety: if no question field options (e.g. 0-candidate guard with overrideText),
  // provide minimal navigation chips
  if (chips.length === 0) {
    const fallbackChips: string[] = []
    if (filters.length > 0) fallbackChips.push("⟵ 이전 단계")
    fallbackChips.push("처음부터 다시")
    chips = fallbackChips
    displayedOptions = buildDisplayedOptions(chips, question?.field ?? "unknown")
  }

  // ── CTA 버튼 2개 매 턴 상시 표시 ──
  if (totalCandidateCount > 0) {
    if (!chips.some(c => c.includes("제품 보기"))) chips.push(`📋 지금 바로 제품 보기 (${totalCandidateCount}개)`)
    if (!chips.some(c => c.includes("AI 상세 분석"))) chips.push(`✨ AI 상세 분석`)
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
        ? `\n선택지(칩): [${chipList}]\n★ 응답에서 질문할 때 반드시 위 선택지와 일치하는 표현을 사용하라. 선택지에 없는 옵션을 제시하지 마라. 선택지를 자연스럽게 안내하되 그대로 나열하지 말고 맥락에 맞게 질문하라.\n★★ 숫자/개수/분포를 절대 지어내지 마라. 칩에 "(N개)"로 표시된 숫자만 인용 가능. 칩에 없는 통계는 언급 금지.`
        : ""
      const raw = await provider.complete(systemPrompt, [
        { role: "user", content: `${sessionCtx}\n\n현재 진행 중인 질문: "${question?.questionText ?? ""}"\n현재 후보 ${totalCandidateCount}개.\n${chipInstruction}\n\n사용자의 최신 메시지: "${lastUserText}"\n\n사용자 메시지가 현재 질문과 관련 없는 내용(회사 정보, 영업소, 공장 등)이면 【YG-1 회사 정보】에서 답변한 뒤 자연스럽게 현재 질문으로 돌아와라.\n사용자 메시지가 현재 질문에 대한 답변이면 질문을 자연스럽게 다듬어서 응답하라.\nJSON으로 응답: { "responseText": "...", "extractedParams": {}, "isComplete": false, "skipQuestion": false }` }
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

  // ── Post-process: strip hallucinated numbers from LLM text ──
  // Build valid number set from chips and total candidate count
  if (responseText && question?.chips?.length) {
    const validNums = new Set<number>()
    validNums.add(totalCandidateCount)
    for (const chip of question.chips) {
      const m = chip.match(/(\d[\d,]*)\s*개/)
      if (m) validNums.add(parseInt(m[1].replace(/,/g, "")))
    }
    // Replace "약 N개" or "N개" where N is not in validNums
    responseText = responseText.replace(/약?\s*(\d[\d,]*)\s*개/g, (match, numStr) => {
      const num = parseInt(numStr.replace(/,/g, ""))
      if (validNums.has(num)) return match
      // Check ±5% tolerance
      for (const v of validNums) {
        if (Math.abs(v - num) / Math.max(v, 1) < 0.05) return match
      }
      // Hallucinated number — remove the whole "약 N개" phrase
      return ""
    })
    // Clean up double spaces / orphan punctuation from removals
    responseText = responseText.replace(/\(\s*\)/g, "").replace(/  +/g, " ").trim()
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

  // When overrideChips is provided (e.g. 0-result recovery), skip the option state
  // pipeline and consistency guards — the caller knows exactly which chips to show.
  // Safety: reject non-array values to prevent string spread (e.g. [..."text"] → ["t","e","x","t"])
  if (overrideChips && !Array.isArray(overrideChips)) {
    console.error(`[buildQuestionResponse] overrideChips is not an array: ${typeof overrideChips} — ignoring to prevent character-level chip split`)
  }
  if (overrideChips && Array.isArray(overrideChips) && overrideChips.length > 0) {
    finalResponseChips = [...overrideChips]
    finalDisplayedOptions = buildDisplayedOptions(overrideChips, question?.field ?? "unknown")
  } else {
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
  }

  if (responsePrefix) {
    responseText = `${responsePrefix}\n\n${responseText}`.trim()
  }

  // ── Safety: strip single-character chips (e.g. "탭" from LLM, or spread string remnants) ──
  const preFilterCount = finalResponseChips.length
  finalResponseChips = finalResponseChips.filter(c => typeof c === "string" && c.trim().length > 1)
  finalDisplayedOptions = finalDisplayedOptions.filter(o => typeof o.label === "string" && o.label.trim().length > 1)
  if (finalResponseChips.length < preFilterCount) {
    console.warn(`[chip-safety] Removed ${preFilterCount - finalResponseChips.length} single-char chips`)
  }

  // ── CTA 버튼 2개를 최종 칩에 항상 추가 ──
  if (totalCandidateCount > 0) {
    if (!finalResponseChips.some(c => c.includes("제품 보기"))) finalResponseChips = [...finalResponseChips, `📋 지금 바로 제품 보기 (${totalCandidateCount}개)`]
    if (!finalResponseChips.some(c => c.includes("AI 상세 분석"))) finalResponseChips = [...finalResponseChips, `✨ AI 상세 분석`]
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

  traceRecommendation("response.buildQuestionResponse:output", {
    purpose: messages.length === 0 ? "greeting" : "question",
    question: question ? {
      field: question.field,
      questionText: question.questionText,
      chipCount: question.chips.length,
      chipPreview: question.chips.slice(0, 6),
    } : null,
    responseText,
    chipCount: finalResponseChips.length,
    chipPreview: finalResponseChips.slice(0, 6),
    displayedOptionCount: finalDisplayedOptions.length,
    displayedOptions: finalDisplayedOptions.slice(0, 6).map(option => ({
      label: option.label,
      field: option.field,
      value: option.value,
      count: option.count,
    })),
    sessionState: {
      sessionId: sessionState.sessionId ?? null,
      currentMode: sessionState.currentMode ?? null,
      lastAskedField: sessionState.lastAskedField ?? null,
      candidateCount: sessionState.candidateCount ?? 0,
      displayedChipCount: sessionState.displayedChips?.length ?? 0,
      displayedOptionCount: sessionState.displayedOptions?.length ?? 0,
    },
  })
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
  traceRecommendation("response.buildRecommendationResponse:input", {
    totalCandidateCount,
    turnCount,
    input: summarizeRecommendationInputForTrace(input),
    historyCount: history.length,
    history: summarizeHistoryForTrace(history),
    filterCount: filters.length,
    filters: summarizeFiltersForTrace(filters),
    messageCount: messages.length,
    pagination: summarizePaginationForTrace(pagination),
    displayedProductsCount: displayedProducts?.length ?? 0,
  })
  const nextQuestion = await selectNextQuestionForResponse({
    input,
    candidates,
    history,
    filters,
    totalCandidateCount,
  })
  if (nextQuestion) {
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

  if (form.material?.status === "unknown") warnings.push("소재 미지정 — 전체 소재 대상 검색")
  if (form.diameterInfo?.status === "unknown") warnings.push("직경 미지정 — 직경 기준 필터 없음")

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

  const evidenceLookup = (p: ScoredProduct): EvidenceSummary | undefined =>
    evidenceMap.get(p.product.normalizedCode) ?? evidenceMap.get(p.product.displayCode)

  const evidenceSummaries: EvidenceSummary[] = []
  if (primary) {
    const primarySummary = evidenceLookup(primary)
    if (primarySummary) evidenceSummaries.push(primarySummary)
  }
  for (const alt of alternatives) {
    const summary = evidenceLookup(alt)
    if (summary) evidenceSummaries.push(summary)
  }

  let primaryExplanation: RecommendationExplanation | null = null
  let primaryFactChecked: FactCheckedRecommendation | null = null
  const altExplanations: RecommendationExplanation[] = []
  const altFactChecked: FactCheckedRecommendation[] = []

  if (primary) {
    const primaryEvidence = evidenceLookup(primary) ?? null
    primaryExplanation = buildExplanation(primary, input, primaryEvidence)
    primaryFactChecked = await runFactCheck(primary, input, primaryEvidence, primaryExplanation)

    for (const alt of alternatives) {
      const altEvidence = evidenceLookup(alt) ?? null
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
      const systemPrompt = buildRecommendationSummarySystemPrompt(language)
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

      const raw = await provider.complete(
        systemPrompt,
        [{ role: "user", content: resultPrompt }],
        RECOMMENDATION_SUMMARY_MAX_TOKENS
      )
      const extractedSummary = extractRecommendationSummaryText(raw)
      if (extractedSummary) {
        recommendation.llmSummary = extractedSummary
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
    const hasBrand = responseText.includes(brandName)
    const hasProductCode = responseText.includes(primary.product.displayCode)
    if (!hasBrand && !hasProductCode) {
      responseText = `${brandName} ${primary.product.displayCode} 기준으로 보면, ${responseText}`.trim()
    } else if (!hasProductCode) {
      responseText = `${primary.product.displayCode} 기준으로 보면, ${responseText}`.trim()
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
  // post-result 칩에서 narrowing 칩(소재/날수/개수 포함 칩) 제거 + CTA 버튼 추가
  const finalRecChips = [
    ...followUpChips.filter(chip =>
      typeof chip === "string" && chip.trim().length > 1 &&
      (!chip.includes("개)") || chip.includes("비교") || chip.includes("보기"))
    ),
    `📋 지금 바로 제품 보기 (${totalCandidateCount}개)`,
    `✨ AI 상세 분석`,
  ]
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

  traceRecommendation("response.buildRecommendationResponse:output", {
    purpose: "recommendation",
    text: finalResponseText,
    chips: finalRecChips,
    sessionState,
    recommendation,
  })
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
    const evidence = evidenceMap.get(candidate.product.normalizedCode) ?? evidenceMap.get(candidate.product.displayCode)
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
      shankType: candidate.product.shankType ?? null,
      lengthOfCutMm: candidate.product.lengthOfCutMm ?? null,
      overallLengthMm: candidate.product.overallLengthMm ?? null,
      helixAngleDeg: candidate.product.helixAngleDeg ?? null,
      coolantHole: candidate.product.coolantHole ?? null,
      ballRadiusMm: candidate.product.ballRadiusMm ?? null,
      taperAngleDeg: candidate.product.taperAngleDeg ?? null,
      pointAngleDeg: candidate.product.pointAngleDeg ?? null,
      threadPitchMm: candidate.product.threadPitchMm ?? null,
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

  const isApproximate = primary.matchStatus === "approximate"
  const isNone = primary.matchStatus === "none"

  // Collect distribution data from all candidates
  const allProducts = [primary, ...alts]
  const flutes = new Set(allProducts.map(p => p.product?.fluteCount).filter(Boolean))
  const coatings = new Set(allProducts.map(p => p.product?.coating).filter(Boolean))
  const series = new Set(allProducts.map(p => p.product?.seriesName).filter(Boolean))

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

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
}

export function extractRecommendationSummaryText(raw: string): string | null {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
  if (!cleaned) return null

  const parsed = safeParseJSON(cleaned)
  if (typeof parsed?.responseText === "string" && parsed.responseText.trim()) {
    return parsed.responseText.trim()
  }

  const responseTextMatch = cleaned.match(/"responseText"\s*:\s*"((?:\\.|[^"])*)"/s)
  if (responseTextMatch?.[1]) {
    const extracted = unescapeJsonString(responseTextMatch[1]).trim()
    if (extracted) return extracted
  }

  const truncatedResponseTextMatch = cleaned.match(/"responseText"\s*:\s*"([\s\S]*)$/)
  if (truncatedResponseTextMatch?.[1]) {
    const extracted = unescapeJsonString(truncatedResponseTextMatch[1]).trim()
    if (extracted) return extracted
  }

  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    return cleaned
  }

  return null
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
