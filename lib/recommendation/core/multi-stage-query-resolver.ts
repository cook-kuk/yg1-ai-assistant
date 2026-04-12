import { getProviderForAgent, type LLMProvider } from "@/lib/llm/provider"
import type { AppliedFilter, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue, getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { stripKoreanParticles } from "@/lib/recommendation/shared/patterns"
import type { ComplexityDecision } from "./complexity-router"
import type { DeterministicAction } from "./deterministic-scr"
import { applyEditIntent, type EditIntentResult } from "./edit-intent"
import type { QueryField, QuerySort } from "./query-spec"
import { getSortableFields, QUERY_FIELD_MANIFEST } from "./query-spec-manifest"
import { findValueByPhonetic, getDbSchemaSync } from "./sql-agent-schema-cache"
import { tokenize } from "./auto-synonym"

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

const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 7 * DAY_MS
const VERIFIED_CACHE_TTL_MS = 30 * DAY_MS
const FAILURE_TTL_MS = DAY_MS
const STAGE2_TIMEOUT_MS = 3000
const STAGE3_TIMEOUT_MS = 12000
const STAGE2_CONFIDENCE_THRESHOLD = 0.7
const SCHEMA_HINT_PHONETIC_THRESHOLD = 0.88
const STAGE1_SKIP_CUE_RE = /(아무거나|상관\s*없|뭐든|다\s*괜찮|무관)/giu
const STAGE1_SORT_CUE_RE = /(제일|가장|젤|맨|최대한|긴걸로|짧은걸로|긴|짧은|큰|작은|많은|적은|높은|낮은|두꺼운|얇은)/giu

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
  stageOneDeterministicActions?: DeterministicAction[],
  stageOneSort?: QuerySort | null,
): Set<string> {
  const known = new Set<string>()

  for (const action of stageOneDeterministicActions ?? []) {
    for (const alias of [action.field ?? "", ...getFilterFieldQueryAliases(action.field ?? "")]) {
      for (const token of tokenize(alias)) {
        const normalized = normalizeToken(token)
        if (normalized) known.add(normalized)
      }
    }
    for (const token of tokenize(String(action.value ?? ""))) {
      const normalized = normalizeToken(token)
      if (normalized) known.add(normalized)
    }
    for (const token of tokenize(String(action.value2 ?? ""))) {
      const normalized = normalizeToken(token)
      if (normalized) known.add(normalized)
    }
  }

  if (stageOneEditIntent) {
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
  if (args.stageOneEditIntent) resolvedBy.push("edit-intent")
  if ((args.stageOneDeterministicActions?.length ?? 0) > 0) resolvedBy.push("det-scr")
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

function extractUnresolvedTokens(args: ResolveMultiStageQueryArgs): string[] {
  const known = extendKnownTokensWithStageOneCues(args, extractKnownTokens(
    args.message,
    args.stageOneEditIntent,
    args.stageOneDeterministicActions,
    args.stageOneSort,
  ))

  return uniqueStrings(
    extractRawTokens(args.message).filter(token => !tokenMatchesKnown(token, known) && !STOPWORD_TOKENS.has(token))
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

function buildStageOneResult(args: ResolveMultiStageQueryArgs): MultiStageResolverResult | null {
  const editIntent = args.stageOneEditIntent?.intent ?? null
  const clearUnmentioned = args.stageOneClearUnmentionedFields === true
  const rawActions = args.stageOneDeterministicActions ?? []
  const effectiveActions =
    editIntent?.type === "skip_field"
      ? rawActions.filter(action => action.field !== editIntent.field)
      : rawActions
  const filterSpecs: ResolverFilterSpec[] = []
  const removeFields = new Set<string>()
  let followUpFilter: AppliedFilter | null = null
  let intent: ResolverIntent = "none"
  let reasoning = "stage1"

  if (editIntent) {
    switch (editIntent.type) {
      case "reset_all":
        return {
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
        }
      case "go_back_then_apply": {
        const mutation = applyEditIntent(editIntent, args.currentFilters, args.turnCount)
        return {
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
        }
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
        removeFields.add(editIntent.field)
        filterSpecs.push({ field: editIntent.field, op: "eq", value: editIntent.newValue })
        reasoning = `stage1:${args.stageOneEditIntent?.reason ?? `replace ${editIntent.field}`}`
        break
      case "exclude_field":
        filterSpecs.push({ field: editIntent.field, op: "neq", value: editIntent.value })
        reasoning = `stage1:${args.stageOneEditIntent?.reason ?? `exclude ${editIntent.field}`}`
        break
    }
  }

  for (const action of effectiveActions) {
    if (action.type !== "apply_filter" || !action.field || action.value == null) continue
    filterSpecs.push({
      field: action.field,
      op: action.op ?? "eq",
      value: action.value as PrimitiveValue | PrimitiveValue[],
      value2: action.value2 as PrimitiveValue | undefined,
      rawToken: typeof action.source === "string" ? action.source : undefined,
    })
  }

  const filters = filterSpecs
    .map(spec => buildFilterFromSpec(spec, args.turnCount))
    .filter((filter): filter is AppliedFilter => filter != null)

  const hasStageOneResolution =
    filters.length > 0
    || !!args.stageOneSort
    || clearUnmentioned
    || removeFields.size > 0
    || intent !== "none"

  if (!hasStageOneResolution) return null

  if (intent === "none") {
    intent = inferIntentFromRouteHint(
      "none",
      args.message,
      filters.length > 0 || removeFields.size > 0 || clearUnmentioned,
      Boolean(args.stageOneSort),
    )
  }

  return {
    source: "stage1",
    filters,
    sort: args.stageOneSort ?? null,
    routeHint: intent === "show_recommendation" ? "show_recommendation" : "none",
    intent,
    clearOtherFilters: clearUnmentioned,
    removeFields: Array.from(removeFields),
    followUpFilter,
    confidence: args.stageOneEditIntent?.confidence ?? (filters.length > 0 || args.stageOneSort ? 0.95 : 0.85),
    unresolvedTokens: [],
    reasoning,
    clarification: null,
  }
}

function buildFieldGuide(): string {
  return getRegisteredFilterFields()
    .map(field => {
      const aliases = getFilterFieldQueryAliases(field).filter(Boolean).slice(0, 8).join(", ")
      return `- ${field} (${getFilterFieldLabel(field)}): aliases=${aliases}`
    })
    .join("\n")
}

function buildSchemaContext(): string {
  const schema = getDbSchemaSync()
  const lines: string[] = []

  if (Array.isArray(schema.workpieces) && schema.workpieces.length > 0) {
    lines.push(`- workPiece samples: ${schema.workpieces.slice(0, 8).join(", ")}`)
  }
  if (Array.isArray(schema.brands) && schema.brands.length > 0) {
    lines.push(`- brand samples: ${schema.brands.slice(0, 12).join(", ")}`)
  }

  for (const [column, rawValues] of Object.entries(schema.sampleValues ?? {}).slice(0, 20)) {
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

function buildStage2Prompt(args: ResolveMultiStageQueryArgs, unresolvedTokens: string[]): { systemPrompt: string; userPrompt: string } {
  const schemaHints = collectSchemaHints(args.message, unresolvedTokens)
  const systemPrompt = `You are the Stage 2 lightweight resolver for the YG-1 cutting tool recommendation system.
The deterministic parser already handled exact patterns. Resolve only the leftover intent.

Field catalog:
${buildFieldGuide()}

Schema samples:
${buildSchemaContext()}

Rules:
- Extract every filter you can map safely.
- Operators: eq, neq, gte, lte, between, skip.
- skip means the user does not care about a field and the existing restriction should be removed.
- sort means a superlative like "제일 긴", "가장 작은".
- Use stockStatus only for availability states such as instock / outofstock / limited.
- Use totalStock for numeric inventory thresholds such as "재고 100개 이상".
- clearOtherFilters=true only when the user says everything else is okay / all other conditions can be dropped.
- routeHint:
  - ui_question: screen labels or UI statuses such as Excellent / Good / 정확매칭
  - general_question: explanatory question, concept question, or tool-domain side question
  - show_recommendation: user explicitly wants results now
  - compare_products: explicit comparison request
  - none: otherwise
- If pendingField is set and the user is clearly dismissing that field, use it.
- If a schema phonetic hint clearly matches a brand / series / material token in the user message, emit the corresponding filter instead of returning only show_recommendation.
- Do not guess. Keep unresolved tokens instead.
- Return JSON only.

Examples:
{"filters":[{"field":"brand","op":"skip","rawToken":"노상관"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.92,"unresolvedTokens":[],"reasoning":"brand indifference"}
{"filters":[{"field":"coating","op":"skip","rawToken":"아무래도 좋은데"},{"field":"fluteCount","op":"eq","value":4,"rawToken":"4날"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.88,"unresolvedTokens":[],"reasoning":"skip coating and keep flute"}
{"filters":[{"field":"brand","op":"eq","value":"CRX S","rawToken":"크렉스에스"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"phonetic brand"}
{"filters":[{"field":"totalStock","op":"gte","value":100,"rawToken":"재고 100개 이상"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"numeric inventory threshold"}
{"filters":[],"sort":{"field":"lengthOfCutMm","direction":"desc"},"routeHint":"show_recommendation","clearOtherFilters":false,"confidence":0.95,"unresolvedTokens":[],"reasoning":"superlative sort"}
{"filters":[],"sort":null,"routeHint":"ui_question","clearOtherFilters":false,"confidence":0.94,"unresolvedTokens":[],"reasoning":"UI label question"}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Possible schema phonetic hints:\n${formatSchemaHintBlock(schemaHints)}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Respond with JSON only.`,
  ].join("\n")

  return { systemPrompt, userPrompt }
}

function buildStage3Prompt(args: ResolveMultiStageQueryArgs, unresolvedTokens: string[], stage2Result: NormalizedResolverResult | null): { systemPrompt: string; userPrompt: string } {
  const schemaHints = collectSchemaHints(args.message, unresolvedTokens)
  const systemPrompt = `You are the Stage 3 deep reasoning resolver for the YG-1 cutting tool recommendation system.
Stage 1 and Stage 2 were not sufficient. Think step by step internally, then return JSON only.

Field catalog:
${buildFieldGuide()}

Schema samples:
${buildSchemaContext()}

Decision process:
1. Classify the user intent: filter, sort, comparison, UI question, side question, or mixed.
2. Analyze the unresolved tokens: Korean pronunciation, slang, misspacing, shorthand, superlative, indifference, UI vocabulary.
3. Use any schema phonetic hints only when they clearly fit the user's meaning.
4. Map only high-confidence items to DB fields or routeHint.
5. If all other existing filters should be released, set clearOtherFilters=true.
6. If unsure, leave filters empty and keep unresolvedTokens.

Return JSON:
{"filters":[],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.0,"unresolvedTokens":[],"reasoning":""}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Complexity: ${args.complexity?.level ?? "unknown"} (${args.complexity?.reason ?? "n/a"})`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Possible schema phonetic hints:\n${formatSchemaHintBlock(schemaHints)}`,
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
  failureCount: number,
): boolean {
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
  const stage1Result = buildStageOneResult(args)
  const stage1ResolvedTokens = extractStageOneResolvedTokens(args)
  const unresolvedTokens = extractUnresolvedTokens(args)
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

  const shouldShortCircuitStage1 = Boolean(stage1Result) && (
    unresolvedTokens.length === 0
    || stage1Result.filters.some(filter => filter.op === "skip")
    || stage1Result.removeFields.length > 0
    || stage1Result.clearOtherFilters
  )

  if (stage1Result && shouldShortCircuitStage1) {
    return {
      ...stage1Result,
      unresolvedTokens: [],
    }
  }

  if (unresolvedTokens.length === 0) {
    const pendingField = args.pendingField ?? args.sessionState?.lastAskedField ?? null
    if (!pendingField && args.currentFilters.length === 0 && isBareRecommendationMessage(args.message)) {
      return buildEmptyResult("defer:bare_recommendation")
    }
    return buildClarificationResult(args, [])
  }

  const cacheKey = computeCacheKey(args.message, args.pendingField ?? args.sessionState?.lastAskedField ?? null)
  const cached = lookupResolverCache(cacheKey)
  if (cached) {
    const cachedResult = mergeMultiStageResults(stage1Result, materializeResult("cache", cached, args.turnCount))
    console.log("[multi-stage:cache] hit", {
      unresolvedTokens,
      filters: formatAppliedFilters(cachedResult.filters),
      sort: cachedResult.sort,
      intent: cachedResult.intent,
      clarification: cachedResult.clarification,
    })
    return cachedResult
  }

  const failureCount = getResolverFailureCount(cacheKey)
  console.log("[multi-stage:stage2] entry", {
    unresolvedTokens,
    whyEnteringStage2: stage1Result ? "stage1_partial_with_unresolved_tokens" : "stage1_no_resolution",
    stage1ResolvedTokens,
  })
  const stage2Result = await runResolverStage("stage2", args, unresolvedTokens, null, stage1ResolvedTokens)

  if (
    hasMeaningfulResolution(stage2Result)
    && stage2Result.confidence >= STAGE2_CONFIDENCE_THRESHOLD
    && stage2Result.unresolvedTokens.length === 0
    && !shouldEscalateToStage3(args, unresolvedTokens, stage2Result, failureCount)
  ) {
    clearResolverFailure(cacheKey)
    storeResolverCache(cacheKey, stage2Result)
    return mergeMultiStageResults(stage1Result, materializeResult("stage2", stage2Result, args.turnCount))
  }

  const stage3Needed = shouldEscalateToStage3(args, unresolvedTokens, stage2Result, failureCount)
  if (stage3Needed) {
    const stage3Result = await runResolverStage("stage3", args, unresolvedTokens, stage2Result)
    if (hasMeaningfulResolution(stage3Result)) {
      clearResolverFailure(cacheKey)
      storeResolverCache(cacheKey, stage3Result)
      return mergeMultiStageResults(stage1Result, materializeResult("stage3", stage3Result, args.turnCount))
    }
  }

  if (hasMeaningfulResolution(stage2Result)) {
    clearResolverFailure(cacheKey)
    storeResolverCache(cacheKey, stage2Result)
    return mergeMultiStageResults(stage1Result, materializeResult("stage2", stage2Result, args.turnCount))
  }

  recordResolverFailure(cacheKey)
  return mergeMultiStageResults(stage1Result, buildClarificationResult(args, unresolvedTokens))
}

export function _resetMultiStageResolverCacheForTest(): void {
  resolverCache.clear()
  failureCache.clear()
}
