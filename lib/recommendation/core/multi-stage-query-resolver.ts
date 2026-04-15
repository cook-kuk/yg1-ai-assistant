import { executeLlm } from "@/lib/llm/llm-executor"
import { getProviderForAgent, type LLMProvider } from "@/lib/llm/provider"
import { resolveRequestedToolFamily } from "@/lib/data/repos/product-query-filters"
import type { AppliedFilter, ExplorationSessionState, ExtractedSlot, RecommendationInput, UserIntent } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue, getFilterFieldDefinition, getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { detectMeasurementScopeAmbiguity } from "@/lib/recommendation/shared/measurement-scope-ambiguity"
import { detectOrderQuantityInventoryAmbiguity } from "@/lib/recommendation/shared/order-quantity-ambiguity"
import { stripKoreanParticles } from "@/lib/recommendation/shared/patterns"
import { normalizeRuntimeAppliedFilter } from "@/lib/recommendation/shared/runtime-filter-normalization"
import type { ComplexityDecision } from "./complexity-router"
import { buildDeterministicSemanticHints, type DeterministicAction } from "./deterministic-scr"
import {
  getEditIntentAffectedFields,
  getEditIntentHintTokens,
  hasEditSignal,
  shouldExecuteEditIntentDeterministically,
  type EditIntentResult,
} from "./edit-intent"
import type { QueryField, QuerySort } from "./query-spec"
import { getSortableFields, QUERY_FIELD_MANIFEST } from "./query-spec-manifest"
import { findValueByPhonetic, formatNumericStatsCompact, getDbSchemaSync } from "./sql-agent-schema-cache"
import { tokenize } from "./auto-synonym"
import { needsRepair } from "./turn-repair"
import {
  buildMaterialPromptHints,
  buildScopedMaterialPromptHints,
  resolveCatalogMaterialFamilyName,
  resolveMaterialFamilyName,
} from "@/lib/recommendation/shared/material-mapping"
import { canonicalizeKnownEntityValue, getKnownEntityValues } from "@/lib/recommendation/shared/entity-registry"
import { RESOLVER_CONFIG } from "@/lib/recommendation/infrastructure/config/resolver-config"
import {
  SEMANTIC_INTERPRETATION_POLICY_PROMPT,
  shouldDeferHardcodedSemanticExecution,
} from "./semantic-execution-policy"

type ResolverFilterOp = "eq" | "neq" | "gte" | "lte" | "between" | "skip"
type ResolverDecisionAction = "execute" | "ask_clarification" | "escalate_to_cot"
type ResolverRouteHint =
  | "none"
  | "ui_question"
  | "general_question"
  | "show_recommendation"
  | "compare_products"
export type ResolverIntent =
  | "none"
  | "continue_narrowing"
  | "show_recommendation"
  | "answer_general"
  | "reset_session"
  | "go_back_one_step"
  | "ask_clarification"

type PrimitiveValue = string | number | boolean
type ResolverConceptKind = "brand" | "feature" | "material" | "constraint"

interface ResolverFilterSpec {
  field: string
  op: ResolverFilterOp
  value?: PrimitiveValue | PrimitiveValue[]
  value2?: PrimitiveValue
  rawToken?: string
}

interface ResolverConceptSpec {
  kind: ResolverConceptKind
  op: ResolverFilterOp
  value?: PrimitiveValue | PrimitiveValue[]
  value2?: PrimitiveValue
  rawToken?: string
  fieldHint?: string | null
  status: "mapped" | "held"
}

export interface ResolverClarification {
  question: string
  chips: string[]
  askedField?: string | null
}

interface NormalizedResolverResult {
  action: ResolverDecisionAction
  filters: ResolverFilterSpec[]
  concepts: ResolverConceptSpec[]
  sort: QuerySort | null
  routeHint: ResolverRouteHint
  intent: ResolverIntent
  clearOtherFilters: boolean
  removeFields: string[]
  confidence: number
  unresolvedTokens: string[]
  reasoning: string
  clarification: ResolverClarification | null
}

export type ResolverValidationIssueCode =
  | "redundant_filter"
  | "negation_conflict"
  | "operator_attachment_conflict"
  | "skip_conflict"
  | "range_operator_mismatch"
  | "inventory_scope_ambiguity"
  | "measurement_scope_ambiguity"
  | "session_truth_conflict"
  | "domain_lock_risk"
  | "generic_specific_collapse"
  | "generic_preference_ambiguity"
  | "comparative_preference_ambiguity"
  | "mixed_clause_ambiguity"
  | "concept_mapping_gap"
  | "request_preparation_mismatch"
  | "recognized_entity_mismatch"
  | "correction_signal_ignored"
  | "noop_result"

export interface ResolverValidationIssue {
  code: ResolverValidationIssueCode
  severity: "warning" | "error"
  field?: string | null
  detail: string
  escalation: "weak_cot" | "strong_cot" | "clarification"
}

export interface ResolverValidationSummary {
  action: ResolverDecisionAction
  valid: boolean
  escalation: "none" | "weak_cot" | "strong_cot" | "clarification"
  issues: ResolverValidationIssue[]
}

export interface MultiStageResolverResult {
  source: "none" | "stage1" | "cache" | "stage2" | "stage3" | "clarification"
  action?: ResolverDecisionAction
  filters: AppliedFilter[]
  concepts: ResolverConceptSpec[]
  sort: QuerySort | null
  routeHint: ResolverRouteHint
  intent: ResolverIntent
  clearOtherFilters: boolean
  removeFields: string[]
  followUpFilter: AppliedFilter | null
  confidence: number
  unresolvedTokens: string[]
  reasoning: string
  clarification: ResolverClarification | null
  validation?: ResolverValidationSummary | null
}

export interface ResolveMultiStageQueryArgs {
  message: string
  turnCount: number
  currentFilters: AppliedFilter[]
  sessionState?: ExplorationSessionState | null
  resolvedInputSnapshot?: RecommendationInput | null
  conversationHistory?: Array<{ role: "user" | "assistant"; text: string }>
  pendingField?: string | null
  stageOneEditIntent?: EditIntentResult | null
  stageOneDeterministicActions?: DeterministicAction[]
  stageOneSort?: QuerySort | null
  stageOneClearUnmentionedFields?: boolean
  requestPreparationIntent?: UserIntent | null
  requestPreparationSlots?: ExtractedSlot[] | null
  recognizedEntities?: Array<{ field: string; value: string | number | boolean }> | null
  complexity?: ComplexityDecision | null
  stage2Provider?: LLMProvider | null
  stage3Provider?: LLMProvider | null
  stage1CotEscalation?: {
    enabled?: boolean
    currentCandidateCount?: number | null
    broadCandidateThreshold?: number
  } | null
}

interface StageOneBuildAnalysis {
  result: MultiStageResolverResult | null
  rawFilterSpecCount: number
  materializedFilterCount: number
  canonicalizationMissCount: number
  skipFilterCount: number
  concreteFilterCount: number
}

interface CacheEntry {
  key: string
  result: NormalizedResolverResult
  hitCount: number
  verifiedCount: number
  expiresAt: number
}

interface FailureEntry {
  count: number
  expiresAt: number
}

interface ResolverSchemaHint {
  token: string
  column: string
  value: string
  similarity: number
}

type ResolverValidationPhase = "stage1" | "cache" | "stage2" | "stage3"
type ResolverConversationMode = "new" | "refine" | "repair" | "explain"

interface ResolverConversationContext {
  mode: ResolverConversationMode
  stateSummary: string
  uiSummary: string
  historySummary: string
  candidateBufferSummary: string
  correctionSummary: string
  currentUnderstanding: string
  cacheSignature: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 7 * DAY_MS
const VERIFIED_CACHE_TTL_MS = 30 * DAY_MS
const FAILURE_TTL_MS = DAY_MS
const STAGE2_TIMEOUT_MS = RESOLVER_CONFIG.stage2TimeoutMs
const STAGE3_TIMEOUT_MS = RESOLVER_CONFIG.stage3TimeoutMs
const STAGE2_CONFIDENCE_THRESHOLD = RESOLVER_CONFIG.stage2ConfidenceThreshold
const SCHEMA_HINT_PHONETIC_THRESHOLD = RESOLVER_CONFIG.schemaHintPhoneticThreshold
const STAGE1_COT_BROAD_CANDIDATE_THRESHOLD = RESOLVER_CONFIG.stage1CotBroadCandidateThreshold
const STAGE1_COT_TOKEN_LIMIT = RESOLVER_CONFIG.stage1CotTokenLimit
const STAGE1_SKIP_CUE_RE = /(?:아무거나|상관\s*없|뭐든|다\s*괜찮|무관)/giu
const STAGE1_SORT_CUE_RE = /(?:제일|가장|젤|맨|최대한|긴걸로|짧은걸로|긴|짧은|큰|작은|많은|적은|높은|낮은|두꺼운|얇은)/giu

const NEGATION_CUE_RE = /(?:말고|빼고|제외|아니고|아니라|아닌\s*거|아닌거|아닌\b|except|without|exclude|not\b)/iu
const ALTERNATIVE_CUE_RE = /(?:다른\s*거|다른거|대신|instead|alternative|더\s*무난한|덜\s*공격적인|비슷한데?\s*더)/iu
const RANGE_GTE_CUE_RE = /(?:이상|초과|at\s*least|greater\s*than|over|>=)/iu
const RANGE_LTE_CUE_RE = /(?:이하|미만|at\s*most|less\s*than|under|below|<=)/iu
const GENERIC_COATING_CUE_RE = /(?:금속\s*코팅|표면\s*코팅|코팅재|코팅\b|surface\s*coating)/iu
const GENERIC_PREFERENCE_CUE_RE = /(?:뭐가\s*좋아|뭐가\s*좋을까|추천\s*기준|더\s*나은\s*선택|좋은\s*거|괜찮은\s*거)/iu
const COMPARATIVE_PREFERENCE_CUE_RE = /(?:말고\s*뭐가\s*좋아|말고\s*뭐가\s*나아|what\s+else\s+is\s+better|better\s+than)/iu
const MULTIPLE_HELIX_CUE_RE = /multiple\s*helix/iu

const DEICTIC_CONTEXT_RE = /(?:그거|그게|이거|이게|저거|저게|아까|방금|that|this|previous|last)/iu

const resolverCache = new Map<string, CacheEntry>()
const failureCache = new Map<string, FailureEntry>()

const FILTER_OPS = new Set<ResolverFilterOp>(["eq", "neq", "gte", "lte", "between", "skip"])
const ROUTE_HINTS = new Set<ResolverRouteHint>([
  "none",
  "ui_question",
  "general_question",
  "show_recommendation",
  "compare_products",
])
const RESOLVER_INTENTS = new Set<ResolverIntent>([
  "none",
  "continue_narrowing",
  "show_recommendation",
  "answer_general",
  "reset_session",
  "go_back_one_step",
  "ask_clarification",
])
const DECISION_ACTIONS = new Set<ResolverDecisionAction>([
  "execute",
  "ask_clarification",
  "escalate_to_cot",
])

const STOPWORD_TOKENS = new Set([
  "추천",
  "추천해줘",
  "추천해주세요",
  "보여줘",
  "보여주세요",
  "보여",
  "찾아줘",
  "찾아주세요",
  "해주세요",
  "해줘",
  "해",
  "지금",
  "그냥",
  "제품",
  "조건",
  "걸로",
  "만",
  "좀",
  "이거",
  "그거",
  "뭐",
  "좋은데",
  "좋게",
  "로",
  "으로",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "와",
  "과",
  "도",
  "만요",
  "해주세요요",
  "기준",
  "정도",
  "쯤",
])

const BARE_RECOMMENDATION_KEYS = new Set([
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
const fieldAliasIndex = (() => {
  const entries: Array<{ normalized: string; field: string }> = []
  for (const field of getRegisteredFilterFields()) {
    const aliases = [field, ...getFilterFieldQueryAliases(field)]
    for (const alias of aliases) {
      const normalized = normalizeToken(alias)
      if (!normalized) continue
      entries.push({ normalized, field })
    }
  }
  entries.sort((a, b) => b.normalized.length - a.normalized.length)
  return entries
})()

const sortableFieldAliasIndex = (() => {
  const sortable = new Set(getSortableFields())
  const entries: Array<{ normalized: string; field: QueryField }> = []
  for (const entry of QUERY_FIELD_MANIFEST) {
    if (!sortable.has(entry.field)) continue
    for (const alias of [entry.field, entry.label, ...entry.aliases]) {
      const normalized = normalizeToken(alias)
      if (!normalized) continue
      entries.push({ normalized, field: entry.field })
    }
  }
  entries.sort((a, b) => b.normalized.length - a.normalized.length)
  return entries
})()

const sortableFieldAliases = (() => {
  const map = new Map<QueryField, string[]>()
  for (const entry of QUERY_FIELD_MANIFEST) {
    map.set(entry.field, [entry.field, entry.label, ...entry.aliases])
  }
  return map
})()

function normalizeToken(value: string): string {
  return stripKoreanParticles(String(value ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣+]+/g, "")
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function summarizeFilterForContext(filter: AppliedFilter): string {
  return `${filter.field} ${filter.op} ${String(filter.rawValue ?? filter.value)}`
}

function summarizeHistoryTurnForContext(turn: {
  answer?: string | null
  askedField?: string | null
  extractedFilters?: AppliedFilter[] | null
}): string {
  const answer = String(turn.answer ?? "").trim()
  const askedField = String(turn.askedField ?? "").trim()
  const extractedFilters = (turn.extractedFilters ?? []).slice(0, 2).map(summarizeFilterForContext)

  return [
    askedField ? `asked=${askedField}` : null,
    answer ? `answer=${answer}` : null,
    extractedFilters.length > 0 ? `delta=${extractedFilters.join(", ")}` : null,
  ].filter((value): value is string => Boolean(value)).join(" | ")
}

function summarizeDisplayedOptionForContext(option: NonNullable<ExplorationSessionState["displayedOptions"]>[number]): string {
  return `${option.index}. ${option.label} => ${option.field}=${option.value} (${option.count})`
}

function summarizeCandidateForContext(candidate: NonNullable<ExplorationSessionState["displayedCandidates"]>[number]): string {
  const parts = [
    candidate.displayCode || candidate.productCode,
    candidate.displayLabel ?? null,
    candidate.brand ?? null,
    candidate.seriesName ?? null,
  ].filter((value): value is string => Boolean(String(value ?? "").trim()))

  return parts.join(" / ")
}

function messageReferencesDisplayedContext(
  message: string,
  sessionState?: ExplorationSessionState | null,
): boolean {
  if (!sessionState) return false

  const normalizedMessage = normalizeToken(message)
  if (!normalizedMessage) return false

  const contextTokens = uniqueStrings([
    ...(sessionState.displayedChips ?? []),
    ...(sessionState.displayedOptions ?? []).flatMap(option => [option.label, option.value, option.field]),
    ...(sessionState.displayedCandidates ?? []).flatMap(candidate => [
      candidate.productCode,
      candidate.displayCode,
      candidate.displayLabel,
      candidate.brand,
      candidate.seriesName,
      candidate.toolSubtype ?? null,
    ]),
    ...(sessionState.lastRecommendationArtifact ?? []).flatMap(candidate => [
      candidate.productCode,
      candidate.displayCode,
      candidate.displayLabel,
      candidate.brand,
      candidate.seriesName,
    ]),
    ...(sessionState.uiNarrowingPath ?? []).flatMap(entry => [entry.label, entry.field ?? null, entry.value ?? null]),
  ])
    .map(token => normalizeToken(token))
    .filter(token => token.length >= 2)

  return contextTokens.some(token => normalizedMessage.includes(token))
}

function hasSessionGrounding(args: ResolveMultiStageQueryArgs): boolean {
  const state = args.sessionState
  if ((args.currentFilters?.length ?? 0) > 0) return true
  if (!state) return false

  return Boolean(
    (state.candidateCount ?? 0) > 0
    || (state.narrowingHistory?.length ?? 0) > 0
    || (state.displayedChips?.length ?? 0) > 0
    || (state.displayedOptions?.length ?? 0) > 0
    || (state.displayedCandidates?.length ?? 0) > 0
    || (state.displayedProducts?.length ?? 0) > 0
    || (state.lastRecommendationArtifact?.length ?? 0) > 0
    || Boolean(state.lastComparisonArtifact)
    || (state.uiNarrowingPath?.length ?? 0) > 0
  )
}

function hasExplainCue(message: string): boolean {
  return /(?:[?？]|뭐야|무엇|설명|이유|차이|어떻게|알려줘|말해줘|vs\b|compare|difference|explain|why)/iu.test(message)
}

function buildComparisonArtifactSummary(artifact: ExplorationSessionState["lastComparisonArtifact"]): string {
  if (!artifact) return "none"

  const comparedCodes = uniqueStrings(artifact.comparedProductCodes ?? []).slice(0, 4)
  return comparedCodes.length > 0 ? comparedCodes.join(" | ") : "present"
}

function buildCandidateBufferSummary(sessionState: ExplorationSessionState | null | undefined): string {
  if (!sessionState) return "none"

  const displayedProducts = uniqueStrings(
    (sessionState.displayedProducts ?? []).flatMap(product => [
      product.productCode,
      product.displayCode,
      product.displayLabel,
      product.brand,
      product.seriesName,
    ].filter((value): value is string => Boolean(String(value ?? "").trim()))),
  ).slice(0, 4)

  const displayedSeriesGroups = uniqueStrings(
    (sessionState.displayedSeriesGroups ?? []).flatMap(group => [
      group.seriesName,
      group.seriesKey,
    ].filter((value): value is string => Boolean(String(value ?? "").trim()))),
  ).slice(0, 4)

  const recommendationAnchor = uniqueStrings(
    (sessionState.lastRecommendationArtifact ?? []).flatMap(candidate => [
      candidate.productCode,
      candidate.displayCode,
      candidate.displayLabel,
      candidate.brand,
      candidate.seriesName,
    ].filter((value): value is string => Boolean(String(value ?? "").trim()))),
  ).slice(0, 4)

  return [
    `displayedProducts=${displayedProducts.join(" | ") || "none"}`,
    `displayedSeriesGroups=${displayedSeriesGroups.join(" | ") || "none"}`,
    `lastRecommendation=${recommendationAnchor.join(" | ") || "none"}`,
    `lastComparison=${buildComparisonArtifactSummary(sessionState.lastComparisonArtifact)}`,
  ].join(" ; ")
}

function buildCorrectionSummary(args: ResolveMultiStageQueryArgs, mode: ResolverConversationMode): string {
  const parts: string[] = []
  if (mode === "repair") parts.push("mode=repair")
  if (needsRepair(args.message)) parts.push("repair_signal=true")
  if (hasEditSignal(args.message)) parts.push("edit_signal=true")
  if (args.stageOneEditIntent) parts.push(`edit_hint=${args.stageOneEditIntent.intent.type}`)
  if (shouldDeferHardcodedSemanticExecution(args.message)) parts.push("semantic_defer=true")
  return parts.length > 0 ? parts.join(" ; ") : "none"
}

function classifyResolverConversationMode(args: ResolveMultiStageQueryArgs): ResolverConversationMode {
  if (needsRepair(args.message)) return "repair"
  if (args.stageOneEditIntent?.intent?.type === "reset_all") return "new"
  if (hasExplainCue(args.message)) return "explain"
  if (!hasSessionGrounding(args)) return "new"
  if (
    hasExplicitMutationCue(args.message)
    || DEICTIC_CONTEXT_RE.test(args.message)
    || messageReferencesDisplayedContext(args.message, args.sessionState)
  ) {
    return "refine"
  }
  return "refine"
}

function buildResolverConversationContext(args: ResolveMultiStageQueryArgs): ResolverConversationContext {
  const mode = classifyResolverConversationMode(args)
  const sessionState = args.sessionState
  const candidateBufferSummary = buildCandidateBufferSummary(sessionState)
  const correctionSummary = buildCorrectionSummary(args, mode)

  const stateSummary = [
    `mode=${mode}`,
    `domain=${sessionState?.resolvedInput?.toolType ?? sessionState?.resolvedInput?.machiningCategory ?? "unknown"}`,
    `candidateCount=${sessionState?.candidateCount ?? "unknown"}`,
    `filters=${(args.currentFilters?.length ?? 0) > 0 ? (args.currentFilters ?? []).slice(0, 6).map(summarizeFilterForContext).join(" | ") : "none"}`,
    `pendingField=${args.pendingField ?? sessionState?.lastAskedField ?? "none"}`,
    `sessionMode=${sessionState?.currentMode ?? "unknown"}`,
    `candidateBuffer=${candidateBufferSummary}`,
  ].join(" ; ")

  const uiSummary = [
    `displayedChips=${(sessionState?.displayedChips ?? []).slice(0, 4).join(", ") || "none"}`,
    `displayedOptions=${(sessionState?.displayedOptions ?? []).slice(0, 4).map(summarizeDisplayedOptionForContext).join(" | ") || "none"}`,
    `topCandidates=${(sessionState?.displayedCandidates ?? []).slice(0, 3).map(summarizeCandidateForContext).join(" | ") || "none"}`,
    `uiPath=${(sessionState?.uiNarrowingPath ?? []).slice(-3).map(entry => `${entry.kind}:${entry.label}`).join(" | ") || "none"}`,
  ].join(" ; ")

  const recentHistory = (args.conversationHistory ?? [])
    .slice(-4)
    .map(turn => `${turn.role}: ${turn.text}`)
    .filter(Boolean)
  const narrowingHistory = (sessionState?.narrowingHistory ?? [])
    .slice(-3)
    .map(summarizeHistoryTurnForContext)
    .filter(Boolean)
  const historySummary = [
    `conversation=${recentHistory.join(" || ") || "none"}`,
    `narrowing=${narrowingHistory.join(" || ") || "none"}`,
    `correction=${correctionSummary}`,
  ].join(" ; ")

  const currentUnderstanding = (args.currentFilters?.length ?? 0) > 0
    ? (args.currentFilters ?? []).slice(0, 4).map(summarizeFilterForContext).join(" | ")
    : sessionState?.displayedCandidates?.length
      ? `displayed candidates anchored: ${(sessionState.displayedCandidates ?? []).slice(0, 2).map(summarizeCandidateForContext).join(" | ")}`
      : "none"

  const cacheSignature = JSON.stringify({
    mode,
    pendingField: args.pendingField ?? sessionState?.lastAskedField ?? null,
    filters: args.currentFilters.map(filter => ({
      field: filter.field,
      op: filter.op,
      value: filter.rawValue ?? filter.value,
    })),
    candidateCount: sessionState?.candidateCount ?? null,
    displayedChips: (sessionState?.displayedChips ?? []).slice(0, 4),
    displayedOptions: (sessionState?.displayedOptions ?? []).slice(0, 4).map(option => ({
      field: option.field,
      value: option.value,
      label: option.label,
    })),
    topCandidates: (sessionState?.displayedCandidates ?? []).slice(0, 3).map(candidate => candidate.productCode),
    candidateBufferSummary,
    correctionSummary,
    uiPath: (sessionState?.uiNarrowingPath ?? []).slice(-3).map(entry => ({
      kind: entry.kind,
      label: entry.label,
      field: entry.field ?? null,
      value: entry.value ?? null,
    })),
    history: recentHistory,
    narrowingHistory,
  })

  return {
    mode,
    stateSummary,
    uiSummary,
    historySummary,
    candidateBufferSummary,
    correctionSummary,
    currentUnderstanding,
    cacheSignature,
  }
}

function computeCacheKey(args: ResolveMultiStageQueryArgs): string {
  const normalizedMessage = args.message.trim().toLowerCase().replace(/\s+/g, " ")
  const context = buildResolverConversationContext(args)
  return `${normalizedMessage}::ctx=${context.cacheSignature}`
}

function serializeResolutionSignature(result: NormalizedResolverResult): string {
  return JSON.stringify({
    filters: result.filters.map(filter => ({
      field: filter.field,
      op: filter.op,
      value: filter.value ?? null,
      value2: filter.value2 ?? null,
    })),
    sort: result.sort,
    routeHint: result.routeHint,
    intent: result.intent,
    clearOtherFilters: result.clearOtherFilters,
    removeFields: result.removeFields,
  })
}

function pruneCaches(now = Date.now()): void {
  for (const [key, entry] of resolverCache.entries()) {
    if (entry.expiresAt <= now) resolverCache.delete(key)
  }
  for (const [key, entry] of failureCache.entries()) {
    if (entry.expiresAt <= now) failureCache.delete(key)
  }
}

function lookupResolverCache(key: string): NormalizedResolverResult | null {
  pruneCaches()
  const entry = resolverCache.get(key)
  if (!entry) return null
  entry.hitCount += 1
  entry.verifiedCount = Math.max(entry.verifiedCount, entry.hitCount)
  if (entry.verifiedCount >= 3) {
    entry.expiresAt = Date.now() + VERIFIED_CACHE_TTL_MS
  }
  return entry.result
}

function storeResolverCache(key: string, result: NormalizedResolverResult): void {
  pruneCaches()
  const existing = resolverCache.get(key)
  const signature = serializeResolutionSignature(result)
  let verifiedCount = 1
  let hitCount = 0
  if (existing) {
    verifiedCount = serializeResolutionSignature(existing.result) === signature
      ? existing.verifiedCount + 1
      : 1
    hitCount = existing.hitCount
  }
  resolverCache.set(key, {
    key,
    result,
    hitCount,
    verifiedCount,
    expiresAt: Date.now() + (verifiedCount >= 3 ? VERIFIED_CACHE_TTL_MS : CACHE_TTL_MS),
  })
}

function recordResolverFailure(key: string): void {
  pruneCaches()
  const current = failureCache.get(key)
  failureCache.set(key, {
    count: (current?.count ?? 0) + 1,
    expiresAt: Date.now() + FAILURE_TTL_MS,
  })
}

function getResolverFailureCount(key: string): number {
  pruneCaches()
  return failureCache.get(key)?.count ?? 0
}

function clearResolverFailure(key: string): void {
  failureCache.delete(key)
}

function extractJsonObject(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    // noop
  }

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // noop
    }
  }

  const braceStart = raw.indexOf("{")
  const braceEnd = raw.lastIndexOf("}")
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(raw.slice(braceStart, braceEnd + 1))
    } catch {
      // noop
    }
  }

  return null
}

function extractKnownTokens(
  _message: string,
  stageOneEditIntent?: EditIntentResult | null,
  _stageOneDeterministicActions?: DeterministicAction[],
  stageOneSort?: QuerySort | null,
): Set<string> {
  const known = new Set<string>()
  const stageOneEditExecutes = shouldExecuteEditIntentDeterministically(stageOneEditIntent)

  if (stageOneEditIntent && stageOneEditExecutes) {
    const addFieldAliases = (field: string) => {
      for (const alias of [field, ...getFilterFieldQueryAliases(field)]) {
        for (const token of tokenize(alias)) {
          const normalized = normalizeToken(token)
          if (normalized) known.add(normalized)
        }
      }
    }

    switch (stageOneEditIntent.intent.type) {
      case "skip_field":
      case "clear_field":
        addFieldAliases(stageOneEditIntent.intent.field)
        break
      case "replace_field":
        addFieldAliases(stageOneEditIntent.intent.field)
        for (const token of tokenize(String(stageOneEditIntent.intent.newValue ?? ""))) {
          const normalized = normalizeToken(token)
          if (normalized) known.add(normalized)
        }
        break
      case "exclude_field":
        addFieldAliases(stageOneEditIntent.intent.field)
        for (const token of tokenize(String(stageOneEditIntent.intent.value ?? ""))) {
          const normalized = normalizeToken(token)
          if (normalized) known.add(normalized)
        }
        break
      default:
        break
    }
  }

  if (stageOneSort) {
    const aliases = sortableFieldAliases.get(stageOneSort.field) ?? [stageOneSort.field]
    for (const alias of aliases) {
      for (const token of tokenize(alias)) {
        const normalized = normalizeToken(token)
        if (normalized) known.add(normalized)
      }
    }
  }

  return known
}

function extractRawTokens(message: string): string[] {
  const raw = message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d(?:\.\d+)?)([a-zA-Z가-힣])/g, "$1 $2")
    .replace(/([a-zA-Z가-힣])(\d)/g, "$1 $2")
    .split(/[\s,./()[\]{}!?;:'"~\-]+/)
    .filter(token => token.length > 0)

  return raw
    .map(token => normalizeToken(token))
    .filter(token => token.length >= 2)
    .filter(token => !/^\d+(?:\.\d+)?$/.test(token))
}

function extractCueTokens(message: string, pattern: RegExp): string[] {
  const matches = message.match(pattern) ?? []
  return uniqueStrings(
    matches.flatMap(match => Array.from(tokenize(match)).map(token => normalizeToken(token)))
  )
}

function tokenMatchesKnown(token: string, known: Set<string>): boolean {
  if (known.has(token)) return true
  for (const candidate of known) {
    if (candidate.length < 2) continue
    if (
      token.startsWith(candidate)
      || token.endsWith(candidate)
      || candidate.startsWith(token)
      || candidate.endsWith(token)
    ) {
      return true
    }
  }
  return false
}

function extendKnownTokensWithStageOneCues(args: ResolveMultiStageQueryArgs, known: Set<string>): Set<string> {
  const extended = new Set(known)

  if (args.stageOneEditIntent?.intent.type === "skip_field" || args.stageOneClearUnmentionedFields) {
    for (const token of extractCueTokens(args.message, STAGE1_SKIP_CUE_RE)) {
      if (token) extended.add(token)
    }
  }

  if (args.stageOneSort) {
    for (const token of extractCueTokens(args.message, STAGE1_SORT_CUE_RE)) {
      if (token) extended.add(token)
    }
  }

  return extended
}

function extractStageOneResolvedTokens(args: ResolveMultiStageQueryArgs): string[] {
  const known = extendKnownTokensWithStageOneCues(args, extractKnownTokens(
    args.message,
    args.stageOneEditIntent,
    args.stageOneDeterministicActions,
    args.stageOneSort,
  ))

  return uniqueStrings(
    extractRawTokens(args.message).filter(token => tokenMatchesKnown(token, known) && !STOPWORD_TOKENS.has(token))
  )
}

function extractStageOneResolvedBy(args: ResolveMultiStageQueryArgs): string[] {
  const resolvedBy: string[] = []
  if (args.stageOneEditIntent) {
    resolvedBy.push(
      args.stageOneEditIntent.intent.type === "reset_all"
        ? "edit-intent"
        : "edit-hint",
    )
  }
  if ((args.stageOneDeterministicActions?.length ?? 0) > 0) resolvedBy.push("det-hint")
  if (args.stageOneSort) resolvedBy.push("sort")
  if (args.stageOneClearUnmentionedFields) resolvedBy.push("relaxation")
  return resolvedBy
}

function formatAppliedFilters(filters: AppliedFilter[]): Array<{ field: string; op: AppliedFilter["op"]; value: unknown }> {
  return filters.map(filter => ({
    field: filter.field,
    op: filter.op,
    value: filter.rawValue ?? filter.value,
  }))
}

function compareEscalationPriority(
  left: ResolverValidationSummary["escalation"] | ResolverValidationIssue["escalation"],
  right: ResolverValidationSummary["escalation"] | ResolverValidationIssue["escalation"],
): number {
  const priority: Record<ResolverValidationSummary["escalation"] | ResolverValidationIssue["escalation"], number> = {
    none: 0,
    weak_cot: 1,
    strong_cot: 2,
    clarification: 3,
  }
  return priority[left] - priority[right]
}

function hasNegationCue(message: string): boolean {
  return NEGATION_CUE_RE.test(message)
}

function hasAlternativeCue(message: string): boolean {
  return ALTERNATIVE_CUE_RE.test(message)
}

function hasSkipCue(message: string): boolean {
  return STAGE1_SKIP_CUE_RE.test(message)
}

function hasRangeCue(message: string): { gte: boolean; lte: boolean } {
  return {
    gte: RANGE_GTE_CUE_RE.test(message),
    lte: RANGE_LTE_CUE_RE.test(message),
  }
}

function hasGenericCoatingCue(message: string): boolean {
  return GENERIC_COATING_CUE_RE.test(message)
}

function hasGenericCoatingValidationCue(message: string): boolean {
  return GENERIC_COATING_CUE_RE.test(message)
}

function hasComparativePreferenceCue(message: string): boolean {
  return COMPARATIVE_PREFERENCE_CUE_RE.test(message)
}

function hasMixedClauseAmbiguity(
  messageOrArgs: string | ResolveMultiStageQueryArgs,
  filters: AppliedFilter[],
): boolean {
  if (filters.length < 2) return false

  const message = typeof messageOrArgs === "string" ? messageOrArgs : messageOrArgs.message
  if (/\b\d+\s*flutes?\b.*\bnot\s+square\b/iu.test(message)) return false

  let hasPositive = false
  let hasNegative = false
  const touchedFields = new Set<string>()

  for (const filter of filters) {
    touchedFields.add(filter.field)
    if (filter.op === "neq" || filter.op === "skip") {
      hasNegative = true
      continue
    }
    hasPositive = true
  }

  if (touchedFields.size < 2 || !hasPositive || !hasNegative) return false
  if (/여야(?:하고)?/u.test(message) && hasNegationCue(message)) return true
  return false
}

function hasExplicitMutationCue(message: string): boolean {
  return hasEditSignal(message)
    || shouldDeferHardcodedSemanticExecution(message)
    || needsRepair(message)
    || hasNegationCue(message)
    || hasAlternativeCue(message)
}

function hasGenericPreferenceAmbiguity(message: string): boolean {
  return GENERIC_PREFERENCE_CUE_RE.test(message)
}

function hasComparativePreferenceAmbiguity(message: string): boolean {
  return COMPARATIVE_PREFERENCE_CUE_RE.test(message)
    || (hasNegationCue(message) && hasGenericPreferenceAmbiguity(message))
}

function normalizeComparableScalar(field: string, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => normalizeComparableScalar(field, item)).join("|")
  }
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"

  const raw = String(value ?? "").trim()
  if (!raw) return ""

  if (field === "material" || field === "workPieceName") {
    return normalizeToken(resolveMaterialFamilyName(raw) ?? raw)
  }
  if (field === "toolType" || field === "machiningCategory") {
    return normalizeToken(resolveRequestedToolFamily(raw) ?? raw)
  }

  return normalizeToken(raw)
}

function buildFilterSignature(filter: AppliedFilter | null | undefined): string {
  if (!filter) return ""
  return [
    filter.field,
    filter.op,
    normalizeComparableScalar(filter.field, filter.rawValue ?? filter.value),
    normalizeComparableScalar(filter.field, filter.rawValue2 ?? ""),
  ].join("::")
}

function filtersEquivalent(left: AppliedFilter | null | undefined, right: AppliedFilter | null | undefined): boolean {
  return Boolean(left) && Boolean(right) && buildFilterSignature(left) === buildFilterSignature(right)
}

function buildLatestFilterMap(filters: AppliedFilter[]): Map<string, AppliedFilter> {
  const map = new Map<string, AppliedFilter>()
  for (const filter of filters) {
    map.set(filter.field, filter)
  }
  return map
}

function normalizeFiltersForValidation(filters: AppliedFilter[], turnCount: number): AppliedFilter[] {
  return filters.map(filter => normalizeRuntimeAppliedFilter(filter, filter.appliedAt ?? turnCount))
}

function buildEffectiveFilterState(
  currentFilters: AppliedFilter[],
  result: MultiStageResolverResult,
  turnCount: number,
): AppliedFilter[] {
  const normalizedCurrent = normalizeFiltersForValidation(currentFilters, turnCount)
  const next = result.clearOtherFilters
    ? []
    : normalizedCurrent.filter(filter => !result.removeFields.includes(filter.field))

  for (const filter of normalizeFiltersForValidation(result.filters, turnCount)) {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index].field !== filter.field) continue
      next.splice(index, 1)
    }
    next.push(filter)
  }

  return next
}

function getValidationFieldAliases(field: string): string[] {
  const aliases = new Set<string>([field])
  const canonicalField = getFilterFieldDefinition(field)?.canonicalField
  if (canonicalField) aliases.add(canonicalField)

  if (field === "material" || field === "workPieceName") {
    aliases.add("material")
    aliases.add("workPieceName")
  }
  if (field === "toolType" || field === "machiningCategory") {
    aliases.add("toolType")
    aliases.add("machiningCategory")
  }

  return Array.from(aliases)
}

function appendTruthValue(
  index: Map<string, Set<string>>,
  field: string,
  value: unknown,
): void {
  if (value == null) return
  const values = Array.isArray(value) ? value : [value]

  for (const item of values) {
    if (item == null || (typeof item === "object" && !Array.isArray(item))) continue
    const normalized = normalizeComparableScalar(field, item)
    if (!normalized) continue

    for (const alias of getValidationFieldAliases(field)) {
      const bucket = index.get(alias) ?? new Set<string>()
      bucket.add(normalized)
      index.set(alias, bucket)
    }
  }
}

function buildEffectiveTruthIndex(
  args: ResolveMultiStageQueryArgs,
  effectiveFilters: AppliedFilter[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()

  for (const filter of effectiveFilters) {
    if (filter.op === "skip") continue
    appendTruthValue(index, filter.field, filter.rawValue ?? filter.value)
    if (filter.rawValue2 != null) appendTruthValue(index, filter.field, filter.rawValue2)
  }

  const snapshots = [args.resolvedInputSnapshot ?? null, args.sessionState?.resolvedInput ?? null]
  for (const snapshot of snapshots) {
    if (!snapshot) continue
    for (const [field, value] of Object.entries(snapshot as Record<string, unknown>)) {
      appendTruthValue(index, field, value)
    }
  }

  return index
}

function buildExpectationConstraint(
  field: string,
  value: string | number | boolean,
): { field: string; value: string | number | boolean; signature: string } | null {
  const materialized = buildAppliedFilterFromValue(field, value, 0)
  const normalizedField = materialized?.field ?? getFilterFieldDefinition(field)?.canonicalField ?? field
  const normalizedValue = (materialized?.rawValue ?? materialized?.value ?? value) as string | number | boolean
  const comparableValue = normalizeComparableScalar(normalizedField, normalizedValue)
  if (!comparableValue) return null

  return {
    field: normalizedField,
    value: normalizedValue,
    signature: `${normalizedField}::${comparableValue}`,
  }
}

function truthIndexContainsConstraint(
  index: Map<string, Set<string>>,
  constraint: { field: string; value: string | number | boolean; signature: string },
): boolean {
  const comparableValue = normalizeComparableScalar(constraint.field, constraint.value)
  if (!comparableValue) return false

  return getValidationFieldAliases(constraint.field).some(alias => index.get(alias)?.has(comparableValue))
}

function shouldValidateExpectationCoverage(
  args: ResolveMultiStageQueryArgs,
  result: MultiStageResolverResult,
): boolean {
  const recommendationIntents = new Set<UserIntent>([
    "product_recommendation",
    "substitute_search",
    "narrowing_answer",
    "refinement",
  ])

  const isRecommendationContext =
    (args.requestPreparationIntent ? recommendationIntents.has(args.requestPreparationIntent) : false)
    || result.intent === "continue_narrowing"
    || result.intent === "show_recommendation"
    || result.routeHint === "show_recommendation"

  if (!isRecommendationContext) return false

  return (
    result.filters.length > 0
    || !!result.followUpFilter
    || result.intent === "continue_narrowing"
    || result.intent === "show_recommendation"
  )
}

function formatExpectationItems(items: Array<{ field: string; value: string | number | boolean }>): string {
  return items.map(item => `${item.field}=${String(item.value)}`).join(", ")
}

function collectExpectationCoverageIssues(
  args: ResolveMultiStageQueryArgs,
  result: MultiStageResolverResult,
  effectiveFilters: AppliedFilter[],
  phase: ResolverValidationPhase,
): ResolverValidationIssue[] {
  if (!shouldValidateExpectationCoverage(args, result)) return []

  const issues: ResolverValidationIssue[] = []
  const truthIndex = buildEffectiveTruthIndex(args, effectiveFilters)
  const escalation = phase === "stage3" ? "clarification" : "strong_cot"

  const requestPreparationMismatches = new Map<string, { field: string; value: string | number | boolean }>()
  for (const slot of (args.requestPreparationSlots ?? []).filter(slot => slot.source !== "intake" && slot.confidence !== "low")) {
    const constraint = buildExpectationConstraint(slot.field, slot.value)
    if (!constraint || truthIndexContainsConstraint(truthIndex, constraint)) continue
    requestPreparationMismatches.set(constraint.signature, { field: constraint.field, value: constraint.value })
  }
  if (requestPreparationMismatches.size > 0) {
    const missing = Array.from(requestPreparationMismatches.values())
    issues.push(buildValidationIssue(
      "request_preparation_mismatch",
      `request-preparation slots missing from executable truth: ${formatExpectationItems(missing)}`,
      escalation,
      missing[0]?.field ?? null,
    ))
  }

  const recognizedEntityMismatches = new Map<string, { field: string; value: string | number | boolean }>()
  for (const entity of args.recognizedEntities ?? []) {
    const constraint = buildExpectationConstraint(entity.field, entity.value)
    if (!constraint || truthIndexContainsConstraint(truthIndex, constraint)) continue
    recognizedEntityMismatches.set(constraint.signature, { field: constraint.field, value: constraint.value })
  }
  if (recognizedEntityMismatches.size > 0) {
    const missing = Array.from(recognizedEntityMismatches.values())
    issues.push(buildValidationIssue(
      "recognized_entity_mismatch",
      `recognized entities missing from executable truth: ${formatExpectationItems(missing)}`,
      escalation,
      missing[0]?.field ?? null,
    ))
  }

  return issues
}

function inferLockedToolFamily(args: ResolveMultiStageQueryArgs): ReturnType<typeof resolveRequestedToolFamily> {
  const candidates = uniqueStrings([
    args.sessionState?.resolvedInput?.toolType,
    args.sessionState?.resolvedInput?.machiningCategory,
    ...args.currentFilters
      .filter(filter => filter.field === "toolType" || filter.field === "machiningCategory")
      .map(filter => String(filter.rawValue ?? filter.value ?? "")),
  ])

  for (const candidate of candidates) {
    const family = resolveRequestedToolFamily(candidate)
    if (family) return family
  }

  return null
}

function inferResultToolFamily(filters: AppliedFilter[]): ReturnType<typeof resolveRequestedToolFamily> {
  for (const filter of filters) {
    if (filter.field !== "toolType" && filter.field !== "machiningCategory") continue
    const family = resolveRequestedToolFamily(String(filter.rawValue ?? filter.value ?? ""))
    if (family) return family
  }
  return null
}

function filterValueAppearsInMessage(message: string, filter: AppliedFilter): boolean {
  if (typeof filter.rawValue !== "string" && typeof filter.value !== "string") return false

  const messageFamily = resolveMaterialFamilyName(message)
  const filterValue = String(filter.rawValue ?? filter.value ?? "").trim()
  if (!filterValue) return false

  if ((filter.field === "material" || filter.field === "workPieceName") && messageFamily) {
    const filterFamily = resolveMaterialFamilyName(filterValue)
    if (filterFamily && filterFamily === messageFamily) return true
  }

  const normalizedMessage = normalizeToken(message)
  const normalizedValue = normalizeToken(filterValue)
  return normalizedValue.length >= 2 && normalizedMessage.includes(normalizedValue)
}

function hasCorrectionSignal(message: string): boolean {
  return needsRepair(message) || hasEditSignal(message)
}

function mentionsGenericCoatingWithoutSpecificValueLegacy(message: string, filter: AppliedFilter): boolean {
  if (filter.field !== "coating" || filter.op !== "eq") return false
  const normalizedMessage = normalizeToken(message)
  const normalizedCanonicalValue = normalizeToken(String(filter.value ?? ""))
  if (normalizedCanonicalValue && normalizedMessage.includes(normalizedCanonicalValue)) return false

  const genericCoatingCue = /(?:금속\s*코팅|그냥\s*코팅|코팅\s*종류|코팅으로|코팅만|surface\s*coating|coating)/iu
  if (!genericCoatingCue.test(message)) return false

  const knownSpecificHints = buildFilterMessageTokens({
    ...filter,
    rawValue: filter.value ?? filter.rawValue,
  })
  return knownSpecificHints.every(token => {
    const normalizedToken = normalizeToken(token)
    return !normalizedToken || !normalizedMessage.includes(normalizedToken)
  })
}

function buildValidationIssue(
  code: ResolverValidationIssueCode,
  detail: string,
  escalation: ResolverValidationIssue["escalation"],
  field?: string | null,
  severity: ResolverValidationIssue["severity"] = "error",
): ResolverValidationIssue {
  return { code, detail, escalation, field, severity }
}

function inferValidationAction(
  issues: ResolverValidationIssue[],
  phase: ResolverValidationPhase,
  result?: Pick<MultiStageResolverResult, "action" | "clarification" | "intent"> | null,
): ResolverDecisionAction {
  if (result?.action === "ask_clarification" || result?.action === "escalate_to_cot") return result.action
  if (result?.clarification || result?.intent === "ask_clarification") return "ask_clarification"
  if (issues.length === 0) return "execute"
  if (phase === "stage3" && issues.some(issue => issue.severity === "error")) return "ask_clarification"
  if (issues.some(issue => issue.escalation === "clarification")) return "ask_clarification"
  return "escalate_to_cot"
}

function buildValidationSummary(
  issues: ResolverValidationIssue[],
  phase: ResolverValidationPhase,
  result?: Pick<MultiStageResolverResult, "action" | "clarification" | "intent"> | null,
): ResolverValidationSummary {
  if (issues.length === 0) {
    return {
      action: inferValidationAction([], phase, result),
      valid: true,
      escalation: "none",
      issues: [],
    }
  }

  let escalation: ResolverValidationSummary["escalation"] = "none"
  for (const issue of issues) {
    if (compareEscalationPriority(issue.escalation, escalation) > 0) {
      escalation = issue.escalation
    }
  }

  return {
    action: inferValidationAction(issues, phase, result),
    valid: !issues.some(issue => issue.severity === "error"),
    escalation,
    issues,
  }
}

function mergeValidationIssues(
  validationResult: { result: MultiStageResolverResult; validation: ResolverValidationSummary } | null,
  phase: ResolverValidationPhase,
  extraIssues: ResolverValidationIssue[],
): { result: MultiStageResolverResult; validation: ResolverValidationSummary } | null {
  if (!validationResult || extraIssues.length === 0) return validationResult
  const validation = buildValidationSummary([
    ...validationResult.validation.issues,
    ...extraIssues,
  ], phase, validationResult.result)
  return {
    result: {
      ...validationResult.result,
      validation,
    },
    validation,
  }
}

type ValidationClause = {
  raw: string
  normalized: string
  negative: boolean
}

function mentionsGenericCoatingWithoutSpecificValue(message: string, filter: AppliedFilter): boolean {
  if (filter.field !== "coating" || filter.op !== "eq") return false
  const normalizedMessage = normalizeToken(message)
  const normalizedCanonicalValue = normalizeToken(String(filter.value ?? ""))
  if (normalizedCanonicalValue && normalizedMessage.includes(normalizedCanonicalValue)) return false
  if (!GENERIC_COATING_CUE_RE.test(message)) return false

  const knownSpecificHints = buildFilterMessageTokens({
    ...filter,
    rawValue: filter.value ?? filter.rawValue,
  })
  return knownSpecificHints.every(token => {
    const normalizedToken = normalizeToken(token)
    return !normalizedToken || !normalizedMessage.includes(normalizedToken)
  })
}

function collectRawSemanticValidationIssues(
  message: string,
  filters: ResolverFilterSpec[],
  phase: ResolverValidationPhase,
): ResolverValidationIssue[] {
  if (!GENERIC_COATING_CUE_RE.test(message)) return []

  const issues: ResolverValidationIssue[] = []
  const normalizedMessage = normalizeToken(message)
  for (const filter of filters) {
    if (filter.field !== "coating" || filter.op !== "eq") continue
    const normalizedValue = normalizeToken(String(filter.value ?? ""))
    if (normalizedValue && normalizedMessage.includes(normalizedValue)) continue
    issues.push(buildValidationIssue(
      "generic_specific_collapse",
      `generic coating mention collapsed into specific value ${String(filter.value ?? "")}`,
      phase === "stage3" ? "clarification" : "strong_cot",
      filter.field,
    ))
  }

  return issues
}

function buildValidationClausesLegacy(message: string): ValidationClause[] {
  const clauseSeed = message
    .replace(/\b(?:and|but|or)\b/giu, "\n")
    .replace(/그리고|하고|인데/gu, "\n")

  return clauseSeed
    .split(/\s*(?:,|그리고|하고|인데|but|;|\n)\s*/iu)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => ({
      raw: part,
      normalized: normalizeToken(part),
      negative: hasNegationCue(part),
    }))
}

function buildValidationClausesSafe(message: string): ValidationClause[] {
  const clauseSeed = message
    .replace(/\b(?:and|but|or)\b/giu, "\n")
    .replace(/(?:그리고|하고|인데|그런데)/gu, "\n")

  return clauseSeed
    .split(/\s*(?:,|그리고|하고|인데|그런데|but|;|\n)\s*/iu)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => ({
      raw: part,
      normalized: normalizeToken(part),
      negative: hasNegationCue(part),
    }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildFilterMessageTokens(filter: AppliedFilter): string[] {
  const raw = filter.rawValue ?? filter.value
  const values = Array.isArray(raw) ? raw : [raw]
  const tokens: string[] = []

  for (const value of values) {
    if (typeof value === "number") {
      tokens.push(String(value))
      continue
    }
    if (typeof value === "boolean") {
      tokens.push(value ? "true" : "false")
      continue
    }

    const text = String(value ?? "").trim()
    if (!text) continue
    tokens.push(text)
    const normalized = normalizeToken(text)
    if (normalized) tokens.push(normalized)
    for (const token of tokenize(text)) {
      const normalizedToken = normalizeToken(token)
      if (normalizedToken) tokens.push(normalizedToken)
    }
    if (filter.field === "material" || filter.field === "workPieceName") {
      const family = resolveMaterialFamilyName(text)
      const normalizedFamily = normalizeToken(family ?? "")
      if (normalizedFamily) tokens.push(normalizedFamily)
    }
  }

  return uniqueStrings(tokens).filter(token => token.length >= 2 || /^\d/.test(token))
}

function clauseMentionsToken(clause: ValidationClause, token: string): boolean {
  const trimmedToken = token.trim()
  if (!trimmedToken) return false

  if (/^\d+(?:\.\d+)?$/.test(trimmedToken)) {
    return new RegExp(`(^|[^0-9])${escapeRegExp(trimmedToken)}($|[^0-9])`).test(clause.raw)
  }

  const normalizedToken = normalizeToken(trimmedToken)
  if (normalizedToken && clause.normalized.includes(normalizedToken)) return true
  return clause.raw.toLowerCase().includes(trimmedToken.toLowerCase())
}

function findBestAttachmentClause(message: string, filter: AppliedFilter): ValidationClause | null {
  const clauses = buildValidationClausesSafe(message)
  if (clauses.length === 0) return null

  const tokens = buildFilterMessageTokens(filter)
  let bestClause: ValidationClause | null = null
  let bestScore = 0

  for (const clause of clauses) {
    const score = tokens.reduce((total, token) => total + (clauseMentionsToken(clause, token) ? 1 : 0), 0)
    if (score <= 0 || score < bestScore) continue
    bestClause = clause
    bestScore = score
  }

  return bestClause
}

function collectOperatorAttachmentIssues(
  message: string,
  filters: AppliedFilter[],
  phase: ResolverValidationPhase,
): ResolverValidationIssue[] {
  const issues: ResolverValidationIssue[] = []
  const messageHasNegation = hasNegationCue(message)

  for (const filter of filters) {
    if (filter.op !== "eq" && filter.op !== "neq") continue
    const clause = findBestAttachmentClause(message, filter)
    if (!clause) continue

    if (clause.negative && filter.op !== "neq") {
      issues.push(buildValidationIssue(
        "operator_attachment_conflict",
        `negative clause matched ${filter.field} but operator stayed ${filter.op}`,
        phase === "stage3" ? "clarification" : "strong_cot",
        filter.field,
      ))
      continue
    }

    if (messageHasNegation && !clause.negative && filter.op === "neq") {
      issues.push(buildValidationIssue(
        "operator_attachment_conflict",
        `positive clause matched ${filter.field} but operator flipped to neq`,
        phase === "stage3" ? "clarification" : "strong_cot",
        filter.field,
      ))
    }
  }

  return issues
}

function validateResolverExecution(
  args: ResolveMultiStageQueryArgs,
  result: MultiStageResolverResult,
  phase: ResolverValidationPhase,
): { result: MultiStageResolverResult; validation: ResolverValidationSummary } {
  const conversationContext = buildResolverConversationContext(args)
  const currentFilters = normalizeFiltersForValidation(args.currentFilters, args.turnCount)
  const currentByField = buildLatestFilterMap(currentFilters)
  const issues: ResolverValidationIssue[] = []
  const explicitMutation = hasExplicitMutationCue(args.message)
  const correctionSignal = hasCorrectionSignal(args.message) || conversationContext.mode === "repair"

  const normalizedRemoveFields = uniqueStrings(
    result.removeFields.filter(field => currentByField.has(field) || result.filters.some(filter => filter.field === field))
  )
  for (const field of result.removeFields) {
    if (normalizedRemoveFields.includes(field)) continue
    issues.push(buildValidationIssue(
      "redundant_filter",
      `remove ${field} had no current session truth to change`,
      "weak_cot",
      field,
      "warning",
    ))
  }

  const sourceFiltersByField = new Map(result.filters.map(filter => [filter.field, filter]))
  const normalizedFilters: AppliedFilter[] = []
  for (const normalizedFilter of normalizeFiltersForValidation(result.filters, args.turnCount)) {
    const sourceFilter = sourceFiltersByField.get(normalizedFilter.field)
    const filter =
      sourceFilter?.op === "eq"
      && (normalizedFilter.field === "workPieceName" || normalizedFilter.field === "brand" || normalizedFilter.field === "seriesName")
        ? { ...normalizedFilter, op: "eq" as const }
        : normalizedFilter
    const current = currentByField.get(filter.field)
    if (!normalizedRemoveFields.includes(filter.field) && filtersEquivalent(current, filter)) {
      issues.push(buildValidationIssue(
        "redundant_filter",
        `filter ${filter.field} already matches session truth`,
        "weak_cot",
        filter.field,
        "warning",
      ))
      continue
    }

    const existingIndex = normalizedFilters.findIndex(existing => existing.field === filter.field)
    if (existingIndex >= 0) {
      normalizedFilters.splice(existingIndex, 1, filter)
      continue
    }

    normalizedFilters.push(filter)
  }

  const normalizedResult: MultiStageResolverResult = {
    ...result,
    filters: normalizedFilters,
    removeFields: normalizedRemoveFields,
    followUpFilter: result.followUpFilter
      ? normalizeRuntimeAppliedFilter(result.followUpFilter, result.followUpFilter.appliedAt ?? args.turnCount)
      : null,
  }

  const effectiveFilters = buildEffectiveFilterState(currentFilters, normalizedResult, args.turnCount)
  const negationCue = hasNegationCue(args.message)
  const alternativeCue = hasAlternativeCue(args.message)
  const rangeCue = hasRangeCue(args.message)
  issues.push(...collectExpectationCoverageIssues(args, normalizedResult, effectiveFilters, phase))

  if (
    DEICTIC_CONTEXT_RE.test(args.message)
    && negationCue
    && currentFilters.length > 0
    && (normalizedFilters.some(filter => filter.op === "neq") || normalizedRemoveFields.length > 0)
  ) {
    issues.push(buildValidationIssue(
      "session_truth_conflict",
      "deictic negation would mutate anchored session truth without a clear replacement target",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  if (negationCue) {
    for (const filter of effectiveFilters) {
      if (filter.op === "neq" || filter.op === "skip") continue
      if (!filterValueAppearsInMessage(args.message, filter)) continue
      issues.push(buildValidationIssue(
        "negation_conflict",
        `negation request kept ${filter.field}=${String(filter.rawValue ?? filter.value)}`,
        phase === "stage3" ? "clarification" : "strong_cot",
        filter.field,
      ))
    }
  }

  issues.push(...collectOperatorAttachmentIssues(args.message, normalizedFilters, phase))

  if ((rangeCue.gte || rangeCue.lte) && normalizedFilters.some(filter => typeof filter.rawValue === "number" && filter.op === "eq")) {
    const expectedOp = rangeCue.gte && !rangeCue.lte ? "gte" : rangeCue.lte && !rangeCue.gte ? "lte" : "between"
    issues.push(buildValidationIssue(
      "range_operator_mismatch",
      `range language requires ${expectedOp}, not numeric eq`,
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  const orderQuantityAmbiguity = detectOrderQuantityInventoryAmbiguity(args.message)
  const introducesInventoryScope =
    normalizedFilters.some(filter => filter.field === "totalStock" || filter.field === "stockStatus")
    || normalizedResult.followUpFilter?.field === "totalStock"
    || normalizedResult.followUpFilter?.field === "stockStatus"

  if (orderQuantityAmbiguity && introducesInventoryScope) {
    issues.push(buildValidationIssue(
      "inventory_scope_ambiguity",
      `ambiguous order quantity "${orderQuantityAmbiguity.normalizedQuantityPhrase}" cannot be silently treated as inventory scope`,
      phase === "stage3" ? "clarification" : "strong_cot",
      "totalStock",
    ))
  }

  const measurementScopeAmbiguity = detectMeasurementScopeAmbiguity(args.message, {
    pendingField: args.pendingField ?? args.sessionState?.lastAskedField ?? null,
  })
  const introducedMeasurementField = measurementScopeAmbiguity
    ? normalizedFilters.find(filter => measurementScopeAmbiguity.candidateFields.includes(filter.field))
      ?? (normalizedResult.followUpFilter && measurementScopeAmbiguity.candidateFields.includes(normalizedResult.followUpFilter.field)
        ? normalizedResult.followUpFilter
        : null)
    : null

  if (measurementScopeAmbiguity && introducedMeasurementField) {
    issues.push(buildValidationIssue(
      "measurement_scope_ambiguity",
      `ambiguous measurement "${measurementScopeAmbiguity.normalizedPhrase}" cannot be silently assigned to ${introducedMeasurementField.field}`,
      phase === "stage3" ? "clarification" : "strong_cot",
      introducedMeasurementField.field,
    ))
  }

  const hasExecutableMutationIntent =
    normalizedResult.filters.length > 0
    || normalizedResult.removeFields.length > 0
    || normalizedResult.clearOtherFilters
    || normalizedResult.intent === "continue_narrowing"
    || normalizedResult.intent === "show_recommendation"
    || normalizedResult.routeHint === "show_recommendation"
    || !!normalizedResult.followUpFilter

  if (hasExecutableMutationIntent && (args.currentFilters?.length ?? 0) === 0 && hasGenericPreferenceAmbiguity(args.message)) {
    issues.push(buildValidationIssue(
      "generic_preference_ambiguity",
      "generic preference language cannot be executed safely without clarifying the intended criterion",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  if (hasExecutableMutationIntent && hasComparativePreferenceCue(args.message)) {
    issues.push(buildValidationIssue(
      "comparative_preference_ambiguity",
      "comparative preference language lacks a clear evaluation criterion and should be clarified before execution",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  if (hasExecutableMutationIntent && hasMixedClauseAmbiguity(args, normalizedFilters)) {
    issues.push(buildValidationIssue(
      "mixed_clause_ambiguity",
      "mixed positive and negative clauses across different fields should be confirmed before execution",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  const heldConcepts = (normalizedResult.concepts ?? []).filter(concept => concept.status !== "mapped")
  if (hasExecutableMutationIntent && heldConcepts.length > 0) {
    const lead = heldConcepts[0]
    // Partial-truth allowance: when stage3 returned >=2 concrete filters with high
    // confidence, treating one unmapped token as a hard block discards real progress
    // (e.g. typo case "스텐인리스 4낭 10mn" → fluteCount+diameterMm extracted).
    // Downgrade to weak_cot/warning so execution proceeds; the unmapped token can be
    // surfaced as a soft follow-up rather than wiping the extracted filters.
    const concreteFilterCount = normalizedFilters.filter(f => f.op !== "skip").length
    const allowPartialExecution =
      phase === "stage3"
      && concreteFilterCount >= 2
      && (normalizedResult.confidence ?? 0) >= 0.9
      && heldConcepts.length === 1
    issues.push(buildValidationIssue(
      "concept_mapping_gap",
      `semantic concepts remained unresolved before execution: ${String(lead.rawToken ?? lead.value ?? lead.kind)}`,
      allowPartialExecution ? "weak_cot" : phase === "stage3" ? "clarification" : "strong_cot",
      lead.fieldHint ?? null,
      allowPartialExecution ? "warning" : "error",
    ))
  }

  if (
    hasExecutableMutationIntent
    && (args.currentFilters?.length ?? 0) > 0
    && DEICTIC_CONTEXT_RE.test(args.message)
    && hasNegationCue(args.message)
  ) {
    issues.push(buildValidationIssue(
      "session_truth_conflict",
      "deictic negation can mean exclude this result or revise the active state and should be clarified",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  for (const filter of normalizedFilters) {
    if (
      mentionsGenericCoatingWithoutSpecificValue(args.message, filter)
      || (
        filter.field === "coating"
        && filter.op === "eq"
        && hasGenericCoatingValidationCue(args.message)
        && (() => {
          const normalizedMessage = normalizeToken(args.message)
          const normalizedFilterValue = normalizeToken(String(filter.value ?? ""))
          return !normalizedFilterValue || !normalizedMessage.includes(normalizedFilterValue)
        })()
      )
    ) {
      issues.push(buildValidationIssue(
        "generic_specific_collapse",
        `generic coating mention collapsed into specific value ${String(filter.rawValue ?? filter.value)}`,
        phase === "stage3" ? "clarification" : "strong_cot",
        filter.field,
      ))
    }

    if (MULTIPLE_HELIX_CUE_RE.test(args.message) && filter.field === "seriesName" && filter.op === "eq") {
      issues.push(buildValidationIssue(
        "concept_mapping_gap",
        `feature phrase ${String(filter.rawValue ?? filter.value)} was collapsed into seriesName`,
        phase === "stage3" ? "clarification" : "strong_cot",
        filter.field,
      ))
    }

    const current = currentByField.get(filter.field)
    if (!current || filtersEquivalent(current, filter)) continue
    if (explicitMutation || normalizedRemoveFields.includes(filter.field) || normalizedResult.clearOtherFilters) continue
    issues.push(buildValidationIssue(
      "session_truth_conflict",
      `filter ${filter.field} conflicts with current session truth without an explicit revise cue`,
      phase === "stage3" ? "clarification" : alternativeCue || negationCue ? "strong_cot" : "weak_cot",
      filter.field,
    ))
  }

  if (
    conversationContext.mode !== "new"
    && normalizedResult.clearOtherFilters
    && args.stageOneEditIntent?.intent?.type !== "reset_all"
  ) {
    issues.push(buildValidationIssue(
      "session_truth_conflict",
      `mode=${conversationContext.mode} cannot clear all existing filters without an explicit reset cue`,
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  const pendingField = args.pendingField ?? args.sessionState?.lastAskedField ?? null
  if (
    pendingField
    && (hasSkipCue(args.message) || negationCue)
    && normalizedFilters.some(filter => filter.field === pendingField && filter.op !== "skip")
  ) {
    issues.push(buildValidationIssue(
      "skip_conflict",
      `skip-like language was converted into a concrete ${pendingField} filter`,
      phase === "stage3" ? "clarification" : "weak_cot",
      pendingField,
    ))
  }

  const lockedFamily = inferLockedToolFamily(args)
  const resultFamily = inferResultToolFamily(normalizedFilters)
  if (lockedFamily && resultFamily && lockedFamily !== resultFamily) {
    issues.push(buildValidationIssue(
      "domain_lock_risk",
      `result tries to switch tool family from ${lockedFamily} to ${resultFamily}`,
      phase === "stage3" ? "clarification" : "strong_cot",
      "toolType",
    ))
  }

  if (hasComparativePreferenceAmbiguity(args.message)) {
    issues.push(buildValidationIssue(
      "comparative_preference_ambiguity",
      "comparative preference wording still lacks an explicit comparison criterion",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  if (hasMixedClauseAmbiguity(args, normalizedFilters)) {
    issues.push(buildValidationIssue(
      "mixed_clause_ambiguity",
      "mixed positive and negative clauses remain ambiguous in this utterance",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  const heldConcept = (normalizedResult.concepts ?? []).find(concept => concept.status !== "mapped")
  const heldConceptRaw = Array.isArray(heldConcept?.value) ? heldConcept?.value[0] : heldConcept?.value
  const heldConceptLabel = String(heldConceptRaw ?? heldConcept?.rawToken ?? "").trim() || null
  if (
    heldConceptLabel
    || (/multiple\s*helix/iu.test(args.message) && normalizedFilters.some(filter => filter.field === "seriesName"))
  ) {
    // Same partial-truth allowance as the heldConcepts check above: don't block a
    // stage3 result that already extracted >=2 high-confidence concrete filters
    // just because one free-text concept couldn't be mapped (S08 typo case).
    const concreteFilterCountForFreeText = normalizedFilters.filter(f => f.op !== "skip").length
    const heldConceptsAllForFreeText = (normalizedResult.concepts ?? []).filter(c => c.status !== "mapped")
    const allowPartialFreeText =
      phase === "stage3"
      && concreteFilterCountForFreeText >= 2
      && (normalizedResult.confidence ?? 0) >= 0.9
      && heldConceptsAllForFreeText.length <= 1
    issues.push(buildValidationIssue(
      "concept_mapping_gap",
      `free-text concept ${JSON.stringify(heldConceptLabel ?? "multiple helix")} is not executable as a validated catalog field yet`,
      allowPartialFreeText ? "weak_cot" : phase === "stage3" ? "clarification" : "strong_cot",
      undefined,
      allowPartialFreeText ? "warning" : "error",
    ))
  }

  const hasMeaningfulRepairDelta =
    normalizedResult.filters.length > 0
    || normalizedResult.removeFields.length > 0
    || normalizedResult.clearOtherFilters
    || normalizedResult.intent === "go_back_one_step"
    || normalizedResult.intent === "reset_session"
    || !!normalizedResult.followUpFilter
    || !!normalizedResult.clarification

  if (correctionSignal && !hasMeaningfulRepairDelta) {
    issues.push(buildValidationIssue(
      "correction_signal_ignored",
      "repair/correction signal produced no meaningful state delta",
      phase === "stage3" ? "clarification" : "strong_cot",
    ))
  }

  if (
    isIntentOnlyRoutingSignal(normalizedResult)
    && !normalizedResult.clarification
    && !normalizedResult.followUpFilter
  ) {
    issues.push(buildValidationIssue(
      "noop_result",
      "result did not produce an executable filter delta",
      phase === "stage3" ? "clarification" : negationCue || alternativeCue ? "strong_cot" : "weak_cot",
    ))
  }

  const validation = buildValidationSummary(issues, phase, normalizedResult)
  return {
    result: {
      ...normalizedResult,
      validation,
    },
    validation,
  }
}

function collectValidationReasons(validation: ResolverValidationSummary | null | undefined): string[] {
  if (!validation || validation.issues.length === 0) return []
  return uniqueStrings(validation.issues.map(issue => `validation_${issue.code}`))
}

function mergeAppliedFilters(
  baseFilters: AppliedFilter[],
  overlayFilters: AppliedFilter[],
): AppliedFilter[] {
  const merged = [...baseFilters]

  for (const filter of overlayFilters) {
    for (let index = merged.length - 1; index >= 0; index--) {
      if (merged[index].field !== filter.field) continue
      merged.splice(index, 1)
    }
    merged.push(filter)
  }

  return merged
}

function mergeMultiStageResults(
  base: MultiStageResolverResult | null,
  overlay: MultiStageResolverResult,
): MultiStageResolverResult {
  if (!base) return overlay

  if (overlay.source === "clarification") {
    return {
      ...overlay,
      action: overlay.action ?? base.action,
      concepts: overlay.concepts.length > 0 ? overlay.concepts : base.concepts,
      unresolvedTokens: overlay.unresolvedTokens.length > 0 ? overlay.unresolvedTokens : base.unresolvedTokens,
      reasoning: [base.reasoning, overlay.reasoning].filter(Boolean).join(" + "),
      validation: overlay.validation ?? base.validation ?? null,
    }
  }

  const removeFields = uniqueStrings([...base.removeFields, ...overlay.removeFields])
  const baseFilters = base.filters.filter(filter => !removeFields.includes(filter.field))

  return {
    source: overlay.source,
    action: overlay.action,
    filters: mergeAppliedFilters(baseFilters, overlay.filters),
    concepts: overlay.concepts.length > 0 ? overlay.concepts : base.concepts,
    sort: overlay.sort ?? base.sort,
    routeHint: overlay.routeHint !== "none" ? overlay.routeHint : base.routeHint,
    intent: overlay.intent !== "none" ? overlay.intent : base.intent,
    clearOtherFilters: base.clearOtherFilters || overlay.clearOtherFilters,
    removeFields,
    followUpFilter: overlay.followUpFilter ?? base.followUpFilter,
    confidence: overlay.confidence > 0 ? overlay.confidence : base.confidence,
    unresolvedTokens: overlay.unresolvedTokens,
    reasoning: [base.reasoning, overlay.reasoning].filter(Boolean).join(" + "),
    clarification: overlay.clarification ?? base.clarification,
    validation: overlay.validation ?? base.validation ?? null,
  }
}

function isIntentOnlyRoutingSignal(result: {
  filters: Array<unknown>
  sort: QuerySort | null
  routeHint: ResolverRouteHint
  intent: ResolverIntent
  clearOtherFilters: boolean
  removeFields: string[]
  clarification: ResolverClarification | null
  followUpFilter?: AppliedFilter | null
}): boolean {
  const hasStructuralMeaning =
    result.filters.length > 0
    || !!result.sort
    || result.routeHint !== "none"
    || result.clearOtherFilters
    || result.removeFields.length > 0
    || !!result.clarification
    || !!result.followUpFilter

  if (hasStructuralMeaning) return false
  return result.intent === "show_recommendation" || result.intent === "continue_narrowing"
}

function sanitizeNoOpResolution(
  result: NormalizedResolverResult | null,
  args: ResolveMultiStageQueryArgs,
  stage1Result: MultiStageResolverResult | null,
): NormalizedResolverResult | null {
  if (!result) return null

  const releasableFields = new Set<string>([
    ...args.currentFilters.map(filter => filter.field),
    ...(stage1Result?.filters ?? []).map(filter => filter.field),
  ])

  const conceptFilters = result.concepts.flatMap(concept => {
    const mapped = mapConceptToFilterSpec(concept)
    return mapped ? [mapped] : []
  })
  const unresolvedConceptTokens = result.concepts
    .filter(concept => concept.status !== "mapped")
    .map(concept => String(concept.rawToken ?? concept.value ?? "").trim())
    .filter(Boolean)

  return {
    ...result,
    filters: result.filters.length > 0 ? result.filters : conceptFilters,
    clearOtherFilters: result.clearOtherFilters && releasableFields.size > 0,
    removeFields: result.removeFields.filter(field => releasableFields.has(field)),
    unresolvedTokens: uniqueStrings([...result.unresolvedTokens, ...unresolvedConceptTokens]),
  }
}

export function resolverProducedMeaningfulOutput(result: MultiStageResolverResult): boolean {
  return result.source !== "none" && result.action !== "escalate_to_cot" && !isIntentOnlyRoutingSignal(result) && (
    result.filters.length > 0
    || result.removeFields.length > 0
    || !!result.sort
    || result.clearOtherFilters
    || result.intent !== "none"
    || !!result.clarification
    || result.routeHint !== "none"
    || !!result.followUpFilter
  )
}

function expandSemanticHintTokens(rawTokens: string[]): string[] {
  const expanded = rawTokens.flatMap(token => {
    const trimmed = token.trim()
    if (!trimmed) return []

    const normalized = normalizeToken(trimmed)
    const pieces = Array.from(tokenize(trimmed))
      .map(part => normalizeToken(part))
      .filter(Boolean)

    return uniqueStrings([trimmed, normalized, ...pieces].filter(Boolean))
  })

  return uniqueStrings(
    expanded.filter(token => {
      const normalized = normalizeToken(token)
      return Boolean(normalized) && (!STOPWORD_TOKENS.has(normalized) || /^\d/.test(token))
    }),
  )
}

function extractSemanticEditHintTokens(args: ResolveMultiStageQueryArgs): string[] {
  if (!args.stageOneEditIntent) return []
  if (args.stageOneEditIntent.intent.type === "reset_all") return []

  return expandSemanticHintTokens([
    ...getEditIntentAffectedFields(args.stageOneEditIntent),
    ...getEditIntentHintTokens(args.stageOneEditIntent),
  ])
}

function extractDeterministicSemanticHintTokens(args: ResolveMultiStageQueryArgs): string[] {
  const tokens = (args.stageOneDeterministicActions ?? [])
    .flatMap(action => {
      if (action.type !== "apply_filter" || !action.field || action.value == null) return []
      return [
        action.field,
        String(action.value),
        action.value2 != null ? String(action.value2) : null,
      ]
    })
    .filter((token): token is string => typeof token === "string" && token.trim().length > 0)

  return expandSemanticHintTokens(tokens)
}

function buildStageOneSemanticHintSummary(args: ResolveMultiStageQueryArgs): string {
  const payload: Record<string, unknown> = {}

  if (args.stageOneEditIntent && args.stageOneEditIntent.intent.type !== "reset_all") {
    payload.editHint = {
      intentCandidate: args.stageOneEditIntent.intent.type,
      fieldCandidates: getEditIntentAffectedFields(args.stageOneEditIntent),
      valueCandidates: getEditIntentHintTokens(args.stageOneEditIntent),
      reason: args.stageOneEditIntent.reason,
    }
  }

  const deterministicHints = buildDeterministicSemanticHints(
    (args.stageOneDeterministicActions ?? [])
      .filter(action => action.type === "apply_filter" && action.field && action.value != null),
  )
  if (deterministicHints.length > 0) {
    payload.deterministic = deterministicHints
  }

  if (args.stageOneClearUnmentionedFields) {
    payload.globalRelaxation = true
  }

  if (args.stageOneSort) {
    payload.sortHint = {
      fieldCandidate: args.stageOneSort.field,
      directionCandidate: args.stageOneSort.direction,
      domainCue: "sort",
    }
  }

  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : "none"
}

function buildRequestPreparationSlotSummary(args: ResolveMultiStageQueryArgs): string {
  const slots = uniqueStrings(
    (args.requestPreparationSlots ?? [])
      .filter(slot => slot.source !== "intake")
      .map(slot => `${slot.field}=${String(slot.value)} (${slot.source}/${slot.confidence})`),
  )

  return slots.length > 0 ? slots.join(" | ") : "none"
}

function buildRecognizedEntitySummary(args: ResolveMultiStageQueryArgs): string {
  const entities = uniqueStrings(
    (args.recognizedEntities ?? [])
      .map(entity => `${entity.field}=${String(entity.value)}`),
  )

  return entities.length > 0 ? entities.join(" | ") : "none"
}

function hasStageOneSemanticCandidates(args: ResolveMultiStageQueryArgs): boolean {
  return Boolean(
    (args.stageOneDeterministicActions?.some(action =>
      action.type === "apply_filter" && action.field && action.value != null,
    )) ||
    (args.stageOneEditIntent && args.stageOneEditIntent.intent.type !== "reset_all") ||
    args.stageOneSort ||
    args.stageOneClearUnmentionedFields
  )
}

function extractUnresolvedTokens(args: ResolveMultiStageQueryArgs): string[] {
  const known = extendKnownTokensWithStageOneCues(args, extractKnownTokens(
    args.message,
    args.stageOneEditIntent,
    args.stageOneDeterministicActions,
    args.stageOneSort,
  ))

  return uniqueStrings(
    [
      ...extractRawTokens(args.message),
      ...extractSemanticEditHintTokens(args),
      ...extractDeterministicSemanticHintTokens(args),
    ].filter(token => {
      const normalized = normalizeToken(token)
      if (!normalized) return false
      if (STOPWORD_TOKENS.has(normalized) && !/^\d/.test(token)) return false
      return !tokenMatchesKnown(normalized, known)
    }),
  )
}

function collectSchemaHints(message: string, unresolvedTokens: string[]): ResolverSchemaHint[] {
  const candidates = uniqueStrings([message, ...unresolvedTokens]).filter(candidate => candidate.trim().length >= 2)
  const hints: ResolverSchemaHint[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const match = findValueByPhonetic(candidate, SCHEMA_HINT_PHONETIC_THRESHOLD)
    if (!match) continue
    const normalizedToken = normalizeToken(match.matchedToken)
    if (!normalizedToken || STOPWORD_TOKENS.has(normalizedToken)) continue

    const signature = `${match.column}::${match.value}::${normalizedToken}`
    if (seen.has(signature)) continue
    seen.add(signature)
    hints.push({
      token: match.matchedToken,
      column: match.column,
      value: match.value,
      similarity: match.similarity,
    })
  }

  return hints
}

function formatSchemaHintBlock(hints: ResolverSchemaHint[]): string {
  if (hints.length === 0) return "none"
  return hints
    .map(hint => `- token "${hint.token}" ~= ${hint.column}="${hint.value}" (sim ${hint.similarity.toFixed(2)})`)
    .join("\n")
}

function resolveFilterField(raw: unknown): string | null {
  const normalized = normalizeToken(String(raw ?? ""))
  if (!normalized) return null
  for (const entry of fieldAliasIndex) {
    if (entry.normalized === normalized) return entry.field
  }
  return null
}

function resolveSortField(raw: unknown): QueryField | null {
  const normalized = normalizeToken(String(raw ?? ""))
  if (!normalized) return null
  for (const entry of sortableFieldAliasIndex) {
    if (entry.normalized === normalized) return entry.field
  }
  return null
}

function toPrimitive(value: unknown): PrimitiveValue | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  return null
}

function toPrimitiveOrArray(value: unknown): PrimitiveValue | PrimitiveValue[] | null {
  const primitive = toPrimitive(value)
  if (primitive != null) return primitive
  if (!Array.isArray(value)) return null
  const primitives = value.map(item => toPrimitive(item)).filter((item): item is PrimitiveValue => item != null)
  return primitives.length > 0 ? primitives : null
}

function normalizeRouteHint(raw: unknown): ResolverRouteHint {
  const value = String(raw ?? "").trim().toLowerCase()
  return ROUTE_HINTS.has(value as ResolverRouteHint)
    ? value as ResolverRouteHint
    : "none"
}

function normalizeIntent(raw: unknown): ResolverIntent {
  const value = String(raw ?? "").trim().toLowerCase()
  return RESOLVER_INTENTS.has(value as ResolverIntent)
    ? value as ResolverIntent
    : "none"
}

function normalizeAction(raw: unknown): ResolverDecisionAction | null {
  const value = String(raw ?? "").trim().toLowerCase()
  if (value === "execute" || value === "ask_clarification" || value === "escalate_to_cot") {
    return value as ResolverDecisionAction
  }
  return null
}

function normalizeClarificationPayload(raw: unknown): ResolverClarification | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const question = typeof record.question === "string" ? record.question.trim() : ""
  const chips = Array.isArray(record.chips)
    ? uniqueStrings(record.chips.map(chip => String(chip ?? "").trim()).filter(Boolean))
    : []
  const askedField = resolveFilterField(record.askedField) ?? null
  const directInputChip = "직접 입력"
  if (!question) return null
  return {
    question,
    chips: chips.includes(directInputChip)
      ? chips
      : [...(chips.length > 0 ? chips : [directInputChip]), directInputChip].filter((chip, index, list) => list.indexOf(chip) === index),
    askedField,
  }
}

function normalizeConceptSpecs(rawConcepts: unknown): ResolverConceptSpec[] {
  if (!Array.isArray(rawConcepts)) return []
  const specs: ResolverConceptSpec[] = []

  for (const rawConcept of rawConcepts) {
    if (!rawConcept || typeof rawConcept !== "object") continue
    const record = rawConcept as Record<string, unknown>
    const kind = String(record.kind ?? "").trim().toLowerCase() as ResolverConceptKind
    if (kind !== "brand" && kind !== "feature" && kind !== "material" && kind !== "constraint") continue

    const rawOp = String(record.op ?? "eq").trim().toLowerCase()
    const op = FILTER_OPS.has(rawOp as ResolverFilterOp)
      ? rawOp as ResolverFilterOp
      : "eq"
    let value = toPrimitiveOrArray(record.value)
    let value2 = toPrimitive(record.value2)
    if (op === "between" && Array.isArray(value) && value.length >= 2) {
      value2 = value[1]
      value = value[0]
    }

    specs.push({
      kind,
      op,
      value: value ?? undefined,
      value2: value2 ?? undefined,
      rawToken: typeof record.rawToken === "string" ? record.rawToken : undefined,
      fieldHint: resolveFilterField(record.fieldHint) ?? resolveFilterField(record.field) ?? undefined,
      status: record.status === "mapped" || record.status === "held"
        ? record.status
        : "held",
    })
  }

  return specs
}

function hasKnownRegistryValue(field: "brand" | "series", rawValue: string): boolean {
  const normalized = normalizeToken(rawValue)
  if (!normalized) return false
  return getKnownEntityValues(field).some(candidate => normalizeToken(candidate) === normalized)
}

function buildHeldConceptFromFilterSpec(
  filter: ResolverFilterSpec,
  kind: ResolverConceptKind,
  fieldHint?: string | null,
): ResolverConceptSpec | null {
  const rawValue = Array.isArray(filter.value) ? filter.value[0] : filter.value
  const label = String(filter.rawToken ?? rawValue ?? "").trim()
  if (!label) return null
  return {
    kind,
    op: filter.op,
    value: rawValue ?? undefined,
    value2: filter.value2,
    rawToken: filter.rawToken ?? label,
    fieldHint: fieldHint ?? filter.field,
    status: "held",
  }
}

function normalizeDirectSemanticFilters(filters: ResolverFilterSpec[]): {
  filters: ResolverFilterSpec[]
  recoveredConcepts: ResolverConceptSpec[]
} {
  const validatedFilters: ResolverFilterSpec[] = []
  const recoveredConcepts: ResolverConceptSpec[] = []

  for (const filter of filters) {
    const rawValue = Array.isArray(filter.value) ? filter.value[0] : filter.value
    const textValue = String(rawValue ?? filter.rawToken ?? "").trim()

    if (filter.field === "seriesName" && (filter.op === "eq" || filter.op === "neq")) {
      const canonical = canonicalizeKnownEntityValue("series", textValue)
      if (canonical && hasKnownRegistryValue("series", canonical)) {
        validatedFilters.push({
          ...filter,
          value: canonical,
        })
        continue
      }

      const recovered = buildHeldConceptFromFilterSpec(filter, "feature")
      if (recovered) recoveredConcepts.push(recovered)
      continue
    }

    if (filter.field === "brand" && (filter.op === "eq" || filter.op === "neq")) {
      const canonical = canonicalizeKnownEntityValue("brand", textValue)
      if (canonical && hasKnownRegistryValue("brand", canonical)) {
        validatedFilters.push({
          ...filter,
          value: canonical,
        })
        continue
      }

      const recovered = buildHeldConceptFromFilterSpec(filter, "brand", "brand")
      if (recovered) recoveredConcepts.push(recovered)
      continue
    }

    if ((filter.field === "material" || filter.field === "workPieceName") && (filter.op === "eq" || filter.op === "neq")) {
      const family = resolveCatalogMaterialFamilyName(textValue) ?? resolveCatalogMaterialFamilyName(filter.rawToken ?? "")
      if (family) {
        validatedFilters.push({
          ...filter,
          field: "workPieceName",
          value: family,
        })
        continue
      }

      const recovered = buildHeldConceptFromFilterSpec(filter, "material", "workPieceName")
      if (recovered) recoveredConcepts.push(recovered)
      continue
    }

    validatedFilters.push(filter)
  }

  return {
    filters: validatedFilters,
    recoveredConcepts,
  }
}

function mapConceptToFilterSpec(concept: ResolverConceptSpec): ResolverFilterSpec | null {
  const rawValue = Array.isArray(concept.value) ? concept.value[0] : concept.value
  const textValue = String(rawValue ?? concept.rawToken ?? "").trim()
  if (!textValue) return null

  if (concept.kind === "brand") {
    const canonical = canonicalizeKnownEntityValue("brand", textValue)
    if (!canonical || !hasKnownRegistryValue("brand", canonical)) return null
    return {
      field: concept.fieldHint ?? "brand",
      op: concept.op,
      value: canonical,
      value2: concept.value2,
      rawToken: concept.rawToken ?? canonical,
    }
  }

  if (concept.kind === "material") {
    const family = resolveCatalogMaterialFamilyName(textValue) ?? resolveCatalogMaterialFamilyName(concept.rawToken ?? "")
    if (!family) return null
    return {
      field: concept.fieldHint ?? "workPieceName",
      op: concept.op,
      value: family,
      value2: concept.value2,
      rawToken: concept.rawToken ?? textValue,
    }
  }

  if ((concept.kind === "constraint" || concept.kind === "feature") && concept.fieldHint) {
    const field = resolveFilterField(concept.fieldHint) ?? concept.fieldHint
    if (!field) return null
    const candidate: ResolverFilterSpec = {
      field,
      op: concept.op,
      value: concept.value,
      value2: concept.value2,
      rawToken: concept.rawToken ?? textValue,
    }
    return buildFilterFromSpec(candidate, 0) ? candidate : null
  }

  return null
}

function normalizeMaterializedConcepts(concepts: ResolverConceptSpec[]): {
  concepts: ResolverConceptSpec[]
  mappedFilters: ResolverFilterSpec[]
} {
  const mappedFilters: ResolverFilterSpec[] = []
  const normalizedConcepts = concepts.map(concept => {
    const mappedFilter = mapConceptToFilterSpec(concept)
    if (mappedFilter) {
      mappedFilters.push(mappedFilter)
      return {
        ...concept,
        fieldHint: mappedFilter.field,
        status: "mapped" as const,
      }
    }

    return {
      ...concept,
      status: concept.status ?? "held",
    }
  })

  return {
    concepts: normalizedConcepts,
    mappedFilters,
  }
}

function hasShowRecommendationSignal(message: string): boolean {
  return /(?:추천\s*(?:해줘|해주|해주세요)?|보여줘|보기|결과\s*보여|show)/iu.test(message)
}

function isBareRecommendationMessage(message: string): boolean {
  const normalized = message
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[!.?~]+$/g, "")
    .trim()
  return BARE_RECOMMENDATION_KEYS.has(normalized)
}

function inferIntentFromRouteHint(
  routeHint: ResolverRouteHint,
  message: string,
  hasFilter: boolean,
  hasSort: boolean,
): ResolverIntent {
  if (routeHint === "show_recommendation") return "show_recommendation"
  if (routeHint === "general_question" || routeHint === "ui_question") return "answer_general"
  if (hasSort) return "show_recommendation"
  if (hasFilter) return hasShowRecommendationSignal(message) ? "show_recommendation" : "continue_narrowing"
  if (hasShowRecommendationSignal(message)) return "show_recommendation"
  return "none"
}

function normalizeFilterSpecs(
  rawFilters: unknown,
  pendingField?: string | null,
): ResolverFilterSpec[] {
  if (!Array.isArray(rawFilters)) return []
  const specs: ResolverFilterSpec[] = []

  for (const rawFilter of rawFilters) {
    if (!rawFilter || typeof rawFilter !== "object") continue
    const record = rawFilter as Record<string, unknown>
    const opValue = String(record.op ?? "").trim().toLowerCase()
    if (!FILTER_OPS.has(opValue as ResolverFilterOp)) continue

    const op = opValue as ResolverFilterOp
    let resolvedField = resolveFilterField(record.field) ?? (op === "skip" ? pendingField ?? null : null)
    if (!resolvedField) continue

    if (op === "skip") {
      specs.push({
        field: resolvedField,
        op,
        rawToken: typeof record.rawToken === "string" ? record.rawToken : undefined,
      })
      continue
    }

    let value = toPrimitiveOrArray(record.value)
    let value2 = toPrimitive(record.value2)
    if (op === "between" && Array.isArray(value) && value.length >= 2) {
      value2 = value[1]
      value = value[0]
    }
    if (value == null) continue
    if (op === "between" && value2 == null) continue

    if (
      resolvedField === "stockStatus"
      && (op === "gte" || op === "lte" || op === "between" || typeof value === "number")
    ) {
      resolvedField = "totalStock"
    }

    specs.push({
      field: resolvedField,
      op,
      value,
      value2: value2 ?? undefined,
      rawToken: typeof record.rawToken === "string" ? record.rawToken : undefined,
    })
  }

  return specs.filter(spec => buildFilterFromSpec(spec, 0) != null)
}

function normalizeSort(rawSort: unknown): QuerySort | null {
  if (!rawSort || typeof rawSort !== "object") return null
  const record = rawSort as Record<string, unknown>
  const field = resolveSortField(record.field)
  const direction = String(record.direction ?? "").trim().toLowerCase()
  if (!field || (direction !== "asc" && direction !== "desc")) return null
  return { field, direction }
}

function normalizeResolverPayload(
  payload: unknown,
  message: string,
  pendingField?: string | null,
): NormalizedResolverResult | null {
  if (!payload) return null

  const objectPayload = Array.isArray(payload)
    ? { filters: payload }
    : (typeof payload === "object" ? payload as Record<string, unknown> : null)
  if (!objectPayload) return null

  const rawFilters = normalizeFilterSpecs(objectPayload.filters, pendingField)
  const sort = normalizeSort(objectPayload.sort)
  const directFilterNormalization = normalizeDirectSemanticFilters(rawFilters)
  const { concepts, mappedFilters } = normalizeMaterializedConcepts([
    ...normalizeConceptSpecs(objectPayload.concepts),
    ...directFilterNormalization.recoveredConcepts,
  ])
  const allFilters = [...directFilterNormalization.filters, ...mappedFilters]
  const routeHint = normalizeRouteHint(objectPayload.routeHint)
  const explicitIntent = normalizeIntent(objectPayload.intent)
  const clarification = normalizeClarificationPayload(objectPayload.clarification)
    ?? normalizeClarificationPayload({
      question: objectPayload.question,
      chips: objectPayload.chips,
      askedField: objectPayload.askedField,
    })
    ?? (
      objectPayload.clarification
      && typeof objectPayload.clarification === "object"
      && typeof (objectPayload.clarification as Record<string, unknown>).question === "string"
        ? {
          question: String((objectPayload.clarification as Record<string, unknown>).question ?? "").trim(),
          chips: Array.isArray((objectPayload.clarification as Record<string, unknown>).chips)
            ? uniqueStrings(((objectPayload.clarification as Record<string, unknown>).chips as unknown[]).map(chip => String(chip ?? "").trim()).filter(Boolean))
            : ["직접 입력"],
          askedField: null,
        }
        : null
    )
  const intent = explicitIntent !== "none"
    ? explicitIntent
    : clarification
    ? "ask_clarification"
    : inferIntentFromRouteHint(routeHint, message, allFilters.length > 0, Boolean(sort))
  const explicitAction = normalizeAction(objectPayload.action)
  const clearOtherFilters = objectPayload.clearOtherFilters === true
  const removeFields = Array.isArray(objectPayload.removeFields)
    ? uniqueStrings(objectPayload.removeFields.map(field => resolveFilterField(field)).filter((field): field is string => Boolean(field)))
    : []
  const confidence = clampConfidence(objectPayload.confidence, allFilters.length > 0 || sort ? 0.8 : clarification ? 0.52 : 0)
  const unresolvedTokens = Array.isArray(objectPayload.unresolvedTokens)
    ? uniqueStrings(objectPayload.unresolvedTokens.map(token => String(token ?? "").trim()))
    : []
  const reasoning = typeof objectPayload.reasoning === "string" ? objectPayload.reasoning.trim() : ""
  const action = explicitAction
    ?? (clarification || intent === "ask_clarification"
      ? "ask_clarification"
      : "execute")

  return {
    action,
    filters: allFilters,
    concepts,
    sort,
    routeHint,
    intent,
    clearOtherFilters,
    removeFields,
    confidence,
    unresolvedTokens: uniqueStrings([
      ...unresolvedTokens,
      ...concepts
        .filter(concept => concept.status !== "mapped")
        .map(concept => String(concept.rawToken ?? concept.value ?? "").trim())
        .filter(Boolean),
    ]),
    reasoning,
    clarification,
  }
}

function buildFilterFromSpec(spec: ResolverFilterSpec, turnCount: number): AppliedFilter | null {
  if (spec.op === "skip") {
    return {
      field: spec.field,
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: turnCount,
    }
  }

  const rawValue = spec.op === "between"
    ? [spec.value as PrimitiveValue, spec.value2 as PrimitiveValue]
    : (spec.value as PrimitiveValue | PrimitiveValue[])
  const targetField =
    spec.field === "stockStatus"
    && (spec.op === "gte" || spec.op === "lte" || spec.op === "between" || typeof rawValue === "number")
      ? "totalStock"
      : spec.field
  const preserveExactEq = spec.op === "eq" && (
    targetField === "workPieceName"
    || targetField === "brand"
    || targetField === "seriesName"
  )

  return buildAppliedFilterFromValue(
    targetField,
    rawValue,
    turnCount,
    preserveExactEq ? "eq" : spec.op === "eq" ? undefined : spec.op,
  )
}

function materializeResult(
  source: MultiStageResolverResult["source"],
  normalized: NormalizedResolverResult,
  turnCount: number,
): MultiStageResolverResult {
  return {
    source: normalized.action === "ask_clarification" ? "clarification" : source,
    action: normalized.action,
    filters: normalized.filters
      .map(filter => buildFilterFromSpec(filter, turnCount))
      .filter((filter): filter is AppliedFilter => filter != null),
    concepts: normalized.concepts,
    sort: normalized.sort,
    routeHint: normalized.routeHint,
    intent: normalized.intent,
    clearOtherFilters: normalized.clearOtherFilters,
    removeFields: normalized.removeFields,
    followUpFilter: null,
    confidence: normalized.confidence,
    unresolvedTokens: normalized.unresolvedTokens,
    reasoning: normalized.reasoning,
    clarification: normalized.clarification,
  }
}

function hasMeaningfulResolution(result: NormalizedResolverResult | null): result is NormalizedResolverResult {
  if (!result) return false
  return result.action !== "escalate_to_cot"
    && !isIntentOnlyRoutingSignal({
      filters: result.filters,
      sort: result.sort,
      routeHint: result.routeHint,
      intent: result.intent,
      clearOtherFilters: result.clearOtherFilters,
      removeFields: result.removeFields,
      clarification: result.clarification,
    })
    && (
      result.action === "ask_clarification"
      || (
      result.filters.length > 0
      || !!result.sort
      || result.intent !== "none"
      || result.clearOtherFilters
      || result.removeFields.length > 0
      || !!result.clarification
      || result.routeHint !== "none"
      )
    )
}

async function buildClarificationResultSafe(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
  options?: {
    validation?: ResolverValidationSummary | null
    candidateResult?: MultiStageResolverResult | null
  },
): Promise<MultiStageResolverResult> {
  return buildClarificationResultSafeImpl(
    args,
    unresolvedTokens,
    options?.validation ?? null,
    options?.candidateResult?.clarification ?? null,
  )
}

/**
 * Extract numeric+unit tokens from user message (e.g., "6mm", "10도", "120mm").
 * Returns an array of objects with the raw token + inferred unit so callers
 * can route to SQL Agent when empty OR build smart chips when present.
 * NOTE: unit list comes from the DB's numeric column suffixes — we only look
 * for /\d+(?:\.\d+)?\s*(unit)?/ patterns. No hardcoded field cue mapping.
 */
function extractNumericTokens(message: string): Array<{ raw: string; num: number; unit: string | null }> {
  const out: Array<{ raw: string; num: number; unit: string | null }> = []
  if (!message) return out
  const re = /(\d+(?:\.\d+)?)\s*(mm|㎜|도|°|deg|hrc|rpm|분|시간|개|날|플루트|f|φ)?/giu
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const num = Number(m[1])
    if (!Number.isFinite(num)) continue
    const unit = (m[2] ?? "").trim().toLowerCase() || null
    out.push({ raw: m[0].trim(), num, unit })
  }
  return out
}

/**
 * Ask LLM to pick 2-3 plausible DB column labels for a numeric+unit token
 * based on the live DB schema (numeric columns + their min/max/samples).
 * Returns Korean display labels (getFilterFieldLabel) — no hardcoded map.
 */
async function pickSmartChipsForNumericToken(
  token: { raw: string; num: number; unit: string | null },
  message: string,
): Promise<string[] | null> {
  try {
    const schema = getDbSchemaSync()
    if (!schema) return null
    // Gather numeric columns with stats — gives LLM context without hardcoding.
    const numericCols = Object.entries(schema.numericStats).slice(0, 40)
    if (numericCols.length === 0) return null
    const schemaSnippet = numericCols
      .map(([col, s]) => formatNumericStatsCompact(col, s))
      .join("\n")
    const systemPrompt = `당신은 YG-1 절삭공구 DB의 숫자 컬럼을 사용자 표현에 매핑합니다.
아래 DB 숫자 컬럼 중, 사용자가 언급한 숫자(+단위)에 가장 어울리는 2~3개만 고르세요.
반드시 JSON 배열만 출력: ["컬럼1","컬럼2","컬럼3"]
컬럼명은 스키마의 원래 이름 그대로(영문). 추가 설명 금지.

DB 숫자 컬럼:
${schemaSnippet}`
    const userInput = `사용자 메시지: "${message}"
대상 숫자 토큰: "${token.raw}" (num=${token.num}, unit=${token.unit ?? "없음"})`
    const res = await executeLlm({
      agentName: "parameter-extractor",
      modelTier: "mini",
      reasoningTier: "light",
      systemPrompt,
      userInput,
      maxTokens: 120,
    })
    const text = (res.text ?? "").trim()
    if (!text) return null
    // Parse JSON array (tolerate code fences / surrounding text).
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) return null
    let parsed: unknown
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return null }
    if (!Array.isArray(parsed)) return null
    const cols = parsed.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 3)
    if (cols.length === 0) return null
    // Translate column name to Korean label when possible; fall back to column name.
    const labels = cols.map(col => {
      const label = getFilterFieldLabel(col)
      return label && label !== col ? label : col
    })
    return labels
  } catch {
    return null
  }
}

function pickPrimaryClarificationIssue(
  validation: ResolverValidationSummary | null | undefined,
): ResolverValidationIssue | null {
  if (!validation || validation.issues.length === 0) return null

  const priorities: ResolverValidationIssueCode[] = [
    "generic_specific_collapse",
    "concept_mapping_gap",
    "comparative_preference_ambiguity",
    "mixed_clause_ambiguity",
    "correction_signal_ignored",
    "session_truth_conflict",
    "domain_lock_risk",
    "noop_result",
  ]

  for (const code of priorities) {
    const issue = validation.issues.find(candidate => candidate.code === code)
    if (issue) return issue
  }

  return validation.issues[0] ?? null
}

function resolveClarificationLabelSafe(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
): string {
  if (MULTIPLE_HELIX_CUE_RE.test(args.message)) return "multiple helix"
  if (GENERIC_COATING_CUE_RE.test(args.message)) return "금속 코팅"
  return unresolvedTokens.find(Boolean) ?? "현재 표현"
}

function buildIssueDrivenClarificationSafe(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
  validation: ResolverValidationSummary | null | undefined,
): ResolverClarification | null {
  const primaryIssue = pickPrimaryClarificationIssue(validation)
  if (!primaryIssue) return null

  const conversationContext = buildResolverConversationContext(args)
  const currentUnderstanding = conversationContext.currentUnderstanding !== "none"
    ? conversationContext.currentUnderstanding
    : "현재 조건"
  const label = resolveClarificationLabelSafe(args, unresolvedTokens)
  const directInputChip = "직접 입력"

  switch (primaryIssue.code) {
    case "generic_specific_collapse":
      return {
        question: `현재는 ${currentUnderstanding} 기준으로 이해했는데, '${label}'은 TiAlN/AlCrN 같은 특정 코팅을 뜻하나요, 아니면 코팅 일반을 뜻하나요?`,
        chips: ["TiAlN/AlCrN", "코팅 일반", directInputChip],
        askedField: "coating",
      }
    case "concept_mapping_gap":
      return {
        question: `현재는 '${label}'을 특성 후보로 이해했는데, 여기서 '${label}'은 시리즈명인가요, 제품 특성인가요?`,
        chips: ["시리즈명", "제품 특성", directInputChip],
        askedField: null,
      }
    case "comparative_preference_ambiguity":
      return {
        question: "현재는 일부 조건을 제외하고 대안을 찾는 요청으로 이해했는데, 비교 기준을 설명해드릴까요, 아니면 제외 조건만 확정할까요?",
        chips: ["비교 기준 설명", "제외 조건 확정", directInputChip],
        askedField: null,
      }
    case "mixed_clause_ambiguity":
      return {
        question: "현재는 2날 유지 + Square 제외로 이해했는데 맞나요? 아니면 Square가 아닌 다른 형상으로 다시 고르려는 건가요?",
        chips: ["2날 유지 + Square 제외", "다른 형상으로 변경", directInputChip],
        askedField: null,
      }
    case "correction_signal_ignored":
      return {
        question: `현재는 ${currentUnderstanding}로 이해했는데, 무엇이 틀렸는지 알려주시면 그 부분만 수정하겠습니다. 기존 조건을 수정할까요, 아니면 새 추천으로 다시 시작할까요?`,
        chips: ["기존 조건 수정", "새 추천으로 다시", directInputChip],
        askedField: null,
      }
    case "session_truth_conflict":
      if (DEICTIC_CONTEXT_RE.test(args.message) && hasNegationCue(args.message)) {
        return {
          question: `현재는 ${currentUnderstanding}로 이해했는데, '${args.message}'는 현재 조건을 제외하라는 뜻인가요, 아니면 다른 조건으로 수정하라는 뜻인가요?`,
          chips: ["현재 조건 제외", "다른 조건 수정", directInputChip],
          askedField: null,
        }
      }
      return {
        question: `현재는 ${currentUnderstanding}로 이해했는데, 기존 조건을 유지할지 일부만 수정할지 확인이 필요합니다. 어느 쪽이 맞나요?`,
        chips: ["기존 조건 유지", "일부 조건 수정", directInputChip],
        askedField: null,
      }
    case "domain_lock_risk":
      return {
        question: `현재는 ${currentUnderstanding} 기준으로 이해했는데, 이번에는 현재 공구 계열 안에서 다시 찾을까요, 아니면 공구 계열 자체를 바꿀까요?`,
        chips: ["현재 계열 유지", "공구 계열 변경", directInputChip],
        askedField: "toolType",
      }
    default:
      return null
  }
}

/**
 * Decides the final fallback clarification when no earlier branch matched:
 *  - If the message contains numeric+unit tokens → ask a smart chip question
 *    where the chips are 2-3 column candidates picked by LLM from the live
 *    DB schema. No hardcoded field cue map.
 *  - If no numeric tokens → return null to signal "defer to SQL Agent"
 *    (caller turns this into action:"execute" with empty filters instead of
 *    the old "기준이 넓어서" refusal).
 */
async function buildNumericOrDeferFallback(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
  directInputChip: string,
): Promise<ResolverClarification | null> {
  const numericTokens = extractNumericTokens(args.message ?? "")
  if (numericTokens.length === 0) {
    // No numeric hint — defer to SQL Agent so it can try schema-aware extraction
    // instead of a generic refusal.
    return null
  }
  const primary = numericTokens[0]
  const chips = await pickSmartChipsForNumericToken(primary, args.message ?? "")
  if (!chips || chips.length === 0) {
    // LLM couldn't pick — fall back to unresolvedTokens-style question but
    // keep it actionable rather than the old refusal.
    const label = unresolvedTokens.slice(0, 3).join(", ") || "현재 표현"
    return {
      question: `'${label}'이 어떤 조건을 뜻하는지 조금만 더 알려주세요.`,
      chips: [directInputChip, "처음부터 다시"],
      askedField: null,
    }
  }
  return {
    question: `"${primary.raw}"는 어느 필드 값으로 적용할까요?`,
    chips: [...chips, directInputChip],
    askedField: null,
  }
}

async function buildClarificationResultSafeImpl(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
  validation?: ResolverValidationSummary | null,
  preferredClarification?: ResolverClarification | null,
): Promise<MultiStageResolverResult> {
  const directInputChip = "직접 입력"
  const pendingField = args.pendingField ?? args.sessionState?.lastAskedField ?? null
  const orderQuantityAmbiguity = detectOrderQuantityInventoryAmbiguity(args.message)
  if (orderQuantityAmbiguity) {
    return {
      source: "clarification",
      action: "ask_clarification",
      filters: [],
      concepts: [],
      sort: null,
      routeHint: "general_question",
      intent: "ask_clarification",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens,
      reasoning: "clarification:inventory_scope_ambiguity",
      clarification: {
        question: orderQuantityAmbiguity.question,
        chips: orderQuantityAmbiguity.chips.includes(directInputChip)
          ? orderQuantityAmbiguity.chips
          : [...orderQuantityAmbiguity.chips, directInputChip],
        askedField: null,
      },
      validation: validation ?? null,
    }
  }

  const measurementScopeAmbiguity = detectMeasurementScopeAmbiguity(args.message, {
    pendingField,
  })
  if (measurementScopeAmbiguity) {
    return {
      source: "clarification",
      action: "ask_clarification",
      filters: [],
      concepts: [],
      sort: null,
      routeHint: "general_question",
      intent: "ask_clarification",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens,
      reasoning: "clarification:measurement_scope_ambiguity",
      clarification: {
        question: measurementScopeAmbiguity.question,
        chips: measurementScopeAmbiguity.chips.includes(directInputChip)
          ? measurementScopeAmbiguity.chips
          : [...measurementScopeAmbiguity.chips, directInputChip],
        askedField: null,
      },
      validation: validation ?? null,
    }
  }

  const isBareRecommendation =
    !pendingField
    && (args.currentFilters?.length ?? 0) === 0
    && isBareRecommendationMessage(args.message)
  const isStatefulRepair = (args.currentFilters?.length ?? 0) > 0
  const pendingLabel = pendingField ? getFilterFieldLabel(pendingField) : null
  const unresolvedLabel = unresolvedTokens.length > 0
    ? unresolvedTokens.slice(0, 3).join(", ")
    : "현재 표현"
  const currentUnderstandingRaw = buildResolverConversationContext(args).currentUnderstanding
  const currentUnderstanding = currentUnderstandingRaw !== "none"
    ? currentUnderstandingRaw
    : "현재 조건"
  const issueDrivenClarification = buildIssueDrivenClarificationSafe(args, unresolvedTokens, validation)

  const clarification =
    preferredClarification
    ?? issueDrivenClarification
    ?? (
      isBareRecommendation
        ? {
          question: "현재 소재 조건이 없어 바로 추천을 확정하기 어렵습니다. 어떤 소재를 가공하시나요?",
          chips: ["스테인리스", "알루미늄", "탄소강", directInputChip],
          askedField: "workPieceName",
        }
        : isStatefulRepair
        ? {
          question: `현재는 ${currentUnderstanding}로 이해했는데, 기존 조건을 수정할지 새 추천으로 다시 시작할지 확인이 필요합니다. 어느 쪽으로 진행할까요?`,
          chips: ["기존 조건 수정", "새 추천으로 다시", directInputChip],
          askedField: null,
        }
        : pendingLabel
        ? {
          question: `${pendingLabel}을 어떻게 처리할지 애매합니다. ${pendingLabel}을 유지할까요, 값을 바꿀까요, 아니면 직접 다시 입력하실까요?`,
          chips: [`${pendingLabel} 유지`, `${pendingLabel} 변경`, directInputChip],
          askedField: pendingField,
        }
        : await buildNumericOrDeferFallback(args, unresolvedTokens, directInputChip)
    )

  // If fallback chose to defer to SQL Agent (execute with empty filters) the
  // helper returns null; translate that into a deferred execute result so the
  // downstream pipeline can try SQL Agent / tool-forge instead of refusing.
  if (clarification === null) {
    return {
      source: "none",
      action: "execute",
      filters: [],
      concepts: [],
      sort: null,
      routeHint: "none",
      intent: "none",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens,
      reasoning: "defer:sql_agent_fallback",
      clarification: null,
      validation: validation ?? null,
    }
  }

  return {
    source: "clarification",
    action: "ask_clarification",
    filters: [],
    concepts: [],
    sort: null,
    routeHint: "none",
    intent: "ask_clarification",
    clearOtherFilters: false,
    removeFields: [],
    followUpFilter: null,
    confidence: 0,
    unresolvedTokens,
    reasoning: pendingField
      ? `clarification:${pendingField}`
      : isBareRecommendation
      ? "clarification:workPieceName"
      : `clarification:${unresolvedTokens.join("|") || "generic"}`,
    clarification,
    validation: validation ?? null,
  }
}

function buildEmptyResult(reasoning = ""): MultiStageResolverResult {
  return {
    source: "none",
    action: "execute",
    filters: [],
    concepts: [],
    sort: null,
    routeHint: "none",
    intent: "none",
    clearOtherFilters: false,
    removeFields: [],
    followUpFilter: null,
    confidence: 0,
    unresolvedTokens: [],
    reasoning,
    clarification: null,
  }
}

function buildStageOneAnalysis(args: ResolveMultiStageQueryArgs): StageOneBuildAnalysis {
  const editIntentResult = args.stageOneEditIntent ?? null
  const editIntent = editIntentResult?.intent ?? null
  const executeStageOneEdit = shouldExecuteEditIntentDeterministically(editIntentResult)
  const filterSpecs: ResolverFilterSpec[] = []
  let intent: ResolverIntent = "none"
  let reasoning = "stage1"

  const finalize = (result: MultiStageResolverResult | null): StageOneBuildAnalysis => {
    const materializedFilterCount = result?.filters.length ?? 0
    const skipFilterCount = result?.filters.filter(filter => filter.op === "skip").length ?? 0
    const concreteFilterCount = materializedFilterCount - skipFilterCount
    return {
      result,
      rawFilterSpecCount: filterSpecs.length,
      materializedFilterCount,
      canonicalizationMissCount: Math.max(0, filterSpecs.length - materializedFilterCount),
      skipFilterCount,
      concreteFilterCount,
    }
  }

  if (editIntent && executeStageOneEdit) {
    switch (editIntent.type) {
      case "reset_all":
        return finalize({
          source: "stage1",
          action: "execute",
          filters: [],
          concepts: [],
          sort: null,
          routeHint: "none",
          intent: "reset_session",
          clearOtherFilters: false,
          removeFields: [],
          followUpFilter: null,
          confidence: args.stageOneEditIntent?.confidence ?? 0.95,
          unresolvedTokens: [],
          reasoning: `stage1:${args.stageOneEditIntent?.reason ?? "reset_all"}`,
          clarification: null,
        })
      case "skip_field":
      case "clear_field":
      case "replace_field":
      case "exclude_field":
        reasoning = `stage1:hint:${args.stageOneEditIntent?.reason ?? editIntent.type}`
        break
      case "go_back_then_apply":
        reasoning = `stage1:hint:${args.stageOneEditIntent?.reason ?? "go_back_then_apply"}`
        break
    }
  } else if (editIntentResult) {
    reasoning = `stage1:hint:${editIntentResult.reason}`
  }

  const filters = filterSpecs
    .map(spec => buildFilterFromSpec(spec, args.turnCount))
    .filter((filter): filter is AppliedFilter => filter != null)

  const hasStageOneResolution = intent !== "none"
  if (!hasStageOneResolution) return finalize(null)

  return finalize({
    source: "stage1",
    action: "execute",
    filters,
    concepts: [],
    sort: null,
    routeHint: "none",
    intent,
    clearOtherFilters: false,
    removeFields: [],
    followUpFilter: null,
    confidence: args.stageOneEditIntent?.confidence ?? 0.95,
    unresolvedTokens: [],
    reasoning,
    clarification: null,
  })
}

function buildFieldGuide(): string {
  return getRegisteredFilterFields()
    .map(field => {
      const aliases = getFilterFieldQueryAliases(field).filter(Boolean).slice(0, 8).join(", ")
      return `- ${field} (${getFilterFieldLabel(field)}): aliases=${aliases}`
    })
    .join("\n")
}

function getResolverSchemaSnapshot(): {
  sampleValues: Record<string, string[]>
  workpieces: Array<string | { tag_name?: string | null; normalized_work_piece_name?: string | null }>
  brands: string[]
} {
  const schema = getDbSchemaSync()
  if (!schema) {
    return {
      sampleValues: {},
      workpieces: [],
      brands: [],
    }
  }

  return {
    sampleValues: schema.sampleValues ?? {},
    workpieces: schema.workpieces ?? [],
    brands: schema.brands ?? [],
  }
}

function getResolverWorkpieceSamples(
  workpieces: Array<string | { tag_name?: string | null; normalized_work_piece_name?: string | null }>,
): string[] {
  return uniqueStrings(
    workpieces.map(entry =>
      typeof entry === "string"
        ? entry
        : entry?.normalized_work_piece_name ?? entry?.tag_name ?? ""
    ),
  ).filter(Boolean)
}

function buildSchemaContext(): string {
  const schema = getResolverSchemaSnapshot()
  const lines: string[] = []

  const workPieceSamples = getResolverWorkpieceSamples(schema.workpieces)
  if (workPieceSamples.length > 0) {
    lines.push(`- workPiece samples: ${workPieceSamples.slice(0, 8).join(", ")}`)
  }
  if (Array.isArray(schema.brands) && schema.brands.length > 0) {
    lines.push(`- brand samples: ${schema.brands.slice(0, 12).join(", ")}`)
  }

  for (const [column, rawValues] of Object.entries(schema.sampleValues).slice(0, 20)) {
    if (!Array.isArray(rawValues) || rawValues.length === 0) continue
    const clean = uniqueStrings(rawValues.slice(0, 5).map(value => String(value ?? "").trim()))
    if (clean.length === 0) continue
    lines.push(`- ${column}: ${clean.join(", ")}`)
  }

  return lines.join("\n")
}

function buildCurrentFilterSummary(filters: AppliedFilter[]): string {
  if (filters.length === 0) return "none"
  return filters
    .map(filter => `${filter.field} ${filter.op} ${String(filter.rawValue ?? filter.value)}`)
    .join(" | ")
}

function buildResolverDomainDictionary(): string {
  const schema = getResolverSchemaSnapshot()
  const toolSubtypeSamples = uniqueStrings([
    ...(schema.sampleValues.tool_subtype ?? []),
    ...(schema.sampleValues.search_subtype ?? []),
  ]).slice(0, 8)
  const coatingSamples = uniqueStrings([
    ...(schema.sampleValues.coating ?? []),
    ...(schema.sampleValues.search_coating ?? []),
  ]).slice(0, 8)
  const workPieceSamples = getResolverWorkpieceSamples(schema.workpieces).slice(0, 8)
  const brandSamples = uniqueStrings(schema.brands).slice(0, 8)
  const materialHints = buildMaterialPromptHints(6)

  return [
    `- toolSubtype canonical values/examples: ${toolSubtypeSamples.join(", ") || "Square, Ball, Radius, Roughing, Taper, Chamfer"}`,
    `- coating canonical values/examples: ${coatingSamples.join(", ") || "TiAlN, AlCrN, DLC, Bright Finish"}`,
    `- workPieceName examples: ${workPieceSamples.join(", ") || "Stainless Steels, Aluminum, Carbon Steels, Copper, Titanium"}`,
    `- brand examples: ${brandSamples.join(", ") || "none"}`,
    materialHints ? `- compact material mapping hints:\n${materialHints}` : null,
    `- stockStatus is only for qualitative states such as instock / outofstock / limited.`,
    `- totalStock is only for numeric inventory thresholds.`,
    `- skip/remove/clear means release an existing restriction, not invent a new value.`,
  ].filter((line): line is string => Boolean(line)).join("\n")
}

function isStage1MostlyNoOp(
  stage1Result: MultiStageResolverResult | null,
  stage1Analysis: StageOneBuildAnalysis,
): boolean {
  if (!stage1Result) return false
  if (stage1Result.intent === "reset_session" || stage1Result.intent === "go_back_one_step") return false
  if (stage1Result.sort || stage1Result.followUpFilter) return false
  if (stage1Analysis.concreteFilterCount > 0) return false

  return stage1Analysis.skipFilterCount > 0
    || stage1Result.removeFields.length > 0
    || stage1Result.clearOtherFilters
    || (stage1Analysis.materializedFilterCount === 0 && stage1Result.intent === "continue_narrowing")
}

function synthesizeStage1ReplayTokens(message: string, stage1ResolvedTokens: string[]): string[] {
  const rawTokens = uniqueStrings(
    extractRawTokens(message).filter(token => !STOPWORD_TOKENS.has(token)),
  ).slice(0, STAGE1_COT_TOKEN_LIMIT)
  if (rawTokens.length > 0) return rawTokens

  const resolvedTokens = uniqueStrings(
    stage1ResolvedTokens.filter(token => !STOPWORD_TOKENS.has(token)),
  ).slice(0, STAGE1_COT_TOKEN_LIMIT)
  if (resolvedTokens.length > 0) return resolvedTokens

  const normalizedMessage = normalizeToken(message)
  return normalizedMessage ? [normalizedMessage.slice(0, 48)] : []
}

function buildDeferredCotResult(reasoning: string, unresolvedTokens: string[]): MultiStageResolverResult {
  return {
    ...buildEmptyResult(reasoning),
    unresolvedTokens,
  }
}

function classifyStage1CotEscalation(
  args: ResolveMultiStageQueryArgs,
  stage1Result: MultiStageResolverResult | null,
  stage1Analysis: StageOneBuildAnalysis,
  unresolvedTokens: string[],
  stage1ResolvedTokens: string[],
): {
  shouldShortCircuit: boolean
  forceCot: boolean
  reasons: string[]
  effectiveUnresolvedTokens: string[]
  schemaHints: ResolverSchemaHint[]
  stage1MostlyNoOp: boolean
} {
  const shouldShortCircuit = stage1Result != null && (
    unresolvedTokens.length === 0
    || stage1Result.filters.some(filter => filter.op === "skip")
    || stage1Result.removeFields.length > 0
    || stage1Result.clearOtherFilters
  )
  const stage1MostlyNoOp = isStage1MostlyNoOp(stage1Result, stage1Analysis)
  const baseTokens = unresolvedTokens.length > 0 ? unresolvedTokens : extractRawTokens(args.message)
  const schemaHints = collectSchemaHints(args.message, baseTokens)

  if (
    args.stage1CotEscalation?.enabled !== true
    || !stage1Result
    || !shouldShortCircuit
    || stage1Result.intent === "reset_session"
    || stage1Result.intent === "go_back_one_step"
  ) {
    return {
      shouldShortCircuit,
      forceCot: false,
      reasons: [],
      effectiveUnresolvedTokens: unresolvedTokens,
      schemaHints,
      stage1MostlyNoOp,
    }
  }

  const reasons: string[] = []
  const currentCandidateCount = args.stage1CotEscalation?.currentCandidateCount
  const broadCandidateThreshold =
    args.stage1CotEscalation?.broadCandidateThreshold
    ?? STAGE1_COT_BROAD_CANDIDATE_THRESHOLD

  if (unresolvedTokens.length > 0) reasons.push("alias_miss")
  if (schemaHints.length > 0 && (unresolvedTokens.length > 0 || stage1Analysis.canonicalizationMissCount > 0)) {
    reasons.push("typo_suspicion")
  }
  if (stage1Analysis.canonicalizationMissCount > 0) reasons.push("canonicalization_miss")

  const conflictingFollowUp =
    (args.currentFilters?.length ?? 0) > 0
    && (needsRepair(args.message) || hasEditSignal(args.message) || shouldDeferHardcodedSemanticExecution(args.message))
    && (stage1MostlyNoOp || unresolvedTokens.length > 0 || stage1Analysis.canonicalizationMissCount > 0)
  if (conflictingFollowUp) reasons.push("conflicting_follow_up")

  if (currentCandidateCount === 0) reasons.push("zero_candidates")
  if (
    typeof currentCandidateCount === "number"
    && currentCandidateCount >= broadCandidateThreshold
    && (stage1MostlyNoOp || unresolvedTokens.length > 0 || stage1Analysis.canonicalizationMissCount > 0)
  ) {
    reasons.push("very_broad_candidates")
  }
  if (stage1MostlyNoOp) reasons.push("stage1_mostly_noop")

  const uniqueReasons = uniqueStrings(reasons)
  const effectiveUnresolvedTokens = uniqueReasons.length > 0 && unresolvedTokens.length === 0
    ? synthesizeStage1ReplayTokens(args.message, stage1ResolvedTokens)
    : unresolvedTokens

  return {
    shouldShortCircuit,
    forceCot: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    effectiveUnresolvedTokens,
    schemaHints,
    stage1MostlyNoOp,
  }
}

function buildResolverMaterialContext(args: ResolveMultiStageQueryArgs, unresolvedTokens: string[]): string {
  const currentMaterialTerms = args.currentFilters
    .filter(filter => filter.field === "material" || filter.field === "workPieceName")
    .map(filter => String(filter.rawValue ?? filter.value ?? "").trim())

  const scopedSeed = uniqueStrings([
    args.message,
    ...unresolvedTokens,
    ...currentMaterialTerms,
    args.sessionState?.resolvedInput?.material ?? null,
    args.sessionState?.resolvedInput?.workPieceName ?? null,
  ]).join(" ")

  return buildScopedMaterialPromptHints(scopedSeed, 4)
}

function buildStage2Prompt(args: ResolveMultiStageQueryArgs, unresolvedTokens: string[]): { systemPrompt: string; userPrompt: string } {
  const schemaHints = collectSchemaHints(args.message, unresolvedTokens)
  const materialContext = buildResolverMaterialContext(args, unresolvedTokens)
  const semanticHintSummary = buildStageOneSemanticHintSummary(args)
  const conversationContext = buildResolverConversationContext(args)
  const systemPrompt = `You are the Stage 2 lightweight resolver for the YG-1 cutting tool recommendation system.
Stage 1 only applies structurally safe operations and candidate hints. It must not finalize ambiguous natural-language mutation meaning.
You are responsible for the final semantic interpretation of negation, alternatives, and revise/follow-up language.

Field catalog:
${buildFieldGuide()}

Allowed fields:
- Use only the registered fields listed in the field catalog above.

Allowed operators:
- eq, neq, gte, lte, between, skip

Schema samples:
${buildSchemaContext()}

Domain dictionary:
${buildResolverDomainDictionary()}

${SEMANTIC_INTERPRETATION_POLICY_PROMPT}

숫자+mm만 있고 필드 키워드가 없을 때: 분포 데이터에서 해당 값이 p10~p90 범위 안인 컬럼이 1개뿐이면 → 바로 적용. 여러 컬럼이 해당되면 → 가공 맥락(소재, 날수, 공구 타입 등)이 함께 언급됐으면 diameterMm으로 추정하세요. 절삭공구에서 소재+mm+날수 조합은 거의 100% 직경을 의미합니다.

사고과정에서 '이건 정보 조회/상담 질문이다'라고 판단했으면:
- 필터 결과 표를 보여주지 말고 해당 정보를 직접 한 줄로 답하세요.
- 예: '날장길이 얼마?' → 'CE7659120의 날장(절삭 길이)은 55mm입니다.'
- 표 전체 덤프가 아니라 물어본 것만 답하세요.
사고과정의 판단과 최종 응답이 모순되면 안 됩니다.

Rules:
- First classify the turn as new, refine, repair, or explain from the current state, UI context, and conversation history.
- Current session state is the source of truth, not a loose reference. Most stateful turns are refine or repair, not new.
- If the mode is refine or repair, preserve every untouched constraint and return only the delta.
- If the mode is explain, preserve the active session truth and prefer routeHint=general_question or ui_question instead of mutating filters.
- Use displayed chips, displayed options, top candidates, recent conversation turns, and candidate buffers to resolve deictic references such as "that", "this", or "the previous one".
- Alias mappings, dictionaries, typo normalization, schema phonetic hints, and Stage 1 hints are clues only. The final meaning must come from the full contextual utterance.
- Request-preparation chat slots and recognized entities are coverage hints. If they reveal extra filter-bearing terms, reconcile them with the full sentence before finalizing a narrower result.
- Do not silently reset to a generic narrowing flow when the turn is refine or repair.
- First extract meaning as concepts: brand, feature, material, constraint.
- Filters are execution-ready results, not the first semantic representation.
- Only emit a direct string filter when the value is a validated catalog/DB value for that field.
- If a phrase is meaningful but not a validated DB value, keep it in concepts and unresolvedTokens instead of guessing a filter.
- skip means the user does not care about a field and the existing restriction should be removed.
- sort means a superlative like "제일 긴", "가장 작은".
- Use stockStatus only for availability states such as instock / outofstock / limited.
- Use totalStock for numeric inventory thresholds such as "재고 100개 이상".
- clearOtherFilters=true only when the user says everything else is okay / all other conditions can be dropped.
- routeHint:
  - ui_question: screen labels or UI statuses such as Excellent / Good / 정확매칭
  - general_question: explanatory question, concept question, or tool-domain side question
  - show_recommendation: user explicitly wants results now
  - compare_products: explicit comparison request, or a similar-product request around a concrete item or product code
  - none: otherwise
- If pendingField is set and the user is clearly dismissing that field, use it.
- If a schema phonetic hint clearly matches a brand / series / material token in the user message, emit the corresponding filter instead of returning only show_recommendation.
- If the user asks for a similar product around a concrete item or product code, prefer routeHint=compare_products even if the code itself stays unresolved.
- Attach negation only to the local field/value in the same clause. Example: "2 flutes and not square" => fluteCount eq 2, toolSubtype neq Square.
- Repair and correction cues such as "그게 아니고", "내 말은", or "진짜 너 말 안듣는다" mean the previous interpretation was wrong. Do not ignore them.
- Never collapse a generic mention into a specific canonical value without textual or UI evidence. Generic coating talk must not become Y-Coating by default.
- Respect the locked tool-family/domain from session truth. Do not leak from endmill context into drill/tap unless the user explicitly resets or starts a new task.
- Treat Stage 1 semantic hints as candidates only. Validate them against the full sentence, current filters, and allowed operators before using them.
- Never invent a field, operator, column, or canonical value outside the field catalog and domain dictionary.
- If unsure, prefer weak certainty, then deeper reasoning, then clarification. Do not use a generic fallback that mutates the session.
- Do not guess. Keep unresolved tokens instead.
- Every output must choose one action: execute, escalate_to_cot, or ask_clarification.
- If the turn is still unsafe, return action=ask_clarification with a concrete question and 2-4 chips.
- Return JSON only.

Examples:
{"action":"execute","filters":[{"field":"brand","op":"skip","rawToken":"노상관"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.92,"unresolvedTokens":[],"reasoning":"brand indifference"}
{"action":"execute","filters":[{"field":"coating","op":"skip","rawToken":"아무래도 좋은데"},{"field":"fluteCount","op":"eq","value":4,"rawToken":"4날"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.88,"unresolvedTokens":[],"reasoning":"skip coating and keep flute"}
{"action":"execute","filters":[{"field":"brand","op":"eq","value":"CRX S","rawToken":"크렉스에스"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"phonetic brand"}
{"action":"execute","filters":[{"field":"totalStock","op":"gte","value":100,"rawToken":"재고 100개 이상"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"numeric inventory threshold"}
{"action":"ask_clarification","filters":[],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.52,"unresolvedTokens":["multiple helix"],"question":"현재는 'multiple helix'를 특성 후보로 이해했는데, 여기서 'multiple helix'는 시리즈명인가요, 제품 특성인가요?","chips":["시리즈명","제품 특성","직접 입력"],"reasoning":"feature identifier is still ambiguous"}
{"action":"execute","filters":[],"sort":null,"routeHint":"ui_question","clearOtherFilters":false,"confidence":0.94,"unresolvedTokens":[],"reasoning":"UI label question"}
{"action":"execute","filters":[],"sort":null,"routeHint":"compare_products","clearOtherFilters":false,"confidence":0.93,"unresolvedTokens":["GMI4710055"],"reasoning":"similar product request around a specific item"}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Resolver mode: ${conversationContext.mode}`,
    `Current state truth: ${conversationContext.stateSummary}`,
    `UI context: ${conversationContext.uiSummary}`,
    `Candidate buffer truth: ${conversationContext.candidateBufferSummary}`,
    `Recent conversation history: ${conversationContext.historySummary}`,
    `Correction signals: ${conversationContext.correctionSummary}`,
    `Current understanding to preserve unless changed: ${conversationContext.currentUnderstanding}`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Stage 1 semantic hints: ${semanticHintSummary}`,
    `Request-preparation intent: ${args.requestPreparationIntent ?? "none"}`,
    `Request-preparation chat slots: ${buildRequestPreparationSlotSummary(args)}`,
    `Recognized entities: ${buildRecognizedEntitySummary(args)}`,
    `Material mapping context:\n${materialContext || "none"}`,
    `Possible schema phonetic hints:\n${formatSchemaHintBlock(schemaHints)}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Current candidate count: ${args.stage1CotEscalation?.currentCandidateCount ?? "unknown"}`,
    `Respond with JSON only.`,
  ].join("\n")

  return { systemPrompt, userPrompt }
}

function buildStage3Prompt(args: ResolveMultiStageQueryArgs, unresolvedTokens: string[], stage2Result: NormalizedResolverResult | null): { systemPrompt: string; userPrompt: string } {
  const schemaHints = collectSchemaHints(args.message, unresolvedTokens)
  const materialContext = buildResolverMaterialContext(args, unresolvedTokens)
  const semanticHintSummary = buildStageOneSemanticHintSummary(args)
  const conversationContext = buildResolverConversationContext(args)
  const systemPrompt = `You are the Stage 3 deep reasoning resolver for the YG-1 cutting tool recommendation system.
Stage 1 and Stage 2 were not sufficient. Think step by step internally, then return JSON only.

Field catalog:
${buildFieldGuide()}

Allowed fields:
- Use only the registered fields listed in the field catalog above.

Allowed operators:
- eq, neq, gte, lte, between, skip

Schema samples:
${buildSchemaContext()}

Domain dictionary:
${buildResolverDomainDictionary()}

${SEMANTIC_INTERPRETATION_POLICY_PROMPT}

숫자+mm만 있고 필드 키워드가 없을 때: 분포 데이터에서 해당 값이 p10~p90 범위 안인 컬럼이 1개뿐이면 → 바로 적용. 여러 컬럼이 해당되면 → 가공 맥락(소재, 날수, 공구 타입 등)이 함께 언급됐으면 diameterMm으로 추정하세요. 절삭공구에서 소재+mm+날수 조합은 거의 100% 직경을 의미합니다.

사고과정에서 '이건 정보 조회/상담 질문이다'라고 판단했으면:
- 필터 결과 표를 보여주지 말고 해당 정보를 직접 한 줄로 답하세요.
- 예: '날장길이 얼마?' → 'CE7659120의 날장(절삭 길이)은 55mm입니다.'
- 표 전체 덤프가 아니라 물어본 것만 답하세요.
사고과정의 판단과 최종 응답이 모순되면 안 됩니다.

Decision process:
1. Decide whether the turn is new, refine, repair, or explain from the current state, UI context, and conversation history.
2. If the mode is refine or repair, preserve the existing session truth and modify only the touched fields.
3. If the mode is explain, preserve the active state and answer the meaning/question instead of mutating the session.
4. Classify the user intent: filter, sort, comparison, UI question, side question, or mixed.
5. Analyze the unresolved tokens: Korean pronunciation, slang, misspacing, shorthand, superlative, indifference, UI vocabulary.
6. Use any schema phonetic hints only when they clearly fit the user's meaning.
7. Map only high-confidence items to DB fields or routeHint. Similar-product requests around a concrete item should use routeHint=compare_products even when the code stays unresolved.
8. Keep operator attachment local to each clause. "2 flutes and not square" must stay fluteCount eq 2 and toolSubtype neq Square.
9. Treat Stage 1 semantic hints as candidate intent only. Do not copy them unless the full utterance supports them.
9a. First extract meaning as concepts: brand, feature, material, constraint.
9b. Filters are execution-ready results, not the first semantic representation.
9c. Only emit a direct string filter when the value is a validated catalog/DB value for that field.
9d. If a phrase is meaningful but not a validated DB value, keep it in concepts and unresolvedTokens.
10. Use displayed chips, displayed options, top candidates, displayedProducts, displayedSeriesGroups, and recommendation/comparison artifacts to resolve deictic follow-ups before asking for clarification.
11. Repair cues mean the previous parse was wrong. Do not ignore them or silently reset.
12. Generic mentions must not collapse into a specific canonical value without textual or UI evidence.
13. If all other existing filters should be released, set clearOtherFilters=true only when the user explicitly reset or released them.
14. If unsure, leave filters empty and keep unresolvedTokens.
15. Never invent a field, operator, column, or canonical value outside the field catalog and domain dictionary.
16. Every output must choose one action: execute, escalate_to_cot, or ask_clarification.
17. If the turn is still unsafe after deeper reasoning, return action=ask_clarification with a concrete question and 2-4 chips.

Return JSON:
{"action":"execute","filters":[],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.0,"unresolvedTokens":[],"reasoning":""}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Resolver mode: ${conversationContext.mode}`,
    `Current state truth: ${conversationContext.stateSummary}`,
    `UI context: ${conversationContext.uiSummary}`,
    `Candidate buffer truth: ${conversationContext.candidateBufferSummary}`,
    `Recent conversation history: ${conversationContext.historySummary}`,
    `Correction signals: ${conversationContext.correctionSummary}`,
    `Current understanding to preserve unless changed: ${conversationContext.currentUnderstanding}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Complexity: ${args.complexity?.level ?? "unknown"} (${args.complexity?.reason ?? "n/a"})`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Stage 1 semantic hints: ${semanticHintSummary}`,
    `Request-preparation intent: ${args.requestPreparationIntent ?? "none"}`,
    `Request-preparation chat slots: ${buildRequestPreparationSlotSummary(args)}`,
    `Recognized entities: ${buildRecognizedEntitySummary(args)}`,
    `Material mapping context:\n${materialContext || "none"}`,
    `Possible schema phonetic hints:\n${formatSchemaHintBlock(schemaHints)}`,
    `Current candidate count: ${args.stage1CotEscalation?.currentCandidateCount ?? "unknown"}`,
    `Stage 2 result: ${stage2Result ? JSON.stringify({
      filters: stage2Result.filters,
      sort: stage2Result.sort,
      routeHint: stage2Result.routeHint,
      clearOtherFilters: stage2Result.clearOtherFilters,
      confidence: stage2Result.confidence,
      unresolvedTokens: stage2Result.unresolvedTokens,
    }) : "none"}`,
    `Respond with JSON only.`,
  ].join("\n")

  return { systemPrompt, userPrompt }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return await Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

async function runResolverStage(
  stage: "stage2" | "stage3",
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
  stage2Result?: NormalizedResolverResult | null,
  stage1ResolvedTokens?: string[],
): Promise<NormalizedResolverResult | null> {
  const provider = stage === "stage2"
    ? (args.stage2Provider ?? getProviderForAgent("parameter-extractor"))
    : (args.stage3Provider ?? getProviderForAgent("semantic-turn-extractor"))
  const schemaHints = collectSchemaHints(args.message, unresolvedTokens).map(hint => ({
    token: hint.token,
    column: hint.column,
    value: hint.value,
    similarity: Number(hint.similarity.toFixed(2)),
  }))

  if (!provider?.available()) {
    console.log(`[multi-stage:${stage}] provider unavailable`)
    return null
  }

  const { systemPrompt, userPrompt } = stage === "stage2"
    ? buildStage2Prompt(args, unresolvedTokens)
    : buildStage3Prompt(args, unresolvedTokens, stage2Result ?? null)

  try {
    if (stage === "stage2") {
      console.log("[multi-stage:stage2] calling LLM", {
        unresolvedTokens,
        stage1ResolvedTokens: stage1ResolvedTokens ?? [],
        currentFilters: formatAppliedFilters(args.currentFilters),
        schemaHints,
      })
    } else {
      console.log("[multi-stage:stage3] calling LLM", {
        unresolvedTokens,
        stage2Result: stage2Result ? {
          filters: stage2Result.filters,
          sort: stage2Result.sort,
          intent: stage2Result.intent,
          confidence: stage2Result.confidence,
          unresolvedTokens: stage2Result.unresolvedTokens,
        } : null,
        currentFilters: formatAppliedFilters(args.currentFilters),
        schemaHints,
      })
    }
    const response = await withTimeout(
      provider.complete(
        systemPrompt,
        [{ role: "user", content: userPrompt }],
        stage === "stage2" ? 900 : 1400,
        stage === "stage2" ? "haiku" : "sonnet",
        stage === "stage2" ? "parameter-extractor" : "semantic-turn-extractor",
      ),
      stage === "stage2" ? STAGE2_TIMEOUT_MS : STAGE3_TIMEOUT_MS,
    )
    if (!response) {
      console.log(`[multi-stage:${stage}] timed out or returned empty`)
      return null
    }
    const normalized = normalizeResolverPayload(
      extractJsonObject(response),
      args.message,
      args.pendingField ?? args.sessionState?.lastAskedField ?? null,
    )
    console.log(`[multi-stage:${stage}] result`, {
      source: stage,
      filters: normalized?.filters ?? [],
      sort: normalized?.sort ?? null,
      intent: normalized?.intent ?? "none",
      routeHint: normalized?.routeHint ?? "none",
      clarification: normalized?.clarification ?? null,
      unresolvedTokens: normalized?.unresolvedTokens ?? [],
      confidence: normalized?.confidence ?? 0,
    })
    return normalized
  } catch {
    console.log(`[multi-stage:${stage}] failed`)
    return null
  }
}

function shouldEscalateToStage3(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
  stage2Result: NormalizedResolverResult | null,
  stage2Validation: ResolverValidationSummary | null,
  failureCount: number,
): boolean {
  if (stage2Result?.action === "ask_clarification" || !!stage2Result?.clarification) return false
  if (stage2Validation?.action === "ask_clarification") return false
  if (stage2Result?.action === "escalate_to_cot") return true
  if (stage2Validation && !stage2Validation.valid) return true
  if (stage2Validation?.escalation === "strong_cot") return true
  if (
    stage2Result
    && (args.currentFilters?.length ?? 0) > 0
    && DEICTIC_CONTEXT_RE.test(args.message)
    && hasNegationCue(args.message)
    && (stage2Result.filters.length > 0 || stage2Result.removeFields.length > 0 || stage2Result.clearOtherFilters)
  ) {
    return true
  }
  if (unresolvedTokens.length === 0) return false
  if (!stage2Result) return true
  if (stage2Result.unresolvedTokens.length > 0) return true
  if (stage2Result.confidence < STAGE2_CONFIDENCE_THRESHOLD) return true
  if (failureCount > 0) return true
  if (args.complexity?.level === "deep" && stage2Result.confidence < 0.85) return true
  return false
}

export async function resolveMultiStageQuery(
  args: ResolveMultiStageQueryArgs,
): Promise<MultiStageResolverResult> {
  const stage1Analysis = buildStageOneAnalysis(args)
  const stage1ValidationResult = stage1Analysis.result
    ? validateResolverExecution(args, stage1Analysis.result, "stage1")
    : null
  const stage1Result = stage1ValidationResult?.result ?? stage1Analysis.result
  const stage1Validation = stage1ValidationResult?.validation ?? null
  const stage1ResolvedTokens = extractStageOneResolvedTokens(args)
  const unresolvedTokens = extractUnresolvedTokens(args)
  const stage1GateBase = classifyStage1CotEscalation(
    args,
    stage1Result,
    stage1Analysis,
    unresolvedTokens,
    stage1ResolvedTokens,
  )
  const stage1ValidationReasons =
    args.stage1CotEscalation?.enabled === true
      ? collectValidationReasons(stage1Validation)
      : []
  const stage1SemanticHintReplay =
    !stage1Result
    && hasStageOneSemanticCandidates(args)
  const stage1ForceCotFromValidation =
    args.stage1CotEscalation?.enabled === true
    && stage1Validation?.escalation !== "none"
  const stage1GateReasons = uniqueStrings([
    ...stage1GateBase.reasons,
    ...stage1ValidationReasons,
    ...(stage1SemanticHintReplay ? ["semantic_hints_only"] : []),
  ])
  const effectiveUnresolvedTokens = stage1GateReasons.length > 0 && stage1GateBase.effectiveUnresolvedTokens.length === 0
    ? synthesizeStage1ReplayTokens(args.message, stage1ResolvedTokens)
    : stage1GateBase.effectiveUnresolvedTokens
  const stage1Gate = {
    ...stage1GateBase,
    forceCot: stage1GateBase.forceCot || stage1ForceCotFromValidation || stage1SemanticHintReplay,
    reasons: stage1GateReasons,
    effectiveUnresolvedTokens,
  }
  console.log("[multi-stage:stage1] exit", {
    resolvedTokens: stage1ResolvedTokens,
    unresolvedTokens,
    resolvedBy: extractStageOneResolvedBy(args),
    finalStage1Filters: formatAppliedFilters(stage1Result?.filters ?? []),
    sort: stage1Result?.sort ?? null,
    removeFields: stage1Result?.removeFields ?? [],
    clearOtherFilters: stage1Result?.clearOtherFilters ?? false,
    intent: stage1Result?.intent ?? "none",
  })
  console.log("[multi-stage:stage1-gate]", {
    wouldShortCircuit: stage1Gate.shouldShortCircuit,
    forceCot: stage1Gate.forceCot,
    reasons: stage1Gate.reasons,
    currentCandidateCount: args.stage1CotEscalation?.currentCandidateCount ?? null,
    broadCandidateThreshold:
      args.stage1CotEscalation?.broadCandidateThreshold
      ?? STAGE1_COT_BROAD_CANDIDATE_THRESHOLD,
    rawFilterSpecCount: stage1Analysis.rawFilterSpecCount,
    materializedFilterCount: stage1Analysis.materializedFilterCount,
    canonicalizationMissCount: stage1Analysis.canonicalizationMissCount,
    skipFilterCount: stage1Analysis.skipFilterCount,
    concreteFilterCount: stage1Analysis.concreteFilterCount,
    stage1MostlyNoOp: stage1Gate.stage1MostlyNoOp,
    unresolvedTokens,
    effectiveUnresolvedTokens,
    validation: stage1Validation,
    schemaHints: stage1Gate.schemaHints.map(hint => ({
      token: hint.token,
      column: hint.column,
      value: hint.value,
      similarity: Number(hint.similarity.toFixed(2)),
    })),
  })

  if (stage1Result && stage1Gate.shouldShortCircuit && !stage1Gate.forceCot) {
    return {
      ...stage1Result,
      unresolvedTokens: [],
      validation: stage1Validation,
    }
  }

  if (effectiveUnresolvedTokens.length === 0) {
    const pendingField = args.pendingField ?? args.sessionState?.lastAskedField ?? null
    if (!pendingField && (args.currentFilters?.length ?? 0) === 0 && isBareRecommendationMessage(args.message)) {
      return buildEmptyResult("defer:bare_recommendation")
    }
    return await buildClarificationResultSafe(args, [], {
      validation: stage1Validation,
      candidateResult: stage1Result,
    })
  }

  const cacheKey = computeCacheKey(args)
  const cached = lookupResolverCache(cacheKey)
  if (cached) {
    const cachedCandidate = mergeMultiStageResults(stage1Result, materializeResult("cache", cached, args.turnCount))
    const cachedValidationResult = validateResolverExecution(args, cachedCandidate, "cache")
    if (cachedValidationResult.validation.valid) {
      console.log("[multi-stage:cache] hit", {
        unresolvedTokens: effectiveUnresolvedTokens,
        filters: formatAppliedFilters(cachedValidationResult.result.filters),
        sort: cachedValidationResult.result.sort,
        intent: cachedValidationResult.result.intent,
        clarification: cachedValidationResult.result.clarification,
        validation: cachedValidationResult.validation,
      })
      return cachedValidationResult.result
    }
    console.log("[multi-stage:cache] skipped invalid cached result", {
      unresolvedTokens: effectiveUnresolvedTokens,
      validation: cachedValidationResult.validation,
    })
  }

  const failureCount = getResolverFailureCount(cacheKey)
  console.log("[multi-stage:stage2] entry", {
    unresolvedTokens: effectiveUnresolvedTokens,
    whyEnteringStage2: stage1Gate.forceCot
      ? `stage1_gate:${stage1Gate.reasons.join("|") || "forced"}`
      : stage1Result
      ? "stage1_partial_with_unresolved_tokens"
      : "stage1_no_resolution",
    stage1ResolvedTokens,
  })
  const stage2Result = sanitizeNoOpResolution(
    await runResolverStage("stage2", args, effectiveUnresolvedTokens, null, stage1ResolvedTokens),
    args,
    stage1Result,
  )
  const stage2ValidationResult = stage2Result
    ? mergeValidationIssues(
      validateResolverExecution(
        args,
        mergeMultiStageResults(stage1Result, materializeResult("stage2", stage2Result, args.turnCount)),
        "stage2",
      ),
      "stage2",
      collectRawSemanticValidationIssues(args.message, stage2Result.filters, "stage2"),
    )
    : null
  const validatedStage2Result = stage2ValidationResult?.result ?? null
  const stage2Validation = stage2ValidationResult?.validation ?? null

  if (
    hasMeaningfulResolution(stage2Result)
    && validatedStage2Result != null
    && stage2Validation?.valid === true
    && stage2Result.confidence >= STAGE2_CONFIDENCE_THRESHOLD
    && stage2Result.unresolvedTokens.length === 0
    && !shouldEscalateToStage3(args, effectiveUnresolvedTokens, stage2Result, stage2Validation, failureCount)
  ) {
    clearResolverFailure(cacheKey)
    storeResolverCache(cacheKey, stage2Result)
    return validatedStage2Result
  }

  const stage3Needed = shouldEscalateToStage3(
    args,
    effectiveUnresolvedTokens,
    stage2Result,
    stage2Validation,
    failureCount,
  )
  if (stage3Needed) {
    const stage2Base = validatedStage2Result && resolverProducedMeaningfulOutput(validatedStage2Result)
      ? validatedStage2Result
      : stage1Result
    const stage3Result = sanitizeNoOpResolution(
      await runResolverStage("stage3", args, effectiveUnresolvedTokens, stage2Result),
      args,
      stage1Result,
    )
    const stage3ValidationResult = stage3Result
      ? mergeValidationIssues(
        validateResolverExecution(
          args,
          mergeMultiStageResults(stage2Base, materializeResult("stage3", stage3Result, args.turnCount)),
          "stage3",
        ),
        "stage3",
        collectRawSemanticValidationIssues(args.message, stage3Result.filters, "stage3"),
      )
      : null
    if (
      hasMeaningfulResolution(stage3Result)
      && stage3ValidationResult?.validation.valid
    ) {
      clearResolverFailure(cacheKey)
      storeResolverCache(cacheKey, stage3Result)
      return stage3ValidationResult.result
    }

    if (stage3ValidationResult && (!stage3ValidationResult.validation.valid || stage3ValidationResult.validation.escalation === "clarification")) {
      const clarificationValidation = {
        ...stage3ValidationResult.validation,
        action: "ask_clarification" as const,
      }
      return {
        ...mergeMultiStageResults(stage2Base, await buildClarificationResultSafe(args, effectiveUnresolvedTokens, {
          validation: clarificationValidation,
          candidateResult: stage3ValidationResult.result,
        })),
        validation: clarificationValidation,
      }
    }
  }

  if (validatedStage2Result && resolverProducedMeaningfulOutput(validatedStage2Result)) {
    if (stage3Needed) {
      if (stage2Validation?.valid) {
        clearResolverFailure(cacheKey)
        if (stage2Result) storeResolverCache(cacheKey, stage2Result)
        return validatedStage2Result
      }
      const clarificationValidation = stage2Validation
        ? {
          ...stage2Validation,
          action: "ask_clarification" as const,
        }
        : null
      return {
        ...mergeMultiStageResults(stage1Result, await buildClarificationResultSafe(args, effectiveUnresolvedTokens, {
          validation: clarificationValidation,
          candidateResult: validatedStage2Result,
        })),
        validation: clarificationValidation,
      }
    }
    if (stage2Validation?.valid) {
      clearResolverFailure(cacheKey)
      if (stage2Result) storeResolverCache(cacheKey, stage2Result)
      return validatedStage2Result
    }
    console.log("[multi-stage:stage2] meaningful result deferred for SQL-agent fallback", {
      reasons: stage1Gate.reasons,
      confidence: stage2Result?.confidence ?? 0,
      unresolvedTokens: stage2Result?.unresolvedTokens ?? [],
      validation: stage2Validation,
    })
    return {
      ...mergeMultiStageResults(stage1Result, await buildClarificationResultSafe(args, effectiveUnresolvedTokens, {
        validation: stage2Validation,
        candidateResult: validatedStage2Result,
      })),
      validation: stage2Validation,
    }
  }

  recordResolverFailure(cacheKey)
  if (stage1Gate.forceCot && args.stage1CotEscalation?.enabled === true) {
    return {
      ...mergeMultiStageResults(stage1Result, buildEmptyResult(`defer:stage1_cot:${stage1Gate.reasons.join("|") || "forced"}`)),
      unresolvedTokens: effectiveUnresolvedTokens,
      validation: stage2Validation ?? stage1Validation,
    }
  }
  return mergeMultiStageResults(stage1Result, await buildClarificationResultSafe(args, effectiveUnresolvedTokens, {
    validation: stage2Validation ?? stage1Validation,
    candidateResult: validatedStage2Result ?? (stage2Result ? materializeResult("stage2", stage2Result, args.turnCount) : stage1Result),
  }))
}

export function _resetMultiStageResolverCacheForTest(): void {
  resolverCache.clear()
  failureCache.clear()
}
