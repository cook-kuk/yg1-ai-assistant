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
import { isPrecisionMode } from "@/lib/recommendation/runtime-flags"
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
import { getProviderForAgent } from "@/lib/llm/provider"
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
import { USE_STATE_REDUCER, USE_CHIP_SYSTEM, isSingleCallRouterEnabled, LLM_FREE_INTERPRETATION, ENABLE_PLANNER_DECISION, ENABLE_STATEFUL_CLARIFICATION_ARBITER } from "@/lib/feature-flags"
import { routeSingleCall } from "@/lib/recommendation/core/single-call-router"
import {
  naturalLanguageToFilters,
  naturalLanguageToFiltersStreaming,
  buildAppliedFilterFromAgentFilter,
  buildAppliedFilterFromAgentFilterWithTrace,
} from "@/lib/recommendation/core/sql-agent"
import { assessComplexity } from "@/lib/recommendation/core/complexity-router"
import { getDbSchemaSync, getDbSchema } from "@/lib/recommendation/core/sql-agent-schema-cache"
import { naturalLanguageToQuerySpec } from "@/lib/recommendation/core/query-planner"
import { querySpecToAppliedFilters, appliedFiltersToConstraints } from "@/lib/recommendation/core/query-spec-to-filters"
import { buildStructuredDraftClarificationOptions, buildStructuredFilterDraft } from "@/lib/recommendation/core/structured-filter-draft"
import { sortScoredCandidatesByQuerySort } from "@/lib/recommendation/core/query-sort-runtime"
import { decidePlannerOverride } from "@/lib/recommendation/core/planner-decision"
import { resolveMultiStageQuery, resolverProducedMeaningfulOutput, type MultiStageResolverResult } from "@/lib/recommendation/core/multi-stage-query-resolver"
import { isLegacyKgHintEnabled, isLegacyKgInterpreterEnabled } from "@/lib/recommendation/core/kg-runtime-policy"
import { logPatternMiningEntry } from "@/lib/recommendation/core/pattern-mining/logger"
import { tryKGDecision, extractEntities, tryParseSortPhrase, type KGSpecPatch } from "@/lib/recommendation/core/knowledge-graph"
import { parseDeterministic } from "@/lib/recommendation/core/deterministic-scr"
import { shouldDeferHardcodedSemanticExecution } from "@/lib/recommendation/core/semantic-execution-policy"
import {
  applyEditIntent,
  getEditIntentAffectedFields,
  hasEditSignal,
  parseEditIntent,
  shouldExecuteEditIntentDeterministically,
} from "@/lib/recommendation/core/edit-intent"
import { deriveChips, toChipState, toChipStateWithCandidates, compareChips, safeApplyChips } from "@/lib/recommendation/core/chip-system"
import { handleServeGeneralChatAction } from "@/lib/recommendation/infrastructure/engines/serve-engine-general-chat"
import { classifyPreSearchRoute } from "@/lib/recommendation/infrastructure/engines/pre-search-route"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import { shouldExecutePendingAction, pendingActionToFilter } from "@/lib/recommendation/domain/context/pending-action-resolver"
import { TurnPerfLogger, setCurrentPerfLogger } from "@/lib/recommendation/infrastructure/perf/turn-perf-logger"
import { applyPostFilterToProducts, buildAppliedFilterFromValue, buildFilterValueScope, extractFilterFieldValueMap, getFilterFieldDefinition, getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { normalizeRuntimeAppliedFilter } from "@/lib/recommendation/shared/runtime-filter-normalization"
import { traceRecommendation } from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import type { CanonicalProduct } from "@/lib/recommendation/domain/types"
import {
  buildConstraintClarificationQuestion,
  hasExplicitFilterIntent,
  hasExplicitRevisionIntent,
  parseExplicitFilterText,
  parseExplicitRevisionText,
} from "@/lib/recommendation/shared/constraint-text-parser"
import { DIRECT_PRODUCT_CODE_PATTERN } from "@/lib/recommendation/infrastructure/engines/serve-engine-assist-utils"
import { applyRuntimeCandidateOrdering } from "@/lib/recommendation/infrastructure/engines/runtime-candidate-ordering"

import { buildMemoryFromSession, recordHighlight, recordQA, recordSkip, recordRevision, recordConfusion } from "@/lib/recommendation/domain/memory/conversation-memory"
import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type { TurnResult } from "@/lib/recommendation/core/types"
import type { OrchestratorAction, OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  ChatMessage,
  DisplayedOption,
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
type ThinkingKind = "stage" | "deep"
type RuntimeThinkingState = {
  thinkingProcess: string | null
  thinkingDeep: string | null
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
  | { kind: "defer_holistic"; pendingField: string; raw: string; reasons: string[] }
  | { kind: "unresolved"; pendingField: string; raw: string }

const DEFAULT_CANDIDATE_PAGE_SIZE = 50
const PENDING_QUESTION_RECOVERY_ACTIONS = new Set<string>([
  "continue_narrowing",
  "skip_field",
  "replace_existing_filter",
  // 사용자가 pending question 도중 명시적으로 결과/네비/리셋을 요청하는 액션
  "show_recommendation",
  "go_back",
  "go_back_to_filter",
  "go_back_one_step", // edit-intent go_back_then_apply → bridgedV2Action.type
  "reset_session",
  "compare_products",
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
/**
 * Scan narrowingHistory for the filter with the largest absolute reduction.
 * Returns null if history is empty or no reduction occurred.
 * Used to surface the *actual* culprit in 0-result messages instead of always
 * blaming the most recently added filter.
 */
function findLargestReductionFilter(
  history: ReadonlyArray<{
    extractedFilters?: ReadonlyArray<{ field: string; value: string | number | boolean }>
    candidateCountBefore?: number
    candidateCountAfter?: number
  }>,
): { field: string; value: string; reduction: number; before: number; after: number } | null {
  let best: { field: string; value: string; reduction: number; before: number; after: number } | null = null
  for (const turn of history) {
    const before = turn.candidateCountBefore ?? 0
    const after = turn.candidateCountAfter ?? 0
    const reduction = before - after
    if (reduction <= 0) continue
    const f = turn.extractedFilters?.[0]
    if (!f) continue
    if (!best || reduction > best.reduction) {
      best = { field: f.field, value: String(f.value), reduction, before, after }
    }
  }
  return best
}

function buildZeroResultWithAlternatives(
  failedFilter: { field: string; value: string },
  activeFilters: Array<{ field: string; value: string }>,
  currentCandidates: ScoredProduct[],
  totalCandidateCount: number,
  previousValue?: string | null,
  narrowingHistory?: ReadonlyArray<{
    extractedFilters?: ReadonlyArray<{ field: string; value: string | number | boolean }>
    candidateCountBefore?: number
    candidateCountAfter?: number
  }>,
): { message: string; chips: string[] } {
  const failedLabel = getFilterFieldLabel(failedFilter.field)
  const failedValue = failedFilter.value

  // Get available values with counts for the failed field from current candidates
  const valueMap = extractFilterFieldValueMap(currentCandidates, [failedFilter.field])
  const distribution = valueMap.get(failedFilter.field)

  // Build condition summary (exclude failedFilter's field from active to avoid duplicates)
  const allConditions = [
    ...activeFilters
      .filter(f => f.field !== failedFilter.field)
      .map(f => `${getFilterFieldLabel(f.field)}: ${f.value}`),
    `${failedLabel}: ${failedValue}`,
  ]
  const conditionSummary = allConditions.join(" + ")

  const lines = [
    `${conditionSummary} 조건을 모두 적용하면 후보가 없습니다.`,
  ]

  // Surface the actual largest-reduction culprit if it differs from the
  // currently failing filter — otherwise the user blames the wrong filter.
  if (narrowingHistory && narrowingHistory.length > 0) {
    const culprit = findLargestReductionFilter(narrowingHistory)
    if (
      culprit &&
      (culprit.field !== failedFilter.field || String(culprit.value) !== String(failedFilter.value))
    ) {
      const culpritLabel = getFilterFieldLabel(culprit.field)
      lines.push(
        `→ 가장 크게 좁힌 필터는 ${culpritLabel}: ${culprit.value} 입니다 (${culprit.before}→${culprit.after}개). 이 필터를 먼저 풀어보세요.`
      )
    }
  }

  const chips: string[] = []

  if (distribution && distribution.size > 0) {
    // Sort by count descending, take top alternatives.
    // Drop empty/whitespace-only values + normalize known DB typos (AITiN→AlTiN).
    const normalize = (v: string): string =>
      v.trim().replace(/\bAITiN\b/gi, "AlTiN").replace(/\s+/g, " ")
    const sorted = [...distribution.entries()]
      .map(([val, count]) => [normalize(String(val ?? "")), count] as const)
      .filter(([val, count]) => count > 0 && val.length > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    const availableList = sorted
      .map(([val, count]) => `${val} (${count}개)`)
      .join(", ")
    lines.push(`현재 조건에서 선택 가능한 ${failedLabel}: ${availableList}`)

    // Build chips for each available value.
    // Skip prefix if value already starts with the label (prevents double-label loop
    // like "코팅 코팅 PM60" → "코팅: 코팅 PM60").
    const labelPrefixRe = new RegExp(`^${failedLabel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*[:\\s]`, "i")
    for (const [val, count] of sorted) {
      const prefix = labelPrefixRe.test(val) ? "" : `${failedLabel} `
      chips.push(`${prefix}${val} (${count}개)`)
    }
  } else {
    // BUG2: 후보 분포가 비어 있을 때(완전 0건 + 회복 단서 없음) — 사용자가 직접
    // 풀 필터를 선택하도록 active 필터 각각에 대해 "X 빼기" 칩을 자동 생성한다.
    // 이렇게 해야 사용자가 다음 액션을 잡을 수 있고, "조건을 변경하거나 상관없음"
    // 같은 막다른 카피로 끝나지 않는다.
    const otherFilters = activeFilters.filter(f => f.field !== failedFilter.field)
    if (otherFilters.length > 0) {
      lines.push(`${failedLabel}: ${failedValue} 와 호환되는 후보가 없습니다. 다른 조건을 풀어보세요:`)
      for (const f of otherFilters) {
        const fLabel = getFilterFieldLabel(f.field)
        chips.push(`${fLabel} ${f.value} 빼기`)
      }
    } else {
      lines.push(`${failedLabel} 조건을 변경하거나 '상관없음'을 선택해주세요.`)
    }
  }

  // Add revert chip if there's a previous value to go back to
  if (previousValue) {
    chips.unshift(`${previousValue}로 돌아가기`)
  }

  // Always add navigation + reset escape hatch (BUG-2 0-result fallback)
  // "처음부터 다시" 는 edit-intent의 reset_all 패턴에 매핑되어 안전하게 동작
  if (!chips.some(c => c.includes("이전 단계"))) chips.push("⟵ 이전 단계")
  if (!chips.some(c => c.includes("처음부터"))) chips.push("↻ 처음부터 다시")

  return { message: lines.join("\n"), chips }
}

/**
 * 첫 턴 filter_by_stock 액션 처리 결정.
 *
 * 회귀 방어: KG orchestrator 가 "재고 있는 거만" 메시지를 filter_by_stock 으로
 * 분류하면 기본 경로는 retrieval 을 SKIP 하고 prevState.displayedCandidates 에
 * post-filter 를 적용한다. 첫 턴엔 displayedCandidates 가 비어 있어서 0건 응답
 * 이 됨. 수정 (564c7cd): 첫 턴이면 stockStatus=instock 필터를 주입하고 정상
 * retrieval 수행.
 *
 * 반환값:
 * - "noop" — 정상 경로 (filter_by_stock 이 아니거나 displayedCandidates 존재)
 * - "injectAndClear" — stockStatus 필터 주입 후 earlyAction 해제
 * - "clearEarlyAction" — stockStatus 필터 이미 존재, earlyAction 만 해제
 */
export type FirstTurnStockFilterDecision = "noop" | "injectAndClear" | "clearEarlyAction"

export function computeFirstTurnStockFilterDecision(args: {
  earlyAction: string | null | undefined
  prevDisplayedCount: number
  hasStockStatusFilter: boolean
}): FirstTurnStockFilterDecision {
  const isFirstTurnStock =
    args.earlyAction === "filter_by_stock" && args.prevDisplayedCount === 0
  if (!isFirstTurnStock) return "noop"
  return args.hasStockStatusFilter ? "clearEarlyAction" : "injectAndClear"
}

export function shouldReplayUnresolvedPendingQuestion(
  pendingReplyKind: PendingQuestionReplyResolution["kind"],
  earlyAction: string | null
): boolean {
  return pendingReplyKind === "unresolved" && !PENDING_QUESTION_RECOVERY_ACTIONS.has(earlyAction ?? "")
}

const PENDING_SELECTION_RESULT_INTENT_RE = /(?:추천\s*(?:해줘|해주|해주세요|좀)?|보여줘|제품\s*(?:보여줘|보기)|찾아줘|비교|차이|vs|versus)/iu
const PENDING_SELECTION_COMPOUND_CUE_RE = /(?:\b(?:and|then)\b|그리고|또|말고|바꾸고|변경하고|다른|추가로|도\s*(?:보여|찾아|추천))/iu

function getPendingSelectionAllowedFields(
  pendingField: string,
  resolvedField: string,
): Set<string> {
  const fields = new Set<string>([pendingField, resolvedField])
  const pendingCanonical = getFilterFieldDefinition(pendingField)?.canonicalField
  if (pendingCanonical) fields.add(pendingCanonical)
  const resolvedCanonical = getFilterFieldDefinition(resolvedField)?.canonicalField
  if (resolvedCanonical) fields.add(resolvedCanonical)
  return fields
}

function shouldDeferPendingSelectionEarlyResolve(args: {
  raw: string
  pendingField: string
  resolvedField: string
  pendingDetActions: ReturnType<typeof parseDeterministic>
}): { defer: boolean; reasons: string[] } {
  const { raw, pendingField, resolvedField, pendingDetActions } = args
  const reasons: string[] = []
  const allowedFields = getPendingSelectionAllowedFields(pendingField, resolvedField)

  const deterministicFields = Array.from(new Set(
    pendingDetActions
      .filter(action => action.type === "apply_filter" && action.field)
      .map(action => action.field!)
  ))
  const recognizedEntityFields = Array.from(new Set(
    extractEntities(raw)
      .map(entity => entity.field)
      .filter(Boolean)
  ))
  const extraDeterministicFields = deterministicFields.filter(field => !allowedFields.has(field))
  const extraRecognizedFields = recognizedEntityFields.filter(field => !allowedFields.has(field))

  if (extraDeterministicFields.length > 0 || extraRecognizedFields.length > 0) {
    reasons.push(`extra_entities:${Array.from(new Set([...extraDeterministicFields, ...extraRecognizedFields])).join("|")}`)
  }
  if (PENDING_SELECTION_RESULT_INTENT_RE.test(raw)) {
    reasons.push("result_intent")
  }
  if (PENDING_SELECTION_COMPOUND_CUE_RE.test(raw) || deterministicFields.length >= 2) {
    reasons.push("compound_utterance")
  }

  return { defer: reasons.length > 0, reasons }
}

const BARE_RECOMMEND_REQUEST_KEYS = new Set([
  "추천해줘",
  "추천해주세요",
  "추천해줄래",
  "골라줘",
  "찾아줘",
  "좋은거",
  "좋은거골라줘",
  "괜찮은거",
  "괜찮은거골라줘",
  "뭐가좋아",
  "뭐가좋을까",
])

export function isBareRecommendationRequest(
  message: string,
  hasSessionState: boolean,
): boolean {
  if (hasSessionState) return false
  const normalized = message
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[!.?~]+$/g, "")
    .trim()
  return BARE_RECOMMEND_REQUEST_KEYS.has(normalized)
}

export function shouldBypassFirstTurnMultiStageResolver(params: {
  message: string
  hasEditIntent: boolean
  hasSort: boolean
  stageOneActionCount: number
}): boolean {
  return isBareRecommendationRequest(params.message, false)
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
        result.sessionState.resultContext?.candidates.length
        ?? prevState?.displayedCandidates?.length
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

  // hintedFields가 있지만 activeFilters에 없는 경우 → 새 필드 적용 (리비전이 아닌 신규 필터)
  // 예: pending=coating인데 "Ball로 바꿔주세요" → hintedFields=["toolSubtype"]
  // toolSubtype이 activeFilters에 없어도 힌트 필드를 신뢰해야 함
  if (hintedFields.length > 0) return [...new Set(hintedFields)]

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

  // ── Det SCR fast path: if deterministic parser handles this message,
  // skip the LLM explicit filter extraction entirely so the SCR path takes over.
  if (process.env.DETERMINISTIC_SCR !== "0" && !shouldDeferHardcodedSemanticExecution(raw)) {
    try {
      const { parseDeterministic } = await import("@/lib/recommendation/core/deterministic-scr")
      const detActions = parseDeterministic(raw)
      if (detActions.length > 0) {
        console.log(`[explicit-filter] det SCR matched ${detActions.length}, skipping LLM path`)
        return null  // let SCR handle it
      }
    } catch (err) {
      console.warn("[explicit-filter] det SCR import failed:", (err as Error).message)
    }
  }

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

/**
 * Extract the value being negated from a message like "TiAlN 빼고 나머지요".
 * Dynamically uses all registered filter fields — no hardcoding.
 * Returns { field, rawValue, displayValue } if found, null otherwise.
 */
function normalizeNegationCueText(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[\s\-_()]+/g, "")
    .replace(/([a-z])\1+/g, "$1")
}

function normalizeAlternativeExplorationLookupText(value: string): string {
  return normalizePendingSelectionText(String(value))
    .replace(/[^a-z0-9가-힣]+/giu, "")
}

function hasAlternativeNegationCue(message: string): boolean {
  const normalized = normalizeAlternativeExplorationLookupText(message)
  if (!normalized) return false

  return [
    "빼고",
    "뺴고",
    "빼구",
    "제외",
    "말고",
    "없이",
    "아닌것",
    "아닌걸",
    "아닌거",
    "없는거",
    "없는걸로",
    "만아니면",
    "가아닌",
    "이아닌",
    "아니것",
    "아니거",
  ].some(cue => normalized.includes(normalizeAlternativeExplorationLookupText(cue)))
}

function buildNegatedPhraseCandidates(cleaned: string): string[] {
  const trimmed = cleaned.replace(/^[\s,.;:!?？]+|[\s,.;:!?？]+$/g, "").trim()
  if (!trimmed) return []

  const strippedLead = trimmed.replace(
    /^(?:그리고|그리고요|그럼|그러면|근데|그런데|혹시|음|아|저기|그냥)\s+/u,
    "",
  ).trim()

  const candidates: string[] = []
  const pushCandidate = (value: string) => {
    const next = value.trim()
    if (!next || candidates.includes(next)) return
    candidates.push(next)
  }

  pushCandidate(strippedLead)
  pushCandidate(trimmed)

  const tokens = strippedLead.split(/\s+/).filter(Boolean)
  if (tokens.length >= 2) pushCandidate(tokens.slice(-2).join(" "))
  if (tokens.length >= 1) pushCandidate(tokens[tokens.length - 1])

  return candidates
}

function buildNegationFieldTryOrder(msg: string): string[] {
  const normalizedMsg = normalizeNegationCueText(msg)
  const explicitCueFields = getRegisteredFilterFields().filter(field => (
    getFilterFieldQueryAliases(field).some(alias => {
      const normalizedAlias = normalizeNegationCueText(alias)
      return normalizedAlias.length >= 2 && normalizedMsg.includes(normalizedAlias)
    })
  ))

  return Array.from(new Set([
    ...explicitCueFields,
    "brand",
    "seriesName",
    "coating",
    "toolSubtype",
    "fluteCount",
    "diameterMm",
    "workPieceName",
    "material",
    "shankType",
  ]))
}

export function extractNegatedValue(msg: string): { field: string; rawValue: string | number; displayValue: string } | null {
  // Strip negation suffixes to isolate the value
  const cleaned = msg
    .replace(/\s*(빼고|뺴고|빼구|제외|말고|없이|아닌\s*것|없는\s*거로?|만\s*아니면\s*(?:돼|된다니까|됩니다|되잖아)?|아닌\s*거|말고\s*다른|없는\s*걸로).*$/u, "")
    .replace(/^(?:아니\s*)?/u, "")
    .trim()

  const relaxedCleaned = cleaned === msg.trim()
    ? msg
      .replace(/\s*(?:아닌\s*것(?:들|중에)?|아니\s*것(?:들|중에)?|아니것(?:들|중에)?|아닌\s*거|아니\s*거|아니거).*$/u, "")
      .replace(/^(?:아닌\s*|아니\s*)?/u, "")
      .trim()
    : cleaned

  if (!relaxedCleaned) return null

  const phraseCandidates = buildNegatedPhraseCandidates(relaxedCleaned)
  if (phraseCandidates.length === 0) return null

  for (const phrase of phraseCandidates) {
    const detActions = parseDeterministic(phrase)
      .filter(action => action.type === "apply_filter")
    if (detActions.length === 1) {
      const [action] = detActions
      return {
        field: action.field,
        rawValue: action.value,
        displayValue: phrase,
      }
    }
  }

  // Try buildAppliedFilterFromValue with each registered field
  // brand/seriesName first — "TANK-POWER 빼고" ���은 브랜드 제외�� 코팅보다 먼저 잡아야 함
  const fieldsToTry = buildNegationFieldTryOrder(msg)
  for (const phrase of phraseCandidates) {
    for (const field of fieldsToTry) {
      const filter = buildAppliedFilterFromValue(field, phrase)
      if (filter) {
        const normalizedFilter = normalizeRuntimeAppliedFilter(filter, filter.appliedAt ?? 0)
        return {
          field: normalizedFilter.field,
          rawValue: typeof normalizedFilter.rawValue === "object" ? String(normalizedFilter.rawValue) : normalizedFilter.rawValue,
          displayValue: phrase,
        }
      }
    }
  }

  // Fallback: try all registered fields
  for (const phrase of phraseCandidates) {
    for (const field of getRegisteredFilterFields()) {
      if (fieldsToTry.includes(field)) continue
      const filter = buildAppliedFilterFromValue(field, phrase)
      if (filter) {
        const normalizedFilter = normalizeRuntimeAppliedFilter(filter, filter.appliedAt ?? 0)
        return {
          field: normalizedFilter.field,
          rawValue: typeof normalizedFilter.rawValue === "object" ? String(normalizedFilter.rawValue) : normalizedFilter.rawValue,
          displayValue: phrase,
        }
      }
    }
  }

  return null
}

function rebuildResolvedInputFromFilters(
  form: ProductIntakeForm,
  filters: AppliedFilter[],
  deps: Pick<ServeEngineRuntimeDependencies, "mapIntakeToInput" | "applyFilterToInput">
): RecommendationInput {
  let nextInput = deps.mapIntakeToInput(form)

  for (const filter of filters) {
    if (filter.op === "skip" || filter.op === "neq") continue
    nextInput = deps.applyFilterToInput(nextInput, filter)
  }

  return nextInput
}

function hasGlobalStageOneRelaxationSignal(msg: string): boolean {
  return /(?:^|\s)(?:\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694|\uC74C)?|\uC544\uBB34\uAC70\uB098|\uBB50\uB4E0(?:\s*\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694)?)?|\uB2E4\s*\uAD1C\uCC2E(?:\uC544|\uC544\uC694)?|\uBB34\uAD00)(?:$|\s)/iu.test(msg)
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
  const pendingDetActions = shouldDeferHardcodedSemanticExecution(raw)
    ? []
    : parseDeterministic(raw)
  if (!raw) return { kind: "none" }
  if (raw.length > 80) return { kind: "unresolved", pendingField, raw }
  if (/[?？]/.test(raw)) return { kind: "side_question", pendingField, raw }
  if (hasExplicitRevisionSignal(raw)) {
    console.log(`[pending-selection] Detected revision signal in "${raw.slice(0, 30)}" — deferring to revision resolver`)
    return { kind: "unresolved", pendingField, raw }
  }
  // 위임 표현 → skip으로 처리 (추천해줘, 알아서 해줘, 아무거나 한개 등)
  // 단, 메시지에 새 필터 의도(KG entity 또는 deterministic SCR action)가 있으면
  // 위임이 아님 — 다음 레이어로 넘김. det-SCR 추가는 J06 ("Y 코팅으로 추천해줘")
  // 같은 케이스 방어: KG 가 "Y 코팅" 별칭을 모르고 entity 0개를 반환해도, det-SCR 의
  // letterCoatingMatch 가 Y-Coating 으로 잡으므로 위임이 아니라 코팅 지정으로 해석.
  if (/^(?:.*(?:추천해|골라|알아서|너가|니가|한개|하나만|아무거나).*(?:줘|해줘|해|주세요|요)?|추천으로\s*골라줘)$/u.test(raw)
      && pendingDetActions.length === 0) {
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
  if (/뭐야|뭔지|설명|차이|왜|어떻게|몇개|종류|비교|결과|처음부터|초기화|리셋|reset|이전 단계|알려줘|알려|궁금|공장|영업소|연락|번호|정보|회사|사장|회장|매출|주주|지점|사우디|해외|국가|나라|도시|어디|재고|납기|가격|배송|리드\s*타임|stock|inventory|price|lead\s*time|적합|카탈로그|스펙/u.test(raw)) {
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

  const pendingSelectionDefer = shouldDeferPendingSelectionEarlyResolve({
    raw,
    pendingField,
    resolvedField,
    pendingDetActions,
  })
  if (pendingSelectionDefer.defer) {
    console.log(
      `[pending-selection] Deferring holistic parse for "${raw.slice(0, 40)}" (reasons=${pendingSelectionDefer.reasons.join(",")})`
    )
    return {
      kind: "defer_holistic",
      pendingField: resolvedField,
      raw,
      reasons: pendingSelectionDefer.reasons,
    }
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
  const pendingDefinition = getFilterFieldDefinition(pendingField)
  const resolvedDefinition = getFilterFieldDefinition(resolvedField)
  const freeformField =
    pendingDefinition?.kind === "number"
      ? pendingField
      : resolvedDefinition?.kind === "number"
        ? resolvedField
        : null
  const parsedDirect = freeformField ? parseAnswerToFilter(freeformField, raw) : null
  const resolvedValue = parsedDirect ? null : selectedValue ?? null

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

  // J06 fix: before declaring unresolved, ask deterministic SCR if it has any
  // filter actions for this message. "Y 코팅으로 추천해줘" parses cleanly to
  // coating=Y-Coating in det-SCR but never matched a chip/option above, so we
  // would have dropped it. Prefer an action targeting the current pendingField,
  // otherwise take the first apply_filter action.
  const deferredDetHint = pendingDetActions.find(action => (
    action.type === "apply_filter"
    && (action.field === pendingField || action.field === resolvedField)
  )) ?? pendingDetActions.find(action => action.type === "apply_filter")

  if (deferredDetHint?.type === "apply_filter") {
    console.log(
      `[pending-selection] Deferred det-SCR hint field="${deferredDetHint.field}" value="${deferredDetHint.value}" (pending="${pendingField}")`
    )
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

  // ── Fast path: "N날로 바꿔줘" 패턴을 deterministic하게 fluteCount revision으로 처리 ──
  const fluteRevisionMatch = raw.match(/(\d+)\s*날\s*(?:로|으로)\s*(?:바꿔|변경|교체)/)
  if (fluteRevisionMatch) {
    const newFluteValue = parseInt(fluteRevisionMatch[1], 10)
    const existingFluteFilter = activeFilters.find(f => f.field === "fluteCount" && f.op !== "skip")
    const existingFluteNum = existingFluteFilter ? parseInt(String(existingFluteFilter.rawValue ?? existingFluteFilter.value), 10) : NaN
    if (existingFluteFilter && newFluteValue > 0 && newFluteValue <= 12 && newFluteValue !== existingFluteNum) {
      const nextFilter = buildAppliedFilterFromValue("fluteCount", newFluteValue, existingFluteFilter.appliedAt ?? 0)
      if (nextFilter) {
        return {
          kind: "resolved",
          request: {
            targetField: "fluteCount",
            previousValue: String(existingFluteFilter.value),
            nextFilter,
          },
        }
      }
    }
  }

  // ── Fast path: "X로 바꿔줘" 형상 revision — toolSubtype 필터가 있을 때 ──
  const { canonicalizeToolSubtype } = await import("@/lib/recommendation/shared/patterns")
  const subtypeRevisionMatch = raw.match(/(.+?)\s*(?:로|으로)\s*(?:바꿔|변경|교체)/)
  if (subtypeRevisionMatch) {
    const candidateValue = subtypeRevisionMatch[1].trim()
    const canonical = canonicalizeToolSubtype(candidateValue)
    if (canonical) {
      const existingSubtypeFilter = activeFilters.find(f => f.field === "toolSubtype" && f.op !== "skip")
      if (existingSubtypeFilter && String(existingSubtypeFilter.rawValue ?? existingSubtypeFilter.value) !== canonical) {
        const nextFilter = buildAppliedFilterFromValue("toolSubtype", canonical, existingSubtypeFilter.appliedAt ?? 0)
        if (nextFilter) {
          return {
            kind: "resolved",
            request: {
              targetField: "toolSubtype",
              previousValue: String(existingSubtypeFilter.value),
              nextFilter,
            },
          }
        }
      }
    }
  }

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
      if (!doesCandidatePoolContainFilterValue(field, parsed, sessionState)) {
        // Revision 대상 필드에 eq/includes 필터가 이미 있으면, candidate pool이
        // 그 값으로 좁혀져 새 값이 없는 게 정상 (예: 6날 풀에서 4날).
        // 이 경우만 검증 스킵 — 다른 필드는 정상 검증.
        const hasRealFilterOnField = matchingFilters.some(f => f.op !== "skip")
        if (!hasRealFilterOnField) continue
      }

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
    extraResponseContext?: string,
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
    displayedProducts?: RecommendationDisplayedProductRequestDto[] | null,
    extraResponseContext?: string,
  ) => Promise<Response>
  /**
   * Optional hook fired the moment the SQL agent (or any other source) produces
   * a Korean reasoning trail. The /api/recommend/stream endpoint wires this to
   * an SSE "thinking" event so the UI can render it Claude-style before the
   * filter result and narrative arrive.
   *
   * Two modes:
   *  - opts.delta = true  → `text` is a *delta* to append to whatever the UI
   *                          has already shown. Used for true token-by-token
   *                          streaming from provider.stream().
   *  - opts undefined / delta=false → `text` is the *complete* reasoning so
   *                          far; the UI should replace its current value.
   *                          Used for non-streaming providers and fallbacks.
   */
  onThinking?: (text: string, opts?: { delta?: boolean; kind?: "deep" | "stage" }) => void
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
  requestPreparation: ReturnType<typeof prepareRequest> | null,
  chipsOverride?: string[],
  pendingClarification?: ExplorationSessionState["pendingClarification"],
  displayedOptionsOverride?: DisplayedOption[],
) {
  const defaultChips = filters.length > 0 ? ["⟵ 이전 단계", "처음부터 다시"] : ["처음부터 다시"]
  const chips = chipsOverride && chipsOverride.length > 0
    ? [...chipsOverride, ...defaultChips.filter(c => !chipsOverride.includes(c))]
    : defaultChips
  const sessionState = carryForwardState(prevState, {
    appliedFilters: filters,
    narrowingHistory,
    resolutionStatus: prevState.resolutionStatus ?? "narrowing",
    resolvedInput: currentInput,
    turnCount,
    displayedChips: chips,
    displayedOptions: displayedOptionsOverride ?? [],
    currentMode: "question",
    lastAction: "ask_clarification",
    pendingAction: null,
    pendingClarification: pendingClarification ?? null,
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

function formatRepairFilterValue(filter: AppliedFilter): string {
  const raw = filter.rawValue ?? filter.value
  if (Array.isArray(raw)) return raw.map(value => String(value)).filter(Boolean).join("/")
  if (typeof raw === "number") {
    if (filter.field === "fluteCount") return `${raw}날`
    if (filter.field.toLowerCase().includes("diameter") || filter.field.toLowerCase().includes("length")) {
      return `${raw}mm`
    }
    return String(raw)
  }
  if (typeof raw === "boolean") return raw ? "yes" : "no"
  return String(raw ?? "").trim()
}

function buildRepairClarification(questionFilters: AppliedFilter[]): { question: string; chips: string[] } {
  const latestFilters = [...questionFilters]
    .sort((left, right) => (right.appliedAt ?? 0) - (left.appliedAt ?? 0))
    .slice(0, 3)
  const summary = latestFilters
    .map(filter => `${getFilterFieldLabel(filter.field)}=${formatRepairFilterValue(filter)}`)
    .filter(Boolean)
    .join(", ")

  const chips = Array.from(new Set([
    ...latestFilters
      .map(filter => formatRepairFilterValue(filter))
      .filter(Boolean)
      .map(value => `${value} 말고`),
    "직접 입력",
  ]))

  const question = summary
    ? `방금 해석한 조건 중 어디가 잘못 반영됐는지 알려주세요. 현재는 ${summary} 로 반영돼 있습니다.`
    : "방금 해석한 조건 중 어디가 잘못됐는지 알려주세요. 잘못 반영된 값을 바로 고칠 수 있습니다."

  return { question, chips }
}

function extractSnapshotFieldValue(candidate: CandidateSnapshot, field: string): string | null {
  switch (field) {
    case "coating":
      return candidate.coating?.trim() || null
    case "toolSubtype":
      return candidate.toolSubtype?.trim() || null
    case "seriesName":
      return candidate.seriesName?.trim() || null
    case "brand":
      return candidate.brand?.trim() || null
    case "fluteCount":
      return typeof candidate.fluteCount === "number" ? `${candidate.fluteCount}날` : null
    case "diameterMm":
      return typeof candidate.diameterMm === "number" ? `${candidate.diameterMm}mm` : null
    default:
      return null
  }
}

function extractNegatedValueFromContext(
  prevState: ExplorationSessionState,
  message: string,
): { field: string; rawValue: string | number; displayValue: string } | null {
  const normalizedMessage = normalizeAlternativeExplorationLookupText(message)
  if (!normalizedMessage) return null

  const matches: Array<{
    field: string
    rawValue: string | number
    displayValue: string
    priority: number
    length: number
  }> = []

  const pushMatch = (
    field: string,
    rawValue: string | number,
    displayValue: string | number | null | undefined,
    priority: number,
  ) => {
    const display = String(displayValue ?? rawValue ?? "").trim()
    const normalizedDisplay = normalizeAlternativeExplorationLookupText(display)
    if (!normalizedDisplay || !normalizedMessage.includes(normalizedDisplay)) return

    matches.push({
      field,
      rawValue,
      displayValue: display,
      priority,
      length: normalizedDisplay.length,
    })
  }

  for (const filter of prevState.appliedFilters ?? []) {
    if (!filter?.field || filter.op === "skip") continue
    const rawValue = filter.rawValue ?? filter.value
    if (typeof rawValue !== "string" && typeof rawValue !== "number") continue
    pushMatch(filter.field, rawValue, rawValue, 3)
  }

  for (const option of prevState.displayedOptions ?? []) {
    if (!option?.field || option.field === "_action" || option.field === "skip") continue
    pushMatch(option.field, option.value, option.value, 4)
    pushMatch(option.field, option.value, option.label, 2)
  }

  const snapshots = prevState.lastRecommendationArtifact ?? prevState.displayedCandidates ?? []
  const snapshotFields = ["coating", "toolSubtype", "seriesName", "brand", "fluteCount", "diameterMm"] as const
  for (const snapshot of snapshots) {
    for (const field of snapshotFields) {
      const value = extractSnapshotFieldValue(snapshot, field)
      if (!value) continue
      pushMatch(field, value, value, 1)
    }
  }

  return matches
    .sort((left, right) => right.priority - left.priority || right.length - left.length)
    .map(({ field, rawValue, displayValue }) => ({ field, rawValue, displayValue }))
    [0] ?? null
}

function isAlternativeExplorationQuestionV2(message: string): boolean {
  const raw = message.trim()
  if (!raw) return false

  const recommendationCue = /(?:추천|보여|고를|선택)/u.test(raw)
  const availabilityCue = /(?:있어|있어요|있나요|있습니까|있을까|가능|가능해|가능한가)/u.test(raw)
  const asksAlternatives =
    /(?:뭐가|무엇이|어떤|다른)\s*(?:있어|있나요|있습니까|좋아|나아요|가능|거|걸|옵션|코팅|형상)?/u.test(raw)
    || /대안|다른\s*옵션/u.test(raw)
    || (recommendationCue && availabilityCue)
  const questionLike = /[?？]/.test(raw) || /(?:있어|있나요|있을까|가능해|가능한가|좋아|나아요)/u.test(raw)
  const explicitReplacement = /(?:으로\s+\S+|(?:으로|로)\s*(?:바꿔|변경|수정))/u.test(raw)

  return asksAlternatives && questionLike && !explicitReplacement
}

type AlternativeExplorationClarification = {
  question: string
  chips: string[]
  displayedOptions: DisplayedOption[]
  pendingClarification: ExplorationSessionState["pendingClarification"]
}

type ClarificationArbiterDecisionName =
  | "keep_current_clarification"
  | "use_state_options"
  | "continue_legacy"

interface ClarificationArbiterDecision {
  decision: ClarificationArbiterDecisionName
  confidence: number
  reasoning: string
  targetField: string | null
  excludedValue: string | number | null
}

type ClarificationArbiterOutcome =
  | { kind: "keep_current" }
  | { kind: "use_state_options"; clarification: AlternativeExplorationClarification }
  | { kind: "continue_legacy"; result: MultiStageResolverResult }

function buildRuntimeClarificationCandidate(params: {
  question: string
  chips: string[]
  askedField?: string | null
  reasoning?: string
}): MultiStageResolverResult {
  return {
    source: "clarification",
    filters: [],
    sort: null,
    routeHint: "none",
    intent: "ask_clarification",
    clearOtherFilters: false,
    removeFields: [],
    followUpFilter: null,
    confidence: 0,
    unresolvedTokens: [],
    reasoning: params.reasoning ?? "clarification:runtime",
    clarification: {
      question: params.question,
      chips: params.chips,
      askedField: params.askedField ?? null,
    },
  }
}

function tryParseClarificationArbiterJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
  ]
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Ignore malformed candidates and try the next one.
    }
  }

  return null
}

function normalizeClarificationArbiterConfidence(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(1, parsed))
}

function resolveClarificationArbiterField(raw: unknown): string | null {
  const value = String(raw ?? "").trim()
  if (!value) return null

  const normalized = normalizeAlternativeExplorationLookupText(value)
  for (const field of getRegisteredFilterFields()) {
    if (normalizeAlternativeExplorationLookupText(field) === normalized) return field
    if (
      getFilterFieldQueryAliases(field).some(alias =>
        normalizeAlternativeExplorationLookupText(alias) === normalized,
      )
    ) {
      return field
    }
  }

  return null
}

function summarizeClarificationArbiterFilters(filters: AppliedFilter[]): string {
  if (filters.length === 0) return "none"

  return filters
    .slice(0, 6)
    .map(filter => `${getFilterFieldLabel(filter.field)} ${filter.op} ${formatRepairFilterValue(filter)}`)
    .join(" | ")
}

function summarizeClarificationArbiterOptions(options: DisplayedOption[]): string {
  if (options.length === 0) return "none"

  return options
    .slice(0, 6)
    .map(option => `${option.field}:${option.value} (${option.count})`)
    .join(" | ")
}

function summarizeClarificationArbiterCandidates(prevState: ExplorationSessionState): string {
  const snapshots = prevState.lastRecommendationArtifact ?? prevState.displayedCandidates ?? []
  if (snapshots.length === 0) return "none"

  return snapshots
    .slice(0, 5)
    .map(candidate => {
      const parts = [
        candidate.displayCode ?? candidate.productCode ?? candidate.seriesName ?? "candidate",
        candidate.toolSubtype ? `shape=${candidate.toolSubtype}` : null,
        candidate.coating ? `coating=${candidate.coating}` : null,
        typeof candidate.fluteCount === "number" ? `flute=${candidate.fluteCount}` : null,
      ].filter(Boolean)
      return parts.join(", ")
    })
    .join(" | ")
}

function buildClarificationArbiterPrompt(
  prevState: ExplorationSessionState,
  result: MultiStageResolverResult,
  userMessage: string,
): { systemPrompt: string; userPrompt: string } {
  const clarification = result.clarification
  const systemPrompt = [
    "You are a clarification arbiter for a stateful industrial tool recommendation system.",
    "State/UI is the source of truth. Never invent product data, option values, or fields.",
    "Decide only one of these actions:",
    '- "keep_current_clarification": the existing clarification should be shown as-is.',
    '- "use_state_options": instead of a generic clarification, show current UI/state options for one existing field.',
    '- "continue_legacy": do not ask a clarification now; let the existing deterministic/runtime logic continue unchanged.',
    "Only choose use_state_options when the target field is already supported by displayedOptions, displayedCandidates, or current state.",
    "Prefer continue_legacy when the current clarification would interrupt a turn that can keep flowing without another question.",
    "Preserve current filters, domain, and session truth.",
    "Return JSON only.",
    '{"decision":"keep_current_clarification|use_state_options|continue_legacy","confidence":0.0,"reasoning":"","targetField":null,"excludedValue":null}',
  ].join("\n")

  const userPrompt = [
    `User message: ${userMessage}`,
    `Current filters: ${summarizeClarificationArbiterFilters(prevState.appliedFilters ?? [])}`,
    `Current mode: ${prevState.currentMode ?? "unknown"}`,
    `Last asked field: ${prevState.lastAskedField ?? "none"}`,
    `Candidate count: ${prevState.candidateCount ?? 0}`,
    `Displayed options: ${summarizeClarificationArbiterOptions(prevState.displayedOptions ?? [])}`,
    `Displayed candidates: ${summarizeClarificationArbiterCandidates(prevState)}`,
    `Existing clarification question: ${clarification?.question ?? "none"}`,
    `Existing clarification chips: ${(clarification?.chips ?? []).join(" | ") || "none"}`,
    `Resolver reasoning: ${result.reasoning || "none"}`,
  ].join("\n")

  return { systemPrompt, userPrompt }
}

function normalizeClarificationArbiterDecision(raw: string): ClarificationArbiterDecision | null {
  const parsed = tryParseClarificationArbiterJson(raw)
  if (!parsed) return null

  const decision = String(parsed.decision ?? "").trim() as ClarificationArbiterDecisionName
  if (!["keep_current_clarification", "use_state_options", "continue_legacy"].includes(decision)) {
    return null
  }

  const rawExcludedValue = parsed.excludedValue
  const excludedValue =
    typeof rawExcludedValue === "string" || typeof rawExcludedValue === "number"
      ? rawExcludedValue
      : null

  return {
    decision,
    confidence: normalizeClarificationArbiterConfidence(parsed.confidence),
    reasoning: String(parsed.reasoning ?? "").trim(),
    targetField: resolveClarificationArbiterField(parsed.targetField),
    excludedValue,
  }
}

export function applyClarificationArbiterDecision(params: {
  decision: ClarificationArbiterDecision
  prevState: ExplorationSessionState
  result: MultiStageResolverResult
  userMessage: string
}): ClarificationArbiterOutcome {
  const { decision, prevState, result, userMessage } = params

  if (decision.decision === "use_state_options") {
    const negatedValue = extractNegatedValue(userMessage) ?? extractNegatedValueFromContext(prevState, userMessage)
    const targetField = decision.targetField ?? negatedValue?.field ?? result.clarification?.askedField ?? prevState.lastAskedField ?? null
    if (!targetField) return { kind: "keep_current" }

    const excludedValue = decision.excludedValue ?? negatedValue?.rawValue ?? null
    const excludedLabel =
      negatedValue?.displayValue
      ?? (typeof excludedValue === "string" || typeof excludedValue === "number" ? String(excludedValue) : null)
    const clarification = buildAlternativeExplorationClarificationV2(
      prevState,
      targetField,
      excludedValue,
      excludedLabel,
    )
    return clarification
      ? { kind: "use_state_options", clarification }
      : { kind: "keep_current" }
  }

  if (decision.decision === "continue_legacy") {
    const hasExecutionSignal =
      result.filters.length > 0
      || result.removeFields.length > 0
      || !!result.sort
      || result.clearOtherFilters
      || !!result.followUpFilter
      || (result.intent !== "ask_clarification" && result.intent !== "none")

    return {
      kind: "continue_legacy",
      result: hasExecutionSignal
        ? {
          ...result,
          clarification: null,
          reasoning: `${result.reasoning}|arbiter:continue_legacy${decision.reasoning ? `:${decision.reasoning}` : ""}`,
        }
        : {
          ...result,
          source: "none",
          intent: "none",
          routeHint: "none",
          clarification: null,
          reasoning: `${result.reasoning}|arbiter:continue_legacy${decision.reasoning ? `:${decision.reasoning}` : ""}`,
        },
    }
  }

  return { kind: "keep_current" }
}

async function maybeRunClarificationArbiter(params: {
  provider: ReturnType<typeof getProvider>
  prevState: ExplorationSessionState | null
  result: MultiStageResolverResult | null
  userMessage: string
}): Promise<ClarificationArbiterOutcome | null> {
  const { provider, prevState, result, userMessage } = params
  if (!ENABLE_STATEFUL_CLARIFICATION_ARBITER) return null
  if (!provider.available() || !prevState || !result?.clarification) return null

  const hasStateTruth =
    (prevState.appliedFilters?.length ?? 0) > 0
    || (prevState.displayedOptions?.length ?? 0) > 0
    || (prevState.displayedCandidates?.length ?? 0) > 0
    || (prevState.lastRecommendationArtifact?.length ?? 0) > 0
  if (!hasStateTruth) return null

  try {
    const { systemPrompt, userPrompt } = buildClarificationArbiterPrompt(prevState, result, userMessage)
    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userPrompt }],
      250,
      "sonnet",
      "turn-orchestrator",
    )
    const decision = normalizeClarificationArbiterDecision(raw)
    if (!decision || decision.confidence < 0.55) return null
    return applyClarificationArbiterDecision({
      decision,
      prevState,
      result,
      userMessage,
    })
  } catch (error) {
    console.warn("[clarification-arbiter] failed:", (error as Error).message)
    return null
  }
}

function buildAlternativeExplorationClarificationV2(
  prevState: ExplorationSessionState,
  field: string,
  excludedValue: string | number | null | undefined,
  excludedLabelOverride?: string | null,
): AlternativeExplorationClarification | null {
  const excludedComparable = normalizeComparableFilterValue(field, excludedValue ?? null)
  let excludedSeen = false

  // Prefer the UI's current options over inferred snapshot distribution.
  let displayedOptions = (prevState.displayedOptions ?? [])
    .filter(option => option.field === field && option.value && option.field !== "skip")
    .filter(option => {
      const comparable = normalizeComparableFilterValue(field, option.value)
      if (excludedComparable && comparable === excludedComparable) {
        excludedSeen = true
        return false
      }
      return true
    })
    .slice(0, 4)
    .map((option, index) => ({
      index: index + 1,
      label: option.label?.trim() || (option.count > 0 ? `${option.value} (${option.count}개)` : option.value),
      field: option.field,
      value: option.value,
      count: option.count ?? 0,
    }))

  if (displayedOptions.length === 0) {
    const snapshots = prevState.lastRecommendationArtifact ?? prevState.displayedCandidates ?? []
    if (!snapshots.length) return null

    const counts = new Map<string, number>()
    for (const candidate of snapshots) {
      const value = extractSnapshotFieldValue(candidate, field)
      if (!value) continue

      if (excludedComparable && normalizeComparableFilterValue(field, value) === excludedComparable) {
        excludedSeen = true
        continue
      }

      counts.set(value, (counts.get(value) ?? 0) + 1)
    }

    displayedOptions = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko"))
      .slice(0, 4)
      .map(([value, count], index) => ({
        index: index + 1,
        label: `${value} (${count}개)`,
        field,
        value,
        count,
      }))
  }

  const label = getFilterFieldLabel(field)
  const excludedLabel = String(excludedLabelOverride ?? excludedValue ?? "").trim()
  const chipResolution: Record<string, { field: string; value: string }> = {}

  if (displayedOptions.length === 0) {
    return {
      question: `현재 후보 기준으로는 ${label}에서 ${excludedLabel || "현재 값"} 말고 바로 고를 만한 대안이 보이지 않습니다. ${label} 대신 다른 조건을 바꿔볼지 알려주세요.`,
      chips: ["다른 조건으로 좁혀보기", "직접 입력"],
      displayedOptions: [],
      pendingClarification: { chipResolution },
    }
  }

  const optionChips = displayedOptions.map(option => {
    chipResolution[option.label] = { field, value: option.value }
    return option.label
  })

  const question = excludedSeen
    ? `현재 후보 기준으로 ${label}에서 ${excludedLabel || "현재 값"} 말고는 다음 옵션이 있습니다. 바꿔볼 값을 선택하시거나 직접 입력해 주세요.`
    : `현재 후보 기준으로는 ${label}에서 ${excludedLabel || "요청한 값"}이(가) 보이지 않습니다. 대신 선택할 수 있는 옵션은 다음과 같습니다.`

  return {
    question,
    chips: [...optionChips, "직접 입력"],
    displayedOptions,
    pendingClarification: { chipResolution },
  }
}

function hasTerminalMultiStageResult(result: MultiStageResolverResult): boolean {
  return resolverProducedMeaningfulOutput(result)
}

export function shouldAllowTurn0LexicalAnswerIntercept(
  result: MultiStageResolverResult | null,
): boolean {
  return !result || !hasTerminalMultiStageResult(result)
}

export function shouldShortCircuitFirstTurnIntake(params: {
  bypassResolver: boolean
  resolverResult: MultiStageResolverResult | null
}): boolean {
  return params.bypassResolver || !!(params.resolverResult && hasTerminalMultiStageResult(params.resolverResult))
}

export function shouldExposeFullThinking(): boolean {
  const explicit = process.env.RECOMMEND_SHOW_FULL_THINKING?.trim().toLowerCase()
  if (explicit === "true" || explicit === "1" || explicit === "on") return true
  if (explicit === "false" || explicit === "0" || explicit === "off") return false

  const appMode = process.env.APP_MODE?.trim().toLowerCase()
  if (appMode === "dev" || appMode === "test" || appMode === "qa" || appMode === "staging") return true
  if (appMode === "production") return false

  return process.env.NODE_ENV === "test"
}

export function shouldUseSqlAgentSemanticCache(exposeFullThinking: boolean): boolean {
  return !exposeFullThinking
}

export function applyThinkingFieldsToPayload(
  payload: unknown,
  thinking: Partial<RuntimeThinkingState>,
): unknown {
  if (!payload || typeof payload !== "object") return payload

  const thinkingProcess = thinking.thinkingProcess ?? null
  const thinkingDeep = thinking.thinkingDeep ?? null
  if (!thinkingProcess && !thinkingDeep) return payload

  const out = payload as Record<string, unknown>
  if (thinkingProcess && out.thinkingProcess == null) out.thinkingProcess = thinkingProcess
  if (thinkingDeep && out.thinkingDeep == null) out.thinkingDeep = thinkingDeep

  const session = out.session
  if (!session || typeof session !== "object") return out

  const sessionEnvelope = session as Record<string, unknown>
  const engineState = sessionEnvelope.engineState
  if (engineState && typeof engineState === "object") {
    const engineRecord = engineState as Record<string, unknown>
    if (thinkingProcess && engineRecord.thinkingProcess == null) engineRecord.thinkingProcess = thinkingProcess
    if (thinkingDeep && engineRecord.thinkingDeep == null) engineRecord.thinkingDeep = thinkingDeep
  }

  return out
}

function setThinking(state: RuntimeThinkingState, text: string, kind: ThinkingKind): void {
  if (!text) return
  if (kind === "deep") {
    state.thinkingDeep = text
    return
  }
  state.thinkingProcess = text
}

function appendThinking(state: RuntimeThinkingState, text: string, kind: ThinkingKind): void {
  if (!text) return
  if (kind === "deep") {
    state.thinkingDeep = state.thinkingDeep ? `${state.thinkingDeep}\n\n${text}` : text
    return
  }
  state.thinkingProcess = state.thinkingProcess ? `${state.thinkingProcess}\n\n${text}` : text
}

function syncThinkingToSession(
  sessionState: ExplorationSessionState | null | undefined,
  thinking: Partial<RuntimeThinkingState>,
): void {
  if (!sessionState) return
  if (thinking.thinkingProcess !== undefined) sessionState.thinkingProcess = thinking.thinkingProcess ?? null
  if (thinking.thinkingDeep !== undefined) sessionState.thinkingDeep = thinking.thinkingDeep ?? null
}

async function withThinkingResponse(
  response: Response,
  thinking: Partial<RuntimeThinkingState>,
): Promise<Response> {
  if (!thinking.thinkingProcess && !thinking.thinkingDeep) return response

  try {
    const payload = await response.json()
    const merged = applyThinkingFieldsToPayload(payload, thinking)
    return new Response(JSON.stringify(merged), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch {
    return response
  }
}

function extractReferenceProductIdFromMessage(rawMessage: string): string | null {
  const match = rawMessage.match(DIRECT_PRODUCT_CODE_PATTERN)
  return match?.[1]?.trim().toUpperCase() ?? null
}

function mergeStagedSpecPatch(base: KGSpecPatch | null, patch: KGSpecPatch | null): KGSpecPatch | null {
  if (!base) return patch
  if (!patch) return base

  return {
    ...base,
    ...patch,
    toleranceConstraints: [
      ...(base.toleranceConstraints ?? []),
      ...(patch.toleranceConstraints ?? []),
    ],
  }
}

export function buildResolverSimilaritySpecPatch(
  result: MultiStageResolverResult | null,
  rawMessage: string,
): KGSpecPatch | null {
  if (!result || result.routeHint !== "compare_products") return null

  const referenceProductId = extractReferenceProductIdFromMessage(rawMessage)
  if (!referenceProductId) return null

  return {
    similarTo: {
      referenceProductId,
      topK: 10,
    },
  }
}

function buildActionFromMultiStageResult(
  result: MultiStageResolverResult,
  rawMessage: string,
  turnCount: number,
  fallbackFilter?: AppliedFilter | null,
): OrchestratorAction | null {
  switch (result.intent) {
    case "reset_session":
      return { type: "reset_session" }
    case "go_back_one_step":
      return { type: "go_back_one_step", followUpFilter: result.followUpFilter ?? undefined }
    case "show_recommendation":
      return { type: "show_recommendation" }
    case "answer_general":
      return { type: "answer_general", message: rawMessage }
    case "continue_narrowing":
      return {
        type: "continue_narrowing",
        filter: fallbackFilter ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount },
      }
    case "ask_clarification":
    case "none":
    default:
      if (result.filters.length > 0 || result.removeFields.length > 0 || !!result.sort || result.clearOtherFilters) {
        return {
          type: "continue_narrowing",
          filter: fallbackFilter ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount },
        }
      }
      return null
  }
}

function mapMessagesToResolverConversationHistory(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; text: string }> {
  return messages.slice(-6).map(message => ({
    role: message.role === "ai" ? "assistant" : "user",
    text: message.text,
  }))
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

/**
 * Generate a short Korean reasoning sentence from a turn's applied filters.
 *
 * Used as a CoT fallback when SQL agent (which produces real natural-language
 * reasoning) didn't run on this turn — e.g. det-SCR / KG / tool-use orchestrator
 * paths only emit technical strings. Result feeds the SSE "thinking" channel so
 * the UI still gets a Claude-style reasoning frame.
 *
 * Deliberately deterministic — no LLM call. Looks at the field name + op + value
 * and assembles 1-2 short sentences. Returns null when nothing useful to say.
 */
// (제거됨, 2026-04-09) chip-path LLM CoT 헬퍼 — 직렬 sonnet 호출이 모든
// 칩 클릭에 순수 latency 회귀를 추가하던 b8be64f 의 잔재. 합성 CoT로 복원.
// sql-agent 경로의 스트리밍 CoT 는 naturalLanguageToFiltersStreaming 으로 살아 있음.

function buildSyntheticThinkingFromFilters(filters: AppliedFilter[]): string | null {
  const meaningful = filters.filter(f => f.op !== "skip")
  if (meaningful.length === 0) return null

  const FIELD_LABEL: Record<string, string> = {
    workPieceName: "피삭재",
    material: "ISO 소재군",
    diameterMm: "공구 직경",
    fluteCount: "날수",
    coating: "코팅",
    toolSubtype: "공구 형상",
    toolMaterial: "공구 재질",
    seriesName: "시리즈",
    brand: "브랜드",
    cuttingType: "가공 방식",
    overallLengthMm: "전체 길이",
    lengthOfCutMm: "날장 길이",
    shankDiameterMm: "생크 직경",
    helixAngleDeg: "헬릭스각",
    taperAngleDeg: "테이퍼각",
    ballRadiusMm: "코너/볼 R",
    pointAngleDeg: "포인트 각도",
    threadPitchMm: "나사 피치",
    stockStatus: "재고",
    country: "생산국",
    toolType: "공구 종류",
    applicationShapes: "적용 형상",
    materialTags: "ISO 소재 분류",
  }
  const OP_PHRASE: Record<string, (v: string) => string> = {
    eq: v => v,
    neq: v => `${v} 제외`,
    gte: v => `${v} 이상`,
    lte: v => `${v} 이하`,
    between: v => `${v} 범위`,
    includes: v => v,
    like: v => v,
  }

  const parts = meaningful.map(f => {
    const label = FIELD_LABEL[f.field] ?? f.field
    const valueStr = String(f.value ?? f.rawValue ?? "")
    const phrase = (OP_PHRASE[f.op] ?? OP_PHRASE.eq)(valueStr)
    return `${label} ${phrase}`
  })

  // Highlight the dominant intent (workpiece > material > diameter > rest)
  const priority = ["workPieceName", "material", "materialTags", "diameterMm", "fluteCount", "toolSubtype", "coating"]
  const sorted = [...meaningful].sort((a, b) => {
    const ia = priority.indexOf(a.field)
    const ib = priority.indexOf(b.field)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  const lead = sorted[0]
  const leadLabel = FIELD_LABEL[lead.field] ?? lead.field
  const leadValue = String(lead.value ?? lead.rawValue ?? "")

  // Two sentences: intent + extracted slots
  const intentSentence = `사용자 요청에서 ${leadLabel} '${leadValue}' 을(를) 핵심 조건으로 파악했습니다.`
  const slotsSentence = `다음 조건으로 필터링합니다: ${parts.join(", ")}.`

  return `${intentSentence} ${slotsSentence}`
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
  // ── Proactive insights auto-injection ──
  // insight-generator (line ~3805) writes into this closure var. The wrapped
  // build*Response functions then auto-inject it as `extraResponseContext` so
  // the polish/summary LLM prompts can weave it into their narrative without
  // every call site having to forward the value explicitly.
  let proactiveInsightsContext: string | undefined
  const runtimeThinking: RuntimeThinkingState = {
    thinkingProcess: prevState?.thinkingProcess ?? null,
    thinkingDeep: prevState?.thinkingDeep ?? null,
  }
  const fullThinkingEnabled = shouldExposeFullThinking()
  const baseBuildQuestionResponse = deps.buildQuestionResponse
  const baseBuildRecommendationResponse = deps.buildRecommendationResponse
  const baseJsonRecommendationResponse = deps.jsonRecommendationResponse
  // Positional indices of `extraResponseContext`:
  //   buildQuestionResponse       → 20 (after overrideText/existingStageHistory/
  //     excludeWorkPieceValues/responsePrefix/overrideChips)
  //   buildRecommendationResponse → 16 (after displayedProducts)
  // Previous indices (19 / 15) pointed at overrideChips / displayedProducts
  // respectively — that silently clobbered chips with the insight string and
  // caused the insight block to be dropped, so the narrative-polish LLM never
  // saw the proactive insights. That's why S03/S09/S10 통찰력 scored low.
  const EXTRA_CTX_IDX_Q = 20
  const EXTRA_CTX_IDX_R = 16
  deps = {
    ...deps,
    jsonRecommendationResponse: (params, init) => {
      syncThinkingToSession(params.sessionState, runtimeThinking)
      return baseJsonRecommendationResponse({
        ...params,
        thinkingProcess: params.thinkingProcess ?? runtimeThinking.thinkingProcess,
        thinkingDeep: params.thinkingDeep ?? runtimeThinking.thinkingDeep,
      }, init)
    },
    buildQuestionResponse: (...args: Parameters<typeof baseBuildQuestionResponse>) => {
      const passed = args[EXTRA_CTX_IDX_Q]
      const ctx = passed !== undefined ? passed : proactiveInsightsContext
      const newArgs = [...args] as Parameters<typeof baseBuildQuestionResponse>
      newArgs[EXTRA_CTX_IDX_Q] = ctx
      return baseBuildQuestionResponse(...newArgs).then(response => withThinkingResponse(response, runtimeThinking))
    },
    buildRecommendationResponse: (...args: Parameters<typeof baseBuildRecommendationResponse>) => {
      const passed = args[EXTRA_CTX_IDX_R]
      const ctx = passed !== undefined ? passed : proactiveInsightsContext
      const newArgs = [...args] as Parameters<typeof baseBuildRecommendationResponse>
      newArgs[EXTRA_CTX_IDX_R] = ctx
      return baseBuildRecommendationResponse(...newArgs).then(response => withThinkingResponse(response, runtimeThinking))
    },
  }

  // SQL Agent 스키마 로드 (첫 호출 시 await, 이후 캐시)
  await getDbSchema().catch(() => {})

  console.log(
    `[recommend] request start hasPrevState=${!!prevState} messages=${messages.length} displayedProducts=${displayedProducts?.length ?? 0} BUILD=002ebde`
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
  const providerAvailable = provider.available()
  const legacyKgInterpreterEnabled = isLegacyKgInterpreterEnabled(providerAvailable)
  const legacyKgHintEnabled = isLegacyKgHintEnabled(providerAvailable)
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
  const currentTurnRecognizedEntities = lastUserMsg?.text
    ? extractEntities(lastUserMsg.text).map(entity => ({
      field: entity.field,
      value: entity.canonical || entity.value,
    }))
    : []

  // Sanitize garbled UTF-8 input. Some clients (Windows curl, certain SSE
  // proxies) mangle Korean bytes into U+FFFD replacement chars. If we let that
  // through, the answer LLM will write apologetic "encoding error" prose and
  // the chip extractor will surface fragments of that prose as user-facing
  // chip options. Replace the message body with a clean clarification BEFORE
  // any LLM ever sees it.
  for (const m of messages) {
    if (m.role !== "user" || typeof m.text !== "string" || m.text.length === 0) continue
    const text = m.text
    // Count replacement chars + non-printable bytes; over 30% = garbled
    let badCount = 0
    for (const ch of text) {
      const code = ch.charCodeAt(0)
      if (code === 0xFFFD || (code < 0x20 && code !== 0x0A && code !== 0x0D && code !== 0x09)) badCount++
    }
    if (badCount > 0 && badCount / text.length >= 0.2) {
      console.warn(`[input:garbled] replacement chars ${badCount}/${text.length} → sanitizing`)
      m.text = "메시지 내용을 다시 입력해주세요."
    }
  }

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

  // ── Post-result skip-word short-circuit ────────────────────────
  // When products are already shown (resolutionStatus=resolved_*) and the
  // user sends a bare skip word ("상관없음", "모름", "패스", ...), there is
  // no pending field to skip and no filter to extract. The heavy routing
  // path still runs sql-agent + SCR through shadow-mode planner — that
  // costs ~30-42s on a no-op message (measured I4 T4). Route straight to
  // answer_general so only the composer runs (~5-8s floor).
  if (
    !shouldResolvePendingSelectionEarly
    && prevState
    && lastUserMsg
    && isSkipSelectionValue(lastUserMsg.text)
    && isPostResultPhase(journeyPhase)
    && !!prevState.resolutionStatus?.startsWith("resolved")
  ) {
    console.log(`[post-result-skip-shortcircuit] "${lastUserMsg.text}" → answer_general (skip sql-agent/SCR)`)
    return handleServeGeneralChatAction({
      deps,
      action: { type: "answer_general", message: lastUserMsg.text },
      orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, "post_result_skip_noop"),
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

  // ── Build & Persist Conversation Memory (long-term, across turns) ──
  if (prevState && !prevState.conversationMemory) {
    prevState.conversationMemory = buildMemoryFromSession(
      form as Parameters<typeof buildMemoryFromSession>[0],
      prevState,
      turnCount
    )
  }

  let singleCallHandled = false
  // ── Deterministic first-turn short-circuit ──────────────────────────────
  // When there's no prior session (prevState=null) and the only message is
  // the auto-synthesized intake summary ("탄소강 / Milling / 8mm 추천해주세요"),
  // every form value is already in `resolvedInput` via the deterministic
  // `mapIntakeToInput`. Running SQL agent / KG / single-call-router on the
  // synthesized text is pure waste — it adds 2-5s of LLM latency, costs
  // tokens, and (worst case) corrupts turn 0 when the extraction LLM returns
  // bad JSON or misclassifies a filter, collapsing the recommendation to
  // primary=null with thousands of candidates intact (the bug we hit on
  // 2026-04-09 after enabling reasoning_effort=minimal).
  //
  // Skip the entire LLM extraction phase: set singleCallHandled=true so all
  // downstream gates (`!singleCallHandled && lastUserMsg`) become no-ops, and
  // pre-fill bridgedV2Action so the existing first-turn dispatcher at the
  // bottom (`if (!prevState && singleCallHandled && bridgedV2Action)`)
  // routes straight into buildRecommendationResponse with the form-derived
  // resolvedInput + empty filter list.
  let stagedSpecPatch: KGSpecPatch | null = null
  let activeQuerySort: ReturnType<typeof tryParseSortPhrase> = null
  const isFirstTurnIntake = !prevState && messages.length <= 1
  let firstTurnResolverResult: MultiStageResolverResult | null = null
  let firstTurnResolverBypassed = false
  if (isFirstTurnIntake && lastUserMsg) {
    const rawMsg = lastUserMsg.text ?? ""
    if (rawMsg) {
      try {
        const stageOneActions = (
          shouldDeferHardcodedSemanticExecution(rawMsg)
            ? []
            : parseDeterministic(rawMsg)
        ).filter(
          action => action.type === "apply_filter" && action.field && action.value != null,
        )
        const firstTurnEditResult = hasEditSignal(rawMsg)
          ? parseEditIntent(rawMsg, filters, stageOneActions)
          : null
        const firstTurnSort = tryParseSortPhrase(rawMsg)
        if (firstTurnSort) activeQuerySort = firstTurnSort
        firstTurnResolverBypassed = shouldBypassFirstTurnMultiStageResolver({
          message: rawMsg,
          hasEditIntent: !!firstTurnEditResult,
          hasSort: !!firstTurnSort,
          stageOneActionCount: stageOneActions.length,
        })
        if (firstTurnResolverBypassed) {
          console.log(`[first-turn-intake] bare recommendation request bypassed multi-stage resolver`)
        } else {
          firstTurnResolverResult = await resolveMultiStageQuery({
            message: rawMsg,
            turnCount,
            currentFilters: filters,
            sessionState: prevState,
            conversationHistory: mapMessagesToResolverConversationHistory(messages),
            resolvedInputSnapshot: resolvedInput,
            stageOneEditIntent: firstTurnEditResult,
            stageOneDeterministicActions: stageOneActions,
            stageOneSort: firstTurnSort,
            complexity: assessComplexity(rawMsg, filters.length),
            requestPreparationIntent: requestPrep.intent,
            requestPreparationSlots: requestPrep.slots,
            recognizedEntities: currentTurnRecognizedEntities,
            stage1CotEscalation: {
              enabled: true,
              currentCandidateCount: prevState?.candidateCount ?? null,
            },
          })
          console.log(
            `[first-turn-intake] multi-stage source=${firstTurnResolverResult.source} intent=${firstTurnResolverResult.intent} unresolved=${firstTurnResolverResult.unresolvedTokens.join(",") || "none"}`
          )
        }
      } catch (e) {
        console.warn("[first-turn-intake] multi-stage fallback failed:", (e as Error).message)
      }
    }
  }
  // Turn 0 question/compare/trouble intercept: route directly to general-chat
  // handler before the filter-spec short-circuit. Without this, messages like
  // "헬릭스가 뭐야?" / "공구 수명 짧아" / "AlCrN vs TiAlN" fall into
  // continue_narrowing with 0 filters and return a stub.
  if (isFirstTurnIntake && lastUserMsg && shouldAllowTurn0LexicalAnswerIntercept(firstTurnResolverResult)) {
    const rawMsg0 = lastUserMsg.text.trim()
    const bareRecommendationRequest = isBareRecommendationRequest(rawMsg0, false)
    const QUESTION_RE = /(뭐야|뭔데|뭐에요|뭐임|뭔가요|무엇|뜻이|의미|알려줘|알려주|설명해|왜\s|어떻게|어느\s*게|어떤\s*게\s*(더|낫|좋))/
    const COMPARE_RE = /(\bvs\.?\b|대비|차이|뭐가\s*(더|나|나아|좋)|어느\s*게\s*(더|낫|좋))/i
    // 수명 ... 짧/줄/안좋/문제/나빠 — adverbs may sit between ("수명이 너무 짧아")
    const TROUBLE_RE = /(수명[\s\S]{0,15}(짧|줄|문제|안\s*좋|나빠|떨어)|마모가|닳아|파손|깨짐|부러|떨림|진동|채터|거칠|버[가는이]?\s|칩[이\s]*엉)/
    // Greetings / chit-chat → general-chat handler (not narrowing)
    const GREETING_RE = /^(안녕|하이|hi\b|hello\b|반가|좋은\s*(아침|오후|저녁)|처음\s*뵙|start)/i
    // Soft recommendation-request markers: "~괜찮은 거?", "~좋은 거?", "~추천 좀",
    // "~뭐가 있어?", "~쓸만한 거" — these LOOK like questions but mean "recommend"
    const SOFT_REC_RE = /(괜찮은|좋은|쓸만한|쓸\s*만한|추천\s*(좀|해)|뭐가\s*있|있을까|어울리는|맞는|적합한)/
    // If the message contains product entities (material/coating/subtype/shank),
    // it's a recommendation context even with "?". Only intercept pure Q/troubleshoot.
    const hasRecEntities = (
      shouldDeferHardcodedSemanticExecution(rawMsg0)
        ? []
        : parseDeterministic(rawMsg0)
    ).some(action =>
      action.type === "apply_filter"
      && action.field != null
      && ["workPieceName", "coating", "toolSubtype", "toolType", "shankType", "diameterMm", "fluteCount"].includes(action.field)
    )
    // Strong compare pattern: "X(이?랑|와|과|vs) Y ... (뭐가 나/더/차이/어느 게)"
    // wins over soft-rec even when entities are present — the user is asking
    // which of two things is better, not for a recommendation of either.
    const STRONG_COMPARE_RE = /(\S+)\s*(이?랑|와|과|\bvs\.?\b)\s*(\S+).*(뭐가\s*(나|더|좋)|어느\s*게|차이|대비)/i
    const isStrongCompare = STRONG_COMPARE_RE.test(rawMsg0)
    const isSoftRec = !isStrongCompare && (SOFT_REC_RE.test(rawMsg0) || hasRecEntities)
    const isKnowledgeLikeTurn0 = QUESTION_RE.test(rawMsg0) || COMPARE_RE.test(rawMsg0) || TROUBLE_RE.test(rawMsg0)
    const isAnswerIntent = (
      !bareRecommendationRequest &&
      !isSoftRec &&
      isKnowledgeLikeTurn0
    ) || GREETING_RE.test(rawMsg0)
    if (isAnswerIntent) {
      console.log(`[turn0-answer] question/compare/trouble pattern → answer_general: "${rawMsg0.slice(0, 60)}"`)
      // Inline proactive insights for turn0 troubleshoot/compare/question —
      // insight-generator normally runs downstream in the recommendation
      // pipeline (line ~3820), but turn0-answer short-circuits before that,
      // so troubleshoot messages ("공구 수명 짧아") would miss the KB-based
      // mechanism hints. Run generateInsights inline so general-chat's
      // insightContext block gets populated.
      let turn0InsightBlock = ""
      try {
        const { generateInsights, formatInsightsForPrompt } = await import("@/lib/recommendation/core/insight-generator")
        const insights = generateInsights(rawMsg0, filters, 0, turnCount ?? 0)
        if (insights.length > 0) {
          turn0InsightBlock = formatInsightsForPrompt(insights)
          console.log(`[turn0-answer] insight: ${insights.length}건 inline`)
        }
      } catch (e) {
        console.warn("[turn0-answer] insight error:", (e as Error).message)
      }
      const answerState = buildSessionState({
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
      if (turn0InsightBlock) {
        ;(answerState as ExplorationSessionState & { __proactiveInsights?: string }).__proactiveInsights = turn0InsightBlock
      }
      return handleServeGeneralChatAction({
        deps,
        action: { type: "answer_general", message: rawMsg0 },
        orchResult: buildPreSearchOrchestratorResult(rawMsg0, "turn0_lexical_answer"),
        provider,
        form,
        messages,
        prevState: answerState,
        filters,
        narrowingHistory,
        currentInput,
        candidates: [],
        evidenceMap: new Map(),
        turnCount,
      })
    }
  }
  if (isFirstTurnIntake) {
    const firstTurnClarificationArbiter = firstTurnResolverResult?.clarification
      ? await maybeRunClarificationArbiter({
        provider,
        prevState,
        result: firstTurnResolverResult,
        userMessage: lastUserMsg?.text ?? "",
      })
      : null
    if (firstTurnClarificationArbiter?.kind === "continue_legacy" && firstTurnResolverResult) {
      firstTurnResolverResult = firstTurnClarificationArbiter.result
    }
    if (firstTurnClarificationArbiter?.kind === "use_state_options" && prevState) {
      return buildRevisionClarificationResponse(
        deps,
        prevState,
        form,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        firstTurnClarificationArbiter.clarification.question,
        requestPrep,
        firstTurnClarificationArbiter.clarification.chips,
        firstTurnClarificationArbiter.clarification.pendingClarification,
        firstTurnClarificationArbiter.clarification.displayedOptions,
      )
    }

    if (firstTurnResolverResult?.clarification) {
      const clarificationState = prevState ?? buildSessionState({
        candidateCount: filters.length,
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
      return buildRevisionClarificationResponse(
        deps,
        clarificationState,
        form,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        firstTurnResolverResult.clarification.question,
        requestPrep,
        firstTurnResolverResult.clarification.chips,
      )
    }

    const injected: string[] = []
    const firstTurnResolverMeaningful =
      firstTurnResolverResult ? hasTerminalMultiStageResult(firstTurnResolverResult) : false
    if (firstTurnResolverResult) {
      console.log(`[first-turn-intake] resolverMeaningful=${firstTurnResolverMeaningful} source=${firstTurnResolverResult.source}`)
    }
    if (firstTurnResolverResult && firstTurnResolverMeaningful) {
      for (const field of firstTurnResolverResult.removeFields) {
        for (let index = filters.length - 1; index >= 0; index--) {
          if (filters[index].field === field) filters.splice(index, 1)
        }
      }
      for (const filter of firstTurnResolverResult.filters) {
        const normalizedFilter = normalizeRuntimeAppliedFilter(filter, filter.appliedAt ?? turnCount)
        if (normalizedFilter.op === "skip") continue
        if (filters.some(existing => existing.field === normalizedFilter.field && existing.op !== "skip")) continue
        const result = replaceFieldFilter(baseInput, filters, normalizedFilter, deps.applyFilterToInput)
        filters.splice(0, filters.length, ...result.nextFilters)
        currentInput = result.nextInput
        injected.push(`${normalizedFilter.field}=${String(normalizedFilter.rawValue ?? normalizedFilter.value)}`)
      }
      if (firstTurnResolverResult.sort) {
        stagedSpecPatch = mergeStagedSpecPatch(stagedSpecPatch, { sort: firstTurnResolverResult.sort })
        activeQuerySort = firstTurnResolverResult.sort
      }
      const firstTurnSimilarityPatch = buildResolverSimilaritySpecPatch(firstTurnResolverResult, lastUserMsg?.text ?? "")
      if (firstTurnSimilarityPatch) {
        stagedSpecPatch = mergeStagedSpecPatch(stagedSpecPatch, firstTurnSimilarityPatch)
        console.log(`[first-turn-intake] staged similarity reference=${firstTurnSimilarityPatch.similarTo?.referenceProductId}`)
      }
      if (injected.length > 0) {
        console.log(`[first-turn-intake] multi-stage injected ${injected.length} filter(s): ${injected.join(", ")}`)
      }
    }

    const shouldShortCircuitFirstTurn = shouldShortCircuitFirstTurnIntake({
      bypassResolver: firstTurnResolverBypassed,
      resolverResult: firstTurnResolverResult,
    })
    if (!shouldShortCircuitFirstTurn) {
      if (firstTurnResolverResult?.source === "none") {
        console.log("[first-turn-intake] multi-stage returned none - falling back to legacy routers")
      }
    } else {
      singleCallHandled = true
    // Fast-path triggers (skip questions, go straight to show_recommendation):
    //   1) explicit show verb ("추천해줘/보여줘/찾아줘") + ≥2 filters
    //   2) urgency ("빨리/급해/당장/지금") + ≥1 filter — user wants speed
    //   3) indifference ("아무거나/알아서/대충/뭐든") + ≥1 filter — user doesn't want to be asked
    // Otherwise fall back to continue_narrowing (light question response).
    const rawMsgLower = (lastUserMsg?.text ?? "").trim()
    const hasShowVerb = /(추천\s*(해줘|해주|좀)?|보여줘|찾아줘|알려줘|골라줘|제품\s*(보|줘))/.test(rawMsgLower)
    const hasUrgency = /(빨리|급해|급한|당장|지금\s*바로|얼른|서둘러)/.test(rawMsgLower)
    const hasIndifference = /(아무거나|아무|알아서|대충|뭐든|상관\s*없)/.test(rawMsgLower)
    const meaningfulFilters = filters.filter(f => f.op !== "skip" && f.field !== "none").length
    const showVerbPath = hasShowVerb && meaningfulFilters >= 2
    const speedPath = (hasUrgency || hasIndifference) && meaningfulFilters >= 1
    const resolverAction = firstTurnResolverResult
      ? buildActionFromMultiStageResult(firstTurnResolverResult, lastUserMsg?.text ?? "", turnCount)
      : null
    if (resolverAction) {
      bridgedV2Action = resolverAction
    } else if (showVerbPath || speedPath) {
      const reason = speedPath ? `urgency/indifference + ${meaningfulFilters} filter(s)` : `${meaningfulFilters} filters + explicit verb`
      console.log(`[first-turn-intake] show_recommendation: ${reason}`)
      bridgedV2Action = { type: "show_recommendation" }
    } else {
      bridgedV2Action = { type: "continue_narrowing", filter: { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: 0 } }
    }
    bridgedV2OrchestratorResult = {
      action: bridgedV2Action,
      reasoning: firstTurnResolverResult
        ? `first-turn-intake:${firstTurnResolverResult.source}:${firstTurnResolverResult.reasoning}`
        : "first-turn-intake-deterministic",
      agentsInvoked: [],
      escalatedToOpus: false,
    }
    console.log("[first-turn-intake] Skipping legacy KG/sql-agent/SCR")
    }
  }
  // Phase 4.5 — tool-forge fallback rows captured for the retrieval stage to
  // promote into candidates if hybrid retrieval + knowledge fallback both miss.
  let forgedFallbackRows: Record<string, unknown>[] = []
  // Phase G — dual-path compiled result hoisted to the outer function scope
  // so both the planner/KG-merge block (~line 2430) that fills it and the v2
  // orchestrator block (~line 3260) that consumes it can see it.
  let phaseGCompiledResult: Awaited<ReturnType<typeof import("@/lib/recommendation/core/execute-spec-via-compiler").executeSpecViaCompiler>> | null = null
  let phaseGSpecMode: "sort" | "similarity" | "tolerance" | "plain" = "plain"
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
    let msg = lastUserMsg?.text ?? ""

    // ── Turn Repair: 모호한 참조("그거 말고", "더 큰 거", "아니야 X를") → 직전 맥락으로 풀이 ──
    // needsRepair=true + 직전 턴 존재(prevState 또는 messages.length>=2)면 트리거.
    // 맥락은 narrowingHistory/appliedFilters → 둘 다 비면 messages 자체에서 직전 user/ai 추출.
    if (msg && (prevState || messages.length >= 2)) {
      try {
        const { isRepairOnlySignal, needsRepair, repairMessage } = await import("@/lib/recommendation/core/turn-repair")
        const repairTriggered = needsRepair(msg)
        const repairOnlySignal = isRepairOnlySignal(msg)
        const deicticRepairSignal = /(?:그거|그게|이거|이게|아까|방금)/u.test(msg)
        const histLen = prevState?.narrowingHistory?.length ?? 0
        const filtLen = prevState?.appliedFilters?.length ?? 0
        console.log(`[turn-repair:gate] msg="${msg.slice(0, 40)}", needsRepair=${repairTriggered}, history=${histLen}, filters=${filtLen}, msgs=${messages.length}`)
        if (repairTriggered) {
          let history = (prevState?.narrowingHistory ?? []) as Array<{ question: string; answer: string; extractedFilters: unknown[]; candidateCountBefore: number; candidateCountAfter: number }>
          if (history.length === 0 && messages.length >= 2) {
            // Fallback: build minimal NarrowingTurn-like records from the recent message tail.
            const recent = messages.slice(-6)
            for (let i = 0; i < recent.length; i++) {
              const m = recent[i] as { role?: string; text?: string }
              if (m.role === "user" && i + 1 < recent.length && (recent[i + 1] as { role?: string }).role === "ai") {
                history.push({
                  question: ((recent[i + 1] as { text?: string }).text ?? ""),
                  answer: m.text ?? "",
                  extractedFilters: [],
                  candidateCountBefore: 0,
                  candidateCountAfter: 0,
                })
              }
            }
          }
          const filters = prevState?.appliedFilters ?? []
          const repair = await repairMessage(msg, filters, history as never, provider)
          const repairDetActions = shouldDeferHardcodedSemanticExecution(msg)
            ? []
            : parseDeterministic(msg)
          const hasConcreteRepairAction = repairDetActions.some(action =>
            action.type === "apply_filter"
            || action.type === "remove_filter"
            || action.type === "replace_filter"
          )
          const needsContextualRepairClarification =
            deicticRepairSignal
            && !repairOnlySignal
            && !hasConcreteRepairAction
          const shouldAskRepairClarification =
            prevState
            && !repair.wasRepaired
            && (repairOnlySignal || needsContextualRepairClarification)
            && !hasConcreteRepairAction
          if (shouldAskRepairClarification && prevState) {
            const repairClarification = buildRepairClarification(filters)
            const repairClarificationArbiter = await maybeRunClarificationArbiter({
              provider,
              prevState,
              result: buildRuntimeClarificationCandidate({
                question: repairClarification.question,
                chips: repairClarification.chips,
                askedField: prevState.lastAskedField ?? null,
                reasoning: "clarification:repair_runtime",
              }),
              userMessage: msg,
            })
            if (repairClarificationArbiter?.kind === "continue_legacy") {
              // Skip the repair clarification and let the existing runtime
              // continue with deterministic/LLM routing.
            } else if (repairClarificationArbiter?.kind === "use_state_options") {
              return buildRevisionClarificationResponse(
                deps,
                prevState,
                form,
                filters,
                narrowingHistory,
                currentInput,
                turnCount,
                repairClarificationArbiter.clarification.question,
                requestPrep,
                repairClarificationArbiter.clarification.chips,
                repairClarificationArbiter.clarification.pendingClarification,
                repairClarificationArbiter.clarification.displayedOptions,
              )
            } else {
              return buildRevisionClarificationResponse(
                deps,
                prevState,
                form,
                filters,
                narrowingHistory,
                currentInput,
                turnCount,
                repairClarification.question,
                requestPrep,
                repairClarification.chips,
              )
            }
          }
          if (repair.wasRepaired) {
            console.log(`[turn-repair] "${msg}" → "${repair.clarifiedMessage}"`)
            msg = repair.clarifiedMessage
            if (prevState) {
              prevState.thinkingProcess = `🔍 모호한 참조 해석: "${lastUserMsg!.text}" → "${msg}"${repair.repairExplanation ? "\n" + repair.repairExplanation : ""}` + (prevState.thinkingProcess ? "\n\n" + prevState.thinkingProcess : "")
            }
          }
        }
      } catch (e) {
        console.warn("[turn-repair] integration error:", (e as Error).message)
      }
    }

    // ── Complexity 판단 (0ms, LLM 없음) ──
    const complexity = assessComplexity(msg, (prevState?.appliedFilters ?? []).length)
    const bareRecommendationRequest = isBareRecommendationRequest(msg, !!prevState)
    console.log(`[complexity] "${msg.slice(0, 30)}" → ${complexity.level} (${complexity.reason})`)

    const hasNegationPattern = /빼고|뺴고|빼구|제외|아닌\s*것|아닌\s*걸|아닌걸|없는\s*거|말고|만\s*아니면|없이|아닌\s*거|없는\s*거로|가\s*아닌|이\s*아닌/u.test(msg)
    let negationHandled = false
    const hasStatefulNegationPattern = hasNegationPattern || hasAlternativeNegationCue(msg)

    // ══════════════════════════════════════════════════════════
    // Router priority: Edit-Intent(수정동사) → KG(entity match) → SQL Agent → negation(fallback) → SCR
    // edit-intent가 맡아야 할 문장(말고/빼고/제외/상관없/바꿔 등)은 KG보다 먼저 처리
    // ══════════════════════════════════════════════════════════

    const alternativeExplorationClarification =
      prevState && hasStatefulNegationPattern && isAlternativeExplorationQuestionV2(msg)
        ? (() => {
            const negatedValue = extractNegatedValue(msg) ?? extractNegatedValueFromContext(prevState, msg)
            if (!negatedValue) return null

            const clarification = buildAlternativeExplorationClarificationV2(
              prevState,
              negatedValue.field,
              negatedValue.rawValue,
              negatedValue.displayValue,
            )
            if (!clarification) return null

            console.log(
              `[alternative-exploration] field=${negatedValue.field} excluded=${String(negatedValue.rawValue)} chips=${clarification.chips.length}`,
            )
            return clarification
          })()
        : null

    if (alternativeExplorationClarification && prevState) {
      return buildRevisionClarificationResponse(
        deps,
        prevState,
        form,
        filters,
        narrowingHistory,
        currentInput,
        turnCount,
        alternativeExplorationClarification.question,
        requestPrep,
        alternativeExplorationClarification.chips,
        alternativeExplorationClarification.pendingClarification,
        alternativeExplorationClarification.displayedOptions,
      )
    }

    let stageOneEditResult: ReturnType<typeof parseEditIntent> = null
    const stageOneEditHintActions =
      !shouldResolvePendingSelectionEarly && lastUserMsg && hasEditSignal(msg)
        ? (
            shouldDeferHardcodedSemanticExecution(msg)
              ? []
              : parseDeterministic(msg)
          ).filter(
            action => action.type === "apply_filter" && action.field && action.value != null,
          )
        : []
    if (!shouldResolvePendingSelectionEarly && lastUserMsg && hasEditSignal(msg)) {
      try {
        stageOneEditResult = parseEditIntent(msg, filters, stageOneEditHintActions)
      } catch (err) {
        console.warn(`[edit-intent] parse failed for "${msg.slice(0, 80)}":`, (err as Error).message)
      }
    }
    const stageOneEditCanExecute = shouldExecuteEditIntentDeterministically(stageOneEditResult)
    const semanticEditHintFields = new Set(
      stageOneEditCanExecute ? [] : getEditIntentAffectedFields(stageOneEditResult),
    )

    const stageOneSort = !shouldResolvePendingSelectionEarly && lastUserMsg
      ? tryParseSortPhrase(msg)
      : null
    if (stageOneSort) {
      stagedSpecPatch = { ...(stagedSpecPatch ?? {}), sort: stageOneSort }
      activeQuerySort = stageOneSort
    }

    // ── 0.5. Deterministic SCR pre-pass (no LLM, fastest path) ──
    // det-SCR로 즉시 잡히는 명확한 필터 의도(예: "Y 코팅으로 추천해줘", "10mm")는
    // SQL Agent / KG / SCR LLM을 거치지 않고 바로 적용한다. skip_field 계열은
    // 같은 턴의 deterministic filter/sort 와 함께 합성하고, replace/exclude 류
    // edit-intent 는 기존 전용 경로에 양보한다.
    const allowStageOneDeterministicMerge =
      !stageOneEditResult
      || !stageOneEditCanExecute
      || stageOneEditResult.intent.type === "skip_field"
    if (!singleCallHandled && lastUserMsg && allowStageOneDeterministicMerge && !shouldResolvePendingSelectionEarly) {
      // Stateless-replay: when the caller has no session yet (evaluation harness
      // sends each call without session context) prior user turns' filters are
      // lost because this pre-pass only sees the latest message. Join all prior
      // user turns so every slot mentioned across the conversation is recovered.
      // FIX: parse the latest message separately so that when the same field
      // appears in both earlier and latest turns (e.g. "TiAlN" in Q&A turn then
      // "AlCrN으로 추천해줘" in latest), the latest turn's value wins.
      let detPreActions: ReturnType<typeof parseDeterministic>
      let currentTurnDetActions: ReturnType<typeof parseDeterministic>
      if (!prevState && messages.filter(m => m.role === "user").length > 1) {
        let allUserMsgs = messages.filter(m => m.role === "user").map(m => m.text)
        // FIX: if any user message is a reset signal ("처음부터", "초기화", "리셋"),
        // discard all messages before (and including) the reset — only parse post-reset messages.
        const RESET_RE = /(?:처음부터|다시\s*시작|초기화|리셋|^reset$)/iu
        const lastResetIdx = allUserMsgs.findLastIndex(m => RESET_RE.test(m))
        if (lastResetIdx >= 0) {
          allUserMsgs = allUserMsgs.slice(lastResetIdx + 1)
          if (allUserMsgs.length === 0) allUserMsgs = [msg]
        }
        const latestMsg = allUserMsgs[allUserMsgs.length - 1]
        const priorMsgs = allUserMsgs.slice(0, -1).join(" ")
        currentTurnDetActions = shouldDeferHardcodedSemanticExecution(latestMsg)
          ? []
          : parseDeterministic(latestMsg)
        const priorActions = shouldDeferHardcodedSemanticExecution(latestMsg)
          ? []
          : parseDeterministic(priorMsgs)
        // latest wins: if the latest message extracts a field, drop that field from prior
        const latestFields = new Set(currentTurnDetActions.filter(a => a.field).map(a => a.field))
        detPreActions = [
          ...priorActions.filter(a => !a.field || !latestFields.has(a.field)),
          ...currentTurnDetActions,
        ]
      } else {
        currentTurnDetActions = shouldDeferHardcodedSemanticExecution(msg)
          ? []
          : parseDeterministic(msg)
        detPreActions = currentTurnDetActions
      }

      const detApplyActions = detPreActions.filter(a => a.type === "apply_filter" && a.field && a.value != null)
      const effectiveDetApplyActions =
        detApplyActions.filter(action => {
          if (!action.field) return true
          if (stageOneEditResult?.intent.type === "skip_field" && action.field === stageOneEditResult.intent.field) {
            return false
          }
          if (semanticEditHintFields.has(action.field)) return false
          return true
        })
      const currentTurnFields = new Set(
        currentTurnDetActions
          .filter(a => a.type === "apply_filter" && a.field && a.value != null)
          .map(a => a.field!)
      )
      const shouldClearUnmentionedFields =
        !stageOneEditResult
        && currentTurnFields.size > 0
        && hasGlobalStageOneRelaxationSignal(msg)

      let lastStageOneFilter: AppliedFilter | null = null
      const stageOneReasoningParts: string[] = []

      let multiStageResult: MultiStageResolverResult
      if (bareRecommendationRequest) {
        multiStageResult = {
          source: "none",
          filters: [],
          sort: null,
          routeHint: "none",
          intent: "none",
          clearOtherFilters: false,
          removeFields: [],
          followUpFilter: null,
          confidence: 0,
          unresolvedTokens: [],
          reasoning: "defer:bare_recommendation",
          clarification: null,
        }
      } else {
        multiStageResult = await resolveMultiStageQuery({
          message: msg,
          turnCount,
          currentFilters: filters,
          sessionState: prevState,
          conversationHistory: mapMessagesToResolverConversationHistory(messages),
          pendingField: prevState?.lastAskedField ?? null,
          resolvedInputSnapshot: currentInput,
          stageOneEditIntent: stageOneEditResult,
          stageOneDeterministicActions: effectiveDetApplyActions,
          stageOneSort,
          stageOneClearUnmentionedFields: shouldClearUnmentionedFields,
          complexity,
          requestPreparationIntent: requestPrep.intent,
          requestPreparationSlots: requestPrep.slots,
          recognizedEntities: currentTurnRecognizedEntities,
          stage1CotEscalation: {
            enabled: true,
            currentCandidateCount: prevState?.candidateCount ?? null,
          },
        })
      }

      trace.add(
        "multi-stage-resolver",
        "router",
        {
          source: multiStageResult.source,
          confidence: multiStageResult.confidence,
          unresolvedTokens: multiStageResult.unresolvedTokens,
          filterCount: multiStageResult.filters.length,
          sort: multiStageResult.sort ? `${multiStageResult.sort.field}:${multiStageResult.sort.direction}` : null,
          clearOtherFilters: multiStageResult.clearOtherFilters,
          routeHint: multiStageResult.routeHint,
          intent: multiStageResult.intent,
          removeFields: multiStageResult.removeFields,
          clarification: !!multiStageResult.clarification,
        },
        { applied: multiStageResult.filters.length + (multiStageResult.sort ? 1 : 0) },
        `multi-stage ${multiStageResult.source} resolved ${multiStageResult.filters.length} filter(s)`
      )
      console.log(
        `[multi-stage-resolver] source=${multiStageResult.source} filters=${multiStageResult.filters.length} sort=${multiStageResult.sort ? `${multiStageResult.sort.field}:${multiStageResult.sort.direction}` : "none"} intent=${multiStageResult.intent} unresolved=${multiStageResult.unresolvedTokens.join(",") || "none"}`
      )

      const clarificationArbiter = multiStageResult.clarification
        ? await maybeRunClarificationArbiter({
          provider,
          prevState,
          result: multiStageResult,
          userMessage: msg,
        })
        : null
      if (clarificationArbiter?.kind === "continue_legacy") {
        multiStageResult = clarificationArbiter.result
      }
      if (clarificationArbiter?.kind === "use_state_options" && prevState) {
        return buildRevisionClarificationResponse(
          deps,
          prevState,
          form,
          filters,
          narrowingHistory,
          currentInput,
          turnCount,
          clarificationArbiter.clarification.question,
          requestPrep,
          clarificationArbiter.clarification.chips,
          clarificationArbiter.clarification.pendingClarification,
          clarificationArbiter.clarification.displayedOptions,
        )
      }

      if (multiStageResult.clarification) {
        const clarificationState = prevState ?? buildSessionState({
          candidateCount: filters.length,
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
        return buildRevisionClarificationResponse(
          deps,
          clarificationState,
          form,
          filters,
          narrowingHistory,
          currentInput,
          turnCount,
          multiStageResult.clarification.question,
          requestPrep,
          multiStageResult.clarification.chips,
        )
      }

      const resolverMeaningful = hasTerminalMultiStageResult(multiStageResult)
      console.log(`[multi-stage:truth] meaningful=${resolverMeaningful} source=${multiStageResult.source}`)
      if (resolverMeaningful) {
        if (multiStageResult.clearOtherFilters) {
          const keepFields = new Set(multiStageResult.filters.map(filter => filter.field))
          const beforeCount = filters.length
          for (let index = filters.length - 1; index >= 0; index--) {
            if (!keepFields.has(filters[index].field)) {
              filters.splice(index, 1)
            }
          }
          if (filters.length !== beforeCount) {
            currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
            stageOneReasoningParts.push(`${multiStageResult.source}:clear_other_filters`)
          }
        }

        if (multiStageResult.removeFields.length > 0) {
          const removeSet = new Set(multiStageResult.removeFields)
          const beforeCount = filters.length
          for (let index = filters.length - 1; index >= 0; index--) {
            if (removeSet.has(filters[index].field)) {
              filters.splice(index, 1)
            }
          }
          if (filters.length !== beforeCount) {
            currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
          }
          stageOneReasoningParts.push(`${multiStageResult.source}:remove:${multiStageResult.removeFields.join("|")}`)
        }

        for (const filter of multiStageResult.filters) {
          const normalizedFilter = normalizeRuntimeAppliedFilter(filter, filter.appliedAt ?? turnCount)
          const skipIdx = normalizedFilter.op === "skip"
            ? -1
            : filters.findIndex(existing => existing.field === normalizedFilter.field && existing.op === "skip")
          if (skipIdx >= 0) filters.splice(skipIdx, 1)
          if (normalizedFilter.op === "neq") {
            const existingIdx = filters.findIndex(existing => existing.field === normalizedFilter.field && existing.op !== "neq")
            if (existingIdx >= 0) filters.splice(existingIdx, 1)
          }
          const replaced = replaceFieldFilter(baseInput, filters, normalizedFilter, deps.applyFilterToInput)
          filters.splice(0, filters.length, ...replaced.nextFilters)
          currentInput = replaced.nextInput
          lastStageOneFilter = normalizedFilter
          const rawValue = Array.isArray(normalizedFilter.rawValue)
            ? normalizedFilter.rawValue.join("~")
            : String(normalizedFilter.rawValue ?? normalizedFilter.value)
          stageOneReasoningParts.push(`${multiStageResult.source}:${normalizedFilter.field}=${rawValue}:${normalizedFilter.op}`)
        }

        if (multiStageResult.sort) {
          stagedSpecPatch = mergeStagedSpecPatch(stagedSpecPatch, { sort: multiStageResult.sort })
          activeQuerySort = multiStageResult.sort
          stageOneReasoningParts.push(
            `${multiStageResult.source}:sort:${multiStageResult.sort.field}:${multiStageResult.sort.direction}`
          )
        }
        const resolverSimilarityPatch = buildResolverSimilaritySpecPatch(multiStageResult, msg)
        if (resolverSimilarityPatch) {
          stagedSpecPatch = mergeStagedSpecPatch(stagedSpecPatch, resolverSimilarityPatch)
          stageOneReasoningParts.push(
            `${multiStageResult.source}:similarTo:${resolverSimilarityPatch.similarTo?.referenceProductId}`
          )
          console.log(`[multi-stage:truth] staged similarity reference=${resolverSimilarityPatch.similarTo?.referenceProductId}`)
        }

        const fallbackFilter =
          lastStageOneFilter
          ?? multiStageResult.followUpFilter
          ?? filters[filters.length - 1]
          ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount }
        const resolverAction = buildActionFromMultiStageResult(multiStageResult, msg, turnCount, fallbackFilter)
        if (resolverAction) {
          bridgedV2Action = resolverAction
          bridgedV2OrchestratorResult = {
            action: resolverAction,
            reasoning: `multi-stage:${multiStageResult.source}:${stageOneReasoningParts.join(",") || multiStageResult.reasoning}`,
            agentsInvoked: [],
            escalatedToOpus: false,
          }
          singleCallHandled = true
          pendingSelectionAction = null
          pendingSelectionOrchestratorResult = null
          trace.add(
            "det-scr-pre",
            "router",
            {
              actions: effectiveDetApplyActions.map(a => ({ field: a.field, value: a.value, op: a.op })),
              skipField: stageOneEditResult?.intent.type === "skip_field" ? stageOneEditResult.intent.field : null,
              sort: stageOneSort ? `${stageOneSort.field}:${stageOneSort.direction}` : null,
              globalRelaxation: shouldClearUnmentionedFields,
              resolverIntent: multiStageResult.intent,
            },
            { applied: stageOneReasoningParts.length, filterCount: filters.length },
            `multi-stage terminal ${multiStageResult.source}`
          )
          console.log(`[multi-stage:terminal] ${stageOneReasoningParts.join(",") || multiStageResult.reasoning}`)
        }
      } else {
        console.log("[multi-stage:truth] resolver produced no actionable output; legacy fallback remains enabled")
      }
    }

    // ── 1. Edit-Intent Layer: state modification (deterministic, 0 LLM calls) ──
    // Handles replace/exclude/skip/clear/go_back/reset — runs BEFORE KG so edit
    // expressions are not intercepted by KG's exclude patterns.
    if (!singleCallHandled && lastUserMsg && hasEditSignal(msg) && !shouldResolvePendingSelectionEarly) {
      const editResult = stageOneEditResult
      if (
        editResult
        && editResult.intent.type === "reset_all"
        && shouldExecuteEditIntentDeterministically(editResult)
        && editResult.confidence >= 0.9
      ) {
        try {
        const mutation = applyEditIntent(editResult.intent, filters, turnCount)
        trace.add("edit-intent", "router", { type: editResult.intent.type, reason: editResult.reason, confidence: editResult.confidence })

        if (editResult.intent.type === "reset_all") {
          bridgedV2Action = { type: "reset_session" }
          bridgedV2OrchestratorResult = { action: bridgedV2Action, reasoning: `edit-intent:reset_all`, agentsInvoked: [], escalatedToOpus: false }
          singleCallHandled = true
          pendingSelectionAction = null
          pendingSelectionOrchestratorResult = null
          console.log(`[edit-intent] reset_all`)
        } else {
          // Handle go_back first — pass the addFilter as followUpFilter so the
          // go_back handler applies it AFTER restoring the previous state.
          if (mutation.goBack) {
            const followUp = mutation.addFilter
              ? buildAppliedFilterFromValue(
                  mutation.addFilter.field,
                  mutation.addFilter.rawValue,
                  turnCount,
                  mutation.addFilter.op === "neq" ? "neq" : undefined,
                ) ?? mutation.addFilter
              : undefined
            bridgedV2Action = { type: "go_back_one_step", followUpFilter: followUp }
            bridgedV2OrchestratorResult = { action: bridgedV2Action, reasoning: `edit-intent:go_back`, agentsInvoked: [], escalatedToOpus: false }
            pendingSelectionAction = null
            pendingSelectionOrchestratorResult = null
            // Skip the addFilter application below — go_back handler will apply it.
            mutation.addFilter = null
          }

          // Apply removals (reverse order to keep indices valid)
          for (const idx of [...mutation.removeIndices].sort((a, b) => b - a)) {
            filters.splice(idx, 1)
          }

          // Apply addition
          if (mutation.addFilter) {
            const built = mutation.addFilter.op === "skip"
              ? mutation.addFilter
              : buildAppliedFilterFromValue(
                  mutation.addFilter.field,
                  mutation.addFilter.rawValue,
                  turnCount,
                  mutation.addFilter.op === "neq" ? "neq" : undefined,
                )
            if (built) {
              const skipIdx = built.op === "skip"
                ? -1
                : filters.findIndex(x => x.field === built.field && x.op === "skip")
              if (skipIdx >= 0) filters.splice(skipIdx, 1)
              const result = replaceFieldFilter(baseInput, filters, built, deps.applyFilterToInput)
              filters.splice(0, filters.length, ...result.nextFilters)
              currentInput = result.nextInput
            } else {
              // buildAppliedFilterFromValue failed (e.g. brand not in registry) — apply raw filter directly
              const skipIdx = filters.findIndex(x => x.field === mutation.addFilter!.field && x.op === "skip")
              if (skipIdx >= 0) filters.splice(skipIdx, 1)
              filters.push(mutation.addFilter)
            }
          }

          if (!bridgedV2Action) {
            const lastF = mutation.addFilter ?? filters[filters.length - 1] ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount }
            const hasShowRec = /추천|보여|제품\s*보기|show/iu.test(msg)
            bridgedV2Action = hasShowRec
              ? { type: "show_recommendation" }
              : { type: "continue_narrowing", filter: lastF }
          }
          if (!bridgedV2OrchestratorResult) {
            bridgedV2OrchestratorResult = { action: bridgedV2Action, reasoning: `edit-intent:${editResult.reason}`, agentsInvoked: [], escalatedToOpus: false }
          }
          singleCallHandled = true
          negationHandled = editResult.intent.type === "exclude_field"
          console.log(`[edit-intent] ${editResult.intent.type}: ${editResult.reason}`)
        }
        } catch (err) {
          // Defensive: any throw inside apply (filter registry, replaceFieldFilter,
          // applyFilterToInput) must not 500 the request — log and fall through.
          console.warn(`[edit-intent] apply failed for "${msg.slice(0, 80)}":`, (err as Error).message)
          singleCallHandled = false
          bridgedV2Action = null
          bridgedV2OrchestratorResult = null
        }
      }
    }

    // ── 2. Knowledge Graph: entity match + navigation (deterministic, 0 LLM calls, ~0.01s) ──
    // Gated by runtime flag — when disableKg=true (header x-disable-kg: 1), skip
    // KG entirely so SCR/sql-agent + LLM handle all extraction. Used for A/B
    // testing the LLM-only path against the KG-augmented path.
    let kgHint: string | undefined
    if (!singleCallHandled && lastUserMsg && legacyKgInterpreterEnabled && !shouldResolvePendingSelectionEarly) {
      const kgResult = tryKGDecision(msg, prevState)
      trace.add("knowledge-graph", "router", { confidence: kgResult.confidence, source: kgResult.source, reason: kgResult.reason })

      if (kgResult.decision && kgResult.confidence >= 0.9) {
        // Phase E — KG §9 specPatch (sort/tolerance/similarTo).
        // Stash on prevState so the downstream compileProductQuery path (or
        // post-display rerank) can pick it up. For similarTo we resolve the
        // "__current__" sentinel to a real product id from session state here,
        // because KG doesn't have session context.
        if (kgResult.specPatch && prevState) {
          const patch = { ...kgResult.specPatch }
          if (patch.similarTo?.referenceProductId === "__current__") {
            const ps = prevState as any
            const resolvedId: string | undefined =
              ps.lastRecommendedProductId ||
              ps.lastRecommended?.productId ||
              ps.lastRecommended?.id ||
              (Array.isArray(ps.displayedProducts) && ps.displayedProducts[0]?.productId) ||
              (Array.isArray(ps.displayedProducts) && ps.displayedProducts[0]?.id)
            if (resolvedId) {
              patch.similarTo = { ...patch.similarTo, referenceProductId: String(resolvedId) }
            } else {
              delete patch.similarTo
            }
          }
          ;(prevState as any).kgSpecPatch = patch
          console.log(`[kg:spec-patch] ${kgResult.source} → ${JSON.stringify(patch)}`)
        }
        // High confidence → execute deterministically, skip LLM
        const kgAction = kgResult.decision.action
        const kgFilters: AppliedFilter[] = []

        // Collect filters from action + extraFilters
        if (kgAction.type === "continue_narrowing" && (kgAction as any).filter) {
          kgFilters.push((kgAction as any).filter)
        }
        if (kgResult.decision.extraFilters?.length) {
          kgFilters.push(...kgResult.decision.extraFilters)
        }

        if (kgFilters.length > 0) {
          for (const kf of kgFilters) {
            const isNeg = kf.op === "exclude" || kf.op === "neq"
            const built = buildAppliedFilterFromValue(kf.field, kf.rawValue ?? kf.value, turnCount, isNeg ? "neq" : undefined)
            if (built) {
              const skipIdx = filters.findIndex(x => x.field === built.field && x.op === "skip")
              if (skipIdx >= 0) filters.splice(skipIdx, 1)
              const result = replaceFieldFilter(baseInput, filters, built, deps.applyFilterToInput)
              filters.splice(0, filters.length, ...result.nextFilters)
              currentInput = result.nextInput
              if (built.field === pendingSelectionFilter?.field && pendingSelectionAction?.type === "skip_field") {
                pendingSelectionAction = null
                pendingSelectionOrchestratorResult = null
                console.log(`[kg:override-pending] KG filter ${built.field}=${built.value} overrides pending skip_field`)
              }
            }
          }
          bridgedV2Action = kgAction
          bridgedV2OrchestratorResult = { action: kgAction, reasoning: `kg:${kgResult.reason}`, agentsInvoked: [], escalatedToOpus: false }
          singleCallHandled = true
          console.log(`[kg:hit] "${msg}" → ${kgResult.source} (${kgResult.confidence}), ${kgFilters.length} filters applied`)
        } else if (["skip_field", "go_back_one_step", "reset_session", "show_recommendation", "filter_by_stock", "refine_condition"].includes(kgAction.type)) {
          if (kgAction.type === "skip_field" && !prevState?.lastAskedField) {
            console.log(`[kg:skip-guard] skip_field ignored — no pending field (first turn)`)
          } else {
            bridgedV2Action = kgAction
            bridgedV2OrchestratorResult = { action: kgAction, reasoning: `kg:${kgResult.reason}`, agentsInvoked: [], escalatedToOpus: false }
            singleCallHandled = true
            if (kgAction.type === "reset_session" || kgAction.type === "go_back_one_step") {
              pendingSelectionAction = null
              pendingSelectionOrchestratorResult = null
            }
            console.log(`[kg:hit] "${msg}" → ${kgResult.source} (${kgResult.confidence}), action=${kgAction.type}`)
          }
        } else if (kgAction.type === "answer_general") {
          bridgedV2Action = kgAction
          bridgedV2OrchestratorResult = { action: kgAction, reasoning: `kg:${kgResult.reason}`, agentsInvoked: [], escalatedToOpus: false }
          singleCallHandled = true
          console.log(`[kg:hit] "${msg}" → ${kgResult.source} (${kgResult.confidence}), answer_general`)
        }
      } else if (kgResult.confidence >= 0.5) {
        // Medium confidence → pass as hint to SCR (used later if SQL Agent also fails)
        const entities = extractEntities(msg)
        // Exclude diameterMm from hint: "<num>mm" is lexically ambiguous
        // (could be OAL / LOC / shank / cutting diameter) and SCR has the
        // surrounding context to disambiguate; passing it as a hint would
        // bias SCR toward diameterMm and re-introduce the hijack regression
        // (2026-04-09 guard).
        const safeEntities = entities.filter(e => e.field !== "diameterMm")
        if (safeEntities.length > 0) {
          kgHint = safeEntities.map(e => `${e.field}=${e.canonical}`).join(", ")
          console.log(`[kg:hint] "${msg}" → ${kgResult.source} (${kgResult.confidence}), hint: ${kgHint}`)
        }
      }
    }

    // KG → sql-agent bridge: even when KG decision confidence is low, any
    // entity match (shankType=HSK, cornerRadiusMm=0.5, taperAngleDeg=5, ...)
    // should be surfaced to sql-agent as a hint so the LLM can include it.
    // Only builds a hint if one wasn't already set above.
    if (!kgHint && lastUserMsg && !singleCallHandled && legacyKgHintEnabled && !shouldResolvePendingSelectionEarly) {
      const entities = extractEntities(msg)
      const safeEntities = entities.filter(e => e.field !== "diameterMm")
      if (safeEntities.length > 0) {
        kgHint = safeEntities.map(e => `${e.field}=${e.canonical}`).join(", ")
        console.log(`[kg:hint:bridge] "${msg}" → hint: ${kgHint}`)
      }
    }

    // ── 3. SQL Agent: primary handler (Haiku 1회, schema-aware, ~0.5s) ──
    // Handles filters + negation + navigation — replaces deterministic negation handler
    // Wrapped in semantic-cache: identical/synonymous queries with the same filter
    // context replay the cached agent result and skip the LLM call entirely.
    if (!singleCallHandled && lastUserMsg && !shouldResolvePendingSelectionEarly) {
      try {
        const schema = getDbSchemaSync()
        if (schema) {
          const { lookupCache: lookupSemanticCache, storeCache: storeSemanticCache } = await import("@/lib/recommendation/core/semantic-cache")
          const semanticHit = shouldUseSqlAgentSemanticCache(fullThinkingEnabled)
            ? lookupSemanticCache(msg, filters)
            : null

          let agentResult: { filters: import("@/lib/recommendation/core/sql-agent").AgentFilter[]; raw: string; reasoning?: string; confidence?: "high" | "medium" | "low"; clarification?: string | null }
          if (semanticHit && semanticHit.source === "sql-agent") {
            agentResult = {
              filters: semanticHit.actions as unknown as import("@/lib/recommendation/core/sql-agent").AgentFilter[],
              raw: "",
            }
            trace.add("semantic-cache", "router", { query: msg.slice(0, 80) }, { hit: true, source: "sql-agent", filterCount: agentResult.filters.length }, "semantic-cache hit")
          } else {
            // Use the streaming variant when an onThinking sink is wired up so
            // we can flush reasoning chars to the SSE channel as they arrive.
            // The streaming function transparently falls back to the
            // non-streaming path when provider.stream is unavailable.
            // sql-agent 스트리밍 CoT: complexity.generateCoT 게이트와 무관하게
            // 항상 켠다. 이 경로(자유 텍스트)는 chip click 같은 deterministic
            // patch가 없어서 reasoning 이 유일한 trail 소스 — 끄면 trail이 빈다.
            // chip click 은 애초에 sql-agent 를 거치지 않으므로 영향 없음.
            if (deps.onThinking && provider.stream) {
              let streamedAny = false
              agentResult = await naturalLanguageToFiltersStreaming(
                msg,
                schema,
                filters,
                provider,
                (delta) => {
                  streamedAny = true
                  try {
                    deps.onThinking!(delta, fullThinkingEnabled ? { delta: true, kind: "deep" } : { delta: true })
                  } catch { /* never block runtime */ }
                },
                fullThinkingEnabled ? "cot" : "fast",
                kgHint,
              )
              // If streaming yielded nothing (e.g. fallback path triggered),
              // emit the final reasoning as a single non-delta frame so the UI
              // still shows something.
              if (!streamedAny && agentResult.reasoning) {
                try {
                  deps.onThinking(agentResult.reasoning, fullThinkingEnabled ? { kind: "deep" } : undefined)
                } catch { /* never block runtime */ }
              }
            } else {
              agentResult = await naturalLanguageToFilters(
                msg,
                schema,
                filters,
                provider,
                fullThinkingEnabled ? "cot" : "fast",
                kgHint,
              )
              if (deps.onThinking && agentResult.reasoning) {
                try {
                  deps.onThinking(agentResult.reasoning, fullThinkingEnabled ? { kind: "deep" } : undefined)
                } catch { /* never block runtime */ }
              }
            }
            // Store in semantic cache for next time (only meaningful results)
            if (shouldUseSqlAgentSemanticCache(fullThinkingEnabled) && agentResult.filters.length > 0) {
              storeSemanticCache(msg, filters, {
                source: "sql-agent",
                actions: agentResult.filters as unknown as import("@/lib/recommendation/core/semantic-cache").CachedAction[],
              })
            }
          }
          trace.add("sql-agent", "router", { filterCount: agentResult.filters.length, raw: agentResult.raw.slice(0, 200) })

          // Surface SQL-agent reasoning to the UI as a Claude-style "추론 과정"
          // collapsible. We stash it on prevState so the presenter (which reads
          // sessionState) picks it up regardless of which response builder fires.
          // The deltas (if any) were already flushed during streaming above; the
          // stash here ensures the final text is persisted on the session for
          // non-stream consumers and message history.
          if (agentResult.reasoning) {
            setThinking(runtimeThinking, agentResult.reasoning, fullThinkingEnabled ? "deep" : "stage")
            syncThinkingToSession(prevState, runtimeThinking)
          }

          // ── CoT confidence 기반 분기 ──
          // low: 필터 적용하지 않고 clarification 질문만 — 0건 무한 루프 방지
          // medium/high: 기존대로 필터 적용, medium이면 clarification도 함께 전달
          if (agentResult.clarification && prevState) {
            ;(prevState as unknown as { pendingClarification?: string }).pendingClarification = agentResult.clarification
          }
          if (agentResult.confidence === "low" && agentResult.clarification) {
            console.log(`[sql-agent:confidence] LOW — skipping filters, asking: "${agentResult.clarification.slice(0, 80)}"`)
            trace.add("sql-agent", "router", { confidence: "low" }, { clarification: agentResult.clarification.slice(0, 120) }, "low-confidence → clarification")
            // filters 무시 — 아래 블록 진입 안 함
            agentResult = { ...agentResult, filters: [] }
          }

          // ── _qa: SQL Agent의 직접 답변 (질문/상담/비교/트러블슈팅) ──
          const qaFilter = agentResult.filters.find(f => f.field === "_qa")
          if (qaFilter) {
            const qaText = String(qaFilter.value ?? "").trim()
            if (qaText) {
              console.log(`[_qa] direct answer: "${qaText.slice(0, 80)}"`)
              if (prevState) {
                ;(prevState as unknown as { __qaDirectAnswer?: string }).__qaDirectAnswer = qaText
              }
            }
            agentResult = { ...agentResult, filters: agentResult.filters.filter(f => f.field !== "_qa") }
          }

          // _qa만 있고 다른 필터 없음 → answer_general 경로 (narrowing 회피)
          if (qaFilter && agentResult.filters.length === 0) {
            const qaText = String(qaFilter.value ?? "").trim()
            console.log(`[_qa] pure Q/A — routing to answer_general`)
            const qaAction = { type: "answer_general" as const, message: qaText }
            bridgedV2Action = qaAction
            bridgedV2OrchestratorResult = { action: qaAction, reasoning: "sql-agent:_qa", agentsInvoked: [], escalatedToOpus: false }
            singleCallHandled = true
          } else if (agentResult.filters.length > 0) {
            const META_FIELDS = new Set(["_skip", "_reset", "_back"])
            const metaAction = agentResult.filters.find(f => META_FIELDS.has(f.field))
            if (metaAction) {
              if (metaAction.op === "reset") {
                bridgedV2Action = { type: "reset_session" }
              } else if (metaAction.op === "back") {
                bridgedV2Action = { type: "go_back_one_step" }
              } else if (metaAction.op === "skip") {
                if (!prevState?.lastAskedField) {
                  console.log(`[sql-agent:skip-guard] skip_field ignored — no pending field`)
                } else {
                  bridgedV2Action = { type: "skip_field" }
                }
              }
              if (bridgedV2Action) {
                bridgedV2OrchestratorResult = { action: bridgedV2Action, reasoning: `sql-agent:${metaAction.op}`, agentsInvoked: [], escalatedToOpus: false }
                singleCallHandled = true
                if (bridgedV2Action.type === "reset_session" || bridgedV2Action.type === "go_back_one_step") {
                  pendingSelectionAction = null
                  pendingSelectionOrchestratorResult = null
                }
                console.log(`[sql-agent] meta action: ${metaAction.op}`)
              }
            } else {
              // 필터 적용 (eq + neq 모두 처리)
              const parsedFilters = agentResult.filters.map(af => ({
                field: af.field,
                op: af.op,
                value: af.value,
                value2: af.value2 ?? null,
                display: af.display ?? null,
              }))
              const normalizedFilters: Array<Record<string, unknown>> = []
              const droppedFilters: Array<Record<string, unknown>> = []
              for (const af of agentResult.filters) {
                const builtResult = buildAppliedFilterFromAgentFilterWithTrace(af, turnCount)
                const built = builtResult.filter
                if (!built) {
                  droppedFilters.push({
                    field: af.field,
                    op: af.op,
                    value: af.value,
                    value2: af.value2 ?? null,
                    reason: builtResult.droppedReason ?? "build_failed",
                  })
                  continue
                }
                normalizedFilters.push({
                  field: built.field,
                  op: built.op,
                  value: built.value,
                  rawValue: built.rawValue,
                  rawValue2: (built as AppliedFilter & { rawValue2?: string | number }).rawValue2 ?? null,
                })
                if (built) {
                  // NEQ: 기존 같은 필드 필터 제거 �� 추가
                  if (af.op === "neq") {
                    const existingIdx = filters.findIndex(f => f.field === built.field && f.op !== "neq")
                    if (existingIdx >= 0) filters.splice(existingIdx, 1)
                  }
                  const skipIdx = filters.findIndex(x => x.field === built.field && x.op === "skip")
                  if (skipIdx >= 0) filters.splice(skipIdx, 1)
                  const result = replaceFieldFilter(baseInput, filters, built, deps.applyFilterToInput)
                  filters.splice(0, filters.length, ...result.nextFilters)
                  currentInput = result.nextInput
                  if (built.field === pendingSelectionFilter?.field && pendingSelectionAction?.type === "skip_field") {
                    pendingSelectionAction = null
                    pendingSelectionOrchestratorResult = null
                  }
                }
              }

              const hasShowRec = /추천|보여|제품\s*보기|show/iu.test(msg)
              traceRecommendation("runtime.handleServeExplorationInner:sql-agent-filter-pipeline", {
                confidence: agentResult.confidence ?? null,
                parsedFilters,
                normalizedFilters,
                droppedFilters,
                finalFilters: filters.filter(f => f.op !== "skip").map(f => ({
                  field: f.field,
                  op: f.op,
                  value: f.value,
                  rawValue: f.rawValue,
                  rawValue2: (f as AppliedFilter & { rawValue2?: string | number }).rawValue2 ?? null,
                })),
              })

              const lastF = filters[filters.length - 1] ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount }
              bridgedV2Action = hasShowRec
                ? { type: "show_recommendation" }
                : { type: "continue_narrowing", filter: lastF }
              bridgedV2OrchestratorResult = {
                action: bridgedV2Action,
                reasoning: `sql-agent:${agentResult.filters.map(f => `${f.field}=${f.op}${f.value}`).join(",")}`,
                agentsInvoked: [],
                escalatedToOpus: false,
              }
              singleCallHandled = true
              negationHandled = hasNegationPattern // SQL Agent가 negation도 처리했으므로
              console.log(`[sql-agent] ${agentResult.filters.length} filters: ${agentResult.filters.map(f => `${f.field}${f.op}${f.value}`).join(", ")}`)
            }
          }
        }
      } catch (e) {
        console.error(`[sql-agent] error, falling back to negation/SCR:`, e)
      }
    }

    // ── 3a-bis. Tool Forge fallback ─────────────────────────────
    // Runs ONLY when det-SCR / KG / SQL-agent all failed to handle the message
    // (singleCallHandled still false). First checks the registry for a cached
    // forged tool; on miss, falls back to live LLM forge. Both paths persist
    // discovered patterns so the next request hits the registry in <50ms.
    //
    // NOTE: Phase 4 MVP — this populates the registry and logs forge results
    // for new patterns (절삭조건 / RPM / 유사제품 등). Row-to-canonical-candidate
    // injection is intentionally deferred to Phase 4.5 to avoid breaking the
    // existing scoring pipeline with mismatched product shapes.
    if (!singleCallHandled && lastUserMsg) {
      try {
        const schemaForForge = getDbSchemaSync()
        if (schemaForForge) {
          // Semantic cache wraps forge too — identical/synonymous follow-up queries
          // skip the entire forge LLM dance (Sonnet + relax + verify, ~7-15s) and
          // replay the captured rows directly from cache.
          const { lookupCache: lookupForgeCache, storeCache: storeForgeCache } = await import("@/lib/recommendation/core/semantic-cache")
          const forgeCacheHit = lookupForgeCache(msg, filters)
          if (forgeCacheHit && forgeCacheHit.source === "forge" && Array.isArray(forgeCacheHit.rows)) {
            const cachedRows = forgeCacheHit.rows
            forgedFallbackRows = cachedRows
            console.log(`[semantic-cache:hit:forge] "${msg.slice(0, 60)}" → ${cachedRows.length} cached rows`)
            trace.add("semantic-cache", "router", { query: msg.slice(0, 80) }, { hit: true, source: "forge", rowCount: cachedRows.length }, "forge cache hit")
          } else {
          const { findMatchingTool } = await import("@/lib/recommendation/core/tool-registry")
          const { forgeAndExecute, executeRegistryTool } = await import("@/lib/recommendation/core/tool-forge")

          const pool = (globalThis as { __yg1ProductDbPool?: import("pg").Pool }).__yg1ProductDbPool
          if (!pool) throw new Error("product DB pool not initialized")
          const cachedTool = await findMatchingTool(msg)

          if (cachedTool) {
            const t0 = Date.now()
            const { rows } = await executeRegistryTool(cachedTool, msg, pool, provider)
            console.log(`[tool-registry:hit] "${msg.slice(0, 60)}" → ${cachedTool.name} (${rows.length} rows, ${Date.now() - t0}ms)`)
            trace.add("tool-registry", "router", { tool: cachedTool.name, rowCount: rows.length, durationMs: Date.now() - t0 })
            if (rows.length > 0) {
              forgedFallbackRows = rows
              storeForgeCache(msg, filters, { source: "forge", actions: [], rows })
            }
          } else {
            // Live forge — slow but only on novel patterns
            const forgeResult = await forgeAndExecute(msg, schemaForForge, filters, provider, pool)
            console.log(`[tool-forge] "${msg.slice(0, 60)}" success=${forgeResult.success} rows=${forgeResult.rows.length} attempts=${forgeResult.attempts.length} ${forgeResult.totalDurationMs}ms${forgeResult.tool ? ` → registered ${forgeResult.tool.name}` : ""}`)
            trace.add("tool-forge", "router", {
              success: forgeResult.success,
              rowCount: forgeResult.rows.length,
              attempts: forgeResult.attempts.length,
              durationMs: forgeResult.totalDurationMs,
              registeredTool: forgeResult.tool?.name ?? null,
            })
            if (forgeResult.success && forgeResult.rows.length > 0) {
              forgedFallbackRows = forgeResult.rows
              storeForgeCache(msg, filters, { source: "forge", actions: [], rows: forgeResult.rows })
            }
          }
          } // end forge cache miss branch
        }
      } catch (e) {
        console.error(`[tool-forge] error (non-fatal):`, e instanceof Error ? e.message : String(e))
      }
    }

    // ── 3b. QuerySpec Planner + Decision Layer ──
    // 1) planner 항상 실행 → shadow filters 생성
    // 2) decision layer가 production vs planner confidence 비교
    // 3) planner가 충분히 높으면 override, 아니면 production 유지
    // Feature flag: ENABLE_PLANNER_DECISION=false → shadow trace only
    //
    // Phase G — variables declared in outer scope (near forgedFallbackRows);
    // filled here after KG merge, consumed in the v2 orchestrator block.
    if (lastUserMsg) {
      try {
        const currentConstraints = appliedFiltersToConstraints(filters)
        const plannerResult = await naturalLanguageToQuerySpec(msg, currentConstraints, getProviderForAgent("query-planner"))
        // Phase E.5 — merge any KG §9 specPatch stashed on session state into
        // the planner-built spec BEFORE we fan out to querySpecToAppliedFilters
        // or compileProductQuery. Consume-once: the patch is deleted from
        // session state so a stale patch can't re-apply on the next turn.
        const { mergeKgPatchIntoSpec, consumeKgSpecPatch } = await import("@/lib/recommendation/core/kg-spec-merge")
        const kgPatch = consumeKgSpecPatch(prevState)
        let spec = mergeKgPatchIntoSpec(plannerResult.spec, kgPatch)
        if (stagedSpecPatch) {
          spec = mergeKgPatchIntoSpec(spec, stagedSpecPatch)
        }
        if (spec.sort) {
          activeQuerySort = spec.sort
        }
        if (kgPatch) {
          console.log(`[kg-merge] applied patch: sort=${!!kgPatch.sort} similarTo=${!!kgPatch.similarTo} tolerance=${kgPatch.toleranceConstraints?.length ?? 0}`)
        }
        if (stagedSpecPatch) {
          console.log(`[stage1-merge] applied patch: sort=${!!stagedSpecPatch.sort} similarTo=${!!stagedSpecPatch.similarTo} tolerance=${stagedSpecPatch.toleranceConstraints?.length ?? 0}`)
          stagedSpecPatch = null
        }
        const structuredDraft = buildStructuredFilterDraft({
          userMessage: msg,
          sessionState: prevState,
          spec,
        })
        trace.add("structured-filter-draft", "router", {
          mode: structuredDraft.mode,
          intent: structuredDraft.intent,
          filterCount: structuredDraft.filters.length,
          confidence: structuredDraft.confidence,
          needsClarification: structuredDraft.needsClarification,
          sort: structuredDraft.sort ? `${structuredDraft.sort.field}:${structuredDraft.sort.direction}` : null,
        })
        const shouldBypassStructuredDraftClarification =
          hasNegationPattern && structuredDraft.mode !== "repair"

        if (structuredDraft.needsClarification && !singleCallHandled && !shouldBypassStructuredDraftClarification) {
          const clarificationState = prevState ?? buildSessionState({
            candidateCount: filters.length,
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
          return buildRevisionClarificationResponse(
            deps,
            clarificationState,
            form,
            filters,
            narrowingHistory,
            currentInput,
            turnCount,
            structuredDraft.clarificationQuestion ?? "조건을 한 번만 더 구체적으로 알려주세요.",
            requestPrep,
            buildStructuredDraftClarificationOptions(structuredDraft, prevState),
          )
        }
        const shadowFilters = querySpecToAppliedFilters(spec, turnCount)

        // ── Phase G — dual-path execute via compileProductQuery ──
        // When the merged spec carries sort / similarTo the legacy
        // AppliedFilter[] path silently drops those features. Compile +
        // execute the spec against the DB here; we stash the ordered result
        // and the v2 orchestrator block below replaces its searchPayload
        // candidates in-place, so downstream response/explanation sees the
        // SQL-ordered rows. Tolerance stays on the legacy path because
        // expandToleranceConstraint already rewrites eq+tolerance → between
        // inside querySpecToAppliedFilters (verified — same helper imported
        // by both compile-product-query.ts and query-spec-to-filters.ts).
        try {
          const { specNeedsCompiler, executeSpecViaCompiler } = await import("@/lib/recommendation/core/execute-spec-via-compiler")
          if (specNeedsCompiler(spec)) {
            phaseGCompiledResult = await executeSpecViaCompiler(spec)
            phaseGSpecMode = phaseGCompiledResult.mode
            console.log(`[phase-g] dual-path engaged mode=${phaseGSpecMode} rows=${phaseGCompiledResult.rowCount} sqlHead="${phaseGCompiledResult.compiled.sql.slice(0, 120).replace(/\s+/g, " ")}"`)
            trace.add("phase-g-compile-exec", "router", {
              mode: phaseGSpecMode,
              rowCount: phaseGCompiledResult.rowCount,
              appliedConstraintCount: phaseGCompiledResult.compiled.appliedConstraints.length,
              droppedConstraintCount: phaseGCompiledResult.compiled.droppedConstraints.length,
              sqlHasOrderBy: /ORDER\s+BY/i.test(phaseGCompiledResult.compiled.sql),
              sqlHasSimilarity: /_similarity_score/.test(phaseGCompiledResult.compiled.sql),
            })
          }
        } catch (e) {
          console.warn(`[phase-g] compile-execute failed (non-blocking, falling back to legacy path):`, e instanceof Error ? e.message : String(e))
          phaseGCompiledResult = null
        }

        // Decision layer: confidence-based selection
        const kgHandled = singleCallHandled && bridgedV2OrchestratorResult?.reasoning?.startsWith("kg:")
        const sqlAgentHandled = singleCallHandled && bridgedV2OrchestratorResult?.reasoning?.startsWith("sql-agent:")
        const decision = decidePlannerOverride(spec, shadowFilters, filters, !!kgHandled, !!sqlAgentHandled)

        let plannerApplied = false
        // Phase 2: semantic loss correction — KG가 eq로 뭉갠 range를 planner가 보정
        // decision.winner와 무관하게, planner가 range op이고 production이 eq면 보정
        const isSemanticLossCorrection = ENABLE_PLANNER_DECISION
          && singleCallHandled
          && spec.constraints.length === 1
          && ["gte", "lte", "between"].includes(spec.constraints[0].op)
          && shadowFilters.length > 0
          && filters.some(f => f.field === shadowFilters[0]?.field && f.op === "eq")
        if (isSemanticLossCorrection) {
          // 기존 eq 필터를 planner의 range 필터로 교체
          const sf = shadowFilters[0]
          const eqIdx = filters.findIndex(f => f.field === sf.field && f.op === "eq")
          if (eqIdx >= 0) {
            filters[eqIdx] = sf
            currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
            plannerApplied = true
            console.log(`[planner-decision] semantic-loss-correction: ${sf.field} eq→${sf.op} ${sf.rawValue}${sf.rawValue2 ? `~${sf.rawValue2}` : ""}`)
          }
        }
        if (ENABLE_PLANNER_DECISION && decision.winner === "planner" && !singleCallHandled) {
          // Navigation override
          if (spec.constraints.length === 0 && spec.navigation !== "none") {
            if (spec.navigation === "reset") bridgedV2Action = { type: "reset_session" }
            else if (spec.navigation === "back") bridgedV2Action = { type: "go_back_one_step" }
            else if (spec.navigation === "skip" && prevState?.lastAskedField) bridgedV2Action = { type: "skip_field" }

            if (bridgedV2Action) {
              bridgedV2OrchestratorResult = { action: bridgedV2Action, reasoning: `planner-decision:${spec.navigation}`, agentsInvoked: [], escalatedToOpus: false }
              singleCallHandled = true
              plannerApplied = true
              if (bridgedV2Action.type === "reset_session" || bridgedV2Action.type === "go_back_one_step") {
                pendingSelectionAction = null
                pendingSelectionOrchestratorResult = null
              }
            }
          }
          // Single constraint override
          else if (shadowFilters.length > 0 && spec.constraints.length === 1) {
            for (const sf of shadowFilters) {
              const skipIdx = filters.findIndex(x => x.field === sf.field && x.op === "skip")
              if (skipIdx >= 0) filters.splice(skipIdx, 1)
              if (sf.op === "neq") {
                const existingIdx = filters.findIndex(f => f.field === sf.field && f.op !== "neq")
                if (existingIdx >= 0) filters.splice(existingIdx, 1)
              }
              const result = replaceFieldFilter(baseInput, filters, sf, deps.applyFilterToInput)
              filters.splice(0, filters.length, ...result.nextFilters)
              currentInput = result.nextInput
            }

            const hasShowRec = spec.intent === "show_recommendation" || /\uCD94\uCC9C|\uBCF4\uC5EC|\uC81C\uD488\s*\uBCF4\uAE30|show/iu.test(msg)
            const lastF = filters[filters.length - 1] ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount }
            bridgedV2Action = hasShowRec
              ? { type: "show_recommendation" }
              : { type: "continue_narrowing", filter: lastF }
            bridgedV2OrchestratorResult = {
              action: bridgedV2Action,
              reasoning: `planner-decision:${spec.constraints.map(c => `${c.field}=${c.op}${c.value}`).join(",")}`,
              agentsInvoked: [],
              escalatedToOpus: false,
            }
            singleCallHandled = true
            plannerApplied = true
            negationHandled = hasNegationPattern && spec.constraints[0]?.op === "neq"
          }
        }

        const plannerOps = spec.constraints.map(c => c.op)
        const productionOps = filters.map(f => f.op)
        const hasSemanticLoss = plannerOps.some(op => op === "gte" || op === "lte" || op === "between") && productionOps.every(op => op === "eq" || op === "includes" || op === "skip")

        trace.add("query-planner", "router", {
          intent: spec.intent,
          navigation: spec.navigation,
          constraintCount: spec.constraints.length,
          constraints: spec.constraints.map(c => `${c.field}${c.op}${c.value}`),
          shadowFilterCount: shadowFilters.length,
          plannerOps,
          productionOps,
          semanticLoss: hasSemanticLoss,
          latencyMs: plannerResult.latencyMs,
          reasoning: spec.reasoning,
          decision: {
            winner: decision.winner,
            plannerScore: decision.plannerScore.score,
            plannerFactors: decision.plannerScore.factors,
            productionScore: decision.productionScore.score,
            productionFactors: decision.productionScore.factors,
            margin: decision.margin,
            reason: decision.reason,
          },
          applied: plannerApplied,
        })
        console.log(`[planner-decision] winner=${decision.winner} planner=${decision.plannerScore.score.toFixed(2)} prod=${decision.productionScore.score.toFixed(2)} margin=${decision.margin.toFixed(2)} applied=${plannerApplied} | ${spec.constraints.length}c ${plannerResult.latencyMs}ms`)

        // ── Pattern Mining Log (non-blocking, fire-and-forget) ──
        const editIntentHandled = singleCallHandled && bridgedV2OrchestratorResult?.reasoning?.startsWith("edit-intent:")
        const prodSource = editIntentHandled ? "edit-intent" as const
          : kgHandled ? "kg" as const
          : sqlAgentHandled ? "sql-agent" as const
          : negationHandled ? "negation" as const
          : singleCallHandled ? "scr" as const
          : "none" as const
        logPatternMiningEntry({
          userText: msg,
          production: {
            source: prodSource,
            constraints: filters.map(f => ({ field: f.field, op: f.op, value: f.rawValue ?? f.value })),
            handled: singleCallHandled,
          },
          planner: {
            constraints: spec.constraints.map(c => ({ field: c.field, op: c.op, value: c.value })),
            navigation: spec.navigation,
            intent: spec.intent,
            confidence: decision.plannerScore.score,
            reasoning: spec.reasoning,
          },
          decision: {
            winner: decision.winner,
            plannerScore: decision.plannerScore.score,
            productionScore: decision.productionScore.score,
            margin: decision.margin,
            reason: decision.reason,
            applied: plannerApplied,
          },
          finalFilters: filters.map(f => ({ field: f.field, op: f.op, value: f.rawValue ?? f.value })),
        })
      } catch (e) {
        console.warn(`[query-planner] error (non-blocking):`, e)
      }
    }

    // ── 4. Deterministic negation fallback (SQL Agent 실패 시에만) ──
    if (false && !singleCallHandled && hasNegationPattern) {
      const msgLower = msg.toLowerCase()

      // Track 1: Remove existing filter if value matches
      if (filters.length > 0) {
        for (const existingFilter of [...filters]) {
          const filterValue = String(existingFilter.rawValue ?? existingFilter.value).toLowerCase()
          if (msgLower.includes(filterValue) && existingFilter.op !== "skip") {
            const idx = filters.indexOf(existingFilter)
            if (idx >= 0) {
              filters.splice(idx, 1)
              currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
              console.log(`[negation-deterministic] Removed ${existingFilter.field}=${existingFilter.value} filter`)
              negationHandled = true
            }
          }
        }
      }

      // Track 2: No matching filter found → create NEQ exclusion filter
      if (!negationHandled) {
        const negatedValue = extractNegatedValue(msg)
        if (negatedValue) {
        const neqFilter: AppliedFilter = {
          field: negatedValue.field,
          op: "neq",
          value: negatedValue.displayValue,
          rawValue: negatedValue.rawValue,
          appliedAt: turnCount,
        }
          const existingIdx = filters.findIndex(f => f.field === neqFilter.field)
          if (existingIdx >= 0) filters.splice(existingIdx, 1)
          filters.push(neqFilter)
          currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
          console.log(`[negation-deterministic] Created NEQ filter: ${neqFilter.field} != ${neqFilter.rawValue}`)
          negationHandled = true
        }
      }

      if (negationHandled) {
        pendingSelectionAction = null
        pendingSelectionOrchestratorResult = null
        bridgedV2Action = { type: "continue_narrowing", filter: filters[filters.length - 1] ?? { field: "none", op: "skip", value: "", rawValue: "", appliedAt: turnCount } as AppliedFilter }
        bridgedV2OrchestratorResult = {
          action: bridgedV2Action,
          reasoning: `negation_deterministic:${filters[filters.length - 1]?.op === "neq" ? "neq_filter" : "removed_filter"}`,
          agentsInvoked: [],
          escalatedToOpus: false,
        }
        singleCallHandled = true
      }
    }

    // ── 5. SCR: 최후 fallback ──
    const negationFullyHandled = hasNegationPattern && negationHandled
    const shouldUseSingleCall = (isSingleCallRouterEnabled() || LLM_FREE_INTERPRETATION) && lastUserMsg && messages.length > 0 && !negationFullyHandled && !singleCallHandled && !bareRecommendationRequest && (LLM_FREE_INTERPRETATION || (!shouldResolvePendingSelectionEarly && !pendingAlreadyResolved))
    if (shouldUseSingleCall) {
      // ── Pending clarification round-trip ──
      // 직전 턴에서 ambiguity chip을 보였고 사용자가 그 chip을 클릭(=동일 텍스트
      // 전송)했으면 SCR/LLM 호출 없이 synthetic apply_filter로 우회.
      // SCR 결과를 만들어 기존 executableActions 경로로 흘려보낸다.
      let scrOverride: Awaited<ReturnType<typeof routeSingleCall>> | null = null
      if (prevState?.pendingClarification?.chipResolution) {
        const userText = lastUserMsg.text.trim()
        const resolution = prevState.pendingClarification.chipResolution[userText]
        if (resolution) {
          console.log(`[SCR:clarify-resolve] chip="${userText}" → ${resolution.field}=${resolution.value}`)
          scrOverride = {
            actions: [{
              type: "apply_filter",
              field: resolution.field,
              value: resolution.value,
              op: "eq",
            }],
            answer: "",
            reasoning: `clarify_resolve:${resolution.field}=${resolution.value}`,
          }
          // Clear pendingClarification so it doesn't re-fire on subsequent turns.
          prevState.pendingClarification = null
        }
      }

      // Pass recent conversation history so SCR understands references like "아까 거", "그거로"
      const recentConversation = messages.slice(-6) // last 3 turns (AI+User pairs)
      // Per-agent provider override: if AGENT_SINGLE_CALL_ROUTER_PROVIDER is set,
      // route this LLM call to OpenAI-compatible (GPT/Groq/Gemini/local).
      // Falls back to Claude default when env not set.
      const scrProvider = getProviderForAgent("single-call-router")
      const singleResult = scrOverride
        ?? await routeSingleCall(lastUserMsg.text, prevState, scrProvider, recentConversation, kgHint)
      // Temporary debug: log SCR result to trace
      trace.add("single-call-router", "router", {
        actionCount: singleResult.actions.length,
        actions: singleResult.actions.map(a => ({ type: a.type, field: a.field, value: a.value, op: a.op })),
        reasoning: singleResult.reasoning,
        answer: singleResult.answer?.slice(0, 100),
      })

      // ── MV reverse-index ambiguity short-circuit ──
      // 사용자가 필드명 없이 던진 토큰이 여러 슬롯에 매치되면 SCR이
      // clarification 정보를 채워 보낸다. 다른 결정론 액션이 없을 때만
      // 즉시 질문 응답으로 단락(short-circuit)시키고, 액션이 있을 땐
      // 그 액션은 정상 적용 후 후속 턴에서 묻는다 (현재는 answer 텍스트로).
      if (singleResult.clarification && singleResult.actions.length === 0 && prevState) {
        console.log(`[SCR:clarify] returning clarification question with ${singleResult.clarification.chips.length} chips`)
        trace.add("single-call-router-clarify", "router", {
          question: singleResult.clarification.question,
          chips: singleResult.clarification.chips,
        })
        // Build chipResolution: chip label → { field, value }. The chip
        // text is "<label>로 적용 (<token>)"; recover the token from the
        // parenthesis to use as the filter value.
        const chipResolution: Record<string, { field: string; value: string }> = {}
        for (const chip of singleResult.clarification.chips) {
          const field = singleResult.clarification.chipFieldMap[chip]
          if (!field) continue
          const m = chip.match(/\(([^)]+)\)\s*$/)
          const value = m ? m[1] : chip
          chipResolution[chip] = { field, value }
        }
        return buildRevisionClarificationResponse(
          deps,
          prevState,
          form,
          filters,
          narrowingHistory,
          currentInput,
          turnCount,
          singleResult.clarification.question,
          requestPrep,
          singleResult.clarification.chips,
          { chipResolution },
        )
      }

      // Filter out _canonFailed actions — let legacy handle them
      const hasCanonFailed = singleResult.actions.some(a => a._canonFailed)
      const executableActions = singleResult.actions.filter(a => !a._canonFailed)
      if (hasCanonFailed) {
        console.warn(`[SCR] ${singleResult.actions.length - executableActions.length} action(s) had _canonFailed, will fallthrough to legacy for those`)
        trace.add("single-call-router-canon-failed", "router", {
          failedActions: singleResult.actions.filter(a => a._canonFailed).map(a => ({ type: a.type, field: a.field, value: a.value })),
        })
      }

      if (executableActions.length > 0) {
        for (const action of executableActions) {
          switch (action.type) {
            case "apply_filter": {
              if (!action.field || action.value == null) {
                console.warn(`[SCR] apply_filter skipped — missing field or value`)
                break
              }
              // Range ops (gte/lte/between) need op override; between also needs value2.
              const isBetween = action.op === "between" && action.value2 != null
              const filterInputValue: string | number | Array<string | number> = isBetween
                ? [action.value, action.value2 as string | number]
                : action.value
              const filter = buildAppliedFilterFromValue(action.field, filterInputValue, turnCount, action.op)
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
              if (!action.field) {
                console.warn(`[SCR] remove_filter skipped — missing field`)
                break
              }
              const idx = filters.findIndex(f => f.field === action.field)
              if (idx >= 0) filters.splice(idx, 1)
              currentInput = rebuildResolvedInputFromFilters(form, filters, deps)
              break
            }
            case "replace_filter": {
              if (!action.field || action.to == null) {
                console.warn(`[SCR] replace_filter skipped — missing field or to`)
                break
              }
              const newFilter = buildAppliedFilterFromValue(action.field, action.to, turnCount)
              if (newFilter) {
                const result = replaceFieldFilter(baseInput, filters, newFilter, deps.applyFilterToInput)
                filters.splice(0, filters.length, ...result.nextFilters)
                currentInput = result.nextInput
                // Record revision in long-term memory
                if (prevState?.conversationMemory) recordRevision(prevState.conversationMemory, action.field)
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
              // Record skip in long-term memory
              if (prevState?.conversationMemory) recordSkip(prevState.conversationMemory, skipField)
              break
            }
            case "compare": {
              explicitComparisonAction = { type: "compare_products", targets: action.targets || [] }
              explicitComparisonOrchestratorResult = buildExplicitComparisonOrchestratorResult(action.targets || [])
              break
            }
            case "answer": {
              // Record Q&A in long-term memory (only if session exists)
              if (prevState?.conversationMemory) {
                const questionField = prevState.lastAskedField ?? null
                recordQA(prevState.conversationMemory, lastUserMsg.text, singleResult.answer || "", questionField, turnCount)
                recordHighlight(prevState.conversationMemory, turnCount, "question", lastUserMsg.text.slice(0, 50), questionField ?? undefined)
                if (questionField) recordConfusion(prevState.conversationMemory, questionField)
              }
              // Turn 0 (no prevState): build a minimal session state so general-chat handler has context.
              const answerState = prevState ?? buildSessionState({
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
              // Stash SCR's answer text so prompt-builder can inject it as the core answer.
              if (singleResult.answer) {
                ;(answerState as unknown as { __qaDirectAnswer?: string }).__qaDirectAnswer = singleResult.answer
              }
              return handleServeGeneralChatAction({
                deps,
                action: { type: "answer_general", message: singleResult.answer || lastUserMsg.text },
                orchResult: buildPreSearchOrchestratorResult(lastUserMsg.text, "single_call_answer"),
                provider,
                form,
                messages,
                prevState: answerState,
                filters,
                narrowingHistory,
                currentInput,
                candidates: [],
                evidenceMap: new Map(),
                turnCount,
              })
            }
            case "reset": {
              singleCallHandled = true
              bridgedV2Action = { type: "reset" as any }
              bridgedV2OrchestratorResult = {
                action: bridgedV2Action,
                reasoning: "single_call:reset",
                agentsInvoked: [{ agent: "single-call-router", model: "haiku" as const, durationMs: 0 }],
                escalatedToOpus: false,
              }
              break
            }
            case "go_back": {
              singleCallHandled = true
              bridgedV2Action = { type: "go_back" as any }
              bridgedV2OrchestratorResult = {
                action: bridgedV2Action,
                reasoning: "single_call:go_back",
                agentsInvoked: [{ agent: "single-call-router", model: "haiku" as const, durationMs: 0 }],
                escalatedToOpus: false,
              }
              break
            }
          }
        }

        // If filters changed, set up continue_narrowing action and clear pending
        if (executableActions.some(a => ["apply_filter", "remove_filter", "replace_filter"].includes(a.type))) {
          // Post-result: filter the FULL narrowed pool in-memory (not just the displayed top-N)
          // so re-ranking can promote a previously hidden candidate into the #1 slot.
          const fullPoolCandidates: CandidateSnapshot[] =
            (prevState?.fullDisplayedCandidates && prevState.fullDisplayedCandidates.length > 0)
              ? prevState.fullDisplayedCandidates
              : (prevState?.displayedCandidates ?? [])
          if (isPostResultPhase(journeyPhase) && fullPoolCandidates.length > 0) {
            const appliedFilterActions = executableActions.filter(a => ["apply_filter", "remove_filter", "replace_filter"].includes(a.type))
            let filtered = fullPoolCandidates as unknown as Array<Record<string, unknown>>
            for (const fa of appliedFilterActions) {
              if (fa.type === "apply_filter" && fa.field && fa.value != null) {
                const f = buildAppliedFilterFromValue(fa.field, fa.value, turnCount)
                if (f) {
                  filtered = filtered.filter(c => {
                    const def = getFilterFieldDefinition(f.field)
                    if (!def?.matches) return true
                    return def.matches(c, f) !== false
                  })
                }
              } else if (fa.type === "remove_filter" && fa.field) {
                // Remove = widen back to the full narrowed pool (skip this filter)
                filtered = fullPoolCandidates as unknown as Array<Record<string, unknown>>
              }
            }
            const fullFilteredSnapshots = filtered as unknown as CandidateSnapshot[]
            // Cap displayed set to top-N (matches retrieval default of 3) — order is preserved
            // from the existing score-ranked pool, so the new #1 reflects the post-filter winner.
            const DISPLAY_TOP_N = 3
            const displayedFilteredSnapshots = fullFilteredSnapshots.slice(0, DISPLAY_TOP_N)
            const filteredScope = buildFilterValueScope(fullFilteredSnapshots as unknown as Array<Record<string, unknown>>)
            const postFilterChips: string[] = []
            if (displayedFilteredSnapshots.length >= 2) postFilterChips.push("상위 2개 비교")
            if (fullFilteredSnapshots.length > displayedFilteredSnapshots.length) postFilterChips.push(`전체 ${fullFilteredSnapshots.length}개 보기`)
            postFilterChips.push("⟵ 이전 단계", "처음부터 다시")

            console.log(`[post-result-filter] pool=${fullPoolCandidates.length} → filtered=${fullFilteredSnapshots.length} (top ${displayedFilteredSnapshots.length} shown) (${appliedFilterActions.map(a => `${a.type}:${a.field}=${a.value??a.to??""}`).join(", ")})`)

            const sessionState = carryForwardState(prevState, {
              candidateCount: fullFilteredSnapshots.length,
              appliedFilters: filters,
              narrowingHistory,
              resolutionStatus: prevState.resolutionStatus ?? "broad",
              resolvedInput: currentInput,
              turnCount,
              displayedCandidates: displayedFilteredSnapshots,
              fullDisplayedCandidates: fullFilteredSnapshots,
              displayedChips: postFilterChips,
              displayedOptions: [],
              currentMode: "recommendation",
              lastAction: "post_result_filter",
              filterValueScope: filteredScope,
            })
            const filterSummary = fullFilteredSnapshots.length > 0
              ? (fullFilteredSnapshots.length > displayedFilteredSnapshots.length
                  ? `조건에 맞는 ${fullFilteredSnapshots.length}개 중 상위 ${displayedFilteredSnapshots.length}개입니다.`
                  : `조건에 맞는 ${fullFilteredSnapshots.length}개 제품입니다.`)
              : `조건에 맞는 제품이 없습니다. 전체 ${fullPoolCandidates.length}개 중 해당 조건을 만족하는 제품이 없어요.`
            return deps.jsonRecommendationResponse({
              text: filterSummary,
              purpose: fullFilteredSnapshots.length > 0 ? "recommendation" : "question",
              chips: postFilterChips,
              isComplete: fullFilteredSnapshots.length > 0,
              recommendation: null,
              sessionState,
              evidenceSummaries: null,
              candidateSnapshot: displayedFilteredSnapshots,
              requestPreparation: null,
              primaryExplanation: null,
              primaryFactChecked: null,
              altExplanations: [],
              altFactChecked: [],
              meta: {
                orchestratorResult: { action: "post_result_filter", agents: [{ agent: "single-call-router", model: "haiku" as const, durationMs: 0 }], opus: false },
              },
            })
          }

          // Pre-result: DB re-query
          // If SCR returned show_recommendation alongside filters, bridge as show_recommendation
          // so the system skips further questions and shows results immediately
          const hasShowRecommendation = executableActions.some(a => a.type === "show_recommendation")
          pendingSelectionAction = null
          pendingSelectionOrchestratorResult = null
          const lastFilter = filters[filters.length - 1] ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount }
          bridgedV2Action = hasShowRecommendation
            ? { type: "show_recommendation" }
            : { type: "continue_narrowing", filter: lastFilter }
          bridgedV2OrchestratorResult = {
            action: bridgedV2Action,
            reasoning: `single_call:${singleResult.reasoning}`,
            agentsInvoked: [{ agent: "single-call-router", model: "sonnet" as const, durationMs: 0 }],
            escalatedToOpus: false,
          }
          singleCallHandled = true
        }
      }
      // Empty actions (or all _canonFailed) = fallthrough to legacy routing below
      if (executableActions.length === 0 && singleResult.actions.length === 0) {
        console.log(`[SCR] 0 actions returned — falling through to legacy routing`)
        trace.add("single-call-router-empty", "router", {
          reasoning: singleResult.reasoning,
          answer: singleResult.answer?.slice(0, 100),
        })
      }
    }

    if (!shouldResolvePendingSelectionEarly && !singleCallHandled) {
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
        if (!revisionResult && !filterResult && prevState) {
          const trimmed = lastUserMsg.text.trim()
          const isExplainQuestion =
            (judgmentResult?.intentAction === "explain") ||
            /[?？]$/.test(trimmed) ||
            /(뭐야|뭔가요|뭔데|뭐에요|뭐임|무엇|뜻|의미|설명|알려)/.test(trimmed)
          if (
            isExplainQuestion &&
            (
              judgmentResult?.domainRelevance === "cutting_condition" ||
              isToolDomainQuestion(lastUserMsg.text)
            )
          ) {
            console.log(`[runtime:explain-route] ${judgmentResult?.domainRelevance ?? "tool_term"} -> answer_general before V2`)
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
          if (bareRecommendationRequest) {
            console.log(`[runtime:pre-route] bare recommendation request bypassed ${preSearchResult.kind} (${preSearchResult.reason})`)
          } else {
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
  }

  // ── Multi-filter extraction from user message (before V2/legacy routing) ──
  // 메시지에 2개 이상 필터 힌트가 있으면 deterministic 추출하여 즉시 적용
  if (lastUserMsg) {
    const { extractMaterial, extractDiameter } = await import("@/lib/recommendation/domain/input-normalizer")
    const { canonicalizeToolSubtype, extractFluteCount } = await import("@/lib/recommendation/shared/patterns")
    const msg = lastUserMsg.text
    const hintMaterial = extractMaterial(msg)
    const hintDiameter = extractDiameter(msg)
    const hintSubtype = canonicalizeToolSubtype(msg)
    const hintFlute = extractFluteCount(msg)
    const hintCount = [hintMaterial, hintDiameter, hintSubtype, hintFlute].filter(Boolean).length
    // 2개 이상 조건이 감지되면 멀티 필터 적용 (단일 조건은 기존 라우팅에 위임)
    if (hintCount >= 2) {
      if (hintMaterial && !resolvedInput.workPieceName) {
        resolvedInput.workPieceName = hintMaterial
        resolvedInput.material = hintMaterial
        if (!filters.some(f => f.field === "workPieceName")) {
          filters.push({ field: "workPieceName", op: "includes", value: hintMaterial, rawValue: hintMaterial, appliedAt: Date.now() })
        }
      }
      if (hintDiameter && !resolvedInput.diameterMm) {
        resolvedInput.diameterMm = hintDiameter
        if (!filters.some(f => f.field === "diameterMm")) {
          filters.push({ field: "diameterMm", op: "eq", value: String(hintDiameter), rawValue: hintDiameter, appliedAt: Date.now() })
        }
      }
      if (hintSubtype && !resolvedInput.toolSubtype) {
        resolvedInput.toolSubtype = hintSubtype
        if (!filters.some(f => f.field === "toolSubtype")) {
          filters.push({ field: "toolSubtype", op: "eq", value: hintSubtype, rawValue: hintSubtype, appliedAt: Date.now() })
        }
      }
      if (hintFlute && !resolvedInput.flutePreference) {
        resolvedInput.flutePreference = hintFlute
        if (!filters.some(f => f.field === "fluteCount")) {
          filters.push({ field: "fluteCount", op: "eq", value: String(hintFlute), rawValue: hintFlute, appliedAt: Date.now() })
        }
      }
      console.log(`[runtime:multi-filter-extract] ${hintCount} hints: material=${hintMaterial}, dia=${hintDiameter}, subtype=${hintSubtype}, flute=${hintFlute}`)

      // Multi-filter 추출 성공 → V2 덮어쓰기 방지
      // KG가 1개 잡았어도 (singleCallHandled=true) multi-filter가 나머지를 보충
      if (filters.length >= 2) {
        const hasShowRec = /추천|보여|제품\s*보기|show/iu.test(msg)
        const lastF = filters[filters.length - 1] ?? { field: "none", op: "skip" as const, value: "", rawValue: "", appliedAt: turnCount }
        bridgedV2Action = hasShowRec
          ? { type: "show_recommendation" }
          : { type: "continue_narrowing", filter: lastF }
        bridgedV2OrchestratorResult = {
          action: bridgedV2Action,
          reasoning: `multi-filter-extract:${hintCount} hints`,
          agentsInvoked: [],
          escalatedToOpus: false,
        }
        singleCallHandled = true
        console.log(`[runtime:multi-filter-extract] singleCallHandled=true, bridged=${bridgedV2Action.type}`)
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

      // Real-time CoT (v2-bridge path): the v2 orchestrator settles filters
      // BEFORE retrieval, but the function returns long before our late-stage
      // synthetic-thinking block ever runs. Fire onThinking right here so the
      // SSE 'thinking' frame lands while the user is still seeing the loading
      // bubble. Stash on legacyState so the presenter also surfaces it.
      // 칩 클릭/v2-bridge 경로: 합성 CoT 즉시 emit (LLM 호출 없음 — 이 경로는
      // CoT 없이도 잘 동작했고, 직렬 LLM 호출은 순수 latency 추가였음).
      try {
        const v2Filters = legacyState.appliedFilters ?? []
        if (v2Filters.length > 0 && !legacyState.thinkingProcess) {
          const cot = buildSyntheticThinkingFromFilters(v2Filters)
          if (cot) {
            legacyState.thinkingProcess = cot
            if (deps.onThinking) {
              try { deps.onThinking(cot) } catch { /* never block runtime */ }
            }
          }
        }
      } catch { /* safe-guard, never block v2 path */ }
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
        // ── Phase G — replace candidates with SQL-ordered rows from
        // compileProductQuery when sort/similarTo is active. We keep the
        // orchestrator's evidenceMap intact (by EDP code intersect) so
        // downstream explanation-builder still has evidence for every row it
        // displays. Skip hybrid rerank: user explicitly asked for this order.
        if (phaseGCompiledResult && phaseGCompiledResult.rowCount > 0) {
          try {
            const compiled = phaseGCompiledResult.products
            const payload = result.searchPayload as {
              candidates: typeof result.searchPayload.candidates
              evidenceMap: typeof result.searchPayload.evidenceMap
              totalConsidered: number
            }
            const origByCode = new Map<string, typeof payload.candidates[number]>()
            for (const c of payload.candidates) {
              const key = (c as { normalizedCode?: string; displayCode?: string }).normalizedCode
                ?? (c as { displayCode?: string }).displayCode
                ?? ""
              if (key) origByCode.set(key, c)
            }
            // Prefer original candidates (they already have hybrid scoring
            // metadata) reordered per compiled result; fall back to the
            // freshly-fetched CanonicalProduct for rows the orchestrator
            // never saw.
            const reordered: typeof payload.candidates = []
            for (const p of compiled) {
              const key = p.normalizedCode || p.displayCode || ""
              const hit = key ? origByCode.get(key) : undefined
              if (hit) reordered.push(hit)
              else reordered.push(p as unknown as typeof payload.candidates[number])
            }
            if (reordered.length > 0) {
              payload.candidates = reordered
              payload.totalConsidered = reordered.length
              console.log(`[phase-g] searchPayload replaced: mode=${phaseGSpecMode} candidates=${reordered.length} (${phaseGCompiledResult.rowCount} compiled, ${origByCode.size} from orchestrator)`)
            }
          } catch (e) {
            console.warn(`[phase-g] candidate replacement failed (keeping orchestrator result):`, e instanceof Error ? e.message : String(e))
          }
        }

        let totalCandidateCount = result.searchPayload.totalConsidered
        if (activeQuerySort) {
          result.searchPayload.candidates = sortScoredCandidatesByQuerySort(result.searchPayload.candidates, activeQuerySort)
          console.log(`[query-sort] applied runtime ordering field=${activeQuerySort.field} dir=${activeQuerySort.direction} candidates=${result.searchPayload.candidates.length}`)
        }

        let displayPage = sliceCandidatesForPage(
          result.searchPayload.candidates,
          result.searchPayload.evidenceMap,
          resolvedPagination
        )

        // ── Self-Correction: 0건 + 필터 존재 → 자동 교정 시도 ──
        // input(base constraints)은 유지하고 AppliedFilter[]만 mutate 한다.
        // 성공 시 result.searchPayload를 in-place 갱신하여 downstream이 그대로 사용.
        // Phase 가드 없음: search가 실행됐는데 0건이면 phase 무관하게 교정한다 (question 모드도 포함).
        console.log(`[self-correction:gate] total=${totalCandidateCount}, lastUserMsg=${!!lastUserMsg}, phase=${result.sessionState.journeyPhase}`)
        // RC3: capture original filters BEFORE self-correction drops any of
        // them, so insight-generator / domain-guard can still see the user's
        // intent (e.g. "스테인리스 DLC" → we need DLC in the warning check
        // even after self-correction drops DLC to find candidates).
        const preCorrectionFilters: AppliedFilter[] = [...(legacyState.appliedFilters ?? [])]
        if (totalCandidateCount === 0 && lastUserMsg) {
          try {
            const { constraintsToFilters } = await import("@/lib/recommendation/core/search-adapter")
            const { input: scInput, filters: scFilters } = constraintsToFilters(result.sessionState)
            if (scFilters.length > 0 && complexity.runSelfCorrection) {
              const { selfCorrectFilters } = await import("@/lib/recommendation/core/self-correction")
              const { runHybridRetrieval } = await import("@/lib/recommendation/domain/hybrid-retrieval")
              let lastHR: Awaited<ReturnType<typeof runHybridRetrieval>> | null = null
              const correction = await selfCorrectFilters(
                lastUserMsg.text, scFilters, provider,
                async (cf) => {
                  lastHR = await runHybridRetrieval(scInput, cf)
                  return lastHR.totalConsidered
                },
              )
              if (correction.success && lastHR) {
                const hr = lastHR as Awaited<ReturnType<typeof runHybridRetrieval>>
                const sortedHrCandidates = activeQuerySort
                  ? sortScoredCandidatesByQuerySort(hr.candidates, activeQuerySort)
                  : hr.candidates
                ;(result.searchPayload as { candidates: typeof hr.candidates; evidenceMap: typeof hr.evidenceMap; totalConsidered: number }).candidates = sortedHrCandidates
                ;(result.searchPayload as { candidates: typeof hr.candidates; evidenceMap: typeof hr.evidenceMap; totalConsidered: number }).evidenceMap = hr.evidenceMap
                ;(result.searchPayload as { candidates: typeof hr.candidates; evidenceMap: typeof hr.evidenceMap; totalConsidered: number }).totalConsidered = hr.totalConsidered
                totalCandidateCount = hr.totalConsidered
                displayPage = sliceCandidatesForPage(sortedHrCandidates, hr.evidenceMap, resolvedPagination)
                legacyState.appliedFilters = correction.finalFilters
                console.log(`[self-correction] success: ${correction.attempts.length} attempts → ${totalCandidateCount} results`)
              } else {
                console.log(`[self-correction] failed: ${correction.attempts.length} attempts, all 0`)
                // ── CoT ESCALATION ──
                // 비-CoT 경로(self-correction 포함)가 실패. SQL agent를 streaming
                // (CoT) variant로 다시 호출해서 reasoning을 UI에 흘리고, 재추출된
                // 필터로 retrieval 한 번 더 돌린다.
                try {
                  const cotSchema = await getDbSchema()
                  const cotResult = await naturalLanguageToFiltersStreaming(
                    lastUserMsg.text,
                    cotSchema,
                    legacyState.appliedFilters ?? [],
                    provider,
                    deps.onThinking
                      ? (delta) => {
                          try {
                            deps.onThinking!(delta, fullThinkingEnabled ? { delta: true, kind: "deep" } : { delta: true })
                          } catch { /* never block */ }
                        }
                      : undefined,
                    "cot", // ← escalation retry: full deliberative reasoning
                  )
                  if (cotResult.reasoning) {
                    if (fullThinkingEnabled) {
                      appendThinking(runtimeThinking, cotResult.reasoning, "deep")
                      syncThinkingToSession(legacyState, runtimeThinking)
                    } else {
                      legacyState.thinkingProcess =
                        (legacyState.thinkingProcess ? legacyState.thinkingProcess + "\n\n" : "")
                        + "🧠 CoT 재시도:\n" + cotResult.reasoning
                    }
                  }
                  if (cotResult.filters.length > 0) {
                    const cotApplied = cotResult.filters
                      .map(f => buildAppliedFilterFromAgentFilter(f, turnCount))
                      .filter((f): f is AppliedFilter => f !== null)
                    const mergedFilters = [...(legacyState.appliedFilters ?? []), ...cotApplied]
                    const cotHR = await runHybridRetrieval(scInput, mergedFilters)
                    if (cotHR.totalConsidered > 0) {
                      const sortedCotCandidates = activeQuerySort
                        ? sortScoredCandidatesByQuerySort(cotHR.candidates, activeQuerySort)
                        : cotHR.candidates
                      ;(result.searchPayload as { candidates: typeof cotHR.candidates; evidenceMap: typeof cotHR.evidenceMap; totalConsidered: number }).candidates = sortedCotCandidates
                      ;(result.searchPayload as { candidates: typeof cotHR.candidates; evidenceMap: typeof cotHR.evidenceMap; totalConsidered: number }).evidenceMap = cotHR.evidenceMap
                      ;(result.searchPayload as { candidates: typeof cotHR.candidates; evidenceMap: typeof cotHR.evidenceMap; totalConsidered: number }).totalConsidered = cotHR.totalConsidered
                      totalCandidateCount = cotHR.totalConsidered
                      displayPage = sliceCandidatesForPage(sortedCotCandidates, cotHR.evidenceMap, resolvedPagination)
                      legacyState.appliedFilters = mergedFilters
                      console.log(`[cot-escalation] success: +${cotApplied.length} filters → ${totalCandidateCount} results`)
                    } else {
                      console.log(`[cot-escalation] still 0 with ${cotApplied.length} new filters`)
                    }
                  } else {
                    console.log(`[cot-escalation] no new filters extracted`)
                  }
                } catch (cotErr) {
                  console.warn("[cot-escalation] error:", (cotErr as Error).message)
                }
              }
              if (correction.explanation) {
                legacyState.thinkingProcess = (legacyState.thinkingProcess ? legacyState.thinkingProcess + "\n\n" : "") + correction.explanation
              }
            }
          } catch (e) {
            console.warn("[self-correction] integration error:", (e as Error).message)
          }
        }

        // ── Web search fallback — self-correction까지 다 실패했을 때만 ──
        if (isResultPhase && lastUserMsg) {
          try {
            const { shouldTriggerWebSearch, runWebSearch, formatWebSearchBlock } =
              await import("@/lib/recommendation/core/web-search-fallback")
            const filtersExtracted = (legacyState.appliedFilters ?? []).length > 0
            if (
              complexity.allowWebSearch &&
              shouldTriggerWebSearch({
                message: lastUserMsg.text,
                filtersExtracted,
                candidateCount: totalCandidateCount,
              })
            ) {
              const ws = await runWebSearch(lastUserMsg.text)
              if (ws) {
                const block = formatWebSearchBlock(ws)
                legacyState.thinkingProcess =
                  (legacyState.thinkingProcess ? legacyState.thinkingProcess + "\n\n" : "") +
                  block.thinkingLine
                ;(legacyState as ExplorationSessionState & { webSearchContext?: string }).webSearchContext =
                  block.promptBlock
                console.log(`[web-search] success: query="${ws.query}" len=${ws.text.length}`)
              }
            }
          } catch (e) {
            console.warn("[web-search] integration error:", (e as Error).message)
          }
        }

        // ── Proactive Insight Engine (KB 기반 능동 통찰) ──
        try {
          const { generateInsights, formatInsightsForPrompt } = await import("@/lib/recommendation/core/insight-generator")
          // RC3: union current filters with pre-correction filters so warnings
          // on dropped combinations (e.g. 스테인리스+DLC) still surface.
          const currentFilters = legacyState.appliedFilters ?? []
          const unionFilters: AppliedFilter[] = [...currentFilters]
          for (const pf of preCorrectionFilters) {
            if (!unionFilters.some(f => f.field === pf.field && String(f.value) === String(pf.value))) {
              unionFilters.push(pf)
            }
          }
          const insights = generateInsights(
            lastUserMsg?.text ?? "",
            unionFilters,
            totalCandidateCount,
            legacyState.turnCount ?? 0,
          )
          if (insights.length > 0) {
            console.log(`[insight] ${insights.length}건: ${insights.map(i => `${i.type}(${i.source})`).join(", ")}`)
            const insightBlock = formatInsightsForPrompt(insights)
            legacyState.thinkingProcess = (legacyState.thinkingProcess ? legacyState.thinkingProcess + "\n\n" : "") + insightBlock
            ;(legacyState as ExplorationSessionState & { __proactiveInsights?: string }).__proactiveInsights = insightBlock
            // Auto-inject into all subsequent build*Response calls via the closure
            // wrapper installed at the top of handleServeExplorationInner.
            proactiveInsightsContext = insightBlock
          }
        } catch (e) {
          console.warn("[insight] error:", (e as Error).message)
        }

        // ── Kick features: domain-guard + predictive-filter + 견적 칩 ──
        try {
          const { checkDomainWarnings, formatWarningsForResponse } = await import("@/lib/recommendation/core/domain-guard")
          // RC3: check against union (pre-correction ∪ current) so dropped
          // filter combinations (e.g. 스테인리스+DLC) still warn.
          const dgCurrent = legacyState.appliedFilters ?? []
          const dgUnion: AppliedFilter[] = [...dgCurrent]
          for (const pf of preCorrectionFilters) {
            if (!dgUnion.some(f => f.field === pf.field && String(f.value) === String(pf.value))) {
              dgUnion.push(pf)
            }
          }
          const domainWarnings = checkDomainWarnings(dgUnion)
          if (domainWarnings.length > 0) {
            console.log(`[domain-guard] ${domainWarnings.length} warnings: ${domainWarnings.map(w => `${w.level}:${w.message.slice(0,50)}`).join("; ")}`)
            const warningText = domainWarnings.map(w => `[${w.level}] ${w.message}`).join("\n")
            legacyState.thinkingProcess = (legacyState.thinkingProcess ? legacyState.thinkingProcess + "\n\n" : "") + "⚠️ 도메인 경고:\n" + warningText
            const responseText = formatWarningsForResponse(domainWarnings)
            if (responseText) {
              ;(legacyState as ExplorationSessionState & { __domainWarnings?: string }).__domainWarnings = responseText
            }
          }
        } catch (e) {
          console.warn("[domain-guard] error:", (e as Error).message)
        }

        // Predictive-filter: 0건 + 필터 2+개일 때 조건별 대안 건수 제시
        if (totalCandidateCount === 0 && (legacyState.appliedFilters ?? []).length >= 2) {
          try {
            const { constraintsToFilters } = await import("@/lib/recommendation/core/search-adapter")
            const { predictFilterResult } = await import("@/lib/recommendation/core/predictive-filter")
            const { runHybridRetrieval: runHR } = await import("@/lib/recommendation/domain/hybrid-retrieval")
            const { input: pfInput, filters: pfFilters } = constraintsToFilters(result.sessionState)
            const prediction = await predictFilterResult(pfFilters, async (tf) => {
              const hr = await runHR(pfInput, tf)
              return hr.totalConsidered
            })
            if (prediction.willBeZero && prediction.suggestion) {
              console.log(`[predictive-filter] 0건 예측, ${prediction.dropOneResults.length}개 대안`)
              legacyState.thinkingProcess = (legacyState.thinkingProcess ? legacyState.thinkingProcess + "\n\n" : "") + "🔮 0건 예측:\n" + prediction.suggestion
              ;(legacyState as ExplorationSessionState & { __predictiveSuggestion?: string }).__predictiveSuggestion = prediction.suggestion
            }
          } catch (e) {
            console.warn("[predictive-filter] error:", (e as Error).message)
          }
        }

        // Turn 3+ 이면서 후보가 적당히 좁혀진 경우 액션 칩(견적/절삭조건) 추가
        if (
          (legacyState.turnCount ?? 0) >= 3 &&
          totalCandidateCount > 0 &&
          totalCandidateCount <= 20 &&
          Array.isArray(legacyState.displayedChips)
        ) {
          const existing = new Set(legacyState.displayedChips)
          const actionChips = ["이 제품으로 견적 요청", "절삭조건 알려주세요"]
          for (const c of actionChips) {
            if (!existing.has(c)) legacyState.displayedChips.push(c)
          }
        }

        legacyState.candidateCount = totalCandidateCount
        legacyState.displayedCandidates = deps.buildCandidateSnapshot(displayPage.candidates, displayPage.evidenceMap)
        legacyState.filterValueScope = buildFilterValueScope(result.searchPayload.candidates as unknown as Array<Record<string, unknown>>)

        perf.endStep("v2_orchestrator")
        perf.recordLlmCall()
        perf.finish()

        // self-correction이 실패해서 0건+필터>0인 케이스도 question 모드로 fallback
        if (isResultPhase && totalCandidateCount === 0 && (legacyState.appliedFilters ?? []).length > 0) {
          console.log("[runtime:v2] 0 candidates after self-correction → question fallback")
          legacyState.currentMode = "question"
          // RC3: deterministic warning prefix — when domain-guard caught an
          // incompatible combination (e.g. 스테인리스 + DLC) and result is 0,
          // inject the warning as responsePrefix so users see the reason even
          // if LLM polish drops it.
          const zeroWarning = (legacyState as ExplorationSessionState & { __domainWarnings?: string }).__domainWarnings
          const zeroPredictive = (legacyState as ExplorationSessionState & { __predictiveSuggestion?: string }).__predictiveSuggestion
          const prefixParts: string[] = []
          if (zeroWarning) prefixParts.push(zeroWarning)
          if (zeroPredictive) prefixParts.push(zeroPredictive)
          const zeroPrefix = prefixParts.length > 0 ? prefixParts.join("\n\n") : undefined
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
            undefined, // overrideText
            undefined, // existingStageHistory
            undefined, // excludeWorkPieceValues
            zeroPrefix, // responsePrefix — deterministic domain warning
          )
        }

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
          const wsCtx = (legacyState as ExplorationSessionState & { webSearchContext?: string }).webSearchContext
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
            null,
            wsCtx,
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

  // filter_by_stock 액션이지만 prevState 에 displayedCandidates 가 없으면
  // post-filter할 대상이 없어서 0건 응답이 됨. 이 경우 stockStatus 필터를 주입하고
  // 정상 retrieval 을 돌려서 SQL EXISTS subquery 가 inventory_summary_mv 와 join.
  const firstTurnStockDecision = computeFirstTurnStockFilterDecision({
    earlyAction,
    prevDisplayedCount: prevState?.displayedCandidates?.length ?? 0,
    hasStockStatusFilter: filters.some(f => f.field === "stockStatus"),
  })
  if (firstTurnStockDecision !== "noop") {
    if (firstTurnStockDecision === "injectAndClear") {
      const stockFilter = buildAppliedFilterFromValue("stockStatus", "instock", 0, "eq")
      if (stockFilter) {
        filters.push(stockFilter)
        console.log("[runtime:stock] first-turn filter_by_stock → injected stockStatus=instock filter and run retrieval")
      }
    }
    earlyAction = null  // 더 이상 SKIP 하지 않음
  }

  // ── First-turn empty-intake guard ─────────────────────────────
  // 빈 intake (소재/직경/가공방식/공구타입/공작물 모두 모름) + 첫 턴이면
  // SQL 으로 random 30개 뽑지 말고 chat-first로 입력 요청. (수찬님 :2999 와 동일 동작)
  const isFirstTurn = !prevState || (prevState.displayedCandidates?.length ?? 0) === 0
  const intakeIsEmpty =
    !resolvedInput?.material
    && !resolvedInput?.diameterMm
    && !resolvedInput?.workPieceName
    && !resolvedInput?.operationType
    && !resolvedInput?.toolType
    && filters.length === 0
  if (isFirstTurn && intakeIsEmpty && !earlyAction) {
    console.log("[runtime:first-turn-guard] empty intake → chat-first, skip retrieval")
    return deps.jsonRecommendationResponse({
      text: "제품을 추천해 드리기 위해 몇 가지 정보가 필요합니다:\n\n1. **피삭재(소재)** — 예: 탄소강, 합금강, 스테인리스강, 주철, 알루미늄, 티타늄, 인코넬\n2. **공구 직경** — 예: 6mm, 10mm, 12mm\n3. **가공 방식** — 예: 밀링/드릴링/탭핑/선삭, 황삭/정삭, 슬로팅\n4. **(선택) 날수** — 2날, 4날, 6날 등\n5. **(선택) 코팅** — TiAlN, AlCrN, DLC 등\n\n위 항목 중 아는 것만 알려주셔도 검색을 시작할 수 있습니다.",
      purpose: "question",
      chips: ["스테인리스 10mm 4날", "탄소강 8mm 황삭", "알루미늄 6mm", "티타늄 가공", "처음부터 다시"],
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
      requestPreparation: requestPrep ?? null,
    })
  }

  // ── CoT: synthetic Korean reasoning fallback ─────────────────
  // SQL agent path sets prevState.thinkingProcess upstream. Det-SCR / KG /
  // tool-use orchestrator paths produce technical reasoning strings that are
  // not user-friendly. If nothing has populated thinkingProcess yet but the
  // turn produced filters, generate a brief Korean explanation from the
  // actual filters and fire onThinking so the UI still gets a Claude-style
  // reasoning frame in real time.
  //
  // First-turn requests have prevState=null, so we MUST not gate on it —
  // the SSE 'thinking' frame is still useful even when there's no session yet.
  if ((!prevState?.thinkingProcess) && filters.length > 0) {
    // sql-agent 경로는 위에서 이미 reasoning을 스트림했고, 여기까지 오는 건
    // det-SCR / KG / tool-use 같이 CoT 없이도 잘 처리됐던 경로다. 합성 CoT만
    // emit (직렬 LLM 호출 금지 — 그 경로의 latency 회귀 원인이었음).
    const cot = buildSyntheticThinkingFromFilters(filters)
    if (cot) {
      if (prevState) prevState.thinkingProcess = cot
      if (deps.onThinking) {
        try { deps.onThinking(cot) } catch { /* never block runtime */ }
      }
    }
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

    // ── Knowledge fallback ──
    // DB에 일부 시리즈(SUPER ALLOY, TITANOX, X-POWER 등)가 누락돼 0건이 나오는 경우,
    // data/series-knowledge.json (PDF에서 추출한 2134 시리즈)에서 매칭을 시도한다.
    //
    // GATE: 사용자가 구체적인 시리즈/브랜드를 언급한 경우에만 fallback. 일반
    // (재질+직경+날수) 쿼리에선 fallback 30개가 ghost narrowing chip 무한루프를
    //만들어서 차단. 시리즈/브랜드 hint 없으면 0건 그대로 두고 broaden 안내.
    const hasSeriesOrBrandHint = !!(
      (resolvedInput as { seriesName?: string | null; brand?: string | null })?.seriesName?.trim()
      || (resolvedInput as { seriesName?: string | null; brand?: string | null })?.brand?.trim()
      || filters.some(f => f.field === "edpSeriesName" || f.field === "brand" || f.field === "seriesName")
    )
    if (candidates.length === 0 && !isPrecisionMode() && hasSeriesOrBrandHint) {
      try {
        const { searchKnowledgeFallback } = await import("@/lib/recommendation/infrastructure/knowledge/knowledge-fallback")
        let kbCandidates = searchKnowledgeFallback(resolvedInput, filters)
        // Knowledge fallback의 entryMatches는 negation(neq/exclude) 필터를 처리하지 않음.
        // → fallback 결과에 post-filter를 다시 적용해서 brand/series 제외 의도가 보존되도록 함.
        if (kbCandidates.length > 0) {
          for (const filter of filters) {
            if (filter.op !== "neq" && filter.op !== "exclude") continue
            const filtered = applyPostFilterToProducts(kbCandidates as unknown as CanonicalProduct[], filter)
            if (filtered != null) {
              kbCandidates = filtered as unknown as typeof kbCandidates
            }
          }
        }
        if (kbCandidates.length > 0) {
          candidates = kbCandidates
          totalCandidateCount = kbCandidates.length
          console.log(`[recommend] Knowledge fallback engaged: ${kbCandidates.length} series from catalog JSON`)
        }
      } catch (kbErr) {
        console.warn(`[recommend] Knowledge fallback error:`, (kbErr as Error).message)
      }
    }

    // Phase 4.5 — tool-forge fallback: hybrid + KB 모두 0건이면 forge 가 가져온
    // raw row 를 mapRowToProduct 로 canonical 로 매핑해 candidates 에 주입한다.
    if (candidates.length === 0 && forgedFallbackRows.length > 0) {
      try {
        const { mapRowToProduct } = await import("@/lib/data/repos/product-db-source")
        const mapped: ScoredProduct[] = []
        for (let i = 0; i < forgedFallbackRows.length; i++) {
          try {
            const row = forgedFallbackRows[i] as unknown as Parameters<typeof mapRowToProduct>[0]
            const product = mapRowToProduct(row)
            if (!product?.normalizedCode) continue
            mapped.push({
              product,
              score: 100 - i,
              scoreBreakdown: null,
              matchedFields: [],
              matchStatus: "approximate",
              inventory: [],
              leadTimes: [],
              evidence: [],
              stockStatus: "unknown",
              totalStock: null,
              minLeadTimeDays: null,
            })
          } catch { /* skip bad row */ }
        }
        if (mapped.length > 0) {
          candidates = mapped
          totalCandidateCount = mapped.length
          console.log(`[recommend] tool-forge fallback engaged: ${mapped.length} products from forged rows`)
        }
      } catch (forgeErr) {
        console.warn(`[recommend] tool-forge fallback mapping error:`, (forgeErr as Error).message)
      }
    }

    const orderedCandidates = applyRuntimeCandidateOrdering(candidates, activeQuerySort, phaseGCompiledResult)
    if (orderedCandidates.phaseGReplaced) {
      candidates = orderedCandidates.candidates
      totalCandidateCount = candidates.length
      console.log(`[phase-g] retrieval candidates replaced: mode=${phaseGSpecMode} candidates=${candidates.length}`)
    } else if (orderedCandidates.sortApplied) {
      candidates = orderedCandidates.candidates
      console.log(`[query-sort] applied retrieval ordering field=${activeQuerySort?.field} dir=${activeQuerySort?.direction} candidates=${candidates.length}`)
    }

    const displayPage = sliceCandidatesForPage(candidates, evidenceMap, resolvedPagination)
    displayCandidates = displayPage.candidates
    displayEvidenceMap = displayPage.evidenceMap
    console.log(`[recommend] Retrieval executed: display=${displayCandidates.length} total=${totalCandidateCount} candidates`)

    // ── Zero-result CoT ──────────────────────────────────────
    // 모든 fallback(KB / tool-forge)이 다 실패해서 결과가 0건이고 사용자가
    // 실제로 필터를 적용한 상태라면 여기서 강력한 진단 CoT를 만든다.
    // 글로벌 CoT hotfix(complexity-router)는 latency 때문에 OFF지만, 0건은
    // 정확히 CoT가 가치 있는 케이스 — "왜 안 나오는지 + 뭘 풀어야 나오는지"를
    // 고객이 즉시 알아야 함. 단일 Haiku 호출(~600 토큰).
    if (candidates.length === 0 && filters.filter(f => f.op !== "skip").length > 0 && lastUserMsg?.text) {
      try {
        const { generateZeroResultCoT } = await import("@/lib/recommendation/domain/zero-result-cot")
        const cot = await generateZeroResultCoT(
          {
            userMessage: lastUserMsg.text,
            filters,
            preFilterCount: prevState?.candidateCount ?? null,
          },
          provider,
        )
        if (cot) {
          if (prevState) {
            prevState.thinkingProcess =
              (prevState.thinkingProcess ? prevState.thinkingProcess + "\n\n" : "") + cot
          }
          if (deps.onThinking) {
            try { deps.onThinking(cot) } catch { /* never block runtime */ }
          }
          console.log(`[zero-result-cot] emitted (${cot.length} chars)`)
        }
      } catch (err) {
        console.warn(`[zero-result-cot] generation failed:`, (err as Error).message)
      }
    }
  } else {
    candidates = []
    evidenceMap = new Map()
    displayCandidates = []
    displayEvidenceMap = new Map()
    console.log(`[recommend] Retrieval SKIPPED for action: ${earlyAction}`)
  }

  // Compute candidate distribution for chip system + LLM prompts
  const candidateDistribution: Array<{ field: string; value: string; count: number }> = []
  if (candidates.length > 0 && LLM_FREE_INTERPRETATION) {
    const distFields = ["toolSubtype", "coating", "fluteCount", "seriesName"]
    const distMap = extractFilterFieldValueMap(candidates, distFields)
    for (const [field, valueCounts] of distMap) {
      for (const [value, count] of valueCounts) {
        candidateDistribution.push({ field, value, count })
      }
    }
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

  // ── First-turn bridged action: prevState=null이면 dispatch 블록(line ~2595) 도달 불가 → 여기서 처리 ──
  if (!prevState && singleCallHandled && bridgedV2Action) {
    if (bridgedV2Action.type === "answer_general" || bridgedV2Action.type === "redirect_off_topic") {
      const answerState = buildSessionState({
        candidateCount: totalCandidateCount,
        appliedFilters: filters,
        narrowingHistory,
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: currentInput,
        turnCount,
        displayedCandidates: displayCandidates,
        fullDisplayedCandidates: candidates,
        displayedProducts: displayCandidates,
        fullDisplayedProducts: candidates,
        displayedSeriesGroups: prevState?.displayedSeriesGroups ?? [],
        displayedChips: [],
        displayedOptions: [],
        currentMode: "question",
        lastRecommendationArtifact: displayCandidates,
      })
      return handleServeGeneralChatAction({
        deps,
        action: bridgedV2Action,
        orchResult: bridgedV2OrchestratorResult ?? {
          action: bridgedV2Action,
          reasoning: "first-turn-bridged-answer-general",
          agentsInvoked: [],
          escalatedToOpus: false,
        },
        provider,
        form,
        messages,
        prevState: answerState,
        filters,
        narrowingHistory,
        currentInput,
        candidates,
        evidenceMap,
        turnCount,
      })
    }
    if (bridgedV2Action.type === "show_recommendation" && displayCandidates.length > 0) {
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
    if (bridgedV2Action.type === "continue_narrowing" || bridgedV2Action.type === "show_recommendation") {
      // Filters applied on first turn but no show_recommendation or 0 candidates → ask next question
      return deps.buildQuestionResponse(
        form, candidates, evidenceMap, totalCandidateCount, paginationDto(totalCandidateCount),
        displayCandidates, displayEvidenceMap, currentInput, narrowingHistory, filters,
        turnCount, messages, provider, language,
      )
    }
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
              undefined,
              narrowingHistory,
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
            candidateCountBefore: prevState?.candidateCount ?? totalCandidateCount,
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
          "현재 질문에 대한 답변으로 인식하지 못했습니다. 아래 선택지 중에서 골라주시거나, 필요한 값이 있으면 형식에 맞게 직접 입력해주세요.",
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

      // Edit-intent "이전으로 돌아가서 X 제외": apply followUpFilter on top of restored state.
      const followUpFilter = action.type === "go_back_one_step" ? action.followUpFilter : undefined
      let restoredFilters = restoreResult.remainingFilters
      let restoredInput = restoreResult.rebuiltInput
      if (followUpFilter) {
        // Drop existing same-field eq filter (replaced by neq), then add followUp.
        restoredFilters = restoredFilters.filter(f =>
          !(f.field === followUpFilter.field && f.op !== "neq" && f.op !== "skip")
        )
        restoredFilters = [...restoredFilters, followUpFilter]
        // For neq filters, do NOT mutate input (input is for inclusion filters).
        if (followUpFilter.op !== "neq" && followUpFilter.op !== "skip") {
          restoredInput = deps.applyFilterToInput(restoredInput, followUpFilter)
        }
        console.log(`[edit-intent:go_back] applied followUpFilter ${followUpFilter.field}=${followUpFilter.rawValue}(${followUpFilter.op}) after restore`)
      }

      const undoResult = await runHybridRetrieval(
        restoredInput,
        restoredFilters.filter(filter => filter.op !== "skip"),
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
        restoredInput,
        restoreResult.remainingHistory,
        restoredFilters,
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
      // ── Stock filter via re-retrieval ──
      // Inject stockStatus filter into the standard recommendation pipeline so the
      // response carries full primary/alt explanations and renders proper product cards
      // (not just a text summary). Replaces previous post-snapshot filter which only
      // returned a text response without recommendation cards.
      const stockThreshold = action.stockThreshold ?? null
      const stockFilterMode = action.stockFilter
      const stockValue = stockThreshold != null && stockThreshold > 0
        ? String(stockThreshold)
        : "instock"
      const stockLabel = stockThreshold != null
        ? `재고 ${stockThreshold}개 이상인`
        : stockFilterMode === "instock" ? "재고 있는" : stockFilterMode === "limited" ? "재고 제한적 이상인" : "전체"

      const stockFilterEntry = buildAppliedFilterFromValue("stockStatus", stockValue, turnCount, "eq")
      if (stockFilterEntry) {
        // Replace any existing stockStatus filter rather than stacking
        for (let i = filters.length - 1; i >= 0; i--) {
          if (filters[i].field === "stockStatus") filters.splice(i, 1)
        }
        filters.push(stockFilterEntry)
      }
      console.log(`[runtime:stock] filter_by_stock → injecting stockStatus=${stockValue}, re-running retrieval`)

      // Defensive: if SQL EXISTS clause throws (missing MV, schema mismatch, etc.)
      // fall back to in-memory filtering of prevState.displayedCandidates so the
      // user still sees a useful response instead of a generic "오류 발생" toast.
      let stockResult: Awaited<ReturnType<typeof runHybridRetrieval>>
      try {
        stockResult = await runHybridRetrieval(currentInput, filters, 0, null)
      } catch (err) {
        console.error("[runtime:stock] hybrid retrieval failed, falling back to in-memory filter:", err)
        // Roll back the injected filter (won't be re-runnable as SQL anyway)
        for (let i = filters.length - 1; i >= 0; i--) {
          if (filters[i].field === "stockStatus") filters.splice(i, 1)
        }
        const prevCandidates = prevState?.displayedCandidates ?? []
        const filtered = stockThreshold != null && stockThreshold > 0
          ? prevCandidates.filter(c => (c.totalStock ?? 0) >= stockThreshold)
          : prevCandidates.filter(c => (c.totalStock ?? 0) > 0)
        const fallbackChips = ["⟵ 이전 단계", "처음부터 다시"]
        if (prevCandidates.length > 0) fallbackChips.unshift(`전체 ${prevCandidates.length}개 보기`)
        const sessionState = carryForwardState(prevState, {
          candidateCount: filtered.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState?.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: filtered,
          displayedChips: fallbackChips,
          displayedOptions: [],
          currentMode: prevState?.currentMode ?? "recommendation",
          lastAction: "filter_by_stock",
          pendingAction: null,
        })
        const fallbackText = filtered.length > 0
          ? `${stockLabel} 후보 ${filtered.length}개입니다 (이전 결과에서 필터링).`
          : `${stockLabel} 후보가 없습니다. 재고 조건을 완화해 보세요.`
        return deps.jsonRecommendationResponse({
          text: fallbackText,
          purpose: filtered.length > 0 ? "recommendation" : "question",
          chips: fallbackChips,
          isComplete: filtered.length > 0,
          recommendation: null,
          sessionState,
          evidenceSummaries: null,
          candidateSnapshot: filtered,
          requestPreparation: null,
          primaryExplanation: null,
          primaryFactChecked: null,
          altExplanations: [],
          altFactChecked: [],
          meta: {
            orchestratorResult: { action: action.type, agents: orchResult.agentsInvoked, opus: orchResult.escalatedToOpus, stockFallbackReason: err instanceof Error ? err.message : String(err) },
          },
        })
      }

      if (stockResult.totalConsidered === 0) {
        const prevCandidates = prevState?.displayedCandidates ?? []
        const noStockChips = ["⟵ 이전 단계", "처음부터 다시"]
        if (prevCandidates.length > 0) noStockChips.unshift(`전체 ${prevCandidates.length}개 보기`)
        // Roll back the injected filter so the user can retry
        for (let i = filters.length - 1; i >= 0; i--) {
          if (filters[i].field === "stockStatus") filters.splice(i, 1)
        }
        const sessionState = carryForwardState(prevState, {
          candidateCount: prevState?.candidateCount ?? prevCandidates.length,
          appliedFilters: filters,
          narrowingHistory,
          resolutionStatus: prevState?.resolutionStatus ?? "broad",
          resolvedInput: currentInput,
          turnCount,
          displayedCandidates: prevCandidates,
          displayedChips: noStockChips,
          displayedOptions: [],
          currentMode: prevState?.currentMode ?? "recommendation",
          lastAction: "filter_by_stock",
          pendingAction: null,
        })
        return deps.jsonRecommendationResponse({
          text: `${stockLabel} 후보가 없습니다. 재고 조건을 완화하거나 '이전 단계'를 선택해주세요.`,
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

      const stockDisplayPage = sliceCandidatesForPage(stockResult.candidates, stockResult.evidenceMap, resolvedPagination)
      return deps.buildRecommendationResponse(
        form,
        stockResult.candidates,
        stockResult.evidenceMap,
        stockResult.totalConsidered,
        paginationDto(stockResult.totalConsidered),
        stockDisplayPage.candidates,
        stockDisplayPage.evidenceMap,
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
        candidateCountBefore: prevState?.candidateCount ?? totalCandidateCount,
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
      const candidateCountBeforeFilter = restoreResult.remainingStages.at(-1)?.candidateCount ?? prevState?.candidateCount ?? totalCandidateCount

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
          narrowingHistory,
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
        revisionResponsePrefix,
      )
    }

    if (action.type === "continue_narrowing") {
      let filterAppliedAt = turnCount
      let baseFiltersForNext = filters
      let baseStageHistoryForNext = prevState.stageHistory ?? []
      let baseHistoryForNext = narrowingHistory
      // ── Narrowing-history "before" count fix ──
      // totalCandidateCount comes from runHybridRetrieval(filters) where the
      // upstream v2-bridge / SCR / sql-agent paths have ALREADY merged the new
      // chip filter into `filters`. So totalCandidateCount is the post-filter
      // count, not the pre-filter count. Use prevState.candidateCount (the
      // resolved count from the previous turn) as the true "before" value, so
      // narrowing history shows e.g. 33727→1669 instead of 1669→1669.
      let candidateCountBeforeFilter = prevState?.candidateCount ?? totalCandidateCount

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

      // NEQ/exclude는 input에 positive 값을 추가하지 않으므로 (DB SQL의 NOT 절로만 작동)
      // baseInput부터 재구성하면 다른 필드들의 input round-trip 손실 리스크가 있음.
      // currentInput을 그대로 두고 필터 배열에만 추가하여 회귀 방지.
      let nextFilterState: ReturnType<typeof replaceFieldFilter>
      if (filter.op === "neq" || filter.op === "exclude") {
        const dedupedFilters = baseFiltersForNext.filter(f => !(
          f.field === filter.field &&
          f.op === filter.op &&
          String(f.rawValue ?? f.value) === String(filter.rawValue ?? filter.value)
        ))
        nextFilterState = {
          replacedExisting: dedupedFilters.length !== baseFiltersForNext.length,
          nextFilters: [...dedupedFilters, filter],
          nextInput: currentInput,
        }
      } else {
        nextFilterState = replaceFieldFilter(
          baseInput,
          baseFiltersForNext,
          filter,
          deps.applyFilterToInput
        )
      }
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
          undefined,
          narrowingHistory,
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
const TOOL_DOMAIN_PATTERN = /slot|milling|side.?mill|shoulder|plunge|ball.?end|taper|square|corner.?r|radius|flute|날수|날 수|coating|코팅|dlc|tialn|alcrn|알루미늄.*가공|스테인리스.*가공|rpm|feed|이송|절삭|ap |ae |vc |fz |추천.*이유|왜.*추천|어떤.*형상|뭐가.*좋|뭐가.*맞|차이점|형상|가공.*방|황삭|정삭|엔드밀|드릴|탭|인서트|시리즈.*차이|제품.*비교|절삭.*조건|헬릭스|helix|비틀림|나선|리드|lead.?angle|rake|경사각|여유각|relief|chip.?load|칩.?로드|런아웃|runout|백래시|backlash|생크|shank|척킹|chuck|툴홀더|tool.?holder|오버행|overhang|워블|wobble/i

function isToolDomainQuestion(message: string): boolean {
  return TOOL_DOMAIN_PATTERN.test(message)
}
