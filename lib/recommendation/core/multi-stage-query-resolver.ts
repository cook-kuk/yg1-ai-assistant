import { getProviderForAgent, type LLMProvider } from "@/lib/llm/provider"
import { resolveRequestedToolFamily } from "@/lib/data/repos/product-query-filters"
import type { AppliedFilter, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue, getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { stripKoreanParticles } from "@/lib/recommendation/shared/patterns"
import { normalizeRuntimeAppliedFilter } from "@/lib/recommendation/shared/runtime-filter-normalization"
import type { ComplexityDecision } from "./complexity-router"
import type { DeterministicAction } from "./deterministic-scr"
import {
  applyEditIntent,
  getEditIntentAffectedFields,
  getEditIntentHintTokens,
  hasEditSignal,
  shouldExecuteEditIntentDeterministically,
  type EditIntentResult,
} from "./edit-intent"
import type { QueryField, QuerySort } from "./query-spec"
import { getSortableFields, QUERY_FIELD_MANIFEST } from "./query-spec-manifest"
import { findValueByPhonetic, getDbSchemaSync } from "./sql-agent-schema-cache"
import { tokenize } from "./auto-synonym"
import { needsRepair } from "./turn-repair"
import {
  buildMaterialPromptHints,
  buildScopedMaterialPromptHints,
  resolveMaterialFamilyName,
} from "@/lib/recommendation/shared/material-mapping"
import { SEMANTIC_INTERPRETATION_POLICY_PROMPT } from "./semantic-execution-policy"

type ResolverFilterOp = "eq" | "neq" | "gte" | "lte" | "between" | "skip"
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

interface ResolverFilterSpec {
  field: string
  op: ResolverFilterOp
  value?: PrimitiveValue | PrimitiveValue[]
  value2?: PrimitiveValue
  rawToken?: string
}

export interface ResolverClarification {
  question: string
  chips: string[]
  askedField?: string | null
}

interface NormalizedResolverResult {
  filters: ResolverFilterSpec[]
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
  | "session_truth_conflict"
  | "domain_lock_risk"
  | "noop_result"

export interface ResolverValidationIssue {
  code: ResolverValidationIssueCode
  severity: "warning" | "error"
  field?: string | null
  detail: string
  escalation: "weak_cot" | "strong_cot" | "clarification"
}

export interface ResolverValidationSummary {
  valid: boolean
  escalation: "none" | "weak_cot" | "strong_cot" | "clarification"
  issues: ResolverValidationIssue[]
}

export interface MultiStageResolverResult {
  source: "none" | "stage1" | "cache" | "stage2" | "stage3" | "clarification"
  filters: AppliedFilter[]
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
  pendingField?: string | null
  stageOneEditIntent?: EditIntentResult | null
  stageOneDeterministicActions?: DeterministicAction[]
  stageOneSort?: QuerySort | null
  stageOneClearUnmentionedFields?: boolean
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

const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 7 * DAY_MS
const VERIFIED_CACHE_TTL_MS = 30 * DAY_MS
const FAILURE_TTL_MS = DAY_MS
const STAGE2_TIMEOUT_MS = 3000
const STAGE3_TIMEOUT_MS = 12000
const STAGE2_CONFIDENCE_THRESHOLD = 0.7
const SCHEMA_HINT_PHONETIC_THRESHOLD = 0.88
const STAGE1_COT_BROAD_CANDIDATE_THRESHOLD = 5000
const STAGE1_COT_TOKEN_LIMIT = 8
const STAGE1_SKIP_CUE_RE = /(아무거나|상관\s*없|뭐든|다\s*괜찮|무관)/giu
const STAGE1_SORT_CUE_RE = /(제일|가장|젤|맨|최대한|긴걸로|짧은걸로|긴|짧은|큰|작은|많은|적은|높은|낮은|두꺼운|얇은)/giu

const NEGATION_CUE_RE = /(?:말고|빼고|제외|아니고|아니라|아닌\s*거|아닌거|아닌\b|except|without|exclude|not\b)/iu
const ALTERNATIVE_CUE_RE = /(?:다른\s*거|다른거|대신|instead|alternative|더\s*무난한|덜\s*공격적인|비슷한데?\s*더)/iu
const RANGE_GTE_CUE_RE = /(?:이상|초과|at\s*least|greater\s*than|over|>=)/iu
const RANGE_LTE_CUE_RE = /(?:이하|미만|at\s*most|less\s*than|under|below|<=)/iu

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

function computeCacheKey(message: string, pendingField?: string | null): string {
  const normalizedMessage = message.trim().toLowerCase().replace(/\s+/g, " ")
  const normalizedPending = pendingField?.trim().toLowerCase() ?? ""
  return normalizedPending ? `${normalizedMessage}::pending=${normalizedPending}` : normalizedMessage
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
      shouldExecuteEditIntentDeterministically(args.stageOneEditIntent)
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
  STAGE1_SKIP_CUE_RE.lastIndex = 0
  return STAGE1_SKIP_CUE_RE.test(message)
}

function hasRangeCue(message: string): { gte: boolean; lte: boolean } {
  return {
    gte: RANGE_GTE_CUE_RE.test(message),
    lte: RANGE_LTE_CUE_RE.test(message),
  }
}

function hasExplicitMutationCue(message: string): boolean {
  return hasEditSignal(message) || needsRepair(message) || hasNegationCue(message) || hasAlternativeCue(message)
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

function buildValidationIssue(
  code: ResolverValidationIssueCode,
  detail: string,
  escalation: ResolverValidationIssue["escalation"],
  field?: string | null,
  severity: ResolverValidationIssue["severity"] = "error",
): ResolverValidationIssue {
  return { code, detail, escalation, field, severity }
}

function buildValidationSummary(issues: ResolverValidationIssue[]): ResolverValidationSummary {
  if (issues.length === 0) {
    return {
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
    valid: !issues.some(issue => issue.severity === "error"),
    escalation,
    issues,
  }
}

type ValidationClause = {
  raw: string
  normalized: string
  negative: boolean
}

function buildValidationClauses(message: string): ValidationClause[] {
  return message
    .split(/\s*(?:,|그리고|하고|인데|but|;|\n)\s*/iu)
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
  const clauses = buildValidationClauses(message)
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
  const currentFilters = normalizeFiltersForValidation(args.currentFilters, args.turnCount)
  const currentByField = buildLatestFilterMap(currentFilters)
  const issues: ResolverValidationIssue[] = []
  const explicitMutation = hasExplicitMutationCue(args.message)

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

  const normalizedFilters: AppliedFilter[] = []
  for (const filter of normalizeFiltersForValidation(result.filters, args.turnCount)) {
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
  const effectiveByField = buildLatestFilterMap(effectiveFilters)
  const negationCue = hasNegationCue(args.message)
  const alternativeCue = hasAlternativeCue(args.message)
  const rangeCue = hasRangeCue(args.message)

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

  for (const filter of normalizedFilters) {
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

  const validation = buildValidationSummary(issues)
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

  const hasStructuralBaseMeaning =
    base.filters.length > 0
    || !!base.sort
    || base.routeHint !== "none"
    || base.clearOtherFilters
    || base.removeFields.length > 0
    || !!base.followUpFilter
  const overlayIsClarificationOnly =
    !!overlay.clarification
    && overlay.filters.length === 0
    && !overlay.sort
    && overlay.routeHint === "none"
    && !overlay.clearOtherFilters
    && overlay.removeFields.length === 0
    && !overlay.followUpFilter
    && (overlay.intent === "ask_clarification" || overlay.intent === "none")

  if (hasStructuralBaseMeaning && overlayIsClarificationOnly) {
    return {
      ...base,
      unresolvedTokens: overlay.unresolvedTokens.length > 0 ? overlay.unresolvedTokens : base.unresolvedTokens,
      reasoning: [base.reasoning, overlay.reasoning].filter(Boolean).join(" + "),
      validation: overlay.validation ?? base.validation ?? null,
    }
  }

  const removeFields = uniqueStrings([...base.removeFields, ...overlay.removeFields])
  const baseFilters = base.filters.filter(filter => !removeFields.includes(filter.field))

  return {
    source: overlay.source,
    filters: mergeAppliedFilters(baseFilters, overlay.filters),
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

  return {
    ...result,
    clearOtherFilters: result.clearOtherFilters && releasableFields.size > 0,
    removeFields: result.removeFields.filter(field => releasableFields.has(field)),
  }
}

export function resolverProducedMeaningfulOutput(result: MultiStageResolverResult): boolean {
  return result.source !== "none" && !isIntentOnlyRoutingSignal(result) && (
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
  if (shouldExecuteEditIntentDeterministically(args.stageOneEditIntent)) return []
  return expandSemanticHintTokens(getEditIntentHintTokens(args.stageOneEditIntent))
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
  const parts: string[] = []

  if (args.stageOneEditIntent && !shouldExecuteEditIntentDeterministically(args.stageOneEditIntent)) {
    const affectedFields = getEditIntentAffectedFields(args.stageOneEditIntent)
    const hintTokens = getEditIntentHintTokens(args.stageOneEditIntent)

    parts.push([
      `edit.intent=${args.stageOneEditIntent.intent.type}`,
      affectedFields.length > 0 ? `fields=${affectedFields.join(", ")}` : null,
      hintTokens.length > 0 ? `tokens=${hintTokens.join(", ")}` : null,
      `reason=${args.stageOneEditIntent.reason}`,
    ].filter((entry): entry is string => Boolean(entry)).join(" | "))
  }

  const deterministicHints = uniqueStrings(
    (args.stageOneDeterministicActions ?? [])
      .filter(action => action.type === "apply_filter" && action.field && action.value != null)
      .map(action => {
        const upper = action.op === "between" && action.value2 != null
          ? `${String(action.value)}..${String(action.value2)}`
          : String(action.value)
        return `${action.field} ${action.op ?? "eq"} ${upper}`
      }),
  )
  if (deterministicHints.length > 0) {
    parts.push(`det.candidates=${deterministicHints.join("; ")}`)
  }

  if (args.stageOneClearUnmentionedFields) {
    parts.push("global_relaxation=true")
  }

  return parts.length > 0 ? parts.join(" || ") : "none"
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

function hasShowRecommendationSignal(message: string): boolean {
  return /(추천\s*(해줘|해주|좀)?|보여줘|찾아줘|알려줘|골라줘|제품\s*(보|줘)|show)/iu.test(message)
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

  const filters = normalizeFilterSpecs(objectPayload.filters, pendingField)
  const sort = normalizeSort(objectPayload.sort)
  const routeHint = normalizeRouteHint(objectPayload.routeHint)
  const intent = normalizeIntent(objectPayload.intent) !== "none"
    ? normalizeIntent(objectPayload.intent)
    : inferIntentFromRouteHint(routeHint, message, filters.length > 0, Boolean(sort))
  const clearOtherFilters = objectPayload.clearOtherFilters === true
  const removeFields = Array.isArray(objectPayload.removeFields)
    ? uniqueStrings(objectPayload.removeFields.map(field => resolveFilterField(field)).filter((field): field is string => Boolean(field)))
    : []
  const confidence = clampConfidence(objectPayload.confidence, filters.length > 0 || sort ? 0.8 : 0)
  const unresolvedTokens = Array.isArray(objectPayload.unresolvedTokens)
    ? uniqueStrings(objectPayload.unresolvedTokens.map(token => String(token ?? "").trim()))
    : []
  const reasoning = typeof objectPayload.reasoning === "string" ? objectPayload.reasoning.trim() : ""

  return {
    filters,
    sort,
    routeHint,
    intent,
    clearOtherFilters,
    removeFields,
    confidence,
    unresolvedTokens,
    reasoning,
    clarification: null,
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

  return buildAppliedFilterFromValue(
    targetField,
    rawValue,
    turnCount,
    spec.op === "eq" ? undefined : spec.op,
  )
}

function materializeResult(
  source: MultiStageResolverResult["source"],
  normalized: NormalizedResolverResult,
  turnCount: number,
): MultiStageResolverResult {
  return {
    source,
    filters: normalized.filters
      .map(filter => buildFilterFromSpec(filter, turnCount))
      .filter((filter): filter is AppliedFilter => filter != null),
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
  return Boolean(result)
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
      result.filters.length > 0
      || !!result.sort
      || result.intent !== "none"
      || result.clearOtherFilters
      || result.removeFields.length > 0
      || !!result.clarification
      || result.routeHint !== "none"
    )
}

function buildClarificationResult(
  args: ResolveMultiStageQueryArgs,
  unresolvedTokens: string[],
): MultiStageResolverResult {
  const pendingField = args.pendingField ?? args.sessionState?.lastAskedField ?? null
  const isBareRecommendation =
    !pendingField
    && args.currentFilters.length === 0
    && isBareRecommendationMessage(args.message)
  const pendingLabel = pendingField ? getFilterFieldLabel(pendingField) : null
  const unresolvedLabel = unresolvedTokens.length > 0 ? unresolvedTokens.slice(0, 3).join(", ") : "현재 표현"
  const question = isBareRecommendation
    ? "어떤 소재를 가공하시나요?"
    : pendingLabel
    ? `${pendingLabel} 조건을 어떻게 처리할지 더 구체적으로 알려주세요.`
    : `입력하신 표현(${unresolvedLabel})의 의미를 정확히 반영하려면 어떤 조건인지 조금만 더 구체적으로 알려주세요.`
  const chips = isBareRecommendation
    ? ["스테인리스", "알루미늄", "탄소강", "직접 입력"]
    : pendingLabel
    ? [`${pendingLabel} 상관없음`, "추천 제품 보기", "직접 입력"]
    : ["추천 제품 보기", "직접 입력", "처음부터 다시"]

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
    unresolvedTokens,
    reasoning: pendingField
      ? `clarification:${pendingField}`
      : isBareRecommendation
      ? "clarification:workPieceName"
      : `clarification:${unresolvedTokens.join("|") || "generic"}`,
    clarification: {
      question,
      chips,
      askedField: pendingField ?? (isBareRecommendation ? "workPieceName" : null),
    },
  }
}

function buildEmptyResult(reasoning = ""): MultiStageResolverResult {
  return {
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
    reasoning,
    clarification: null,
  }
}

function buildStageOneAnalysis(args: ResolveMultiStageQueryArgs): StageOneBuildAnalysis {
  const editIntentResult = args.stageOneEditIntent ?? null
  const editIntent = editIntentResult?.intent ?? null
  const executeStageOneEdit = shouldExecuteEditIntentDeterministically(editIntentResult)
  const filterSpecs: ResolverFilterSpec[] = []
  const removeFields = new Set<string>()
  let followUpFilter: AppliedFilter | null = null
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
          filters: [],
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
      case "go_back_then_apply": {
        const mutation = applyEditIntent(editIntent, args.currentFilters, args.turnCount)
        return finalize({
          source: "stage1",
          filters: [],
          sort: null,
          routeHint: "none",
          intent: "go_back_one_step",
          clearOtherFilters: false,
          removeFields: [],
          followUpFilter: mutation.addFilter,
          confidence: args.stageOneEditIntent?.confidence ?? 0.93,
          unresolvedTokens: [],
          reasoning: `stage1:${args.stageOneEditIntent?.reason ?? "go_back_then_apply"}`,
          clarification: null,
        })
      }
      case "skip_field":
        removeFields.add(editIntent.field)
        filterSpecs.push({ field: editIntent.field, op: "skip" })
        reasoning = `stage1:${args.stageOneEditIntent?.reason ?? `skip ${editIntent.field}`}`
        break
      case "clear_field":
        removeFields.add(editIntent.field)
        reasoning = `stage1:${args.stageOneEditIntent?.reason ?? `clear ${editIntent.field}`}`
        break
      case "replace_field":
        reasoning = `stage1:${args.stageOneEditIntent?.reason ?? `replace ${editIntent.field}`}`
        break
      case "exclude_field":
        reasoning = `stage1:${args.stageOneEditIntent?.reason ?? `exclude ${editIntent.field}`}`
        break
    }
  } else if (editIntentResult) {
    reasoning = `stage1:hint:${editIntentResult.reason}`
  }

  const filters = filterSpecs
    .map(spec => buildFilterFromSpec(spec, args.turnCount))
    .filter((filter): filter is AppliedFilter => filter != null)

  const hasStageOneResolution =
    filters.length > 0
    || !!args.stageOneSort
    || removeFields.size > 0
    || intent !== "none"

  if (!hasStageOneResolution) return finalize(null)

  if (intent === "none") {
    intent = inferIntentFromRouteHint(
      "none",
      args.message,
      filters.length > 0 || removeFields.size > 0,
      Boolean(args.stageOneSort),
    )
  }

  return finalize({
    source: "stage1",
    filters,
    sort: args.stageOneSort ?? null,
    routeHint: intent === "show_recommendation" ? "show_recommendation" : "none",
    intent,
    clearOtherFilters: false,
    removeFields: Array.from(removeFields),
    followUpFilter,
    confidence: args.stageOneEditIntent?.confidence ?? (filters.length > 0 || args.stageOneSort ? 0.95 : 0.85),
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
  const shouldShortCircuit = Boolean(stage1Result) && (
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
    args.currentFilters.length > 0
    && (needsRepair(args.message) || hasEditSignal(args.message))
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

Rules:
- Extract every filter you can map safely.
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
- Treat Stage 1 semantic hints as candidates only. Validate them against the full sentence, current filters, and allowed operators before using them.
- Never invent a field, operator, column, or canonical value outside the field catalog and domain dictionary.
- Do not guess. Keep unresolved tokens instead.
- Return JSON only.

Examples:
{"filters":[{"field":"brand","op":"skip","rawToken":"노상관"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.92,"unresolvedTokens":[],"reasoning":"brand indifference"}
{"filters":[{"field":"coating","op":"skip","rawToken":"아무래도 좋은데"},{"field":"fluteCount","op":"eq","value":4,"rawToken":"4날"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.88,"unresolvedTokens":[],"reasoning":"skip coating and keep flute"}
{"filters":[{"field":"brand","op":"eq","value":"CRX S","rawToken":"크렉스에스"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"phonetic brand"}
{"filters":[{"field":"totalStock","op":"gte","value":100,"rawToken":"재고 100개 이상"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"numeric inventory threshold"}
{"filters":[],"sort":{"field":"lengthOfCutMm","direction":"desc"},"routeHint":"show_recommendation","clearOtherFilters":false,"confidence":0.95,"unresolvedTokens":[],"reasoning":"superlative sort"}
{"filters":[],"sort":null,"routeHint":"ui_question","clearOtherFilters":false,"confidence":0.94,"unresolvedTokens":[],"reasoning":"UI label question"}
{"filters":[],"sort":null,"routeHint":"compare_products","clearOtherFilters":false,"confidence":0.93,"unresolvedTokens":["GMI4710055"],"reasoning":"similar product request around a specific item"}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Stage 1 semantic hints: ${semanticHintSummary}`,
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

Decision process:
1. Classify the user intent: filter, sort, comparison, UI question, side question, or mixed.
2. Analyze the unresolved tokens: Korean pronunciation, slang, misspacing, shorthand, superlative, indifference, UI vocabulary.
3. Use any schema phonetic hints only when they clearly fit the user's meaning.
4. Map only high-confidence items to DB fields or routeHint. Similar-product requests around a concrete item should use routeHint=compare_products even when the code stays unresolved.
5. Keep operator attachment local to each clause. "2 flutes and not square" must stay fluteCount eq 2 and toolSubtype neq Square.
6. Treat Stage 1 semantic hints as candidate intent only. Do not copy them unless the full utterance supports them.
7. If all other existing filters should be released, set clearOtherFilters=true.
8. If unsure, leave filters empty and keep unresolvedTokens.
9. Never invent a field, operator, column, or canonical value outside the field catalog and domain dictionary.

Return JSON:
{"filters":[],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.0,"unresolvedTokens":[],"reasoning":""}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Complexity: ${args.complexity?.level ?? "unknown"} (${args.complexity?.reason ?? "n/a"})`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Stage 1 semantic hints: ${semanticHintSummary}`,
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
  if (stage2Validation && !stage2Validation.valid) return true
  if (stage2Validation?.escalation === "strong_cot" || stage2Validation?.escalation === "clarification") return true
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
  const stage1ForceCotFromValidation =
    args.stage1CotEscalation?.enabled === true
    && stage1Validation?.escalation !== "none"
  const stage1GateReasons = uniqueStrings([...stage1GateBase.reasons, ...stage1ValidationReasons])
  const effectiveUnresolvedTokens = stage1GateReasons.length > 0 && stage1GateBase.effectiveUnresolvedTokens.length === 0
    ? synthesizeStage1ReplayTokens(args.message, stage1ResolvedTokens)
    : stage1GateBase.effectiveUnresolvedTokens
  const stage1Gate = {
    ...stage1GateBase,
    forceCot: stage1GateBase.forceCot || stage1ForceCotFromValidation,
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
    if (!pendingField && args.currentFilters.length === 0 && isBareRecommendationMessage(args.message)) {
      return buildEmptyResult("defer:bare_recommendation")
    }
    return buildClarificationResult(args, [])
  }

  const cacheKey = computeCacheKey(args.message, args.pendingField ?? args.sessionState?.lastAskedField ?? null)
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
    ? validateResolverExecution(
      args,
      mergeMultiStageResults(stage1Result, materializeResult("stage2", stage2Result, args.turnCount)),
      "stage2",
    )
    : null
  const validatedStage2Result = stage2ValidationResult?.result ?? null
  const stage2Validation = stage2ValidationResult?.validation ?? null

  if (
    hasMeaningfulResolution(stage2Result)
    && Boolean(validatedStage2Result)
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
      ? validateResolverExecution(
        args,
        mergeMultiStageResults(stage2Base, materializeResult("stage3", stage3Result, args.turnCount)),
        "stage3",
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
      return {
        ...mergeMultiStageResults(stage2Base, buildClarificationResult(args, effectiveUnresolvedTokens)),
        validation: stage3ValidationResult.validation,
      }
    }
  }

  if (validatedStage2Result && resolverProducedMeaningfulOutput(validatedStage2Result)) {
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
      ...mergeMultiStageResults(stage1Result, buildClarificationResult(args, effectiveUnresolvedTokens)),
      validation: stage2Validation,
    }
  }

  recordResolverFailure(cacheKey)
  if (stage1Gate.forceCot) {
    return buildDeferredCotResult(
      `defer:stage1_cot:${stage1Gate.reasons.join("|") || "forced"}`,
      effectiveUnresolvedTokens,
    )
  }
  return mergeMultiStageResults(stage1Result, buildClarificationResult(args, effectiveUnresolvedTokens))
}

export function _resetMultiStageResolverCacheForTest(): void {
  resolverCache.clear()
  failureCache.clear()
}
