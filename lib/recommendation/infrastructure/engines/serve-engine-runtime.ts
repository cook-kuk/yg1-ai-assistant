import {
  analyzeInquiry,
  buildSessionState,
  carryForwardState,
  checkResolution,
  getRedirectResponse,
  prepareRequest,
  restoreToBeforeFilter,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"
import { BrandReferenceRepo } from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { getSessionCache } from "@/lib/recommendation/infrastructure/cache/session-cache"
import { resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
import { parseAnswerToFilter, extractAllFiltersFromMessage } from "@/lib/recommendation/domain/question-engine"
import { extractFiltersWithLLM, llmResultToAppliedFilters } from "@/lib/recommendation/core/llm-filter-extractor"
import {
  compareProducts,
  orchestrateTurn,
  orchestrateTurnWithTools,
  resolveProductReferences,
} from "@/lib/recommendation/infrastructure/agents/recommendation-agents"
import { ENABLE_TOOL_USE_ROUTING } from "@/lib/recommendation/infrastructure/config/recommendation-feature-flags"
import { USE_NEW_ORCHESTRATOR, shouldUseV2ForPhase } from "@/lib/feature-flags"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { performUnifiedJudgment } from "@/lib/recommendation/domain/context/unified-haiku-judgment"
import {
  buildComparisonOptionState,
  buildRefinementOptionState,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { replaceFieldFilter } from "@/lib/recommendation/infrastructure/engines/serve-engine-filter-state"
import { detectUserState } from "@/lib/recommendation/domain/context/user-understanding-detector"
import { buildUnifiedTurnContext } from "@/lib/recommendation/domain/context/turn-context-builder"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"
import { normalizeFilterValue, extractDistinctFieldValues } from "@/lib/recommendation/domain/value-normalizer"
import { classifyQueryTarget } from "@/lib/recommendation/domain/context/query-target-classifier"
import { TraceCollector, isDebugEnabled } from "@/lib/debug/agent-trace"
import { handleServeGeneralChatAction } from "@/lib/recommendation/infrastructure/engines/serve-engine-general-chat"
import { handleFilterByStock } from "@/lib/recommendation/infrastructure/engines/serve-engine-stock"
import { handleCompareProducts } from "@/lib/recommendation/infrastructure/engines/serve-engine-comparison"
import { handleResetSession, handleGoBack, handleShowRecommendation } from "@/lib/recommendation/infrastructure/engines/serve-engine-navigation"
import type { NavigationHandlerContext } from "@/lib/recommendation/infrastructure/engines/serve-engine-navigation"
import { classifyPreSearchRoute } from "@/lib/recommendation/infrastructure/engines/pre-search-route"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import { shouldExecutePendingAction, pendingActionToFilter } from "@/lib/recommendation/domain/context/pending-action-resolver"
import { TurnPerfLogger, setCurrentPerfLogger } from "@/lib/recommendation/infrastructure/perf/turn-perf-logger"
import { buildAppliedFilterFromValue, buildFilterValueScope, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import {
  buildConstraintClarificationQuestion,
  hasExplicitFilterIntent,
  hasExplicitRevisionIntent,
  parseExplicitFilterText,
  parseExplicitRevisionText,
} from "@/lib/recommendation/shared/constraint-text-parser"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type { TurnResult } from "@/lib/recommendation/core/types"
import type { OrchestratorAction, OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  ChatMessage,
  EvidenceSummary,
  ExplorationSessionState,
  NarrowingStage,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationInput,
  RecommendationResult,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

export { handleServeSimpleChat } from "@/lib/recommendation/infrastructure/engines/serve-engine-simple-chat"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

type QuestionReply = { text: string; chips: string[] } | null
type CandidatePaginationRequest = Pick<RecommendationPaginationDto, "page" | "pageSize">
type CandidatePageSlice = {
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
}
type ExplicitRevisionRequest = {
  targetField: string
  previousValue: string
  nextFilter: AppliedFilter
}

type ExplicitRevisionResolution =
  | { kind: "resolved"; request: ExplicitRevisionRequest }
  | { kind: "ambiguous"; question: string }

type ExplicitFilterResolution =
  | { kind: "resolved"; filter: AppliedFilter }
  | { kind: "ambiguous"; question: string }

const DEFAULT_CANDIDATE_PAGE_SIZE = 50

function buildPreSearchOrchestratorResult(userMessage: string, reason: string) {
  return {
    action: { type: "answer_general" as const, message: userMessage },
    reasoning: `pre_search_route:${reason}`,
    agentsInvoked: [{ agent: "pre-search-router", model: "haiku" as const, durationMs: 0 }],
    escalatedToOpus: false,
  }
}

function buildExplicitComparisonOrchestratorResult(targets: string[]): OrchestratorResult {
  return {
    action: { type: "compare_products", targets },
    reasoning: `explicit_compare:${targets.join(",")}`,
    agentsInvoked: [{ agent: "explicit-compare-resolver", model: "haiku" as const, durationMs: 0 }],
    escalatedToOpus: false,
  }
}

function buildPendingSelectionOrchestratorResult(filter: AppliedFilter): OrchestratorResult {
  const action = filter.op === "skip"
    ? { type: "skip_field" as const }
    : { type: "continue_narrowing" as const, filter }

  return {
    action,
    reasoning: `pending_selection:${filter.field}:${filter.op === "skip" ? "skip" : filter.value}`,
    agentsInvoked: [{ agent: "pending-selection-resolver", model: "haiku" as const, durationMs: 0 }],
    escalatedToOpus: false,
  }
}

function buildV2BridgeOrchestratorResult(
  action: OrchestratorAction,
  result: TurnResult
): OrchestratorResult {
  return {
    action,
    reasoning: `v2_bridge:${result.trace.action}`,
    agentsInvoked: [{ agent: "v2-bridge", model: "haiku", durationMs: 0 }],
    escalatedToOpus: false,
  }
}

function buildV2BridgeAction(
  result: TurnResult,
  prevState: ExplorationSessionState | null
): OrchestratorAction | null {
  switch (result.trace.action) {
    case "compare_products": {
      const availableCount =
        prevState?.displayedCandidates?.length
        ?? result.sessionState.resultContext?.candidates.length
        ?? 0
      const topN = Math.min(3, availableCount)
      return topN >= 2
        ? { type: "compare_products", targets: [`상위 ${topN}`] }
        : { type: "answer_general", message: result.answer, preGenerated: true }
    }
    case "skip_field":
      return { type: "skip_field" }
    case "answer_general":
      return { type: "answer_general", message: result.answer, preGenerated: true }
    case "redirect_off_topic":
      return { type: "redirect_off_topic" }
    case "reset_session":
      return { type: "reset_session" }
    case "show_recommendation":
      return { type: "show_recommendation" }
    default:
      return null
  }
}

function resolveCandidatePagination(
  pagination: CandidatePaginationRequest | null | undefined
): CandidatePaginationRequest {
  const page = typeof pagination?.page === "number" && pagination.page >= 0 ? pagination.page : 0
  const pageSize = typeof pagination?.pageSize === "number" && pagination.pageSize > 0
    ? pagination.pageSize
    : DEFAULT_CANDIDATE_PAGE_SIZE

  return { page, pageSize }
}

function buildPaginationDto(
  pagination: CandidatePaginationRequest,
  totalItems: number
): RecommendationPaginationDto {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pagination.pageSize),
  }
}

function sliceCandidatesForPage(
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  pagination: CandidatePaginationRequest
): CandidatePageSlice {
  // Clamp page to valid range to prevent empty results on out-of-bounds requests
  const totalPages = candidates.length === 0 ? 0 : Math.ceil(candidates.length / pagination.pageSize)
  const clampedPage = totalPages > 0 ? Math.min(pagination.page, totalPages - 1) : 0
  const start = clampedPage * pagination.pageSize
  const end = start + pagination.pageSize
  const pageCandidates = candidates.slice(start, end)
  const pageEvidenceMap = new Map<string, EvidenceSummary>()

  for (const candidate of pageCandidates) {
    const summary = evidenceMap.get(candidate.product.normalizedCode)
    if (summary) pageEvidenceMap.set(candidate.product.normalizedCode, summary)
  }

  return {
    candidates: pageCandidates,
    evidenceMap: pageEvidenceMap,
  }
}

function normalizePendingSelectionText(value: string): string {
  return value
    .trim()
    .replace(/\s*\(\d+개\)\s*$/, "")
    .replace(/\s*—\s*.+$/, "")
    .replace(/(으로요|로요|이에요|예요|입니다|으로|로|요)$/u, "")
    .trim()
    .toLowerCase()
}

function isSkipSelectionValue(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = normalizePendingSelectionText(value)
  return ["상관없음", "상관 없음", "모름", "skip", "패스", "스킵"].includes(normalized)
}

function hasExplicitComparisonSignal(value: string): boolean {
  return /(비교|차이|vs|versus)/i.test(value)
}

function parseExplicitComparisonTargets(raw: string): string[] {
  const clean = raw.trim().toLowerCase()
  const targets: string[] = []
  const seen = new Set<string>()

  const pushTarget = (target: string | null) => {
    if (!target || seen.has(target)) return
    seen.add(target)
    targets.push(target)
  }

  for (const match of clean.matchAll(/(\d+)\s*번/g)) {
    pushTarget(`${match[1]}번`)
  }

  const topMatch = clean.match(/상위\s*(\d+|한|하나|두|둘|세|셋|네|넷|다섯)\s*개?/)
  if (topMatch) {
    const map: Record<string, string> = {
      한: "1",
      하나: "1",
      두: "2",
      둘: "2",
      세: "3",
      셋: "3",
      네: "4",
      넷: "4",
      다섯: "5",
    }
    pushTarget(`상위${map[topMatch[1]] ?? topMatch[1]}`)
  }

  const aboveMatch = clean.match(/위[에]?\s*(\d+|두|세|네)\s*개/)
  if (aboveMatch && targets.length === 0) {
    const map: Record<string, string> = {
      두: "2",
      세: "3",
      네: "4",
    }
    pushTarget(`상위${map[aboveMatch[1]] ?? aboveMatch[1]}`)
  }

  for (const match of raw.toUpperCase().matchAll(/\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/g)) {
    pushTarget(match[0].replace(/-/g, ""))
  }

  return targets
}

function hasExplicitRevisionSignal(value: string): boolean {
  return hasExplicitRevisionIntent(value)
}

function hasExplicitFilterIntentSignal(value: string): boolean {
  return hasExplicitFilterIntent(value)
}

function includesText(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizePendingSelectionText(haystack).replace(/\s+/g, "")
  const normalizedNeedle = normalizePendingSelectionText(needle).replace(/\s+/g, "")
  if (!normalizedHaystack || !normalizedNeedle) return false
  return normalizedHaystack.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedHaystack)
}

function getRevisionCandidatePool(sessionState: ExplorationSessionState | null): Array<Record<string, unknown>> {
  return (
    sessionState?.fullDisplayedProducts
    ?? sessionState?.fullDisplayedCandidates
    ?? sessionState?.displayedProducts
    ?? sessionState?.displayedCandidates
    ?? []
  ) as unknown as Array<Record<string, unknown>>
}

function getRevisionCandidateValues(
  sessionState: ExplorationSessionState | null,
  field: string
): string[] {
  const scopedValues = sessionState?.filterValueScope?.[field]
  if (Array.isArray(scopedValues)) return scopedValues
  return extractDistinctFieldValues(getRevisionCandidatePool(sessionState), field)
}

function matchRevisionValueAgainstCandidateValues(
  field: string,
  value: string,
  sessionState: ExplorationSessionState | null
): string | null {
  const candidateValues = getRevisionCandidateValues(sessionState, field)
  if (candidateValues.length === 0) return null

  const normalizedValue = normalizePendingSelectionText(value).replace(/\s+/g, "")
  if (!normalizedValue) return null

  const exactMatch = candidateValues.find(candidate => (
    normalizePendingSelectionText(candidate).replace(/\s+/g, "") === normalizedValue
  ))
  if (exactMatch) return exactMatch

  const fuzzyMatch = candidateValues.find(candidate => {
    const normalizedCandidate = normalizePendingSelectionText(candidate).replace(/\s+/g, "")
    return normalizedCandidate.includes(normalizedValue) || normalizedValue.includes(normalizedCandidate)
  })
  if (fuzzyMatch) return fuzzyMatch

  return null
}

function sanitizeRevisionValueForField(
  field: string,
  value: string,
  sessionState: ExplorationSessionState | null
): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return ""

  const exactCandidate = matchRevisionValueAgainstCandidateValues(field, trimmed, sessionState)
  if (exactCandidate) return exactCandidate

  const parsed = parseAnswerToFilter(field, trimmed)
  if (!parsed) return trimmed

  const normalized = parsed.rawValue ?? parsed.value
  return String(normalized ?? trimmed).trim()
}

function inferRevisionTargetFields(
  hintedFields: string[],
  activeFilters: AppliedFilter[],
  sessionState: ExplorationSessionState | null
): string[] {
  const activeFieldSet = new Set(activeFilters.map(filter => filter.field))
  const filteredHintedFields = hintedFields.filter(field => activeFieldSet.has(field))

  if (filteredHintedFields.length > 0) return filteredHintedFields

  const lastAskedField = sessionState?.lastAskedField
  if (lastAskedField && activeFieldSet.has(lastAskedField)) {
    return [lastAskedField]
  }

  return [...new Set(activeFilters.map(filter => filter.field))]
}

function inferExplicitFilterTargetFields(
  raw: string,
  hintedFields: string[],
  sessionState: ExplorationSessionState | null
): string[] {
  if (hintedFields.length > 0) return [...new Set(hintedFields)]
  const matchedFields: string[] = []

  for (const field of getRegisteredFilterFields()) {
    const values = getRevisionCandidateValues(sessionState, field)
    if (values.length === 0) continue
    if (values.some(value => includesText(String(value), raw))) {
      matchedFields.push(field)
    }
  }

  return [...new Set(matchedFields)]
}

function normalizeComparableFilterValue(field: string, value: string | number | null | undefined): string {
  if (value == null) return ""

  if (field === "fluteCount") {
    const match = String(value).match(/(\d+)/)
    return match?.[1] ?? ""
  }

  if (field === "diameterMm" || field === "diameterRefine") {
    const match = String(value).match(/([\d.]+)/)
    return match?.[1] ?? ""
  }

  const parsed = typeof value === "string" ? parseAnswerToFilter(field, value) : null
  const canonicalValue = parsed?.rawValue ?? parsed?.value ?? value

  if (canonicalValue == null) return ""
  if (typeof canonicalValue === "number") return String(canonicalValue)
  return normalizePendingSelectionText(String(canonicalValue))
}

function doesCandidatePoolContainFilterValue(
  field: string,
  filter: AppliedFilter,
  sessionState: ExplorationSessionState | null
): boolean {
  const candidateValues = getRevisionCandidateValues(sessionState, field)
  if (candidateValues.length === 0) return true

  const filterComparable = normalizeComparableFilterValue(field, filter.rawValue ?? filter.value)
  if (!filterComparable) return false

  return candidateValues.some(candidateValue => (
    normalizeComparableFilterValue(field, candidateValue) === filterComparable
  ))
}

export async function resolveExplicitFilterRequest(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null,
  provider: ReturnType<typeof getProvider>
): Promise<ExplicitFilterResolution | null> {
  if (!sessionState || !userMessage) return null

  const raw = userMessage.trim()
  if (!raw || !hasExplicitFilterIntentSignal(raw) || hasExplicitRevisionSignal(raw)) return null
  const parsedText = await parseExplicitFilterText(raw, undefined, provider)
  const candidateFields = inferExplicitFilterTargetFields(raw, parsedText.hintedFields, sessionState)
  if (candidateFields.length === 0) return null

  const valueCandidates = parsedText.valueCandidates
  if (valueCandidates.length === 0) return null

  const matchedFilters: AppliedFilter[] = []

  for (const field of candidateFields) {
    const fieldCandidateValues = getRevisionCandidateValues(sessionState, field)

    for (const rawCandidate of valueCandidates) {
      const sanitized = sanitizeRevisionValueForField(field, rawCandidate, sessionState)
      let nextValue = sanitized

      if (fieldCandidateValues.length > 0) {
        const { normalized, matchType } = await normalizeFilterValue(nextValue, field, fieldCandidateValues, provider)
        if (matchType !== "none") nextValue = normalized
      }

      const parsed = buildAppliedFilterFromValue(field, nextValue)
      if (!parsed) continue
      if (!doesCandidatePoolContainFilterValue(field, parsed, sessionState)) continue
      matchedFilters.push(parsed)
    }
  }

  const deduped = matchedFilters.filter((filter, index, filters) => {
    const key = `${filter.field}:${normalizeComparableFilterValue(filter.field, filter.rawValue ?? filter.value)}`
    return index === filters.findIndex(candidate => (
      `${candidate.field}:${normalizeComparableFilterValue(candidate.field, candidate.rawValue ?? candidate.value)}` === key
    ))
  })

  if (deduped.length === 0) return null
  if (deduped.length === 1) return { kind: "resolved", filter: deduped[0] }

  return {
    kind: "ambiguous",
    question: buildConstraintClarificationQuestion(
      deduped.map(filter => filter.field),
      valueCandidates
    ),
  }
}

function rebuildResolvedInputFromFilters(
  form: ProductIntakeForm,
  filters: AppliedFilter[],
  deps: Pick<ServeEngineRuntimeDependencies, "mapIntakeToInput" | "applyFilterToInput">
): RecommendationInput {
  let nextInput = deps.mapIntakeToInput(form)

  for (const filter of filters) {
    if (filter.op === "skip") continue
    nextInput = deps.applyFilterToInput(nextInput, filter)
  }

  return nextInput
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

function dropDependentWorkPieceFilters(filters: AppliedFilter[]): void {
  for (let index = filters.length - 1; index >= 0; index--) {
    const field = filters[index]?.field
    if (field === "workPieceName" || field === "edpBrandName" || field === "edpSeriesName") {
      filters.splice(index, 1)
    }
  }
}

async function enrichWorkPieceFilterWithSeriesScope(
  filter: AppliedFilter,
  currentInput: RecommendationInput
): Promise<AppliedFilter> {
  if (filter.field !== "workPieceName") return filter

  const isoGroup = resolveSingleIsoGroup(currentInput.material)
  const workPieceName = String(filter.rawValue ?? "").trim()
  if (!isoGroup || !workPieceName) return filter

  const seriesNames = await getSessionCache().getOrFetch(
    `seriesNames:${isoGroup}|${workPieceName}`,
    () => BrandReferenceRepo.listDistinctSeriesNames({ isoGroup, workPieceName, limit: 30 })
  )
  if (seriesNames.length === 0) return filter

  const seriesScopeFilter: AppliedFilter = {
    field: "edpSeriesName",
    op: "in",
    value: seriesNames.length <= 3 ? seriesNames.join(", ") : `${seriesNames.length}개 시리즈`,
    rawValue: seriesNames.join("||"),
    appliedAt: filter.appliedAt,
  }

  return {
    ...filter,
    _sideFilters: [seriesScopeFilter],
  } as AppliedFilter
}

/**
 * Detect "다른 직경/소재/코팅" refinement patterns deterministically.
 * Returns the target field name or null if no match.
 */
function detectRefineConditionField(userMessage: string): string | null {
  const clean = userMessage.trim()
  // Action verbs: 변경/바꿔/바꾸/바꾸고/바꿨/고치/수정 + correction: 틀렸/틀림/잘못/실수/다시
  const actionVerbs = "변경|바꿔|바꾸|바꾸고|바꿨|고치|수정|틀렸|틀림|잘못|실수|다시"
  // "다른 X", "X + action verb", "correction ... X"
  if (new RegExp(`(?:외|다른)\\s*(?:직경|사이즈|크기|지름)|(?:직경|사이즈|크기|지름)\\s*(?:${actionVerbs})|(?:틀렸|틀림|잘못|실수)[^.]{0,6}직경`, "u").test(clean)) return "diameter"
  if (new RegExp(`다른\\s*(?:소재|재질|피삭재)|(?:소재|재질|피삭재)\\s*(?:${actionVerbs})|(?:틀렸|틀림|잘못|실수)[^.]{0,6}(?:소재|재질)`, "u").test(clean)) return "material"
  if (new RegExp(`다른\\s*코팅|코팅\\s*(?:${actionVerbs})|(?:틀렸|틀림|잘못|실수)[^.]{0,6}코팅`, "u").test(clean)) return "coating"
  if (new RegExp(`다른\\s*(?:날수?|플루트)|(?:날수?)\\s*(?:${actionVerbs})|(?:틀렸|틀림|잘못|실수)[^.]{0,6}날수?`, "u").test(clean)) return "fluteCount"
  if (new RegExp(`다른\\s*형상|형상\\s*(?:${actionVerbs})|(?:틀렸|틀림|잘못|실수)[^.]{0,6}형상`, "u").test(clean)) return "toolSubtype"
  return null
}

export function buildPendingSelectionFilter(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null
): AppliedFilter | null {
  const pendingField = sessionState?.lastAskedField ?? null
  if (!sessionState || !pendingField) return null
  if (sessionState.resolutionStatus?.startsWith("resolved")) return null
  if (!userMessage) return null

  const raw = userMessage.trim()
  if (!raw) return null
  // Short question marks → skip (long messages may contain ? in context)
  if (/[?？]/.test(raw) && raw.length <= 40) return null
  // Block question-words only for short messages; long NL messages like
  // "Corner radius 타입에 알루미늄 소재 추천해주세요" should pass through.
  // Removed "추천", "줘", "알려" — they appear in legitimate filter requests.
  if (raw.length <= 40 && /뭐야|뭔지|설명|차이|왜|어떻게|몇개|종류|비교|결과|처음부터|이전 단계|궁금|공장|영업소|연락|번호|정보|회사|사장|회장|매출|주주|지점|사우디|해외|국가|나라|도시|어디/u.test(raw)) return null

  const clean = normalizePendingSelectionText(raw)
  if (!clean) return null

  let optionsForPendingField = (sessionState.displayedOptions ?? []).filter(option => option.field === pendingField)
  if (optionsForPendingField.length === 0) {
    optionsForPendingField = (sessionState.displayedChips ?? []).map((chip, index) => {
      const skipValue = isSkipSelectionValue(chip)
      const cleanChipValue = normalizePendingSelectionText(chip)
        .replace(/\s*\(\d+개\)\s*$/u, "")
        .trim()

      return {
        index: index + 1,
        label: chip,
        field: pendingField,
        value: skipValue ? "skip" : cleanChipValue,
        count: 0,
      }
    })
  }

  const optionMatch = optionsForPendingField.find(option => {
    const normalizedValue = normalizePendingSelectionText(option.value)
    const normalizedLabel = normalizePendingSelectionText(option.label)
    return clean === normalizedValue || clean === normalizedLabel || clean.startsWith(normalizedValue) || normalizedValue.startsWith(clean)
  })

  const chipMatch = optionsForPendingField.find(option => {
    const normalizedChip = normalizePendingSelectionText(option.label)
    return normalizedChip && (clean === normalizedChip || clean.startsWith(normalizedChip) || normalizedChip.startsWith(clean))
  })

  const selectedOption = optionMatch ?? chipMatch ?? null
  const selectedValue = selectedOption?.value ?? null
  if (!selectedValue) {
    // ── NL fallback: try pattern-based extraction for the pending field ──
    const nlFilters = extractAllFiltersFromMessage(raw, sessionState.appliedFilters ?? [])
    const nlMatch = nlFilters.find(f => f.field === pendingField)
    if (nlMatch) {
      console.log(`[pending-filter:nl] NL extracted field="${pendingField}" value="${nlMatch.rawValue}"`)
      return nlMatch
    }
    console.log(`[pending-filter] No option/chip/NL match for "${raw.slice(0, 30)}" → skip filter creation`)
    return null
  }

  if (selectedValue === "skip" || isSkipSelectionValue(selectedOption?.label) || isSkipSelectionValue(raw)) {
    const filter: AppliedFilter = {
      field: pendingField,
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: sessionState.turnCount ?? 0,
    }
    console.log(`[pending-selection] Resolved field="${pendingField}" as skip`)
    return filter
  }

  const filter = parseAnswerToFilter(pendingField, selectedValue)
  if (filter) {
    console.log(`[pending-selection] Resolved field="${pendingField}" value="${selectedValue}"`)
  }
  return filter
}

export function resolveExplicitComparisonAction(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null
): OrchestratorAction | null {
  if (!sessionState || !userMessage) return null

  const raw = userMessage.trim()
  if (!raw || !hasExplicitComparisonSignal(raw)) return null

  const candidatePool = sessionState.fullDisplayedProducts
    ?? sessionState.fullDisplayedCandidates
    ?? sessionState.displayedProducts
    ?? sessionState.displayedCandidates
    ?? []
  if (candidatePool.length < 2) return null

  const targets = parseExplicitComparisonTargets(raw)
  if (targets.length === 0) return null

  const resolvedTargets = resolveProductReferences(targets, candidatePool, { fallbackToTop2: false })
  if (resolvedTargets.length < 2) return null

  return { type: "compare_products", targets }
}

export async function resolveExplicitRevisionRequest(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null,
  provider?: ReturnType<typeof getProvider>
): Promise<ExplicitRevisionResolution | null> {
  if (!sessionState || !userMessage) return null

  const raw = userMessage.trim()
  if (!raw || !hasExplicitRevisionSignal(raw)) return null

  const activeFilters = (sessionState.appliedFilters ?? []).filter(filter => filter.op !== "skip")
  if (activeFilters.length === 0) return null

  const parsedText = await parseExplicitRevisionText(raw, activeFilters.map(filter => filter.field), provider)
  const { previousText, valueCandidates: nextValues } = parsedText
  if (nextValues.length === 0) return null

  const prioritizedFilters = [...activeFilters].sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0))
  const candidateFields = inferRevisionTargetFields(parsedText.hintedFields, prioritizedFilters, sessionState)
  const matchedRequests: ExplicitRevisionRequest[] = []

  for (const field of candidateFields) {
    const matchingFilters = prioritizedFilters.filter(filter => filter.field === field)
    if (matchingFilters.length === 0) continue

    for (const nextValue of nextValues) {
      const sanitizedNextValue = sanitizeRevisionValueForField(field, nextValue, sessionState)
      const parsed = parseAnswerToFilter(field, sanitizedNextValue)
      if (!parsed) continue

      for (const existingFilter of matchingFilters) {
        const existingComparable = normalizeComparableFilterValue(existingFilter.field, existingFilter.rawValue ?? existingFilter.value)
        const nextComparable = normalizeComparableFilterValue(existingFilter.field, parsed.rawValue ?? parsed.value)
        if (!nextComparable || existingComparable === nextComparable) continue

        if (previousText) {
          const sanitizedPreviousText = sanitizeRevisionValueForField(existingFilter.field, previousText, sessionState)
          const previousComparable = normalizeComparableFilterValue(existingFilter.field, sanitizedPreviousText)
          if (previousComparable && existingComparable && !existingComparable.includes(previousComparable)) {
            continue
          }
        }

        matchedRequests.push({
          targetField: existingFilter.field,
          previousValue: String(existingFilter.value),
          nextFilter: parsed,
        })
      }
    }
  }

  if (matchedRequests.length === 0) return null

  const dedupedRequests = matchedRequests.filter((request, index, requests) => {
    const key = `${request.targetField}:${normalizeComparableFilterValue(request.targetField, request.nextFilter.rawValue ?? request.nextFilter.value)}`
    return index === requests.findIndex(candidate => (
      `${candidate.targetField}:${normalizeComparableFilterValue(candidate.targetField, candidate.nextFilter.rawValue ?? candidate.nextFilter.value)}` === key
    ))
  })

  if (dedupedRequests.length === 1) {
    return { kind: "resolved", request: dedupedRequests[0] }
  }

  return {
    kind: "ambiguous",
    question: buildConstraintClarificationQuestion(
      dedupedRequests.map(request => request.targetField),
      nextValues
    ),
  }
}

export interface ServeEngineRuntimeDependencies {
  mapIntakeToInput: (form: ProductIntakeForm) => RecommendationInput
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
  buildQuestionResponse: (
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
  ) => Promise<Response>
  buildRecommendationResponse: (
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
    provider: ReturnType<typeof getProvider>,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    prevState: ExplorationSessionState,
    messages?: ChatMessage[],
  ) => Promise<string | null>
  handleGeneralChat: (
    provider: ReturnType<typeof getProvider>,
    userMessage: string,
    currentInput: RecommendationInput,
    candidates: ScoredProduct[],
    form: ProductIntakeForm,
    displayedCandidatesContext?: CandidateSnapshot[],
    messages?: ChatMessage[],
    prevState?: ExplorationSessionState,
  ) => Promise<{ text: string; chips: string[] }>
  jsonRecommendationResponse: JsonRecommendationResponse
  getFollowUpChips: (result: RecommendationResult) => string[]
  buildSourceSummary: (primary: { product: { rawSourceFile: string; rawSourceSheet?: string | null; sourceConfidence?: string | null } } | null) => string[]
}

const SKIP_RETRIEVAL_ACTIONS = new Set([
  "compare_products",
  "explain_product",
  "answer_general",
  "filter_by_stock",
])

function buildActionMeta(
  actionType: string,
  orchResult: { agentsInvoked: unknown; escalatedToOpus: boolean },
  debugTrace?: import("@/lib/debug/agent-trace").TurnDebugTrace | null
) {
  return {
    orchestratorResult: {
      action: actionType,
      agents: orchResult.agentsInvoked,
      opus: orchResult.escalatedToOpus,
    },
    debugTrace: debugTrace ?? undefined,
  }
}

function buildRevisionClarificationResponse(
  deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse" | "buildCandidateSnapshot">,
  prevState: ExplorationSessionState,
  form: ProductIntakeForm,
  filters: AppliedFilter[],
  narrowingHistory: NarrowingTurn[],
  currentInput: RecommendationInput,
  turnCount: number,
  question: string,
  requestPreparation: ReturnType<typeof prepareRequest> | null
) {
  const sessionState = carryForwardState(prevState, {
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "narrowing",
    resolvedInput: currentInput,
    turnCount,
    displayedChips: filters.length > 0 ? ["⟵ 이전 단계", "처음부터 다시"] : ["처음부터 다시"],
    displayedOptions: [],
    currentMode: "question",
    lastAction: "ask_clarification",
  })

  return deps.jsonRecommendationResponse({
    text: question,
    purpose: "question",
    chips: sessionState.displayedChips,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot: prevState.displayedCandidates ?? null,
    requestPreparation,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
  })
}

export async function handleServeExploration(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null = null,
  language: AppLanguage = "ko",
  pagination: CandidatePaginationRequest | null = null,
): Promise<Response> {
  const trace = new TraceCollector()
  const response = await handleServeExplorationInner(deps, form, messages, prevState, displayedProducts, language, pagination, trace)

  // Inject debug trace into every response
  if (isDebugEnabled()) {
    try {
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === "ai")
      const debugTrace = trace.build({
        latestUserMessage: lastUserMsg?.text ?? "",
        latestAssistantQuestion: lastAssistantMsg?.text?.slice(0, 100) ?? null,
        currentMode: prevState?.currentMode ?? null,
        routeAction: null,
        pendingField: prevState?.lastAskedField ?? null,
        candidateCount: prevState?.candidateCount ?? null,
        filterCount: prevState?.appliedFilters?.length ?? 0,
        summary: `${prevState?.currentMode ?? "initial"} | ${prevState?.candidateCount ?? "?"}개 후보 | 필터 ${prevState?.appliedFilters?.length ?? 0}개`,
      })
      if (debugTrace) {
        const json = await response.json()
        const meta = (json as any).meta ?? {}
        meta.debugTrace = debugTrace
        ;(json as any).meta = meta
        return new Response(JSON.stringify(json), {
          status: response.status,
          headers: response.headers,
        })
      }
    } catch { /* response already consumed or not JSON — return as-is */ }
  }

  return response
}

async function handleServeExplorationInner(
  deps: ServeEngineRuntimeDependencies,
  form: ProductIntakeForm,
  messages: ChatMessage[],
  prevState: ExplorationSessionState | null,
  displayedProducts: RecommendationDisplayedProductRequestDto[] | null = null,
  language: AppLanguage = "ko",
  pagination: CandidatePaginationRequest | null = null,
  trace: TraceCollector = new TraceCollector()
): Promise<Response> {
  console.log(
    `[recommend] request start hasPrevState=${!!prevState} messages=${messages.length} displayedProducts=${displayedProducts?.length ?? 0}`
  )

  const provider = getProvider()
  const perf = new TurnPerfLogger()
  setCurrentPerfLogger(perf)
  perf.setPhase(prevState?.currentMode ?? "intake")
  const baseInput = deps.mapIntakeToInput(form)
  const filters: AppliedFilter[] = [...(prevState?.appliedFilters ?? [])]
  const resolvedPagination = resolveCandidatePagination(pagination)
  const paginationDto = (totalItems: number) => buildPaginationDto(resolvedPagination, totalItems)
  const resolvedInput: RecommendationInput = prevState?.resolvedInput
    ? { ...baseInput, ...prevState.resolvedInput }
    : baseInput

  if (prevState && messages.length === 0 && pagination) {
    const fullResult = await runHybridRetrieval(resolvedInput, filters, 0, null)
    const pageResult = sliceCandidatesForPage(fullResult.candidates, fullResult.evidenceMap, resolvedPagination)
    const candidateSnapshot = deps.buildCandidateSnapshot(pageResult.candidates, pageResult.evidenceMap)
    const nextState = carryForwardState(prevState, {
      candidateCount: fullResult.totalConsidered,
      displayedCandidates: candidateSnapshot,
      displayedProducts: candidateSnapshot,
      fullDisplayedCandidates: candidateSnapshot,
      fullDisplayedProducts: candidateSnapshot,
      filterValueScope: buildFilterValueScope(fullResult.candidates as unknown as Array<Record<string, unknown>>),
    })

    return deps.jsonRecommendationResponse({
      text: "",
      purpose: prevState.currentMode === "recommendation" ? "recommendation" : "question",
      chips: prevState.displayedChips ?? [],
      isComplete: prevState.resolutionStatus?.startsWith("resolved") ?? false,
      recommendation: null,
      sessionState: nextState,
      evidenceSummaries: null,
      candidateSnapshot,
      pagination: paginationDto(fullResult.totalConsidered),
      requestPreparation: null,
      primaryExplanation: null,
      primaryFactChecked: null,
      altExplanations: [],
      altFactChecked: [],
    })
  }

  const requestPrep = prepareRequest(form, messages, prevState, resolvedInput, prevState?.candidateCount ?? 0)
  console.log(`[recommend] Intent: ${requestPrep.intent} (${requestPrep.intentConfidence}), Route: ${requestPrep.route.action}`)

  const lastUserMsg = messages.length > 0
    ? [...messages].reverse().find(message => message.role === "user")
    : null
  const narrowingHistory: NarrowingTurn[] = [...(prevState?.narrowingHistory ?? [])]
  let currentInput = { ...resolvedInput }
  let turnCount = prevState?.turnCount ?? 0
  let explicitComparisonAction: OrchestratorAction | null = null
  let explicitComparisonOrchestratorResult: OrchestratorResult | null = null
  let explicitRevisionResolution: ExplicitRevisionResolution | null = null
  let explicitRevisionAction: OrchestratorAction | null = null
  let explicitRevisionOrchestratorResult: OrchestratorResult | null = null
  let explicitFilterResolution: ExplicitFilterResolution | null = null
  let explicitFilterAction: OrchestratorAction | null = null
  let explicitFilterOrchestratorResult: OrchestratorResult | null = null
  let explicitRefineAction: OrchestratorAction | null = null
  let explicitRefineOrchestratorResult: OrchestratorResult | null = null
  let pendingSelectionAction: OrchestratorAction | null = null
  let pendingSelectionOrchestratorResult: OrchestratorResult | null = null
  let llmExtraFilters: AppliedFilter[] = []
  let bridgedV2Action: OrchestratorAction | null = null
  let bridgedV2OrchestratorResult: OrchestratorResult | null = null
  const journeyPhase = detectJourneyPhase(prevState)

  // ── CTA 버튼 감지 ──
  const userText = lastUserMsg?.text ?? ""
  const isProductListRequest = /제품 보기|후보 목록|제품 목록|바로 보기/u.test(userText)
  const isAIAnalysisRequest = /AI 상세 분석|상세 분석|분석해/u.test(userText)
  const isRecommendRequest = /추천받기|추천보기|추천해주세요|추천해줘|바로 보여|결과 보여|지금 조건으로/u.test(userText)

  if (prevState && (isProductListRequest || isAIAnalysisRequest || isRecommendRequest)) {
    const currentCount = prevState.candidateCount ?? 0

    if (isProductListRequest) {
      // 제품 보기는 항상 show_recommendation으로 — 개수가 많으면 답변에서 안내
      pendingSelectionAction = { type: "show_recommendation" } as OrchestratorAction
      if (currentCount > 200) {
        console.log(`[product-list] ${currentCount} > 200 — will show with caution note`)
      } else {
        console.log(`[product-list] ${currentCount} candidates → show products`)
      }
    } else if (isAIAnalysisRequest) {
      // AI 상세 분석은 개수 제한 없음 — 현재 추천 리스트 기반 깊은 분석
      const analysisPrompt = `현재 ${currentCount}개 후보 제품에 대해 상세 분석을 해주세요. 상위 제품들의 특성, 용도별 적합성, 선택 가이드를 자세히 설명해주세요.`
      pendingSelectionAction = { type: "answer_general", message: analysisPrompt } as OrchestratorAction
      console.log(`[ai-analysis] ${currentCount} candidates → deep analysis`)
    } else if (isRecommendRequest) {
      pendingSelectionAction = { type: "show_recommendation" } as OrchestratorAction
    }
  }

  const pendingSelectionFilter = buildPendingSelectionFilter(prevState, lastUserMsg?.text ?? null)
  // 비교 신호가 있으면 pending selection을 우회 → 비교 질문을 side question으로 처리
  const hasComparisonSignal = lastUserMsg?.text ? hasExplicitComparisonSignal(lastUserMsg.text) : false
  const shouldResolvePendingSelectionEarly = !!pendingSelectionFilter && !isPostResultPhase(journeyPhase) && !hasComparisonSignal

  if (shouldResolvePendingSelectionEarly && pendingSelectionFilter) {
    pendingSelectionAction = pendingSelectionFilter.op === "skip"
      ? { type: "skip_field" }
      : { type: "continue_narrowing", filter: pendingSelectionFilter }
    pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(pendingSelectionFilter)
    trace.addProcessingStep({
      label: "칩매칭",
      status: "success",
      detail: pendingSelectionFilter.op === "skip"
        ? `"${prevState?.lastAskedField}" 스킵`
        : `${pendingSelectionFilter.field}=${pendingSelectionFilter.value}`,
    })
  }

  // ── Step 2: LLM fallback — deterministic(Step 0+1)이 못 잡았을 때만 ──
  if (!pendingSelectionAction && prevState?.lastAskedField && lastUserMsg && !isPostResultPhase(journeyPhase) && !hasComparisonSignal) {
    const llmResult = await extractFiltersWithLLM(
      lastUserMsg.text,
      prevState.lastAskedField,
      prevState.appliedFilters ?? [],
      provider
    )

    // Record LLM filter result for debug visualization
    trace.setLLMFilterResult({
      extractedFilters: llmResult.extractedFilters ?? {},
      skipPendingField: llmResult.skipPendingField,
      isSideQuestion: llmResult.isSideQuestion,
      confidence: (llmResult as any).confidence,
      pendingField: prevState.lastAskedField,
    })
    trace.add("llm-filter-extract", "router", {
      userMessage: lastUserMsg.text.slice(0, 100),
      pendingField: prevState.lastAskedField,
    }, {
      extractedFilters: llmResult.extractedFilters,
      skipPendingField: llmResult.skipPendingField,
      isSideQuestion: llmResult.isSideQuestion,
      confidence: (llmResult as any).confidence,
    }, `LLM filter: ${JSON.stringify(llmResult.extractedFilters)}`)

    if (llmResult.skipPendingField) {
      const skipFilter: AppliedFilter = {
        field: prevState.lastAskedField,
        op: "skip",
        value: "상관없음",
        rawValue: "skip",
        appliedAt: prevState.turnCount ?? 0,
      }
      pendingSelectionAction = { type: "skip_field" }
      pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(skipFilter)
      console.log(`[llm-filter] skip "${prevState.lastAskedField}"`)
      trace.addProcessingStep({ label: "칩매칭 실패 → LLM 분석", status: "success", detail: `skipPendingField → "${prevState.lastAskedField}" 스킵` })

    } else if (llmResult.isSideQuestion) {
      // side question → pendingSelectionAction stays null → orchestrator handles
      console.log(`[llm-filter] side question detected`)
      trace.addProcessingStep({ label: "칩매칭 실패 → LLM 분석", status: "info", detail: "isSideQuestion=true → 오케스트레이터 위임" })

    } else if (Object.keys(llmResult.extractedFilters).length > 0) {
      const allFilters = llmResultToAppliedFilters(llmResult.extractedFilters, prevState.turnCount ?? 0)
      if (allFilters.length > 0) {
        // 첫 번째 필터를 primary action으로
        const primaryFilter = allFilters[0]
        pendingSelectionAction = { type: "continue_narrowing", filter: primaryFilter }
        pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(primaryFilter)
        console.log(`[llm-filter] primary: ${primaryFilter.field}=${primaryFilter.value}`)
        trace.addProcessingStep({
          label: "칩매칭 실패 → LLM 분석",
          status: "success",
          detail: `${Object.keys(llmResult.extractedFilters).map(k => `${k}=${(llmResult.extractedFilters as any)[k]}`).join(", ")}`,
        })

        if (allFilters.length > 1) {
          llmExtraFilters = allFilters.slice(1)
          console.log(`[llm-filter] ${llmExtraFilters.length} extra filters queued`)
        }
      }
    } else {
      trace.addProcessingStep({ label: "칩매칭 실패 → LLM 분석", status: "fail", detail: "필터 추출 없음" })
    }
  }

  if (messages.length > 0 && lastUserMsg) {
    if (prevState?.pendingAction) {
      const pendingCheck = shouldExecutePendingAction(
        prevState.pendingAction,
        lastUserMsg.text,
        turnCount,
        prevState.displayedChips ?? []
      )

      if (pendingCheck.reason === "expired" || pendingCheck.reason === "explicit_override") {
        console.log(`[pending-action:pre-route] Cleared before V2: ${pendingCheck.reason}`)
        prevState.pendingAction = null
      }
    }

    if (!shouldResolvePendingSelectionEarly) {
      explicitComparisonAction = resolveExplicitComparisonAction(prevState, lastUserMsg.text)
      if (explicitComparisonAction?.type === "compare_products") {
        explicitComparisonOrchestratorResult = buildExplicitComparisonOrchestratorResult(explicitComparisonAction.targets)
        console.log(`[runtime:explicit-compare] targets=${explicitComparisonAction.targets.join(", ")}`)
      }
      if (!explicitComparisonAction) {
        explicitRevisionResolution = await resolveExplicitRevisionRequest(prevState, lastUserMsg.text, provider)
        if (explicitRevisionResolution?.kind === "resolved") {
          const explicitRevisionRequest = explicitRevisionResolution.request
          explicitRevisionAction = {
            type: "replace_existing_filter",
            targetField: explicitRevisionRequest.targetField,
            previousValue: explicitRevisionRequest.previousValue,
            nextFilter: explicitRevisionRequest.nextFilter,
          }
          explicitRevisionOrchestratorResult = {
            action: explicitRevisionAction,
            reasoning: `explicit_revision:${explicitRevisionRequest.targetField}:${explicitRevisionRequest.previousValue}->${explicitRevisionRequest.nextFilter.value}`,
            agentsInvoked: [{ agent: "explicit-revision-resolver", model: "haiku", durationMs: 0 }],
            escalatedToOpus: false,
          }
          console.log(
            `[runtime:explicit-revision] field=${explicitRevisionRequest.targetField} ${explicitRevisionRequest.previousValue} -> ${explicitRevisionRequest.nextFilter.value}`
          )
        }
      }
      if (!explicitComparisonAction && !explicitRevisionResolution) {
        explicitFilterResolution = await resolveExplicitFilterRequest(prevState, lastUserMsg.text, provider)
        if (explicitFilterResolution?.kind === "resolved") {
          explicitFilterAction = {
            type: "continue_narrowing",
            filter: explicitFilterResolution.filter,
          }
          explicitFilterOrchestratorResult = {
            action: explicitFilterAction,
            reasoning: `explicit_filter:${explicitFilterResolution.filter.field}:${explicitFilterResolution.filter.value}`,
            agentsInvoked: [{ agent: "explicit-filter-resolver", model: "haiku", durationMs: 0 }],
            escalatedToOpus: false,
          }
          console.log(
            `[runtime:explicit-filter] field=${explicitFilterResolution.filter.field} value=${explicitFilterResolution.filter.value}`
          )
        }
      }

      // ── Deterministic refine-condition detection ──
      // "φ8mm 외 다른 직경", "다른 직경 검색", "다른 소재", "다른 코팅" etc.
      // Must be detected BEFORE V2 orchestrator to prevent misrouting to product lookup.
      if (!explicitComparisonAction && !explicitRevisionResolution && !explicitFilterResolution) {
        const refineField = detectRefineConditionField(lastUserMsg.text)
        if (refineField) {
          explicitRefineAction = { type: "refine_condition", field: refineField }
          explicitRefineOrchestratorResult = {
            action: explicitRefineAction,
            reasoning: `explicit_refine:${refineField}`,
            agentsInvoked: [{ agent: "explicit-refine-detector", model: "deterministic", durationMs: 0 }],
            escalatedToOpus: false,
          }
          // Remove existing filter for the target field so retrieval returns broader results
          const diameterFields = ["diameterMm", "diameterRefine", "diameter"]
          const fieldAliases = refineField === "diameter" ? diameterFields : [refineField]
          for (let i = filters.length - 1; i >= 0; i--) {
            if (fieldAliases.includes(filters[i].field)) {
              console.log(`[runtime:explicit-refine] Removing filter: ${filters[i].field}=${filters[i].value}`)
              filters.splice(i, 1)
            }
          }
          currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
          console.log(`[runtime:explicit-refine] field=${refineField}, filters remaining=${filters.length}`)
        }
      }
    }

    if (prevState && explicitRevisionResolution?.kind === "ambiguous") {
      return buildRevisionClarificationResponse(
        deps,
        prevState,
        form,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        explicitRevisionResolution.question,
        requestPrep
      )
    }
    if (prevState && explicitFilterResolution?.kind === "ambiguous") {
      return buildRevisionClarificationResponse(
        deps,
        prevState,
        form,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        explicitFilterResolution.question,
        requestPrep
      )
    }

    if (!shouldResolvePendingSelectionEarly && !explicitComparisonAction && !explicitRevisionResolution && !explicitFilterResolution && !explicitRefineAction && prevState) {
      const explanationJudgment = await performUnifiedJudgment({
        userMessage: lastUserMsg.text,
        assistantText: null,
        pendingField: prevState.lastAskedField ?? null,
        currentMode: prevState.currentMode ?? null,
        displayedChips: prevState.displayedChips ?? [],
        filterCount: filters.length,
        candidateCount: prevState.candidateCount ?? 0,
        hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
      }, provider)

      const isExplainQuestion = explanationJudgment.intentAction === "explain" || /[?？]$/.test(lastUserMsg.text.trim())
      if (
        isExplainQuestion &&
        (
          explanationJudgment.domainRelevance === "cutting_condition" ||
          isToolDomainQuestion(lastUserMsg.text)
        )
      ) {
        console.log(`[runtime:explain-route] ${explanationJudgment.domainRelevance} -> answer_general before V2`)
        return handleServeGeneralChatAction({
          deps,
          action: { type: "answer_general", message: lastUserMsg.text },
          orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, `tool_explain:${explanationJudgment.domainRelevance}`),
          provider,
          form,
          messages,
          prevState,
          filters,
          narrowingHistory,
          currentInput,
          candidates: [],
          evidenceMap: new Map(),
          turnCount,
        })
      }
    }

    if (!shouldResolvePendingSelectionEarly && !explicitComparisonAction && !explicitRevisionResolution && !explicitFilterResolution && !explicitRefineAction) {
      const preSearchRoute = await classifyPreSearchRoute(lastUserMsg.text, prevState, provider)
      if (preSearchRoute.kind !== "recommendation_action") {
        console.log(`[runtime:pre-route] ${preSearchRoute.kind} -> answer_general (${preSearchRoute.reason})`)
        const generalChatState = prevState ?? buildSessionState({
          candidateCount: 0,
          appliedFilters: filters,
          narrowingHistory,
          stageHistory: [],
          resolutionStatus: "narrowing",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: [],
          displayedChips: [],
          displayedOptions: [],
          currentMode: "question",
        })
        return handleServeGeneralChatAction({
          deps,
          action: { type: "answer_general", message: lastUserMsg.text },
          orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, preSearchRoute.reason),
          provider,
          form,
          messages,
          prevState: generalChatState,
          filters,
          narrowingHistory,
          currentInput,
          candidates: [],
          evidenceMap: new Map(),
          turnCount,
        })
      }
    }
  }

  // ── V2 Orchestrator Integration ──
  // V2 handles routing decisions (LLM-based), then delegates execution to legacy engines.
  // On error, automatically falls back to legacy path.
  const currentPhase = prevState?.currentMode ?? "intake"
  perf.startStep("v2_orchestrator")
  if (shouldUseV2ForPhase(currentPhase) && lastUserMsg && !shouldResolvePendingSelectionEarly && !explicitComparisonAction && !explicitRevisionResolution && !explicitFilterResolution && !explicitRefineAction) {
    try {
      const { orchestrateTurnV2 } = await import("@/lib/recommendation/core/turn-orchestrator")
      const { convertToV2State, convertFromV2State } = await import("@/lib/recommendation/core/state-adapter")

      // ── Narrowing 단계 → 항상 레거시 사용 ──
      // V2는 필터 적용 + 재검색을 하지 못하므로, 축소 질문 응답 단계에서는
      // 반드시 레거시 경로를 사용해야 필터가 정확히 걸린다.
      // V2는 side question, 회사 질문, 제품 설명 등 비검색 턴에서만 사용.
      const isNarrowingPhase = prevState?.currentMode === "question" || prevState?.currentMode === "narrowing"
      const hasPendingField = !!prevState?.lastAskedField
      if (isNarrowingPhase && hasPendingField) {
        console.log(`[runtime:v2] Narrowing phase with pending field "${prevState!.lastAskedField}" → delegating to legacy for filter+search`)
        perf.endStep("v2_orchestrator")
        throw new Error("DELEGATE_TO_LEGACY")
      }

      const v2State = convertToV2State(prevState)

      // Extract recent conversation turns for V2 single-call context
      const v2RecentTurns = messages.slice(-6).map(m => ({
        role: (m.role === "ai" ? "assistant" : m.role) as "user" | "assistant",
        text: m.text,
      })).filter(t => t.role === "user" || t.role === "assistant")

      const result = await orchestrateTurnV2(lastUserMsg.text, v2State, provider, v2RecentTurns)
      const v2Action = result.trace.action
      console.log(`[runtime:v2] Orchestrator decision: action=${v2Action}, phase=${result.trace.phase}, confidence=${result.trace.confidence}`)

      // ── Enrich debug trace with V2 orchestrator details ──
      trace.add("v2-orchestrator", "router", {
        userMessage: lastUserMsg.text.slice(0, 100),
        prevPhase: currentPhase,
        prevFilters: prevState?.appliedFilters?.length ?? 0,
        prevCandidates: prevState?.candidateCount ?? 0,
      }, {
        action: v2Action,
        phase: result.trace.phase,
        confidence: result.trace.confidence,
        searchExecuted: result.trace.searchExecuted,
        validated: result.trace.validated,
        answerLength: result.answer.length,
        chipsCount: result.chips.length,
        chips: result.chips,
      }, `V2 single-call: ${v2Action} (${(result.trace.confidence * 100).toFixed(0)}% confidence)`)

      trace.setRouteDecision({
        chosen: `v2:${v2Action}`,
        reason: `V2 orchestrator decided: ${v2Action}`,
        alternatives: [{ name: "legacy_fallback", rejectedReason: "V2 succeeded" }],
      })

      trace.setReasoning({
        oneLiner: `V2: ${v2Action} → ${result.trace.phase} (${result.chips.length} chips)`,
        bullets: [
          `Action: ${v2Action}`,
          `Phase: ${result.trace.phase}`,
          `Confidence: ${(result.trace.confidence * 100).toFixed(0)}%`,
          `Search: ${result.trace.searchExecuted ? "executed" : "skipped"}`,
          `Answer: ${result.answer.slice(0, 80)}...`,
          `Chips: [${result.chips.join(", ")}]`,
        ],
      })

      if (prevState) {
        trace.setSessionState({
          sessionId: prevState.sessionId ?? "",
          candidateCount: prevState.candidateCount ?? 0,
          resolutionStatus: prevState.resolutionStatus ?? null,
          currentMode: prevState.currentMode ?? null,
          lastAskedField: prevState.lastAskedField ?? null,
          lastAction: prevState.lastAction ?? null,
          turnCount: prevState.turnCount ?? 0,
          appliedFilters: (prevState.appliedFilters ?? []).map(f => ({ field: f.field, value: f.value, op: f.op })),
          displayedChips: prevState.displayedChips ?? [],
          displayedOptionsCount: prevState.displayedOptions?.length ?? 0,
          displayedCandidateCount: prevState.displayedCandidates?.length ?? 0,
          hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
          hasComparison: prevState.currentMode === "comparison",
          pendingAction: prevState.pendingAction ? { label: prevState.pendingAction.label, type: prevState.pendingAction.type } : null,
        })
      }

      // Convert V2 result → legacy session state (preserving existing state data)
      const legacyState = convertFromV2State(result.sessionState, prevState)
      const v2ResolvedInput = rebuildResolvedInputFromFilters(form, legacyState.appliedFilters ?? [], deps)
      legacyState.displayedChips = result.chips
      legacyState.displayedOptions = result.displayedOptions
      legacyState.turnCount = result.sessionState.turnCount
      legacyState.currentMode = result.sessionState.journeyPhase === "results_displayed" ? "recommendation"
        : result.sessionState.journeyPhase === "comparison" ? "comparison"
        : "question"
      legacyState.lastAskedField = result.sessionState.pendingQuestion?.field ?? prevState?.lastAskedField ?? undefined
      legacyState.candidateCount = result.sessionState.resultContext?.totalConsidered ?? prevState?.candidateCount ?? legacyState.candidateCount
      legacyState.displayedCandidates = prevState?.displayedCandidates ?? legacyState.displayedCandidates
      legacyState.filterValueScope = prevState?.filterValueScope
      legacyState.resolvedInput = v2ResolvedInput
      legacyState.narrowingHistory = prevState?.narrowingHistory ?? legacyState.narrowingHistory
      legacyState.stageHistory = prevState?.stageHistory ?? legacyState.stageHistory

      // Build response matching existing API format
      const isResultPhase = result.sessionState.journeyPhase === "results_displayed" || result.sessionState.journeyPhase === "post_result_exploration"
      if (result.searchPayload) {
        const totalCandidateCount = result.searchPayload.totalConsidered
        const displayPage = sliceCandidatesForPage(
          result.searchPayload.candidates,
          result.searchPayload.evidenceMap,
          resolvedPagination
        )

        // V2 검색 결과가 이전 필터된 수보다 많으면 필터 손실 의심 → 이전 값 유지
        const prevCount = prevState?.candidateCount ?? 0
        if (prevCount > 0 && totalCandidateCount > prevCount * 1.5 && (prevState?.appliedFilters?.length ?? 0) > 0) {
          console.warn(`[runtime:v2:guard] V2 search returned ${totalCandidateCount} but prevState had ${prevCount} with ${prevState!.appliedFilters.length} filters → keeping prev candidateCount`)
          legacyState.candidateCount = prevCount
          legacyState.displayedCandidates = prevState?.displayedCandidates ?? legacyState.displayedCandidates
        } else {
          legacyState.candidateCount = totalCandidateCount
          legacyState.displayedCandidates = deps.buildCandidateSnapshot(displayPage.candidates, displayPage.evidenceMap)
        }
        legacyState.filterValueScope = buildFilterValueScope(result.searchPayload.candidates as unknown as Array<Record<string, unknown>>)

        perf.endStep("v2_orchestrator")
        perf.recordLlmCall()
        perf.finish()

        if (isResultPhase) {
          return deps.buildRecommendationResponse(
            form,
            result.searchPayload.candidates,
            result.searchPayload.evidenceMap,
            totalCandidateCount,
            paginationDto(totalCandidateCount),
            displayPage.candidates,
            displayPage.evidenceMap,
            v2ResolvedInput,
            legacyState.narrowingHistory ?? [],
            legacyState.appliedFilters ?? [],
            legacyState.turnCount,
            messages,
            provider,
            language,
          )
        }

        return deps.buildQuestionResponse(
          form,
          result.searchPayload.candidates,
          result.searchPayload.evidenceMap,
          totalCandidateCount,
          paginationDto(totalCandidateCount),
          displayPage.candidates,
          displayPage.evidenceMap,
          v2ResolvedInput,
          legacyState.narrowingHistory ?? [],
          legacyState.appliedFilters ?? [],
          legacyState.turnCount,
          messages,
          provider,
          language,
        )
      }

      perf.endStep("v2_orchestrator")
      perf.recordLlmCall() // V2 orchestrator does 1 LLM call
      const bridgeAction = buildV2BridgeAction(result, prevState)
      if (bridgeAction) {
        bridgedV2Action = bridgeAction
        bridgedV2OrchestratorResult = buildV2BridgeOrchestratorResult(bridgeAction, result)
        currentInput = v2ResolvedInput
        turnCount = legacyState.turnCount
        filters.splice(0, filters.length, ...(legacyState.appliedFilters ?? []))
        console.log(`[runtime:v2-bridge] ${v2Action} -> legacy ${bridgeAction.type}`)
      } else {
        perf.finish()
        return deps.jsonRecommendationResponse({
          text: result.answer,
          purpose: isResultPhase ? "recommendation" : "question",
          chips: result.chips,
          isComplete: isResultPhase,
          recommendation: null,
          sessionState: legacyState,
          evidenceSummaries: null,
          candidateSnapshot: legacyState.displayedCandidates ?? prevState?.displayedCandidates ?? null,
          pagination: legacyState.candidateCount > 0 ? paginationDto(legacyState.candidateCount) : null,
          requestPreparation: requestPrep,
          primaryExplanation: null,
          primaryFactChecked: null,
          altExplanations: [],
          altFactChecked: [],
          meta: {
            orchestratorResult: {
              action: `v2:${v2Action}`,
              agents: [],
              opus: false,
              v2Trace: result.trace,
            },
          },
        })
      }
    } catch (err) {
      perf.endStep("v2_orchestrator")
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg === "DELEGATE_TO_LEGACY") {
        // Intentional delegation — pending field answer needs legacy filter+search
        console.log(`[runtime:v2] Delegated to legacy path for filter application`)
      } else {
        // V2 error → automatic legacy fallback (zero user impact)
        console.error(`[runtime:v2] Error (falling back to legacy): ${errMsg}`, {
          phase: currentPhase,
          userMessage: lastUserMsg.text.slice(0, 50),
        })
      }
      // Fall through to legacy path below
    }
  }

  let earlyAction: string | null =
    pendingSelectionAction?.type
    ?? explicitComparisonAction?.type
    ?? explicitRevisionAction?.type
    ?? explicitFilterAction?.type
    ?? explicitRefineAction?.type
    ?? bridgedV2Action?.type
    ?? null
  if (!earlyAction && pendingSelectionFilter) {
    // Post-result phase: don't force narrowing for non-selection messages
    if (isPostResultPhase(journeyPhase)) {
      earlyAction = null // let orchestrator decide
      console.log(`[runtime:journey] Post-result phase (${journeyPhase}), skip forced narrowing for pendingSelectionFilter`)
    } else {
      earlyAction = pendingSelectionFilter.op === "skip" ? "skip_field" : "continue_narrowing"
    }
  } else if (!earlyAction && messages.length > 0 && prevState && lastUserMsg) {
    const earlyUnifiedTurnContext = buildUnifiedTurnContext({
      latestAssistantText: [...messages].reverse().find(message => message.role === "ai")?.text ?? null,
      latestUserMessage: lastUserMsg.text,
      messages,
      sessionState: prevState,
      resolvedInput,
      intakeForm: form,
      candidates: prevState.displayedCandidates ?? [],
    })
    const earlyTurnContext = {
      userMessage: lastUserMsg.text,
      intakeForm: form,
      sessionState: prevState,
      resolvedInput,
      candidateCount: prevState.candidateCount ?? 0,
      displayedProducts: prevState.displayedCandidates ?? [],
      currentCandidates: [],
      unifiedTurnContext: earlyUnifiedTurnContext,
    }
    const earlyResult = ENABLE_TOOL_USE_ROUTING
      ? await orchestrateTurnWithTools(earlyTurnContext, provider)
      : await orchestrateTurn(earlyTurnContext, provider)
    earlyAction = earlyResult.action.type
  }

  const needsRetrieval = !earlyAction || !SKIP_RETRIEVAL_ACTIONS.has(earlyAction)
  let candidates: ScoredProduct[]
  let evidenceMap: Map<string, EvidenceSummary>
  let displayCandidates: ScoredProduct[]
  let displayEvidenceMap: Map<string, EvidenceSummary>
  let totalCandidateCount = prevState?.candidateCount ?? 0
  if (needsRetrieval) {
    const hybridResult = await runHybridRetrieval(resolvedInput, filters, 0, null)
    candidates = hybridResult.candidates
    evidenceMap = hybridResult.evidenceMap
    totalCandidateCount = hybridResult.totalConsidered
    const displayPage = sliceCandidatesForPage(candidates, evidenceMap, resolvedPagination)
    displayCandidates = displayPage.candidates
    displayEvidenceMap = displayPage.evidenceMap
    console.log(`[recommend] Retrieval executed: display=${displayCandidates.length} total=${totalCandidateCount} candidates`)
  } else {
    candidates = []
    evidenceMap = new Map()
    displayCandidates = []
    displayEvidenceMap = new Map()
    console.log(`[recommend] Retrieval SKIPPED for action: ${earlyAction}`)
  }

  trace.add("search", "search", {
    needsRetrieval,
    earlyAction,
    filterCount: filters.length,
  }, {
    candidateCount: candidates.length,
    skipped: !needsRetrieval,
  }, needsRetrieval ? `Retrieved ${displayCandidates.length}/${totalCandidateCount} display candidates` : `Skipped retrieval for ${earlyAction}`)

  trace.setSearchDetail({
    requiresSearch: needsRetrieval,
    searchScope: earlyAction ?? "full_retrieval",
    targetEntities: [],
    preFilterCount: totalCandidateCount,
    postFilterCount: totalCandidateCount,
    appliedConstraints: filters.filter(f => f.op !== "skip").map(f => ({ field: f.field, value: f.value })),
    skippedReason: !needsRetrieval ? `Action "${earlyAction}" does not require retrieval` : undefined,
  })

  if (requestPrep.route.action === "reset_session") {
    return handleResetSession({ deps, requestPrep })
  }

  // ── Journey phase trace ──
  trace.add("journey-phase", "context", {
    journeyPhase,
    pendingFieldActive: !!prevState?.lastAskedField,
    pendingFieldSuppressedByPhase: isPostResultPhase(journeyPhase) && !!prevState?.lastAskedField,
    resultsSurfaceDetected: (prevState?.resolutionStatus?.startsWith("resolved") ?? false) || ((prevState?.displayedCandidates?.length ?? 0) > 0 && prevState?.currentMode === "recommendation"),
  }, {}, `Phase: ${journeyPhase}`)

  // ── Deep debug: session state + memory (ALWAYS, before any dispatch) ──
  if (prevState) {
    trace.setSessionState({
      sessionId: prevState.sessionId ?? "unknown",
      candidateCount: prevState.candidateCount ?? 0,
      resolutionStatus: prevState.resolutionStatus ?? null,
      currentMode: prevState.currentMode ?? null,
      lastAskedField: prevState.lastAskedField ?? null,
      lastAction: prevState.lastAction ?? null,
      turnCount: prevState.turnCount ?? 0,
      appliedFilters: (prevState.appliedFilters ?? []).map(f => ({ field: f.field, value: f.value, op: f.op })),
      displayedChips: prevState.displayedChips ?? [],
      displayedOptionsCount: prevState.displayedOptions?.length ?? 0,
      displayedCandidateCount: prevState.displayedCandidates?.length ?? 0,
      hasRecommendation: !!prevState.lastRecommendationArtifact,
      hasComparison: !!prevState.lastComparisonArtifact,
      pendingAction: prevState.pendingAction ? { label: prevState.pendingAction.label, type: prevState.pendingAction.type } : null,
    })

    if (prevState.conversationMemory) {
      const mem = prevState.conversationMemory
      trace.setMemory({
        resolvedFacts: mem.items.filter(i => i.status === "resolved").map(i => ({ field: i.field, value: i.value, source: i.source })),
        activeFilters: (prevState.appliedFilters ?? []).filter(f => f.op !== "skip").map(f => ({ field: f.field, value: f.value, op: f.op })),
        tentativeReferences: mem.items.filter(i => i.status === "tentative").map(i => ({ field: i.field, value: i.value })),
        pendingQuestions: prevState.lastAskedField ? [{ field: prevState.lastAskedField, kind: prevState.currentMode ?? "narrowing" }] : [],
        pendingAction: prevState.pendingAction ? { label: prevState.pendingAction.label, type: prevState.pendingAction.type } : null,
        recentQACount: mem.recentQA?.length ?? 0,
        highlightCount: mem.highlights?.length ?? 0,
        userSignals: { confusedFields: mem.userSignals.confusedFields, skippedFields: mem.userSignals.skippedFields, prefersDelegate: mem.userSignals.prefersDelegate, frustrationCount: mem.userSignals.frustrationCount },
      })
    } else {
      trace.setMemory({
        resolvedFacts: [],
        activeFilters: (prevState.appliedFilters ?? []).filter(f => f.op !== "skip").map(f => ({ field: f.field, value: f.value, op: f.op })),
        tentativeReferences: [],
        pendingQuestions: prevState.lastAskedField ? [{ field: prevState.lastAskedField, kind: prevState.currentMode ?? "narrowing" }] : [],
        pendingAction: prevState.pendingAction ? { label: prevState.pendingAction.label, type: prevState.pendingAction.type } : null,
        recentQACount: 0, highlightCount: 0, userSignals: {},
      })
    }

    // UI artifacts
    trace.setUIArtifacts({
      artifacts: [
        ...(prevState.resolutionStatus?.startsWith("resolved") && prevState.displayedCandidates?.length
          ? [{ kind: "recommendation_card", summary: `추천 ${prevState.displayedCandidates.length}개`, productCodes: prevState.displayedCandidates.slice(0, 5).map(c => c.displayCode), isPrimaryFocus: prevState.currentMode === "recommendation" }]
          : []),
        ...(prevState.lastComparisonArtifact
          ? [{ kind: "comparison_table", summary: `비교 ${prevState.lastComparisonArtifact.comparedProductCodes?.length ?? 0}개`, productCodes: prevState.lastComparisonArtifact.comparedProductCodes ?? [], isPrimaryFocus: prevState.currentMode === "comparison" }]
          : []),
        ...(prevState.displayedChips?.length
          ? [{ kind: "chips_bar", summary: `칩 ${prevState.displayedChips.length}개`, productCodes: [], isPrimaryFocus: prevState.currentMode === "question" }]
          : []),
      ],
      likelyReferencedBlock: prevState.currentMode === "recommendation" ? "recommendation_card"
        : prevState.currentMode === "comparison" ? "comparison_table"
        : prevState.currentMode === "question" ? "question_prompt" : null,
    })

    // Recent conversation
    trace.setRecentTurns(messages.slice(-10).map(m => ({ role: m.role, text: m.text.slice(0, 150) })))
  }

  if (messages.length > 0 && prevState && lastUserMsg) {
    // ── PendingAction Lifecycle: check → execute/expire/override → clear ──
    if (prevState.pendingAction) {
      const pendingCheck = shouldExecutePendingAction(
        prevState.pendingAction,
        lastUserMsg.text,
        turnCount,
        prevState.displayedChips ?? []
      )
      console.log(`[pending-action] ${pendingCheck.reason} for "${lastUserMsg.text.slice(0, 20)}"`)

      trace.add("pending-action-check", "router", {
        userMessage: lastUserMsg.text,
        pendingAction: prevState.pendingAction.label,
        pendingType: prevState.pendingAction.type,
        createdAt: prevState.pendingAction.createdAt,
      }, {
        execute: pendingCheck.execute,
        reason: pendingCheck.reason,
      }, `Pending action "${prevState.pendingAction.label}": ${pendingCheck.reason}`)

      if (pendingCheck.execute && prevState.pendingAction.type === "apply_filter") {
        const filter = pendingActionToFilter(prevState.pendingAction)
        if (filter) {
          filter.appliedAt = prevState.turnCount ?? 0
          const acceptedLabel = prevState.pendingAction.label
          console.log(`[pending-action] Executed: ${acceptedLabel}`)

          // Clear after execution
          prevState.pendingAction = null

          const testInput = deps.applyFilterToInput(currentInput, filter)
          const testFilters = [...filters, filter]
          const testResult = await runHybridRetrieval(testInput, testFilters, 0, null)
          const testDisplayPage = sliceCandidatesForPage(testResult.candidates, testResult.evidenceMap, resolvedPagination)

          if (testResult.totalConsidered === 0) {
            const excludeRawVal = String(filter.rawValue ?? filter.value).replace(/\s*\(\d+개\)\s*$/, "")
            const excludeVals = filter.field === "workPieceName" ? [excludeRawVal] : undefined
            return deps.buildQuestionResponse(
              form, candidates, evidenceMap, totalCandidateCount, paginationDto(totalCandidateCount), displayCandidates, displayEvidenceMap, currentInput,
              narrowingHistory, filters, turnCount, messages, provider, language,
              `"${excludeRawVal}" 조건을 적용하면 후보가 없습니다. 현재 ${totalCandidateCount}개 후보에서 다른 조건을 선택해주세요.`,
              undefined, // existingStageHistory
              excludeVals
            )
          }

          filters.push(filter)
          currentInput = testInput
          narrowingHistory.push({
            question: "pending-action-accept",
            answer: lastUserMsg.text,
            extractedFilters: [filter],
            candidateCountBefore: totalCandidateCount,
            candidateCountAfter: testResult.totalConsidered,
          })
          turnCount++

          const newStatus = checkResolution(testResult.candidates, narrowingHistory, testResult.totalConsidered)
          if (newStatus.startsWith("resolved")) {
            return deps.buildRecommendationResponse(form, testResult.candidates, testResult.evidenceMap, testResult.totalConsidered, paginationDto(testResult.totalConsidered), testDisplayPage.candidates, testDisplayPage.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language, displayedProducts)
          }
          return deps.buildQuestionResponse(form, testResult.candidates, testResult.evidenceMap, testResult.totalConsidered, paginationDto(testResult.totalConsidered), testDisplayPage.candidates, testDisplayPage.evidenceMap, currentInput, narrowingHistory, filters, turnCount, messages, provider, language)
        }
      }

      // Clear on expiration or explicit override (keep for not_affirmative — user may still respond)
      if (pendingCheck.reason === "expired" || pendingCheck.reason === "explicit_override") {
        console.log(`[pending-action] Cleared: ${pendingCheck.reason}`)
        prevState.pendingAction = null
      }
    }

    const currentCandidateSnapshot = deps.buildCandidateSnapshot(displayCandidates, displayEvidenceMap)
    const unifiedTurnContext = buildUnifiedTurnContext({
      latestAssistantText: [...messages].reverse().find(message => message.role === "ai")?.text ?? null,
      latestUserMessage: lastUserMsg.text,
      messages,
      sessionState: prevState,
      resolvedInput: currentInput,
      intakeForm: form,
      candidates: currentCandidateSnapshot,
    })
    const turnContext = {
      userMessage: lastUserMsg.text,
      intakeForm: form,
      sessionState: prevState,
      resolvedInput: currentInput,
      candidateCount: candidates.length,
      displayedProducts: currentCandidateSnapshot,
      currentCandidates: candidates,
      unifiedTurnContext,
    }

    const orchResult = pendingSelectionOrchestratorResult ?? explicitComparisonOrchestratorResult ?? explicitRevisionOrchestratorResult ?? explicitFilterOrchestratorResult ?? explicitRefineOrchestratorResult ?? bridgedV2OrchestratorResult ?? (
      ENABLE_TOOL_USE_ROUTING
        ? await orchestrateTurnWithTools(turnContext, provider)
        : await orchestrateTurn(turnContext, provider)
    )
    let action = pendingSelectionAction ?? explicitComparisonAction ?? explicitRevisionAction ?? explicitFilterAction ?? explicitRefineAction ?? bridgedV2Action ?? orchResult.action
    const usingBridgedAction = !!pendingSelectionAction || !!explicitComparisonAction || !!explicitRevisionAction || !!explicitFilterAction || !!explicitRefineAction || !!bridgedV2Action

    trace.add("orchestrator", "router", {
      userMessage: lastUserMsg.text,
      mode: prevState.currentMode,
      lastAskedField: prevState.lastAskedField,
      candidateCount: candidates.length,
      filterCount: filters.length,
      resolutionStatus: prevState.resolutionStatus,
    }, {
      action: action.type,
      agents: orchResult.agentsInvoked,
      escalatedToOpus: orchResult.escalatedToOpus,
    }, orchResult.reasoning)

    // Processing path: orchestrator decision
    trace.addProcessingStep({
      label: usingBridgedAction ? `사전결정 → ${action.type}` : `오케스트레이터 → ${action.type}`,
      status: "success",
      detail: orchResult.reasoning?.slice(0, 100),
    })

    const hasPendingQuestion = !!prevState.lastAskedField
      && !prevState.resolutionStatus?.startsWith("resolved")
      && !isPostResultPhase(journeyPhase)
    if (hasPendingQuestion && !usingBridgedAction) {
      const userState = detectUserState(lastUserMsg.text, prevState.lastAskedField)
      const isQuestionAssistSignal =
        userState.state === "confused"
        || userState.state === "wants_explanation"
        || userState.state === "wants_delegation"
        || userState.state === "wants_skip"

      // ── Query Target Override ──
      // If user is asking about a DIFFERENT entity (series/product/comparison),
      // do NOT intercept into question-assist mode.
      // Active filters are constraints, not the topic.
      const queryTarget = classifyQueryTarget(
        lastUserMsg.text,
        prevState.appliedFilters?.find(f => f.op !== "skip")?.field,
        prevState.lastAskedField
      )

      trace.add("query-target-classifier", "context", {
        userMessage: lastUserMsg.text,
        activeFilterField: prevState.appliedFilters?.find(f => f.op !== "skip")?.field,
        pendingField: prevState.lastAskedField,
      }, {
        type: queryTarget.type,
        entities: queryTarget.entities,
        overridesActiveFilter: queryTarget.overridesActiveFilter,
        answerTopic: queryTarget.answerTopic,
        searchScopeOnly: queryTarget.searchScopeOnly,
      }, queryTarget.overridesActiveFilter
        ? `User target "${queryTarget.answerTopic}" overrides pending field "${prevState.lastAskedField}"`
        : `Query about pending field "${prevState.lastAskedField}"`)

      if (queryTarget.overridesActiveFilter) {
        trace.add("question-assist-bypass", "router", {
          reason: "query target overrides active filter",
          pendingField: prevState.lastAskedField,
        }, {
          queryTarget: queryTarget.answerTopic,
          entities: queryTarget.entities,
          originalAction: action.type,
        }, `User asked about "${queryTarget.answerTopic}" — bypassing question-assist for pending "${prevState.lastAskedField}"`)
        console.log(`[query-target:override] User query target="${queryTarget.answerTopic}" overrides pending field="${prevState.lastAskedField}" (entities: ${queryTarget.entities.join(",")})`)
        // Don't intercept — let the orchestrator's original routing stand
      } else if (isQuestionAssistSignal) {
        if (userState.state === "wants_skip" || userState.state === "wants_delegation") {
          action = { type: "skip_field" }
          trace.add("question-assist-intercept", "router", { userState: userState.state, pendingField: prevState.lastAskedField }, { action: "skip_field" }, `${userState.state} → skip_field for "${prevState.lastAskedField}"`)
          console.log(`[question-assist:intercept] ${userState.state} -> skip_field for "${prevState.lastAskedField}"`)
        } else if (action.type === "answer_general" || action.type === "redirect_off_topic") {
          const originalAction = action.type
          action = { type: "explain_product", target: lastUserMsg.text }
          trace.add("question-assist-intercept", "router", { userState: userState.state, pendingField: prevState.lastAskedField, originalAction }, { action: "explain_product" }, `${userState.state} overrides ${originalAction} → explain_product (pending: ${prevState.lastAskedField})`)
          console.log(`[question-assist:intercept] ${userState.state} overrides ${originalAction} -> explain_product (pending: ${prevState.lastAskedField})`)
        }
      }
    }

    // 회사 질문이면 강제 narrowing 하지 않고 LLM이 답변할 수 있게 허용
    if (!usingBridgedAction && pendingSelectionFilter && (
      pendingSelectionFilter.op === "skip" ||
      action.type === "answer_general" ||
      action.type === "redirect_off_topic"
    )) {
      if (isPostResultPhase(journeyPhase)) {
        // Post-result: don't force narrowing, let the answer go through
        action = { type: "answer_general", message: lastUserMsg.text }
        console.log(`[runtime:journey] Post-result exploration (${journeyPhase}), skip forced narrowing → answer_general`)
      } else if (pendingSelectionFilter.op === "skip") {
        action = { type: "skip_field" }
        console.log(`[runtime:pending-selection] explicit skip -> skip_field for "${prevState.lastAskedField ?? "unknown"}"`)
      } else {
        const quickJudgment = await performUnifiedJudgment({
          userMessage: lastUserMsg.text,
          assistantText: null,
          pendingField: prevState.lastAskedField ?? null,
          currentMode: prevState.currentMode ?? null,
          displayedChips: prevState.displayedChips ?? [],
          filterCount: filters.length,
          candidateCount: candidates.length,
          hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
        }, provider)

        const toolDomainHere = isToolDomainQuestion(lastUserMsg.text)
        if (toolDomainHere) {
          // Tool domain → answer_general 유지 (company가 아닌 tool explanation으로)
          action = { type: "answer_general", message: lastUserMsg.text }
          console.log(`[runtime:judgment] Tool domain → answer_general (NOT company)`)
        } else if (quickJudgment.domainRelevance === "company_query" || quickJudgment.domainRelevance === "greeting") {
          // 회사 질문/인사 → answer_general로 유지, narrowing 강제하지 않음
          action = { type: "answer_general", message: lastUserMsg.text }
          console.log(`[runtime:judgment] company_query detected, skip forced narrowing → answer_general`)
        } else {
          action = { type: "continue_narrowing", filter: pendingSelectionFilter }
        }
      }
    }

    // ── Deep debug: route decision + reasoning summary ──
    const originalActionType = orchResult.action.type
    const wasIntercepted = action.type !== originalActionType
    trace.setRouteDecision({
      chosen: action.type,
      reason: wasIntercepted
        ? `Orchestrator chose "${originalActionType}" but intercepted to "${action.type}"`
        : `Orchestrator chose "${action.type}"`,
      alternatives: wasIntercepted
        ? [{ name: originalActionType, rejectedReason: "Intercepted by question-assist or query-target override" }]
        : [],
    })

    // Build human-readable reasoning
    const reasoningBullets: string[] = []
    if (prevState.lastAskedField) reasoningBullets.push(`Pending question: "${prevState.lastAskedField}"`)
    if (prevState.resolutionStatus?.startsWith("resolved")) reasoningBullets.push("Recommendation already shown")
    if (wasIntercepted) reasoningBullets.push(`Original action "${originalActionType}" was intercepted → "${action.type}"`)
    if (filters.length > 0) reasoningBullets.push(`${filters.length} filters active: ${filters.filter(f => f.op !== "skip").map(f => `${f.field}=${f.value}`).join(", ")}`)
    reasoningBullets.push(`${totalCandidateCount} candidates available`)

    trace.setReasoning({
      oneLiner: `${action.type} | ${prevState.currentMode ?? "initial"} | ${totalCandidateCount}개 후보${wasIntercepted ? ` (intercepted from ${originalActionType})` : ""}`,
      bullets: reasoningBullets,
    })

    if (action.type === "reset_session") {
      return handleResetSession({ deps, requestPrep })
    }

    const navCtx: NavigationHandlerContext = {
      jsonRecommendationResponse: deps.jsonRecommendationResponse,
      prevState,
      filters,
      narrowingHistory,
      currentInput,
      turnCount,
      orchResult,
      deps,
      form,
      messages,
      provider,
      language,
      displayedProducts,
      baseInput,
      candidates,
      evidenceMap,
      totalCandidateCount,
      displayCandidates,
      displayEvidenceMap,
      resolvedPagination,
      paginationDto,
      requestPrep,
      sliceCandidatesForPage,
    }

    if (action.type === "go_back_one_step" || action.type === "go_back_to_filter") {
      return handleGoBack(action, navCtx)
    }

    if (action.type === "show_recommendation") {
      return handleShowRecommendation(navCtx)
    }

    if (action.type === "filter_by_stock") {
      return handleFilterByStock(action, {
        jsonRecommendationResponse: deps.jsonRecommendationResponse,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        orchResult,
      })
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

      const refinementOptionState = buildRefinementOptionState({
        form,
        prevState,
        currentInput,
        candidates,
        filters,
        field,
        language,
        userMessage: lastUserMsg.text,
      })

      const sessionState = carryForwardState(prevState, {
        candidateCount: prevState.candidateCount ?? candidates.length,
        appliedFilters: filters,
        narrowingHistory,
        resolutionStatus: prevState.resolutionStatus ?? "broad",
        resolvedInput: currentInput,
        turnCount,
        displayedCandidates: prevState.displayedCandidates ?? [],
        displayedChips: refinementOptionState.chips,
        displayedOptions: refinementOptionState.displayedOptions,
        currentMode: "question",
        lastAction: "ask_clarification",
        lastAskedField: field,
      })

      return deps.jsonRecommendationResponse({
        text: refinementText,
        purpose: "question",
        chips: refinementOptionState.chips,
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
        meta: buildActionMeta(action.type, orchResult, trace.build({
          latestUserMessage: lastUserMsg.text,
          currentMode: prevState.currentMode ?? null,
          routeAction: action.type,
        })),
      })
    }

    if (action.type === "compare_products") {
      return handleCompareProducts(action, {
        jsonRecommendationResponse: deps.jsonRecommendationResponse,
        prevState,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        orchResult,
        deps: {
          handleDirectEntityProfileQuestion: deps.handleDirectEntityProfileQuestion,
          buildCandidateSnapshot: deps.buildCandidateSnapshot,
        },
        provider,
        candidates,
        evidenceMap,
        lastUserText: lastUserMsg.text,
        trace,
        buildActionMeta,
      })
    }

    if (action.type === "explain_product" || action.type === "answer_general") {
      // ── Deep debug: user state + option generation context ──
      const userStateForDebug = detectUserState(lastUserMsg.text, prevState.lastAskedField)
      trace.add("user-state", "context", {
        userMessage: lastUserMsg.text.slice(0, 80),
        pendingField: prevState.lastAskedField,
      }, {
        state: userStateForDebug.state,
        confidence: userStateForDebug.confidence,
        confusedAbout: userStateForDebug.confusedAbout,
        boundField: userStateForDebug.boundField,
      }, `User state: ${userStateForDebug.state}${userStateForDebug.boundField ? ` (bound to ${userStateForDebug.boundField})` : ""}`)

      trace.add("answer-generation", "answer", {
        action: action.type,
        hasLLM: true,
        preGenerated: (action as any).preGenerated ?? false,
      }, {
        mode: "general_chat",
      }, `Answer via ${action.type}`)

      // ── Side Question Suspend: snapshot current flow before answering off-topic ──
      const isSideQuestion =
        action.type === "answer_general"
        && hasPendingQuestion
        && userStateForDebug.state !== "wants_explanation"
        && userStateForDebug.state !== "confused"
        && userStateForDebug.state !== "wants_delegation"
        && userStateForDebug.state !== "wants_skip"
      if (isSideQuestion) {
        const lastAiText = [...messages].reverse().find(m => m.role === "ai")?.text ?? null
        prevState.suspendedFlow = {
          pendingField: prevState.lastAskedField ?? null,
          pendingQuestion: lastAiText,
          displayedOptionsSnapshot: prevState.displayedOptions ?? [],
          displayedChipsSnapshot: prevState.displayedChips ?? [],
          reason: "side_question",
        }
        console.log(`[side-question:suspend] Suspended flow for field="${prevState.lastAskedField}", options=${prevState.displayedOptions?.length ?? 0}, chips=${prevState.displayedChips?.length ?? 0}`)
      }

      return handleServeGeneralChatAction({
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
      })
    }

    if (action.type === "redirect_off_topic") {
      // 통합 판단의 domainRelevance가 있으면 활용, 없으면 기존 analyzeInquiry fallback
      const inquiry = analyzeInquiry(lastUserMsg.text)
      const redirect = getRedirectResponse(inquiry)
      // company_query면 answer_general로 전환
      if (redirect.text && lastUserMsg.text) {
        const quickCheck = await performUnifiedJudgment({
          userMessage: lastUserMsg.text,
          assistantText: null,
          pendingField: prevState.lastAskedField ?? null,
          currentMode: prevState.currentMode ?? null,
          displayedChips: prevState.displayedChips ?? [],
          filterCount: filters.length,
          candidateCount: candidates.length,
          hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
        }, provider)
        if (quickCheck.domainRelevance === "company_query") {
          // ── Side Question Suspend for redirect_off_topic → company_query ──
          if (hasPendingQuestion && !prevState.suspendedFlow) {
            const lastAiText = [...messages].reverse().find(m => m.role === "ai")?.text ?? null
            prevState.suspendedFlow = {
              pendingField: prevState.lastAskedField ?? null,
              pendingQuestion: lastAiText,
              displayedOptionsSnapshot: prevState.displayedOptions ?? [],
              displayedChipsSnapshot: prevState.displayedChips ?? [],
              reason: "side_question",
            }
            console.log(`[side-question:suspend:redirect] Suspended flow for field="${prevState.lastAskedField}"`)
          }
          return handleServeGeneralChatAction({ deps, action: { type: "answer_general", message: lastUserMsg.text }, orchResult, provider, form, messages, prevState, filters, narrowingHistory, currentInput, candidates, evidenceMap, turnCount })
        }
      }
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
        pagination: paginationDto(totalCandidateCount),
        requestPreparation: null,
        primaryExplanation: null,
        primaryFactChecked: null,
        altExplanations: [],
        altFactChecked: [],
      })
    }

    if (action.type === "skip_field") {
      const skipField = prevState.lastAskedField ?? "unknown"
      trace.add("skip-field", "router", { field: skipField }, { skipped: true }, `Skipping field "${skipField}"`)

      if (skipField === "material") {
        dropDependentWorkPieceFilters(filters)
      }
      const skipFilter: AppliedFilter = {
        field: skipField,
        op: "skip",
        value: "상관없음",
        rawValue: "skip",
        appliedAt: turnCount,
      }
      const replacedSkipState = replaceFieldFilter(
        baseInput,
        filters,
        skipFilter,
        deps.applyFilterToInput
      )
      filters.splice(0, filters.length, ...replacedSkipState.nextFilters)
      currentInput = replacedSkipState.nextInput

      const newResult = await runHybridRetrieval(currentInput, filters.filter(filter => filter.op !== "skip"), 0, null)
      const newDisplayPage = sliceCandidatesForPage(newResult.candidates, newResult.evidenceMap, resolvedPagination)
      
      narrowingHistory.push({
        question: "follow-up",
        answer: lastUserMsg.text,
        extractedFilters: [skipFilter],
        candidateCountBefore: totalCandidateCount,
        candidateCountAfter: newResult.totalConsidered,
      })
      turnCount += 1

      if (replacedSkipState.replacedExisting) {
        console.log(`[orchestrator:replace] ${skipField} -> skip | filters rebuilt=${filters.length}`)
      }

      const statusAfterSkip = checkResolution(newResult.candidates, narrowingHistory, newResult.totalConsidered)
      if (statusAfterSkip.startsWith("resolved")) {
        return deps.buildRecommendationResponse(
          form,
          newResult.candidates,
          newResult.evidenceMap,
          newResult.totalConsidered,
          paginationDto(newResult.totalConsidered),
          newDisplayPage.candidates,
          newDisplayPage.evidenceMap,
          currentInput,
          narrowingHistory,
          filters,
          turnCount,
          messages,
          provider,
          language,
          displayedProducts
        )
      }

      return deps.buildQuestionResponse(
        form,
        newResult.candidates,
        newResult.evidenceMap,
        newResult.totalConsidered,
        paginationDto(newResult.totalConsidered),
        newDisplayPage.candidates,
        newDisplayPage.evidenceMap,
        currentInput,
        narrowingHistory,
        filters,
        turnCount,
        messages,
        provider,
        language
      )
    }

    if (action.type === "replace_existing_filter") {
      const restoreResult = restoreToBeforeFilter(
        prevState,
        action.previousValue,
        action.targetField,
        baseInput,
        deps.applyFilterToInput
      )

      const baseFiltersForNext = [...restoreResult.remainingFilters]
      const baseStageHistoryForNext = [...restoreResult.remainingStages]
      const baseHistoryForNext = [...restoreResult.remainingHistory]
      currentInput = restoreResult.rebuiltInput

      const filterAppliedAt = restoreResult.undoTurnCount
      let candidateCountBeforeFilter = restoreResult.remainingStages.at(-1)?.candidateCount
      if (candidateCountBeforeFilter == null) {
        // No stage snapshot available (e.g. replacing the first filter) — run retrieval on restored input to get accurate "before" count
        const restoredResult = await runHybridRetrieval(restoreResult.rebuiltInput, restoreResult.remainingFilters, 0, null)
        candidateCountBeforeFilter = restoredResult.totalConsidered
        console.log(`[orchestrator:replace] No stage snapshot, retrieved candidateCountBefore=${candidateCountBeforeFilter} from restored input`)
      }

      let filter = { ...action.nextFilter, appliedAt: filterAppliedAt }
      if (filter.field === "material") {
        dropDependentWorkPieceFilters(baseFiltersForNext)
      }

      const candidateFieldVals = extractDistinctFieldValues(candidates as any[], filter.field)
      if (candidateFieldVals.length > 0 && typeof filter.rawValue === "string") {
        const { normalized, matchType } = await normalizeFilterValue(
          String(filter.rawValue),
          filter.field,
          candidateFieldVals,
          provider
        )
        if (matchType !== "none" && normalized !== String(filter.rawValue)) {
          trace.add("value-normalizer", "search", { original: String(filter.rawValue), field: filter.field }, { normalized, matchType }, `"${filter.rawValue}" → "${normalized}" (${matchType})`)
          console.log(`[value-normalizer] "${filter.rawValue}" → "${normalized}" (${matchType}) for field=${filter.field}`)
          filter.rawValue = normalized
          if (!filter.value.includes("(") && !filter.value.includes("개")) {
            filter.value = normalized
          }
        }
      }

      filter = await enrichWorkPieceFilterWithSeriesScope(filter, currentInput)

      const nextFilterState = replaceFieldFilter(
        baseInput,
        baseFiltersForNext,
        filter,
        deps.applyFilterToInput
      )
      const testInput = nextFilterState.nextInput
      const testFilters = nextFilterState.nextFilters
      const testResult = await runHybridRetrieval(testInput, testFilters, 0, null)
      const testDisplayPage = sliceCandidatesForPage(testResult.candidates, testResult.evidenceMap, resolvedPagination)

      trace.add("filter-replace", "search", {
        field: filter.field,
        previousValue: action.previousValue,
        nextValue: filter.value,
        candidatesBefore: candidateCountBeforeFilter,
      }, {
        candidatesAfter: testResult.totalConsidered,
        replaced: nextFilterState.replacedExisting,
      }, `Replace ${filter.field}: ${action.previousValue} → ${filter.value} | ${candidateCountBeforeFilter} → ${testResult.totalConsidered} candidates`)
      trace.addCandidateChange({ before: candidateCountBeforeFilter ?? 0, after: testResult.totalConsidered, filterApplied: `${filter.field}: ${action.previousValue} → ${filter.value}` })
      trace.addProcessingStep({
        label: `필터 교체: ${filter.field}`,
        status: testResult.totalConsidered === 0 ? "fail" : "success",
        detail: `${candidateCountBeforeFilter} → ${testResult.totalConsidered}개`,
        error: testResult.totalConsidered === 0 ? "후보 0개 — 차단됨" : undefined,
      })

      const updatedHistory = [...baseHistoryForNext, {
        question: baseHistoryForNext.length > 0 ? "follow-up" : "initial",
        answer: lastUserMsg.text,
        extractedFilters: [filter],
        candidateCountBefore: candidateCountBeforeFilter,
        candidateCountAfter: testResult.totalConsidered,
      }]
      const updatedStages = [...baseStageHistoryForNext, {
        stepIndex: filterAppliedAt,
        stageName: `${filter.field}_${filter.value}`,
        filterApplied: filter,
        candidateCount: testResult.totalConsidered,
        resolvedInputSnapshot: { ...testInput },
        filtersSnapshot: [...testFilters],
      }]

      console.log(
        `[orchestrator:replace] ${action.targetField} ${action.previousValue} -> ${filter.value} | ${candidateCountBeforeFilter}->${testResult.totalConsidered} candidates`
      )

      if (testResult.totalConsidered === 0) {
        return deps.buildRecommendationResponse(
          form,
          testResult.candidates,
          testResult.evidenceMap,
          testResult.totalConsidered,
          paginationDto(testResult.totalConsidered),
          testDisplayPage.candidates,
          testDisplayPage.evidenceMap,
          testInput,
          updatedHistory,
          testFilters,
          filterAppliedAt + 1,
          messages,
          provider,
          language,
          []
        )
      }

      filters.splice(0, filters.length, ...testFilters)
      currentInput = testInput
      narrowingHistory.splice(0, narrowingHistory.length, ...updatedHistory)

      turnCount = filterAppliedAt + 1
      const newStatus = checkResolution(testResult.candidates, narrowingHistory, testResult.totalConsidered)
      if (newStatus.startsWith("resolved")) {
        return deps.buildRecommendationResponse(
          form,
          testResult.candidates,
          testResult.evidenceMap,
          testResult.totalConsidered,
          paginationDto(testResult.totalConsidered),
          testDisplayPage.candidates,
          testDisplayPage.evidenceMap,
          currentInput,
          narrowingHistory,
          filters,
          turnCount,
          messages,
          provider,
          language,
          displayedProducts
        )
      }

      const replayPendingField = prevState?.lastAskedField ?? undefined
      const shouldReplayPendingField = replayPendingField && replayPendingField !== action.targetField
      const revisionResponsePrefix = `알겠습니다. ${action.previousValue} 대신 ${filter.value}로 변경했습니다.`

      return deps.buildQuestionResponse(
        form,
        testResult.candidates,
        testResult.evidenceMap,
        testResult.totalConsidered,
        paginationDto(testResult.totalConsidered),
        testDisplayPage.candidates,
        testDisplayPage.evidenceMap,
        currentInput,
        narrowingHistory,
        filters,
        turnCount,
        messages,
        provider,
        language,
        undefined,
        updatedStages,
        undefined,
        shouldReplayPendingField ? replayPendingField : undefined,
        revisionResponsePrefix
      )
    }

    if (action.type === "continue_narrowing") {
      let filterAppliedAt = turnCount
      let baseFiltersForNext = filters
      let baseStageHistoryForNext = prevState.stageHistory ?? []
      let baseHistoryForNext = narrowingHistory
      let candidateCountBeforeFilter = totalCandidateCount

      let filter = { ...action.filter, appliedAt: filterAppliedAt }
      if (filter.field === "material") {
        dropDependentWorkPieceFilters(baseFiltersForNext)
      }

      // ── Value Normalizer: match user input to actual DB values ──
      // Tier 1-2: exact/fuzzy (instant), Tier 3: Haiku LLM translation (~200ms)
      let candidateFieldVals = extractDistinctFieldValues(candidates as any[], filter.field)

      // workPieceName은 제품 필드가 아니므로 brand_reference에서 후보값을 가져옴
      if (candidateFieldVals.length === 0 && filter.field === "workPieceName") {
        const isoGroup = resolveSingleIsoGroup(currentInput.material)
        if (isoGroup) {
          candidateFieldVals = await getSessionCache().getOrFetch(
            `workPieceNames:${isoGroup}`,
            () => BrandReferenceRepo.listDistinctWorkPieceNames({ isoGroup, limit: 30 })
          )
          console.log(`[value-normalizer:workPiece] Loaded ${candidateFieldVals.length} workPiece names from brand_reference for ISO ${isoGroup}`)
        }
      }
      if (candidateFieldVals.length > 0 && typeof filter.rawValue === "string") {
        const { normalized, matchType } = await normalizeFilterValue(
          String(filter.rawValue),
          filter.field,
          candidateFieldVals,
          provider
        )
        if (matchType !== "none" && normalized !== String(filter.rawValue)) {
          trace.add("value-normalizer", "search", { original: String(filter.rawValue), field: filter.field }, { normalized, matchType }, `"${filter.rawValue}" → "${normalized}" (${matchType})`)
          console.log(`[value-normalizer] "${filter.rawValue}" → "${normalized}" (${matchType}) for field=${filter.field}`)
          filter.rawValue = normalized
          if (!filter.value.includes("(") && !filter.value.includes("개")) {
            filter.value = normalized
          }
        }
      }

      filter = await enrichWorkPieceFilterWithSeriesScope(filter, currentInput)

      const nextFilterState = replaceFieldFilter(
        baseInput,
        baseFiltersForNext,
        filter,
        deps.applyFilterToInput
      )
      const testInput = nextFilterState.nextInput
      const testFilters = nextFilterState.nextFilters
      const testResult = await runHybridRetrieval(testInput, testFilters, 0, null)
      const testDisplayPage = sliceCandidatesForPage(testResult.candidates, testResult.evidenceMap, resolvedPagination)

      trace.add("filter-apply", "search", {
        field: filter.field,
        value: filter.value,
        op: filter.op,
        candidatesBefore: candidateCountBeforeFilter,
      }, {
        candidatesAfter: testResult.totalConsidered,
        blocked: testResult.totalConsidered === 0,
        replaced: nextFilterState.replacedExisting,
      }, `Filter ${filter.field}=${filter.value}: ${candidateCountBeforeFilter} → ${testResult.totalConsidered} candidates${testResult.totalConsidered === 0 ? " (BLOCKED)" : ""}`)
      trace.addCandidateChange({ before: candidateCountBeforeFilter, after: testResult.totalConsidered, filterApplied: `${filter.field}=${filter.value}` })
      trace.addProcessingStep({
        label: `필터 적용: ${filter.field}=${filter.value}`,
        status: testResult.totalConsidered === 0 ? "fail" : "success",
        detail: `${candidateCountBeforeFilter} → ${testResult.totalConsidered}개`,
        error: testResult.totalConsidered === 0 ? "후보 0개 — 차단됨" : undefined,
      })

      if (testResult.totalConsidered === 0) {
        console.log(`[orchestrator:guard] Filter ${filter.field}=${filter.value} would result in 0 candidates -> BLOCKED, excluding from chips`)
        // 실패값을 buildQuestionResponse에 전달 → workPiece 칩에서 제외
        const excludeRawValue = String(filter.rawValue ?? filter.value).replace(/\s*\(\d+개\)\s*$/, "")
        const excludeValues = filter.field === "workPieceName" ? [excludeRawValue] : undefined
        return deps.buildQuestionResponse(
          form,
          candidates,
          evidenceMap,
          totalCandidateCount,
          paginationDto(totalCandidateCount),
          displayCandidates,
          displayEvidenceMap,
          currentInput,
          narrowingHistory,
          filters,
          turnCount,
          messages,
          provider,
          language,
          `"${excludeRawValue}" 조건을 적용하면 후보가 없습니다. 현재 ${totalCandidateCount}개 후보에서 다른 조건을 선택해주세요.`,
          undefined, // existingStageHistory
          excludeValues
        )
      }

      filters.splice(0, filters.length, ...testFilters)
      currentInput = testInput
      const newCandidates = testResult.candidates
      const previousCandidateCount = candidateCountBeforeFilter

      const updatedHistory = [...baseHistoryForNext, {
        question: baseHistoryForNext.length > 0 ? "follow-up" : "initial",
        answer: lastUserMsg.text,
        extractedFilters: [filter],
        candidateCountBefore: previousCandidateCount,
        candidateCountAfter: testResult.totalConsidered,
      }]
      narrowingHistory.splice(0, narrowingHistory.length, ...updatedHistory)

      const existingStages = baseStageHistoryForNext
      const newStage: NarrowingStage = {
        stepIndex: filterAppliedAt,
        stageName: `${filter.field}_${filter.value}`,
        filterApplied: filter,
        candidateCount: testResult.totalConsidered,
        resolvedInputSnapshot: { ...currentInput },
        filtersSnapshot: [...filters],
      }
      // Cap stageHistory to last 10 stages to prevent session state bloat in long conversations
      // (each stage has full resolvedInputSnapshot + filtersSnapshot)
      const MAX_STAGE_HISTORY = 10
      const updatedStages = [...existingStages, newStage].slice(-MAX_STAGE_HISTORY)

      console.log(
        `[orchestrator:filter] ${filter.field}=${filter.value} | ${previousCandidateCount}->${testResult.totalConsidered} candidates | stages: ${updatedStages.map(stage => stage.stageName).join(" -> ")}`
      )
      if (nextFilterState.replacedExisting) {
        console.log(`[orchestrator:replace] ${filter.field} updated to ${filter.value}`)
      }

      turnCount = filterAppliedAt + 1

      // ── Multi-filter: extract and apply additional NL filters from same message ──
      // e.g. "Radius로 해주세요 소재는 알루미늄입니다" → primary filter=Radius, additional=알루미늄
      let finalCandidates = newCandidates
      let finalEvidenceMap = testResult.evidenceMap
      let finalTotalConsidered = testResult.totalConsidered
      let finalDisplayPage = testDisplayPage
      const additionalNLFilters = llmExtraFilters
      for (const addFilter of additionalNLFilters) {
        const enrichedAdd = await enrichWorkPieceFilterWithSeriesScope(
          { ...addFilter, appliedAt: turnCount - 1 },
          currentInput
        )
        const addState = replaceFieldFilter(baseInput, filters, enrichedAdd, deps.applyFilterToInput)
        const addResult = await runHybridRetrieval(addState.nextInput, addState.nextFilters, 0, null)
        if (addResult.totalConsidered > 0) {
          filters.splice(0, filters.length, ...addState.nextFilters)
          currentInput = addState.nextInput
          finalCandidates = addResult.candidates
          finalEvidenceMap = addResult.evidenceMap
          finalTotalConsidered = addResult.totalConsidered
          finalDisplayPage = sliceCandidatesForPage(finalCandidates, finalEvidenceMap, resolvedPagination)
          narrowingHistory[narrowingHistory.length - 1].extractedFilters.push(enrichedAdd)
          narrowingHistory[narrowingHistory.length - 1].candidateCountAfter = finalTotalConsidered
          console.log(`[multi-filter] Applied ${enrichedAdd.field}=${enrichedAdd.value} → ${finalTotalConsidered} candidates`)
        } else {
          console.log(`[multi-filter] Skipped ${enrichedAdd.field}=${enrichedAdd.value}: would result in 0 candidates`)
        }
      }

      const newStatus = checkResolution(finalCandidates, narrowingHistory, finalTotalConsidered)
      if (newStatus.startsWith("resolved")) {
        return deps.buildRecommendationResponse(
          form,
          finalCandidates,
          finalEvidenceMap,
          finalTotalConsidered,
          paginationDto(finalTotalConsidered),
          finalDisplayPage.candidates,
          finalDisplayPage.evidenceMap,
          currentInput,
          narrowingHistory,
          filters,
          turnCount,
          messages,
          provider,
          language,
          displayedProducts
        )
      }

      return deps.buildQuestionResponse(
        form,
        finalCandidates,
        finalEvidenceMap,
        finalTotalConsidered,
        paginationDto(finalTotalConsidered),
        finalDisplayPage.candidates,
        finalDisplayPage.evidenceMap,
        currentInput,
        narrowingHistory,
        filters,
        turnCount,
        messages,
        provider,
        language,
        undefined,
        updatedStages,
        undefined
      )
    }
  }

  const status = checkResolution(candidates, narrowingHistory, totalCandidateCount)
  if (status.startsWith("resolved") && turnCount > 0) {
    return deps.buildRecommendationResponse(
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      paginationDto(totalCandidateCount),
      displayCandidates,
      displayEvidenceMap,
      currentInput,
      narrowingHistory,
      filters,
      turnCount,
      messages,
      provider,
      language,
      displayedProducts
    )
  }

  return deps.buildQuestionResponse(
    form,
    candidates,
    evidenceMap,
    totalCandidateCount,
    paginationDto(totalCandidateCount),
    displayCandidates,
    displayEvidenceMap,
    currentInput,
    narrowingHistory,
    filters,
    turnCount,
    messages,
    provider,
    language
  )
}

// ── Tool domain detection ─────────────────────────────
// tool/가공/형상/추천 질문은 company handler로 가면 안 됨
const TOOL_DOMAIN_PATTERN = /slot|milling|side.?mill|shoulder|plunge|ball.?end|taper|square|corner.?r|radius|flute|날수|날 수|coating|코팅|dlc|tialn|alcrn|알루미늄.*가공|스테인리스.*가공|rpm|feed|이송|절삭|ap |ae |vc |fz |추천.*이유|왜.*추천|어떤.*형상|뭐가.*좋|뭐가.*맞|차이점|형상|가공.*방|황삭|정삭|엔드밀|드릴|탭|인서트|시리즈.*차이|제품.*비교|절삭.*조건/i

function isToolDomainQuestion(message: string): boolean {
  return TOOL_DOMAIN_PATTERN.test(message)
}
