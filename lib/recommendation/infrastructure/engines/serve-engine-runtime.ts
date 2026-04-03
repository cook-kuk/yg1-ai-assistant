import {
  analyzeInquiry,
  buildSessionState,
  carryForwardState,
  checkResolution,
  getRedirectResponse,
  prepareRequest,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
  runHybridRetrieval,
} from "@/lib/recommendation/domain/recommendation-domain"
import { BrandReferenceRepo } from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { getSessionCache } from "@/lib/recommendation/infrastructure/cache/session-cache"
import { resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
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
import { normalizePlannerResult, validatePlannerResult, buildExecutorSummary } from "@/lib/recommendation/core/turn-boundaries"
import { dryRunReduce, reduce, compareReducerVsActual, type ReducerAction } from "@/lib/recommendation/core/state-reducer"
import { USE_STATE_REDUCER, USE_CHIP_SYSTEM, isSingleCallRouterEnabled } from "@/lib/feature-flags"
import { routeSingleCall } from "@/lib/recommendation/core/single-call-router"
import { deriveChips, toChipState, compareChips, safeApplyChips } from "@/lib/recommendation/core/chip-system"
import { handleServeGeneralChatAction } from "@/lib/recommendation/infrastructure/engines/serve-engine-general-chat"
import { classifyPreSearchRoute } from "@/lib/recommendation/infrastructure/engines/pre-search-route"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import { shouldExecutePendingAction, pendingActionToFilter } from "@/lib/recommendation/domain/context/pending-action-resolver"
import { TurnPerfLogger, setCurrentPerfLogger } from "@/lib/recommendation/infrastructure/perf/turn-perf-logger"
import { buildAppliedFilterFromValue, buildFilterValueScope, extractFilterFieldValueMap, getFilterFieldDefinition, getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
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

type PendingQuestionReplyResolution =
  | { kind: "none" }
  | { kind: "resolved"; filter: AppliedFilter }
  | { kind: "side_question"; pendingField: string; raw: string }
  | { kind: "unresolved"; pendingField: string; raw: string }

const DEFAULT_CANDIDATE_PAGE_SIZE = 50
const PENDING_QUESTION_RECOVERY_ACTIONS = new Set<string>([
  "continue_narrowing",
  "skip_field",
  "replace_existing_filter",
])

/**
 * Build a user-friendly 0-result message that tells the user:
 * 1. Which combined conditions caused 0 results
 * 2. Which specific filter (the newly attempted one) to relax
 */
function buildZeroResultMessage(
  failedFilter: { field: string; value: string },
  activeFilters: Array<{ field: string; value: string }>,
  totalCandidateCount: number,
): string {
  const failedLabel = getFilterFieldLabel(failedFilter.field)
  const failedValue = failedFilter.value

  // Build a summary of all active conditions including the failed one
  const allConditions = [
    ...activeFilters.map(f => `${getFilterFieldLabel(f.field)}: ${f.value}`),
    `${failedLabel}: ${failedValue}`,
  ]
  const conditionSummary = allConditions.join(" + ")

  const lines = [
    `${conditionSummary} 조건을 모두 적용하면 후보가 없습니다.`,
    `${failedLabel} 조건을 변경하거나 '상관없음'을 선택해주세요.`,
    `현재 ${totalCandidateCount}개 후보에서 다른 옵션을 골라보세요.`,
  ]
  return lines.join("\n")
}

/**
 * When a filter change produces 0 results, compute which values ARE available
 * for the failed field given the current (pre-change) candidate set.
 * Returns an enriched message + alternative chips so the user can recover.
 */
function buildZeroResultWithAlternatives(
  failedFilter: { field: string; value: string },
  activeFilters: Array<{ field: string; value: string }>,
  currentCandidates: ScoredProduct[],
  totalCandidateCount: number,
  previousValue?: string | null,
): { message: string; chips: string[] } {
  const failedLabel = getFilterFieldLabel(failedFilter.field)
  const failedValue = failedFilter.value

  // Get available values with counts for the failed field from current candidates
  const valueMap = extractFilterFieldValueMap(currentCandidates, [failedFilter.field])
  const distribution = valueMap.get(failedFilter.field)

  // Build condition summary
  const allConditions = [
    ...activeFilters.map(f => `${getFilterFieldLabel(f.field)}: ${f.value}`),
    `${failedLabel}: ${failedValue}`,
  ]
  const conditionSummary = allConditions.join(" + ")

  const lines = [
    `${conditionSummary} 조건을 모두 적용하면 후보가 없습니다.`,
  ]

  const chips: string[] = []

  if (distribution && distribution.size > 0) {
    // Sort by count descending, take top alternatives
    const sorted = [...distribution.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    const availableList = sorted
      .map(([val, count]) => `${val} (${count}개)`)
      .join(", ")
    lines.push(`현재 조건에서 선택 가능한 ${failedLabel}: ${availableList}`)

    // Build chips for each available value
    for (const [val, count] of sorted) {
      chips.push(`${failedLabel} ${val} (${count}개)`)
    }
  } else {
    lines.push(`${failedLabel} 조건을 변경하거나 '상관없음'을 선택해주세요.`)
  }

  // Add revert chip if there's a previous value to go back to
  if (previousValue) {
    chips.unshift(`${previousValue}로 돌아가기`)
  }

  // Always add navigation options
  if (!chips.some(c => c.includes("이전 단계"))) chips.push("⟵ 이전 단계")

  return { message: lines.join("\n"), chips }
}

export function shouldReplayUnresolvedPendingQuestion(
  pendingReplyKind: PendingQuestionReplyResolution["kind"],
  earlyAction: string | null
): boolean {
  return pendingReplyKind === "unresolved" && !PENDING_QUESTION_RECOVERY_ACTIONS.has(earlyAction ?? "")
}

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

function createNarrowingTurn(params: {
  question: string
  askedField?: string
  answer: string
  extractedFilters: AppliedFilter[]
  candidateCountBefore: number
  candidateCountAfter: number
}): NarrowingTurn {
  return {
    question: params.question,
    askedField: params.askedField,
    answer: params.answer,
    extractedFilters: params.extractedFilters,
    candidateCountBefore: params.candidateCountBefore,
    candidateCountAfter: params.candidateCountAfter,
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
  const start = pagination.page * pagination.pageSize
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

function matchesPendingOptionValue(clean: string, option: { label?: string; value?: string | number | boolean }): boolean {
  const normalizedValue = normalizePendingSelectionText(String(option.value ?? ""))
  const normalizedLabel = normalizePendingSelectionText(String(option.label ?? ""))
  if (!clean) return false
  return (
    clean === normalizedValue
    || clean === normalizedLabel
    || (normalizedValue.length > 0 && (clean.startsWith(normalizedValue) || normalizedValue.startsWith(clean)))
    || (normalizedLabel.length > 0 && (clean.startsWith(normalizedLabel) || normalizedLabel.startsWith(clean)))
  )
}

function normalizePendingComparableValue(value: string | number | boolean | null | undefined): string {
  return normalizePendingSelectionText(String(value ?? "")).replace(/\s+/g, "")
}

function inferPendingFieldFromScope(
  sessionState: ExplorationSessionState,
  cleanValue: string,
  pendingField: string
): string | null {
  const scope = sessionState.filterValueScope ?? {}
  const matchedFields = getRegisteredFilterFields().filter(field => {
    const parsedUserValue = buildAppliedFilterFromValue(field, cleanValue, sessionState.turnCount ?? 0)
    if (!parsedUserValue) return false

    const scopeValues = scope[field] ?? []
    if (scopeValues.length === 0) return false

    return scopeValues.some(scopeValue => {
      const parsedScopeValue = buildAppliedFilterFromValue(field, scopeValue, sessionState.turnCount ?? 0)
      if (!parsedScopeValue) return false

      const userComparable = normalizePendingComparableValue(parsedUserValue.rawValue ?? parsedUserValue.value)
      const scopeComparable = normalizePendingComparableValue(parsedScopeValue.rawValue ?? parsedScopeValue.value)
      if (!userComparable || !scopeComparable) return false

      return userComparable === scopeComparable
    })
  })

  if (matchedFields.length === 1) return matchedFields[0]
  if (matchedFields.includes(pendingField)) return pendingField
  return null
}

function isSkipSelectionValue(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = normalizePendingSelectionText(value)
  return ["상관없음", "상관 없음", "모름", "skip", "패스", "스킵", "아무거나", "아무거나요", "넘어가", "넘어가줘", "넘어갈게", "모르겠어", "모르겠어요", "다괜찮아", "뭐든상관없어"].includes(normalized)
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

  // filterValueScope covers the FULL candidate set (not just the displayed page).
  // If the scope exists but this field is missing, return [] (= no constraint, allow all)
  // rather than falling back to displayedCandidates which only contains the top-N page.
  if (sessionState?.filterValueScope) return []

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

export function resolvePendingQuestionReply(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null
): PendingQuestionReplyResolution {
  const pendingField = sessionState?.lastAskedField ?? null
  if (!sessionState || !pendingField) return { kind: "none" }
  if (sessionState.resolutionStatus?.startsWith("resolved")) return { kind: "none" }
  if (!userMessage) return { kind: "none" }

  const raw = userMessage.trim()
  if (!raw) return { kind: "none" }
  if (raw.length > 80) return { kind: "unresolved", pendingField, raw }
  if (/[?？]/.test(raw)) return { kind: "side_question", pendingField, raw }
  if (hasExplicitRevisionSignal(raw)) {
    console.log(`[pending-selection] Detected revision signal in "${raw.slice(0, 30)}" — deferring to revision resolver`)
    return { kind: "unresolved", pendingField, raw }
  }
  // 위임 표현 → skip으로 처리 (추천해줘, 알아서 해줘, 아무거나 한개 등)
  if (/^(?:.*(?:추천해|골라|알아서|너가|니가|한개|하나만|아무거나).*(?:줘|해줘|해|주세요|요)?|추천으로\s*골라줘)$/u.test(raw)) {
    console.log(`[pending-selection] Delegation detected: "${raw.slice(0, 30)}" → treating as skip`)
    const skipFilter: AppliedFilter = {
      field: pendingField,
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: sessionState.turnCount ?? 0,
    }
    return { kind: "resolved", filter: skipFilter }
  }
  if (/뭐야|뭔지|설명|차��|왜|어떻게|몇개|종류|비교|결과|처음부터|이전 단계|알려줘|��려|궁금|공장|영업소|연락|번호|정보|회사|사장|회장|매출|주주|지점|사우디|해외|국가|��라|도시|어디|재고|납기|가격|배송|리드\s*타임|stock|inventory|price|lead\s*time|적합|카탈로그|스펙/u.test(raw)) {
    return { kind: "side_question", pendingField, raw }
  }
  // Product code + additional text → side question about a specific product (e.g., "G8A59080의 재고 수")
  if (/\b[A-Z]{1,5}\d[A-Z]?\d{3,}\b/i.test(raw) && raw.trim() !== (raw.match(/\b[A-Z]{1,5}\d[A-Z]?\d{3,}\b/i)?.[0] ?? "")) {
    return { kind: "side_question", pendingField, raw }
  }

  const clean = normalizePendingSelectionText(raw)
  if (!clean) return { kind: "unresolved", pendingField, raw }

  const structuredOptions = sessionState.displayedOptions ?? []
  let resolvedField = pendingField
  let optionsForPendingField = structuredOptions.filter(option => option.field === pendingField)

  if (structuredOptions.length > 0 && optionsForPendingField.length === 0) {
    const actionableMatchedOptions = structuredOptions.filter(option => (
      option.field
      && option.field !== "_action"
      && option.field !== "skip"
      && matchesPendingOptionValue(clean, option)
    ))
    const matchedFields = Array.from(new Set(actionableMatchedOptions.map(option => option.field)))
    if (matchedFields.length === 1) {
      resolvedField = matchedFields[0]
      optionsForPendingField = structuredOptions.filter(option => option.field === resolvedField)
      console.warn(
        `[pending-selection] Stale pending field "${pendingField}" detected; using displayed option field "${resolvedField}"`
      )
    }
  }

  if (optionsForPendingField.length === 0) {
    const inferredField = inferPendingFieldFromScope(sessionState, clean, pendingField)
    if (inferredField && inferredField !== pendingField) {
      resolvedField = inferredField
      console.warn(
        `[pending-selection] Inferred field "${resolvedField}" from scope while pending field was "${pendingField}"`
      )
    }

    optionsForPendingField = (sessionState.displayedChips ?? []).map((chip, index) => {
      const skipValue = isSkipSelectionValue(chip)
      const cleanChipValue = normalizePendingSelectionText(chip)
        .replace(/\s*\(\d+개\)\s*$/u, "")
        .trim()

      return {
        index: index + 1,
        label: chip,
        field: resolvedField,
        value: skipValue ? "skip" : cleanChipValue,
        count: 0,
      }
    })
  }

  const optionMatch = optionsForPendingField.find(option => matchesPendingOptionValue(clean, option))

  const chipMatch = optionsForPendingField.find(option => {
    const normalizedChip = normalizePendingSelectionText(option.label)
    return normalizedChip && (clean === normalizedChip || clean.startsWith(normalizedChip) || normalizedChip.startsWith(clean))
  })

  // Try canonicalized matching: e.g. "스퀘어" → "Square" via field's canonicalizeRawValue
  // Only attempt for single-token inputs to avoid partial matches in phrases like "change Ball to Radius"
  const canonicalMatch = (!optionMatch && !chipMatch && !/\s/.test(raw.trim())) ? (() => {
    const fieldDef = getFilterFieldDefinition(resolvedField)
    if (!fieldDef?.canonicalizeRawValue) return null
    const canonicalized = fieldDef.canonicalizeRawValue(raw.trim())
    if (!canonicalized) return null
    const canonicalClean = normalizePendingSelectionText(String(canonicalized))
    if (!canonicalClean || canonicalClean === clean) return null
    return optionsForPendingField.find(option => matchesPendingOptionValue(canonicalClean, option))
  })() : null

  const selectedOption = optionMatch ?? chipMatch ?? canonicalMatch ?? null
  const selectedValue = selectedOption?.value ?? null
  const diameterFields = ["diameterMm", "diameterRefine"]
  const supportsDirectFreeformAnswer = diameterFields.includes(pendingField) || diameterFields.includes(resolvedField)
  const freeformField = diameterFields.includes(pendingField) ? pendingField : resolvedField
  const parsedDirect = selectedValue || !supportsDirectFreeformAnswer ? null : parseAnswerToFilter(freeformField, raw)
  const resolvedValue = selectedValue ?? null

  if (resolvedValue === "skip" || isSkipSelectionValue(selectedOption?.label) || isSkipSelectionValue(raw)) {
    const filter: AppliedFilter = {
      field: resolvedField,
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: sessionState.turnCount ?? 0,
    }
    console.log(`[pending-selection] Resolved field="${resolvedField}" as skip`)
    return { kind: "resolved", filter }
  }

  const filter = resolvedValue ? parseAnswerToFilter(resolvedField, String(resolvedValue)) : parsedDirect
  // canonicalField 매칭: diameterRefine → diameterMm 변환 시 filter.field가 달라질 수 있음
  if (filter) {
    const pendingCanonical = getFilterFieldDefinition(pendingField)?.canonicalField ?? null
    const filterMatchesPending = filter.field === pendingField || filter.field === resolvedField || (pendingCanonical && filter.field === pendingCanonical)
    if (filterMatchesPending) {
      console.log(`[pending-selection] Resolved field="${resolvedField}" value="${filter.value}" (filter.field="${filter.field}", pending="${pendingField}")`)
      return { kind: "resolved", filter }
    }
    // filter.field가 pending과 다르더라도 canonicalField가 맞으면 통과
    console.log(`[pending-selection] Resolved field="${resolvedField}" value="${filter.value}" (canonical match)`)
    return { kind: "resolved", filter }
  }

  console.log(`[pending-selection] Unresolved reply for field="${resolvedField}" raw="${raw.slice(0, 30)}"`)
  return { kind: "unresolved", pendingField, raw }
}

export function buildPendingSelectionFilter(
  sessionState: ExplorationSessionState | null,
  userMessage: string | null
): AppliedFilter | null {
  const resolved = resolvePendingQuestionReply(sessionState, userMessage)
  return resolved.kind === "resolved" ? resolved.filter : null
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

  let activeFilters = (sessionState.appliedFilters ?? []).filter(filter => filter.op !== "skip")

  // intake form에서 설정된 조건은 appliedFilters에 없을 수 있음 — resolvedInput에서 가상 필터 생성
  if (activeFilters.length === 0 && sessionState.resolvedInput) {
    const ri = sessionState.resolvedInput
    const syntheticFilters: AppliedFilter[] = []
    if (ri.diameterMm != null) syntheticFilters.push({ field: "diameterMm", op: "eq", value: `${ri.diameterMm}mm`, rawValue: ri.diameterMm, appliedAt: 0 })
    if (ri.material) syntheticFilters.push({ field: "material", op: "eq", value: ri.material, rawValue: ri.material, appliedAt: 0 })
    if (ri.operationType) syntheticFilters.push({ field: "operationType", op: "eq", value: ri.operationType, rawValue: ri.operationType, appliedAt: 0 })
    if (ri.flutePreference != null) syntheticFilters.push({ field: "fluteCount", op: "eq", value: `${ri.flutePreference}날`, rawValue: ri.flutePreference, appliedAt: 0 })
    if (ri.coatingPreference) syntheticFilters.push({ field: "coating", op: "includes", value: ri.coatingPreference, rawValue: ri.coatingPreference, appliedAt: 0 })
    if (ri.toolSubtype) syntheticFilters.push({ field: "toolSubtype", op: "eq", value: ri.toolSubtype, rawValue: ri.toolSubtype, appliedAt: 0 })
    activeFilters = syntheticFilters
    if (activeFilters.length > 0) {
      console.log(`[explicit-revision] No appliedFilters, using ${activeFilters.length} synthetic filters from resolvedInput`)
    }
  }

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
      if (!doesCandidatePoolContainFilterValue(field, parsed, sessionState)) continue

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

  // Dedup by targetField + normalized value
  const dedupedRequests = matchedRequests.filter((request, index, requests) => {
    const key = `${request.targetField}:${normalizeComparableFilterValue(request.targetField, request.nextFilter.rawValue ?? request.nextFilter.value)}`
    return index === requests.findIndex(candidate => (
      `${candidate.targetField}:${normalizeComparableFilterValue(candidate.targetField, candidate.nextFilter.rawValue ?? candidate.nextFilter.value)}` === key
    ))
  })

  // When multiple deduped requests exist for the SAME field, filter out those whose rawValue
  // is a field label/alias (e.g. "형상" for toolSubtype) rather than a real domain value.
  if (dedupedRequests.length > 1) {
    const fieldGroups = new Map<string, typeof dedupedRequests>()
    for (const req of dedupedRequests) {
      const group = fieldGroups.get(req.targetField) ?? []
      group.push(req)
      fieldGroups.set(req.targetField, group)
    }
    const filtered: typeof dedupedRequests = []
    for (const [field, group] of fieldGroups) {
      if (group.length <= 1) {
        filtered.push(...group)
        continue
      }
      // For same-field duplicates, remove entries whose rawValue matches a field query alias
      // but only if there are other entries that don't
      const fieldAliasSet = new Set(
        getFilterFieldQueryAliases(field).map(a => a.toLowerCase().replace(/\s+/g, ""))
      )
      // Among same-field duplicates, prefer entries whose rawValue is a real domain value,
      // not a field label. Field labels (e.g. "형상" for toolSubtype, "코팅" for coating)
      // are noise from the field-mention extraction surrounding text.
      const fieldDef = getFilterFieldDefinition(field)
      const fieldLabel = (fieldDef?.label ?? "").toLowerCase().replace(/\s+/g, "")
      const fieldId = field.toLowerCase().replace(/\s+/g, "")
      const nonAliasEntries = group.filter(req => {
        const rawStr = String(req.nextFilter.rawValue ?? "").toLowerCase().replace(/\s+/g, "")
        return rawStr !== fieldLabel && rawStr !== fieldId
      })
      filtered.push(...(nonAliasEntries.length > 0 ? nonAliasEntries : group))
    }
    if (filtered.length === 1) {
      return { kind: "resolved", request: filtered[0] }
    }
    if (filtered.length > 1 && filtered.length < dedupedRequests.length) {
      // Re-check after filtering
      const reDedupedFiltered = filtered.filter((request, index, requests) => {
        const key = `${request.targetField}:${normalizeComparableFilterValue(request.targetField, request.nextFilter.rawValue ?? request.nextFilter.value)}`
        return index === requests.findIndex(candidate => (
          `${candidate.targetField}:${normalizeComparableFilterValue(candidate.targetField, candidate.nextFilter.rawValue ?? candidate.nextFilter.value)}` === key
        ))
      })
      if (reDedupedFiltered.length === 1) {
        return { kind: "resolved", request: reDedupedFiltered[0] }
      }
    }
  }

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
    responsePrefix?: string,
    overrideChips?: string[],
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
  handleCompetitorCrossReference?: (
    userMessage: string,
    prevState: ExplorationSessionState | null,
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
  "refine_condition",
  "filter_by_stock",
])

function buildResetResponse(
  deps: Pick<ServeEngineRuntimeDependencies, "jsonRecommendationResponse">,
  requestPreparation: ReturnType<typeof prepareRequest> | null
) {
  return deps.jsonRecommendationResponse({
    text: "처음부터 다시 시작합니다. 새로 조건을 입력해주세요.",
    purpose: "greeting",
    chips: ["처음부터 다시"],
    isComplete: true,
    recommendation: null,
    sessionState: null,
    evidenceSummaries: null,
    candidateSnapshot: null,
    requestPreparation,
  })
}

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

        // ── Shadow reducer comparison (post-execution — uses ACTUAL response data) ──
        const actualSessionState = (json as any).sessionState ?? (json as any).session?.engineState
        if (actualSessionState && prevState && debugTrace.plannerAction) {
          try {
            // Use ACTUAL candidateCount and lastAskedField from response
            const actualCandidateCount = actualSessionState.candidateCount ?? 0
            const actualLastAskedField = actualSessionState.lastAskedField ?? null
            const actualMode = actualSessionState.currentMode ?? null
            const actualFilters = actualSessionState.appliedFilters ?? []

            const reducerAction: ReducerAction = debugTrace.plannerAction === "continue_narrowing"
              ? { type: "narrow", filter: actualFilters[actualFilters.length - 1] ?? { field: "unknown", value: "unknown", op: "eq", rawValue: "unknown", appliedAt: 0 }, candidateCountAfter: actualCandidateCount, resolvedInput: actualSessionState.resolvedInput ?? prevState.resolvedInput ?? {} as any }
              : debugTrace.plannerAction === "skip_field"
              ? { type: "skip_field", field: prevState.lastAskedField ?? "unknown" }
              : debugTrace.plannerAction === "show_recommendation"
              ? { type: "recommend", candidateCountAfter: actualCandidateCount, displayedCandidates: actualSessionState.displayedCandidates ?? [] }
              : debugTrace.plannerAction === "answer_general" || debugTrace.plannerAction === "redirect_off_topic"
              ? { type: "general_chat" }
              : debugTrace.plannerAction === "reset_session"
              ? { type: "reset" }
              : debugTrace.plannerAction === "go_back_one_step" || debugTrace.plannerAction === "go_back_to_filter"
              ? { type: "go_back", candidateCountAfter: actualCandidateCount, remainingFilters: actualFilters }
              : debugTrace.plannerAction === "filter_by_stock"
              ? { type: "stock_filter", candidateCountAfter: actualCandidateCount }
              : { type: "passthrough", overrides: {
                  turnCount: actualSessionState.turnCount ?? (prevState.turnCount ?? 0) + 1,
                  lastAction: debugTrace.plannerAction,
                  candidateCount: actualCandidateCount,
                  currentMode: actualMode,
                  lastAskedField: actualLastAskedField,
                } }

            const reducerResult = reduce(prevState as any, reducerAction)
            const comparison = compareReducerVsActual(reducerResult.nextState, actualSessionState)

            // Reducer dry-run trace (now post-execution with real data)
            const dryRun = dryRunReduce(prevState as any, reducerAction)
            debugTrace.events?.push({
              step: "reducer-dry-run",
              category: "context",
              inputSummary: { actionType: reducerAction.type, actualCandidateCount, actualMode },
              outputSummary: { mutations: dryRun.mutations, nextStateSummary: dryRun.nextStateSummary },
              reasonSummary: `Post-exec reducer: ${dryRun.mutations.map(m => `${m.field}: ${m.before}→${m.after}`).join(", ")}`,
            })

            meta.reducerComparison = {
              match: comparison.match,
              differences: comparison.differences,
              reducerUsed: USE_STATE_REDUCER,
            }

            if (!comparison.match) {
              console.log(`[reducer-shadow] MISMATCH: ${comparison.differences.map(d => `${d.field}: reducer=${d.reducer} actual=${d.actual}`).join(", ")}`)
            }
          } catch (e) {
            console.warn("[reducer-shadow] comparison error:", e)
          }
        }

        // ── Shadow chip comparison (post-execution — uses ACTUAL state + candidate data) ──
        const actualChips: string[] = (json as any).chips ?? []
        if (prevState && actualChips.length > 0) {
          try {
            // Use actual session state for chip derivation (includes real filters, mode, candidateCount)
            const chipState = toChipState(actualSessionState ?? prevState)
            const newChips = deriveChips(chipState, language)
            const chipComparison = compareChips(actualChips, newChips)

            // Chip dry-run trace
            debugTrace.events?.push({
              step: "chip-system-dry-run",
              category: "ui",
              inputSummary: { mode: chipState.currentMode, candidates: chipState.candidateCount, filters: chipState.appliedFilters.length },
              outputSummary: {
                chipCount: newChips.length,
                chips: newChips.map(c => ({ key: c.key, label: c.label, type: c.type })),
                dynamicChipCount: 0,
              },
              reasonSummary: `Chips: ${newChips.map(c => c.label).join(", ")}`,
            })

            meta.chipComparison = {
              match: chipComparison.match,
              oldCount: chipComparison.oldCount,
              newCount: chipComparison.newCount,
              onlyInOld: chipComparison.onlyInOld.slice(0, 5),
              onlyInNew: chipComparison.onlyInNew.slice(0, 5),
              chipSystemUsed: USE_CHIP_SYSTEM,
            }

            if (!chipComparison.match) {
              console.log(`[chip-shadow] MISMATCH: old=${chipComparison.oldCount} new=${chipComparison.newCount} onlyOld=[${chipComparison.onlyInOld.join(",")}] onlyNew=[${chipComparison.onlyInNew.join(",")}]`)
            }

            if (USE_CHIP_SYSTEM) {
              const applied = safeApplyChips(actualChips, newChips, true)
              ;(json as any).chips = applied
            }
          } catch (e) {
            console.warn("[chip-shadow] comparison error:", e)
          }
        }

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

  // ── DebugTrace: snapshot stateBefore ──
  trace.setStateBefore({
    sessionId: trace["turnId"],
    candidateCount: prevState?.candidateCount ?? 0,
    resolutionStatus: prevState?.resolutionStatus ?? null,
    currentMode: prevState?.currentMode ?? null,
    lastAskedField: prevState?.lastAskedField ?? null,
    lastAction: prevState?.lastAction ?? null,
    turnCount: prevState?.turnCount ?? 0,
    appliedFilters: (prevState?.appliedFilters ?? []).map(f => ({ field: f.field, value: f.value, op: f.op })),
    displayedChips: prevState?.displayedChips ?? [],
    displayedOptionsCount: prevState?.displayedOptions?.length ?? 0,
    displayedCandidateCount: prevState?.displayedCandidates?.length ?? 0,
    hasRecommendation: false,
    hasComparison: false,
    pendingAction: prevState?.pendingAction ? { label: String(prevState.pendingAction.type ?? ""), type: String(prevState.pendingAction.type ?? "") } : null,
  })

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
  let pendingSelectionAction: OrchestratorAction | null = null
  let pendingSelectionOrchestratorResult: OrchestratorResult | null = null
  let bridgedV2Action: OrchestratorAction | null = null
  let bridgedV2OrchestratorResult: OrchestratorResult | null = null
  const journeyPhase = detectJourneyPhase(prevState)
  const hasActivePendingQuestion = !!prevState?.lastAskedField
    && !prevState.resolutionStatus?.startsWith("resolved")
    && !isPostResultPhase(journeyPhase)
  const pendingQuestionReply = resolvePendingQuestionReply(prevState, lastUserMsg?.text ?? null)
  const pendingSelectionFilter = pendingQuestionReply.kind === "resolved" ? pendingQuestionReply.filter : null
  const shouldResolvePendingSelectionEarly = !!pendingSelectionFilter && !isPostResultPhase(journeyPhase)

  if (shouldResolvePendingSelectionEarly && pendingSelectionFilter) {
    pendingSelectionAction = pendingSelectionFilter.op === "skip"
      ? { type: "skip_field" }
      : { type: "continue_narrowing", filter: pendingSelectionFilter }
    pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(pendingSelectionFilter)
  }

  let singleCallHandled = false
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

    // ── Single-Call Router (feature-flagged) ──────────────────
    // Use Single-Call when: multi-condition message detected (2+ filter hints)
    // Skip when: simple chip click, side question, or pending selection early
    const pendingAlreadyResolved = pendingQuestionReply.kind === "resolved" || pendingQuestionReply.kind === "side_question"
    // Detect 2+ filter hints in a single message: flute+coating, flute+subtype, coating+subtype, etc.
    const msg = lastUserMsg?.text ?? ""
    const filterHints = [
      /\d+날|\d+flute|\d+플루트/i.test(msg),
      /TiAlN|AlCrN|DLC|TiCN|Bright|Blue|코팅|무코팅|블루코팅/i.test(msg),
      /Square|Ball|Radius|Roughing|Taper|Chamfer|스퀘어|볼|라디우스|황삭|코너/i.test(msg),
      /\d+mm|\d+밀리|직경/i.test(msg),
    ].filter(Boolean).length
    const hasMultipleConditions = filterHints >= 2
    // ── Deterministic negation handling (빼고/제외/아닌것) ──
    // Detect "X 빼고", "X 제외", "X 아닌 것" and remove matching filter WITHOUT LLM
    const hasNegationPattern = /빼고|제외|아닌\s*것|없는\s*거|말고\s*다른/u.test(msg)
    if (hasNegationPattern && filters.length > 0) {
      const msgLower = msg.toLowerCase()
      let negationHandled = false
      for (const existingFilter of [...filters]) {
        const filterValue = String(existingFilter.rawValue ?? existingFilter.value).toLowerCase()
        if (msgLower.includes(filterValue) && existingFilter.op !== "skip") {
          // Found: "Square 빼고" matches existing toolSubtype=Square filter
          const idx = filters.indexOf(existingFilter)
          if (idx >= 0) {
            filters.splice(idx, 1)
            currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
            console.log(`[negation-deterministic] Removed ${existingFilter.field}=${existingFilter.value} filter`)
            negationHandled = true
          }
        }
      }
      if (negationHandled) {
        // Skip pending selection — we already handled the message
        pendingSelectionAction = null
        pendingSelectionOrchestratorResult = null
        bridgedV2Action = { type: "continue_narrowing", filter: filters[filters.length - 1] ?? { field: "none", op: "skip", value: "", rawValue: "", appliedAt: turnCount } as AppliedFilter }
        bridgedV2OrchestratorResult = {
          action: bridgedV2Action,
          reasoning: `negation_deterministic:removed_filter`,
          agentsInvoked: [],
          escalatedToOpus: false,
        }
        // Skip Single-Call Router — already handled
      }
    }

    const shouldUseSingleCall = isSingleCallRouterEnabled() && lastUserMsg && messages.length > 0 && !hasNegationPattern && (hasMultipleConditions || (!shouldResolvePendingSelectionEarly && !pendingAlreadyResolved))
    if (shouldUseSingleCall) {
      const singleResult = await routeSingleCall(lastUserMsg.text, prevState, provider)
      // Temporary debug: log SCR result to trace
      trace.add("single-call-router", "router", {
        actionCount: singleResult.actions.length,
        actions: singleResult.actions.map(a => ({ type: a.type, field: a.field, value: a.value, op: a.op })),
        reasoning: singleResult.reasoning,
        answer: singleResult.answer?.slice(0, 100),
      })

      if (singleResult.actions.length > 0) {
        for (const action of singleResult.actions) {
          switch (action.type) {
            case "apply_filter": {
              const filter = buildAppliedFilterFromValue(action.field!, action.value!, turnCount)
              if (filter) {
                // Remove existing skip filter for same field before applying
                const skipIdx = filters.findIndex(f => f.field === filter.field && f.op === "skip")
                if (skipIdx >= 0) filters.splice(skipIdx, 1)
                const result = replaceFieldFilter(baseInput, filters, filter, deps.applyFilterToInput)
                filters.splice(0, filters.length, ...result.nextFilters)
                currentInput = result.nextInput
              }
              break
            }
            case "remove_filter": {
              const idx = filters.findIndex(f => f.field === action.field)
              if (idx >= 0) filters.splice(idx, 1)
              currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
              break
            }
            case "replace_filter": {
              const newFilter = buildAppliedFilterFromValue(action.field!, action.to!, turnCount)
              if (newFilter) {
                const result = replaceFieldFilter(baseInput, filters, newFilter, deps.applyFilterToInput)
                filters.splice(0, filters.length, ...result.nextFilters)
                currentInput = result.nextInput
              }
              break
            }
            case "skip": {
              const skipField = action.field || prevState?.lastAskedField
              if (!skipField) {
                console.warn(`[orchestrate] skip action ignored — no field resolved`)
                break
              }
              const skipFilter: AppliedFilter = {
                field: skipField,
                op: "skip",
                value: "상관없음",
                rawValue: "skip",
                appliedAt: turnCount,
              }
              filters.push(skipFilter)
              break
            }
            case "compare": {
              explicitComparisonAction = { type: "compare_products", targets: action.targets || [] }
              explicitComparisonOrchestratorResult = buildExplicitComparisonOrchestratorResult(action.targets || [])
              break
            }
            case "answer": {
              return handleServeGeneralChatAction({
                deps,
                action: { type: "answer_general", message: lastUserMsg.text },
                orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, "single_call_answer"),
                provider,
                form,
                messages,
                prevState: prevState!,
                filters,
                narrowingHistory,
                currentInput,
                candidates: [],
                evidenceMap: new Map(),
                turnCount,
              })
            }
            case "reset":
            case "go_back":
              break // fall through to existing reset/go_back handling below
          }
        }

        // If filters changed, set up continue_narrowing action and clear pending
        if (singleResult.actions.some(a => ["apply_filter", "remove_filter", "replace_filter"].includes(a.type))) {
          // Override pending selection — Single-Call Router handled it
          pendingSelectionAction = null
          pendingSelectionOrchestratorResult = null
          bridgedV2Action = { type: "continue_narrowing", filter: filters[filters.length - 1] }
          bridgedV2OrchestratorResult = {
            action: bridgedV2Action,
            reasoning: `single_call:${singleResult.reasoning}`,
            agentsInvoked: [{ agent: "single-call-router", model: "sonnet" as const, durationMs: 0 }],
            escalatedToOpus: false,
          }
          singleCallHandled = true
        }
      }
      // Empty actions = fallthrough to legacy routing below
    }

    if (!shouldResolvePendingSelectionEarly) {
      // Step 1: Synchronous comparison check (no LLM, instant)
      explicitComparisonAction = resolveExplicitComparisonAction(prevState, lastUserMsg.text)
      if (explicitComparisonAction?.type === "compare_products") {
        explicitComparisonOrchestratorResult = buildExplicitComparisonOrchestratorResult(explicitComparisonAction.targets)
        console.log(`[runtime:explicit-compare] targets=${explicitComparisonAction.targets.join(", ")}`)
      }

      // Step 2: If no comparison, run 4 LLM checks in parallel
      if (!explicitComparisonAction) {
        const [revisionSettled, filterSettled, judgmentSettled, preSearchSettled] = await Promise.allSettled([
          resolveExplicitRevisionRequest(prevState, lastUserMsg.text, provider),
          resolveExplicitFilterRequest(prevState, lastUserMsg.text, provider),
          prevState ? performUnifiedJudgment({
            userMessage: lastUserMsg.text,
            assistantText: null,
            pendingField: prevState.lastAskedField ?? null,
            currentMode: prevState.currentMode ?? null,
            displayedChips: prevState.displayedChips ?? [],
            filterCount: filters.length,
            candidateCount: prevState.candidateCount ?? 0,
            hasRecommendation: prevState.resolutionStatus?.startsWith("resolved") ?? false,
          }, provider) : Promise.resolve(null),
          classifyPreSearchRoute(lastUserMsg.text, prevState, provider),
        ])

        const revisionResult = revisionSettled.status === "fulfilled" ? revisionSettled.value : null
        const filterResult = filterSettled.status === "fulfilled" ? filterSettled.value : null
        const judgmentResult = judgmentSettled.status === "fulfilled" ? judgmentSettled.value : null
        const preSearchResult = preSearchSettled.status === "fulfilled" ? preSearchSettled.value : null

        // Apply by priority: revision > filter > judgment > preSearch

        // 1. Revision resolved
        if (revisionResult?.kind === "resolved") {
          explicitRevisionResolution = revisionResult
          const explicitRevisionRequest = revisionResult.request
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

        // 2. Revision ambiguous → clarification early return
        if (revisionResult?.kind === "ambiguous" && prevState) {
          return buildRevisionClarificationResponse(
            deps,
            prevState,
            form,
            filters,
            narrowingHistory,
            currentInput,
            turnCount,
            revisionResult.question,
            requestPrep
          )
        }

        // 3. Filter resolved (only if no revision)
        if (!revisionResult && filterResult?.kind === "resolved") {
          explicitFilterResolution = filterResult
          explicitFilterAction = {
            type: "continue_narrowing",
            filter: filterResult.filter,
          }
          explicitFilterOrchestratorResult = {
            action: explicitFilterAction,
            reasoning: `explicit_filter:${filterResult.filter.field}:${filterResult.filter.value}`,
            agentsInvoked: [{ agent: "explicit-filter-resolver", model: "haiku", durationMs: 0 }],
            escalatedToOpus: false,
          }
          console.log(
            `[runtime:explicit-filter] field=${filterResult.filter.field} value=${filterResult.filter.value}`
          )
        }

        // 4. Filter ambiguous → clarification early return (only if no revision)
        if (!revisionResult && filterResult?.kind === "ambiguous" && prevState) {
          return buildRevisionClarificationResponse(
            deps,
            prevState,
            form,
            filters,
            narrowingHistory,
            currentInput,
            turnCount,
            filterResult.question,
            requestPrep
          )
        }

        // 5. Judgment explain route (only if no revision, no filter)
        if (!revisionResult && !filterResult && judgmentResult && prevState) {
          const isExplainQuestion = judgmentResult.intentAction === "explain" || /[?？]$/.test(lastUserMsg.text.trim())
          if (
            isExplainQuestion &&
            (
              judgmentResult.domainRelevance === "cutting_condition" ||
              isToolDomainQuestion(lastUserMsg.text)
            )
          ) {
            console.log(`[runtime:explain-route] ${judgmentResult.domainRelevance} -> answer_general before V2`)
            return handleServeGeneralChatAction({
              deps,
              action: { type: "answer_general", message: lastUserMsg.text },
              orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, `tool_explain:${judgmentResult.domainRelevance}`),
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

        // 6. PreSearch non-recommendation route (only if no revision, no filter)
        if (!revisionResult && !filterResult && preSearchResult && preSearchResult.kind !== "recommendation_action") {
          console.log(`[runtime:pre-route] ${preSearchResult.kind} -> answer_general (${preSearchResult.reason})`)
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
            orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, preSearchResult.reason),
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
  }

  // ── V2 Orchestrator Integration ──
  // V2 handles routing decisions (LLM-based), then delegates execution to legacy engines.
  // On error, automatically falls back to legacy path.
  const currentPhase = prevState?.currentMode ?? "intake"
  perf.startStep("v2_orchestrator")
  if (shouldUseV2ForPhase(currentPhase) && lastUserMsg && !hasActivePendingQuestion && !shouldResolvePendingSelectionEarly && !explicitComparisonAction && !explicitRevisionResolution && !explicitFilterResolution && !singleCallHandled) {
    try {
      const { orchestrateTurnV2 } = await import("@/lib/recommendation/core/turn-orchestrator")
      const { convertToV2State, convertFromV2State } = await import("@/lib/recommendation/core/state-adapter")

      const v2State = convertToV2State(prevState)

      // 첫 턴(prevState=null)에서 user message로부터 deterministic 힌트를 V2 constraints에 주입
      if (!prevState && lastUserMsg) {
        const { extractMaterial, extractOperation, extractDiameter } = await import("@/lib/recommendation/domain/input-normalizer")
        const hintMaterial = extractMaterial(lastUserMsg.text)
        const hintOperation = extractOperation(lastUserMsg.text)
        const hintDiameter = extractDiameter(lastUserMsg.text)
        if (hintMaterial) v2State.constraints.base.material = hintMaterial
        if (hintOperation) v2State.constraints.base.operation = hintOperation
        if (hintDiameter) v2State.constraints.base.diameter = hintDiameter
        if (hintMaterial || hintOperation || hintDiameter) {
          console.log(`[runtime:v2-hint] material=${hintMaterial}, op=${hintOperation}, dia=${hintDiameter}`)
        }
      }

      // Extract recent conversation turns for V2 single-call context
      const v2RecentTurns = messages.slice(-6).map(m => ({
        role: (m.role === "ai" ? "assistant" : m.role) as "user" | "assistant",
        text: m.text,
      })).filter(t => t.role === "user" || t.role === "assistant")

      const result = await orchestrateTurnV2(lastUserMsg.text, v2State, provider, v2RecentTurns)
      const v2Action = result.trace.action
      console.log(`[runtime:v2] Orchestrator decision: action=${v2Action}, phase=${result.trace.phase}, confidence=${result.trace.confidence}`)

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

        legacyState.candidateCount = totalCandidateCount
        legacyState.displayedCandidates = deps.buildCandidateSnapshot(displayPage.candidates, displayPage.evidenceMap)
        legacyState.filterValueScope = buildFilterValueScope(result.searchPayload.candidates as unknown as Array<Record<string, unknown>>)

        perf.endStep("v2_orchestrator")
        perf.recordLlmCall()
        perf.finish()

        // 0건이면 recommendation 대신 question 모드로 fallback — 조건 축소를 유도한다.
        if (isResultPhase && totalCandidateCount === 0 && (legacyState.appliedFilters ?? []).length === 0) {
          console.log("[runtime:v2] 0 candidates with no filters → fallback to question mode")
          legacyState.currentMode = "question"
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
        // 0건 + 필터 없음이면 recommendation이어도 question으로 내린다.
        const downgradeToQuestion = isResultPhase && (legacyState.candidateCount ?? 0) === 0 && (legacyState.appliedFilters ?? []).length === 0
        if (downgradeToQuestion) {
          console.log("[runtime:v2-bridge] 0 candidates with no filters → downgrade to question")
          legacyState.currentMode = "question"
        }
        return deps.jsonRecommendationResponse({
          text: result.answer,
          purpose: (isResultPhase && !downgradeToQuestion) ? "recommendation" : "question",
          chips: result.chips,
          isComplete: isResultPhase && !downgradeToQuestion,
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
      // V2 error → automatic legacy fallback (zero user impact)
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[runtime:v2] Error (falling back to legacy): ${errMsg}`, {
        phase: currentPhase,
        userMessage: lastUserMsg.text.slice(0, 50),
      })
      // Fall through to legacy path below
    }
  }

  let earlyAction: string | null =
    pendingSelectionAction?.type
    ?? explicitComparisonAction?.type
    ?? explicitRevisionAction?.type
    ?? explicitFilterAction?.type
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
    return buildResetResponse(deps, requestPrep)
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
          // 같은 필드 필터가 이미 있으면 교체 (추가가 아님)
          const canonField = filter.field === "diameterRefine" ? "diameterMm" : filter.field
          const testFilters = [...filters.filter(f => f.field !== filter.field && f.field !== canonField), filter]
          console.log(`[chip-filter-debug] filter=${JSON.stringify(filter)} testInput.diameterMm=${testInput.diameterMm} testFilters=${JSON.stringify(testFilters.map(f=>f.field+'='+f.value))}`)
          const testResult = await runHybridRetrieval(testInput, testFilters, 0, null)
          const testDisplayPage = sliceCandidatesForPage(testResult.candidates, testResult.evidenceMap, resolvedPagination)

          if (testResult.totalConsidered === 0) {
            console.log(`[chip-filter-debug] ZERO RESULTS: filter=${filter.field}=${filter.value} currentInput.diameterMm=${currentInput.diameterMm} totalBefore=${totalCandidateCount}`)
            const excludeVals = filter.field === "workPieceName" ? [filter.value] : undefined
            const { message: zeroMsg, chips: zeroChips } = buildZeroResultWithAlternatives(
              filter,
              filters,
              candidates,
              totalCandidateCount,
            )
            return deps.buildQuestionResponse(
              form, candidates, evidenceMap, totalCandidateCount, paginationDto(totalCandidateCount), displayCandidates, displayEvidenceMap, currentInput,
              narrowingHistory, filters, turnCount, messages, provider, language,
              zeroMsg,
              undefined, // existingStageHistory
              excludeVals,
              undefined, // preferredQuestionField
              undefined, // responsePrefix
              zeroChips,
            )
          }

          filters.push(filter)
          currentInput = testInput
          narrowingHistory.push(createNarrowingTurn({
            question: "pending-action-accept",
            askedField: prevState.lastAskedField,
            answer: lastUserMsg.text,
            extractedFilters: [filter],
            candidateCountBefore: totalCandidateCount,
            candidateCountAfter: testResult.totalConsidered,
          }))
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

    if (hasActivePendingQuestion && shouldReplayUnresolvedPendingQuestion(pendingQuestionReply.kind, earlyAction)) {
      const replayField = prevState.lastAskedField ?? undefined
      if (replayField) {
        console.log(`[pending-selection] Unresolved reply for active field="${replayField}" -> replaying same question`)
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
          undefined,
          prevState.stageHistory,
          undefined,
          replayField,
          "현재 질문에 대한 답변으로 인식하지 못했습니다. 아래 선택지 중에서 골라주시거나, 필요한 값이 있으면 형식에 맞게 직접 입력해주세요."
        )
      }
    } else if (hasActivePendingQuestion && pendingQuestionReply.kind === "unresolved" && earlyAction) {
      console.log(
        `[pending-selection] Unresolved direct match recovered by action="${earlyAction}" for field="${prevState.lastAskedField ?? "unknown"}"`
      )
    }

    const orchResult = pendingSelectionOrchestratorResult ?? explicitComparisonOrchestratorResult ?? explicitRevisionOrchestratorResult ?? explicitFilterOrchestratorResult ?? bridgedV2OrchestratorResult ?? (
      ENABLE_TOOL_USE_ROUTING
        ? await orchestrateTurnWithTools(turnContext, provider)
        : await orchestrateTurn(turnContext, provider)
    )
    let action = pendingSelectionAction ?? explicitComparisonAction ?? explicitRevisionAction ?? explicitFilterAction ?? bridgedV2Action ?? orchResult.action
    const usingBridgedAction = !!pendingSelectionAction || !!explicitComparisonAction || !!explicitRevisionAction || !!explicitFilterAction || !!bridgedV2Action

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

    // ── DebugTrace: planner result ──
    trace.setPlannerResult(
      action.type,
      orchResult.reasoning ?? `action=${action.type}, usingBridged=${usingBridgedAction}`
    )

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

    // ── Boundary: normalize planner result + validate ──
    const plannerResult = normalizePlannerResult(orchResult, action, wasIntercepted)
    const validationResult = validatePlannerResult(plannerResult, trace)
    if (validationResult.warnings.length > 0) {
      console.log(`[turn-boundary:validator] warnings: ${validationResult.warnings.join(", ")}`)
    }
    const executionStartTime = Date.now()

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

    // ── Reducer/Chip dry-run moved to post-execution (handleServeExploration outer) ──
    // Uses actual response data for accurate comparison

    if (action.type === "reset_session") {
      return buildResetResponse(deps, requestPrep)
    }

    if (action.type === "go_back_one_step" || action.type === "go_back_to_filter") {
      const restoreResult = action.type === "go_back_to_filter"
        ? restoreToBeforeFilter(prevState, action.filterValue ?? "", action.filterField, baseInput, deps.applyFilterToInput)
        : restoreOnePreviousStep(prevState, baseInput, deps.applyFilterToInput)

      const undoResult = await runHybridRetrieval(
        restoreResult.rebuiltInput,
        restoreResult.remainingFilters.filter(filter => filter.op !== "skip"),
        0,
        null
      )
      const undoDisplayPage = sliceCandidatesForPage(undoResult.candidates, undoResult.evidenceMap, resolvedPagination)

      console.log(
        `[session-manager:undo] Reverted "${restoreResult.removedFilterDesc}": ${prevState.candidateCount} -> ${undoResult.candidates.length} candidates, filters: ${prevState.appliedFilters.length} -> ${restoreResult.remainingFilters.length}`
      )

      return deps.buildQuestionResponse(
        form,
        undoResult.candidates,
        undoResult.evidenceMap,
        undoResult.totalConsidered,
        paginationDto(undoResult.totalConsidered),
        undoDisplayPage.candidates,
        undoDisplayPage.evidenceMap,
        restoreResult.rebuiltInput,
        restoreResult.remainingHistory,
        restoreResult.remainingFilters,
        restoreResult.undoTurnCount,
        messages,
        provider,
        language,
        undefined,
        restoreResult.remainingStages
      )
    }

    if (action.type === "show_recommendation") {
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

    if (action.type === "filter_by_stock") {
      // ── Post-scoring stock filter ──
      // Filters from already-displayed candidates (no re-retrieval).
      // Uses prevState.displayedCandidates snapshots to avoid re-running full search.
      let prevCandidates = prevState?.displayedCandidates ?? []
      const stockFilter = action.stockFilter
      const stockThreshold = action.stockThreshold ?? null

      // Fallback: if no displayed candidates, use full candidates from current search
      if (prevCandidates.length === 0 && candidates.length > 0) {
        prevCandidates = deps.buildCandidateSnapshot(candidates, evidenceMap)
      }

      let filteredSnapshots: CandidateSnapshot[]
      if (stockThreshold != null && stockThreshold > 0) {
        // Numeric threshold: "재고 50개 이상" → totalStock >= 50
        filteredSnapshots = prevCandidates.filter(c => (c.totalStock ?? 0) >= stockThreshold)
      } else if (stockFilter === "instock") {
        filteredSnapshots = prevCandidates.filter(c => (c.totalStock ?? 0) > 0)
      } else if (stockFilter === "limited") {
        filteredSnapshots = prevCandidates.filter(c => c.stockStatus === "instock" || c.stockStatus === "limited")
      } else {
        filteredSnapshots = prevCandidates // "all" = no filter
      }

      if (filteredSnapshots.length === 0) {
        // No candidates match stock filter — inform user
        const stockLabel = stockThreshold != null
          ? `재고 ${stockThreshold}개 이상인`
          : stockFilter === "instock" ? "재고 있는" : "재고 제한적 이상인"
        const noStockChips = ["⟵ 이전 단계", "처음부터 다시"]
        if (prevCandidates.length > 0) {
          noStockChips.unshift(`전체 ${prevCandidates.length}개 보기`)
        }
        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount ?? prevCandidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevCandidates,
          displayedChips: noStockChips,
          displayedOptions: [],
          currentMode: prevState.currentMode ?? "recommendation",
          lastAction: "filter_by_stock",
        })
        return deps.jsonRecommendationResponse({
          text: `${stockLabel} 후보가 없습니다. 현재 ${prevCandidates.length}개 후보 중 재고 조건에 맞는 제품이 없어요.\n재고 조건을 완화하거나 '전체 보기'를 선택해주세요.`,
          purpose: "question",
          chips: noStockChips,
          isComplete: false,
          recommendation: null,
          sessionState,
          evidenceSummaries: null,
          candidateSnapshot: prevCandidates,
          requestPreparation: null,
          primaryExplanation: null,
          primaryFactChecked: null,
          altExplanations: [],
          altFactChecked: [],
          meta: {
            orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
          },
        })
      }

      // Build response from filtered snapshots without re-running full search
      console.log(`[stock-filter] ${stockFilter}: ${prevCandidates.length} → ${filteredSnapshots.length} candidates (from displayed)`)
      const stockChips = ["⟵ 이전 단계", "처음부터 다시"]
      if (filteredSnapshots.length < prevCandidates.length) {
        stockChips.unshift(`전체 ${prevCandidates.length}개 보기`)
      }
      const sessionState = carryForwardState(prevState, {
        candidateCount: filteredSnapshots.length,
        appliedFilters: filters,
        narrowingHistory,
        resolutionStatus: prevState.resolutionStatus ?? "broad",
        resolvedInput: currentInput,
        turnCount,
        displayedCandidates: filteredSnapshots,
        displayedChips: stockChips,
        displayedOptions: [],
        currentMode: prevState.currentMode ?? "recommendation",
        lastAction: "filter_by_stock",
      })
      const stockLabel = stockThreshold != null
        ? `재고 ${stockThreshold}개 이상인`
        : stockFilter === "instock" ? "재고 있는" : stockFilter === "limited" ? "재고 제한적 이상인" : "전체"
      // Build deterministic stock summary per candidate to prevent LLM hallucination
      const stockDetails = filteredSnapshots
        .map(c => `- ${c.displayCode}: 재고 ${c.totalStock ?? 0}개`)
        .join("\n")
      const responseText = stockDetails
        ? `${stockLabel} 후보 ${filteredSnapshots.length}개입니다.\n\n${stockDetails}`
        : `${stockLabel} 후보 ${filteredSnapshots.length}개입니다.`
      return deps.jsonRecommendationResponse({
        text: responseText,
        purpose: "recommendation",
        chips: stockChips,
        isComplete: true,
        recommendation: null,
        sessionState,
        evidenceSummaries: null,
        candidateSnapshot: filteredSnapshots,
        requestPreparation: null,
        primaryExplanation: null,
        primaryFactChecked: null,
        altExplanations: [],
        altFactChecked: [],
        meta: {
          orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus },
        },
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
      trace.add("comparison", "answer", { targets: (action as any).targets }, {}, "Product comparison requested")
      const compareQueryTarget = classifyQueryTarget(
        lastUserMsg.text,
        prevState.appliedFilters?.find(f => f.op !== "skip")?.field,
        prevState.lastAskedField
      )
      const entityProfileReply = compareQueryTarget.type === "series_comparison" || compareQueryTarget.type === "brand_comparison"
        ? await deps.handleDirectEntityProfileQuestion(lastUserMsg.text, currentInput, prevState)
        : null
      if (entityProfileReply) {
        const comparisonOptionState = buildComparisonOptionState()
        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState.candidateCount ?? candidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevState.displayedCandidates ?? [],
          displayedChips: comparisonOptionState.chips,
          displayedOptions: comparisonOptionState.displayedOptions,
          currentMode: "comparison",
          lastAction: "compare_products",
          lastComparisonArtifact: {
            comparedProductCodes: action.targets,
            comparedRanks: [],
            text: entityProfileReply.text,
            timestamp: Date.now(),
          },
        })

        const entityComparisonValidation = validateOptionFirstPipeline(
          entityProfileReply.text,
          comparisonOptionState.chips,
          comparisonOptionState.displayedOptions,
        )
        const comparisonText = entityComparisonValidation.correctedAnswer ?? entityProfileReply.text

        return deps.jsonRecommendationResponse({
          text: comparisonText,
          purpose: "comparison",
          chips: comparisonOptionState.chips,
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

      const snapshot = prevState.displayedCandidates?.length
        ? prevState.displayedCandidates
        : deps.buildCandidateSnapshot(candidates, evidenceMap)
      const targets = resolveProductReferences(action.targets, snapshot)
      const comparison = await compareProducts(targets, evidenceMap, provider)
      const comparisonOptionState = buildComparisonOptionState()

      const sessionState = carryForwardState(prevState, {
        candidateCount: prevState.candidateCount ?? candidates.length,
        appliedFilters: filters,
        narrowingHistory,
        resolutionStatus: prevState.resolutionStatus ?? "broad",
        resolvedInput: currentInput,
        turnCount,
        displayedCandidates: snapshot,
        displayedChips: comparisonOptionState.chips,
        displayedOptions: comparisonOptionState.displayedOptions,
        currentMode: "comparison",
        lastAction: "compare_products",
      })

      let comparisonText = comparison.text
      trace.add("comparison-result", "answer", {}, { textLength: comparisonText.length, chips: comparisonOptionState.chips }, "Comparison completed")
      const comparisonValidation = validateOptionFirstPipeline(
        comparisonText,
        comparisonOptionState.chips,
        comparisonOptionState.displayedOptions,
      )
      if (comparisonValidation.correctedAnswer) {
        comparisonText = comparisonValidation.correctedAnswer
        console.log(`[answer-validator:compare] Softened: ${comparisonValidation.unauthorizedActions.map(actionItem => actionItem.phrase).join(",")}`)
      }

      return deps.jsonRecommendationResponse({
        text: comparisonText,
        purpose: "comparison",
        chips: comparisonOptionState.chips,
        isComplete: false,
        recommendation: null,
        sessionState,
        evidenceSummaries: null,
        candidateSnapshot: snapshot,
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
      
      narrowingHistory.push(createNarrowingTurn({
        question: "follow-up",
        askedField: skipField,
        answer: lastUserMsg.text,
        extractedFilters: [skipFilter],
        candidateCountBefore: totalCandidateCount,
        candidateCountAfter: newResult.totalConsidered,
      }))
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
      const candidateCountBeforeFilter = restoreResult.remainingStages.at(-1)?.candidateCount ?? totalCandidateCount

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
      console.log(`[chip-filter-debug] (replace) filter=${JSON.stringify(filter)} testInput.diameterMm=${testInput.diameterMm} testFilters=${JSON.stringify(testFilters.map(f=>f.field+'='+f.value))}`)
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
        console.log(`[chip-filter-debug] (replace) ZERO RESULTS: filter=${filter.field}=${filter.value} currentInput.diameterMm=${testInput.diameterMm} totalBefore=${candidateCountBeforeFilter}`)
        // Build message with available alternatives so user can pick a valid value
        const { message: zeroResultMessage, chips: zeroResultChips } = buildZeroResultWithAlternatives(
          filter,
          filters,
          candidates,
          totalCandidateCount,
          action.previousValue,
        )
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
          zeroResultMessage,
          undefined, // existingStageHistory
          undefined, // excludeWorkPieceValues
          undefined, // responsePrefix
          zeroResultChips,
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
      console.log(`[chip-filter-debug] (apply) filter=${JSON.stringify(filter)} testInput.diameterMm=${testInput.diameterMm} testFilters=${JSON.stringify(testFilters.map(f=>f.field+'='+f.value))}`)
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

      if (testResult.totalConsidered === 0) {
        console.log(`[chip-filter-debug] (apply) ZERO RESULTS: filter=${filter.field}=${filter.value} currentInput.diameterMm=${testInput.diameterMm} totalBefore=${candidateCountBeforeFilter}`)
        console.log(`[orchestrator:guard] Filter ${filter.field}=${filter.value} would result in 0 candidates -> BLOCKED, excluding from chips`)
        // Build message with available alternatives so user can pick a valid value
        const excludeValues = filter.field === "workPieceName" ? [filter.value] : undefined
        const { message: zeroMsg, chips: zeroChips } = buildZeroResultWithAlternatives(
          filter,
          filters,
          candidates,
          totalCandidateCount,
        )
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
          zeroMsg,
          undefined, // existingStageHistory
          excludeValues,
          undefined, // responsePrefix
          zeroChips,
        )
      }

      filters.splice(0, filters.length, ...testFilters)
      currentInput = testInput
      const newCandidates = testResult.candidates
      const previousCandidateCount = candidateCountBeforeFilter

      const updatedHistory = [...baseHistoryForNext, createNarrowingTurn({
        question: baseHistoryForNext.length > 0 ? "follow-up" : "initial",
        askedField: prevState?.lastAskedField ?? filter.field,
        answer: lastUserMsg.text,
        extractedFilters: [filter],
        candidateCountBefore: previousCandidateCount,
        candidateCountAfter: testResult.totalConsidered,
      })]
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
      const updatedStages = [...existingStages, newStage]

      console.log(
        `[orchestrator:filter] ${filter.field}=${filter.value} | ${previousCandidateCount}->${testResult.totalConsidered} candidates | stages: ${updatedStages.map(stage => stage.stageName).join(" -> ")}`
      )
      if (nextFilterState.replacedExisting) {
        console.log(`[orchestrator:replace] ${filter.field} updated to ${filter.value}`)
      }

      turnCount = filterAppliedAt + 1
      const newStatus = checkResolution(newCandidates, narrowingHistory, testResult.totalConsidered)
      if (newStatus.startsWith("resolved")) {
        return deps.buildRecommendationResponse(
          form,
          newCandidates,
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

      return deps.buildQuestionResponse(
        form,
        newCandidates,
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
