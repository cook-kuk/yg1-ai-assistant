import { getProviderForAgent, type LLMProvider } from "@/lib/llm/provider"
import type { AppliedFilter, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue, getFilterFieldLabel, getFilterFieldQueryAliases, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { stripKoreanParticles } from "@/lib/recommendation/shared/patterns"
import type { ComplexityDecision } from "./complexity-router"
import type { DeterministicAction } from "./deterministic-scr"
import type { EditIntentResult } from "./edit-intent"
import type { QueryField, QuerySort } from "./query-spec"
import { getSortableFields, QUERY_FIELD_MANIFEST } from "./query-spec-manifest"
import { getDbSchemaSync } from "./sql-agent-schema-cache"
import { tokenize } from "./auto-synonym"

type ResolverFilterOp = "eq" | "neq" | "gte" | "lte" | "between" | "skip"
type ResolverRouteHint =
  | "none"
  | "ui_question"
  | "general_question"
  | "show_recommendation"
  | "compare_products"

type PrimitiveValue = string | number | boolean

interface ResolverFilterSpec {
  field: string
  op: ResolverFilterOp
  value?: PrimitiveValue | PrimitiveValue[]
  value2?: PrimitiveValue
  rawToken?: string
}

interface NormalizedResolverResult {
  filters: ResolverFilterSpec[]
  sort: QuerySort | null
  routeHint: ResolverRouteHint
  clearOtherFilters: boolean
  confidence: number
  unresolvedTokens: string[]
  reasoning: string
}

export interface MultiStageResolverResult {
  source: "none" | "cache" | "stage2" | "stage3"
  filters: AppliedFilter[]
  sort: QuerySort | null
  routeHint: ResolverRouteHint
  clearOtherFilters: boolean
  confidence: number
  unresolvedTokens: string[]
  reasoning: string
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

const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 7 * DAY_MS
const VERIFIED_CACHE_TTL_MS = 30 * DAY_MS
const FAILURE_TTL_MS = DAY_MS
const STAGE2_TIMEOUT_MS = 3000
const STAGE3_TIMEOUT_MS = 12000
const STAGE2_CONFIDENCE_THRESHOLD = 0.7

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
    clearOtherFilters: result.clearOtherFilters,
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

  for (const { normalized } of fieldAliasIndex) known.add(normalized)

  for (const action of stageOneDeterministicActions ?? []) {
    const fieldNormalized = normalizeToken(action.field ?? "")
    if (fieldNormalized) known.add(fieldNormalized)
    for (const token of tokenize(String(action.value ?? ""))) {
      const normalized = normalizeToken(token)
      if (normalized) known.add(normalized)
    }
    for (const token of tokenize(String(action.value2 ?? ""))) {
      const normalized = normalizeToken(token)
      if (normalized) known.add(normalized)
    }
  }

  if (stageOneEditIntent?.intent.type === "skip_field" || stageOneEditIntent?.intent.type === "clear_field") {
    const normalized = normalizeToken(stageOneEditIntent.intent.field)
    if (normalized) known.add(normalized)
  }

  if (stageOneSort) {
    for (const token of tokenize(stageOneSort.field)) {
      const normalized = normalizeToken(token)
      if (normalized) known.add(normalized)
    }
  }

  return known
}

function extractUnresolvedTokens(args: ResolveMultiStageQueryArgs): string[] {
  const known = extractKnownTokens(
    args.message,
    args.stageOneEditIntent,
    args.stageOneDeterministicActions,
    args.stageOneSort,
  )

  const rawTokens = Array.from(tokenize(args.message))
    .map(token => normalizeToken(token))
    .filter(token => token.length >= 2)
    .filter(token => !/^\d+(?:\.\d+)?$/.test(token))

  return uniqueStrings(
    rawTokens.filter(token => !known.has(token) && !STOPWORD_TOKENS.has(token))
  )
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
    const resolvedField = resolveFilterField(record.field) ?? (op === "skip" ? pendingField ?? null : null)
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
  const clearOtherFilters = objectPayload.clearOtherFilters === true
  const confidence = clampConfidence(objectPayload.confidence, filters.length > 0 || sort ? 0.8 : 0)
  const unresolvedTokens = Array.isArray(objectPayload.unresolvedTokens)
    ? uniqueStrings(objectPayload.unresolvedTokens.map(token => String(token ?? "").trim()))
    : []
  const reasoning = typeof objectPayload.reasoning === "string" ? objectPayload.reasoning.trim() : ""

  return {
    filters,
    sort,
    routeHint,
    clearOtherFilters,
    confidence,
    unresolvedTokens,
    reasoning,
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

  return buildAppliedFilterFromValue(
    spec.field,
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
    clearOtherFilters: normalized.clearOtherFilters,
    confidence: normalized.confidence,
    unresolvedTokens: normalized.unresolvedTokens,
    reasoning: normalized.reasoning,
  }
}

function hasMeaningfulResolution(result: NormalizedResolverResult | null): result is NormalizedResolverResult {
  return Boolean(result)
    && (
      result.filters.length > 0
      || !!result.sort
      || result.clearOtherFilters
      || result.routeHint !== "none"
    )
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
- clearOtherFilters=true only when the user says everything else is okay / all other conditions can be dropped.
- routeHint:
  - ui_question: screen labels or UI statuses such as Excellent / Good / 정확매칭
  - general_question: explanatory question, concept question, or tool-domain side question
  - show_recommendation: user explicitly wants results now
  - compare_products: explicit comparison request
  - none: otherwise
- If pendingField is set and the user is clearly dismissing that field, use it.
- Do not guess. Keep unresolved tokens instead.
- Return JSON only.

Examples:
{"filters":[{"field":"brand","op":"skip","rawToken":"노상관"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.92,"unresolvedTokens":[],"reasoning":"brand indifference"}
{"filters":[{"field":"coating","op":"skip","rawToken":"아무래도 좋은데"},{"field":"fluteCount","op":"eq","value":4,"rawToken":"4날"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.88,"unresolvedTokens":[],"reasoning":"skip coating and keep flute"}
{"filters":[{"field":"brand","op":"eq","value":"CRX S","rawToken":"크렉스에스"}],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.9,"unresolvedTokens":[],"reasoning":"phonetic brand"}
{"filters":[],"sort":{"field":"lengthOfCutMm","direction":"desc"},"routeHint":"show_recommendation","clearOtherFilters":false,"confidence":0.95,"unresolvedTokens":[],"reasoning":"superlative sort"}
{"filters":[],"sort":null,"routeHint":"ui_question","clearOtherFilters":false,"confidence":0.94,"unresolvedTokens":[],"reasoning":"UI label question"}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Respond with JSON only.`,
  ].join("\n")

  return { systemPrompt, userPrompt }
}

function buildStage3Prompt(args: ResolveMultiStageQueryArgs, unresolvedTokens: string[], stage2Result: NormalizedResolverResult | null): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are the Stage 3 deep reasoning resolver for the YG-1 cutting tool recommendation system.
Stage 1 and Stage 2 were not sufficient. Think step by step internally, then return JSON only.

Field catalog:
${buildFieldGuide()}

Schema samples:
${buildSchemaContext()}

Decision process:
1. Classify the user intent: filter, sort, comparison, UI question, side question, or mixed.
2. Analyze the unresolved tokens: Korean pronunciation, slang, misspacing, shorthand, superlative, indifference, UI vocabulary.
3. Map only high-confidence items to DB fields or routeHint.
4. If all other existing filters should be released, set clearOtherFilters=true.
5. If unsure, leave filters empty and keep unresolvedTokens.

Return JSON:
{"filters":[],"sort":null,"routeHint":"none","clearOtherFilters":false,"confidence":0.0,"unresolvedTokens":[],"reasoning":""}`

  const userPrompt = [
    `User message: ${args.message}`,
    `Pending field: ${args.pendingField ?? args.sessionState?.lastAskedField ?? "none"}`,
    `Current filters: ${buildCurrentFilterSummary(args.currentFilters)}`,
    `Complexity: ${args.complexity?.level ?? "unknown"} (${args.complexity?.reason ?? "n/a"})`,
    `Stage 1 unresolved tokens: ${unresolvedTokens.join(", ") || "none"}`,
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
): Promise<NormalizedResolverResult | null> {
  const provider = stage === "stage2"
    ? (args.stage2Provider ?? getProviderForAgent("parameter-extractor"))
    : (args.stage3Provider ?? getProviderForAgent("semantic-turn-extractor"))

  if (!provider?.available()) return null

  const { systemPrompt, userPrompt } = stage === "stage2"
    ? buildStage2Prompt(args, unresolvedTokens)
    : buildStage3Prompt(args, unresolvedTokens, stage2Result ?? null)

  try {
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
    if (!response) return null
    return normalizeResolverPayload(extractJsonObject(response), args.pendingField ?? args.sessionState?.lastAskedField ?? null)
  } catch {
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
  const unresolvedTokens = extractUnresolvedTokens(args)
  if (unresolvedTokens.length === 0) {
    return {
      source: "none",
      filters: [],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0,
      unresolvedTokens: [],
      reasoning: "",
    }
  }

  const cacheKey = computeCacheKey(args.message, args.pendingField ?? args.sessionState?.lastAskedField ?? null)
  const cached = lookupResolverCache(cacheKey)
  if (cached) {
    return materializeResult("cache", cached, args.turnCount)
  }

  const failureCount = getResolverFailureCount(cacheKey)
  const stage2Result = await runResolverStage("stage2", args, unresolvedTokens)

  if (
    hasMeaningfulResolution(stage2Result)
    && stage2Result.confidence >= STAGE2_CONFIDENCE_THRESHOLD
    && stage2Result.unresolvedTokens.length === 0
    && !shouldEscalateToStage3(args, unresolvedTokens, stage2Result, failureCount)
  ) {
    clearResolverFailure(cacheKey)
    storeResolverCache(cacheKey, stage2Result)
    return materializeResult("stage2", stage2Result, args.turnCount)
  }

  const stage3Needed = shouldEscalateToStage3(args, unresolvedTokens, stage2Result, failureCount)
  if (stage3Needed) {
    const stage3Result = await runResolverStage("stage3", args, unresolvedTokens, stage2Result)
    if (hasMeaningfulResolution(stage3Result)) {
      clearResolverFailure(cacheKey)
      storeResolverCache(cacheKey, stage3Result)
      return materializeResult("stage3", stage3Result, args.turnCount)
    }
  }

  if (hasMeaningfulResolution(stage2Result)) {
    clearResolverFailure(cacheKey)
    storeResolverCache(cacheKey, stage2Result)
    return materializeResult("stage2", stage2Result, args.turnCount)
  }

  recordResolverFailure(cacheKey)
  return {
    source: "none",
    filters: [],
    sort: null,
    routeHint: "none",
    clearOtherFilters: false,
    confidence: stage2Result?.confidence ?? 0,
    unresolvedTokens,
    reasoning: stage2Result?.reasoning ?? "",
  }
}

export function _resetMultiStageResolverCacheForTest(): void {
  resolverCache.clear()
  failureCache.clear()
}
