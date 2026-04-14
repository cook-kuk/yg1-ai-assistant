import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { OrchestratorAction } from "@/lib/recommendation/infrastructure/agents/types"
import {
  buildAppliedFilterFromValue,
  getFilterFieldLabel,
  getFilterFieldQueryAliases,
  getRegisteredFilterFields,
} from "@/lib/recommendation/shared/filter-field-registry"
import { getDbSchemaSync } from "@/lib/recommendation/core/sql-agent-schema-cache"
import { DB_COL_TO_FILTER_FIELD } from "@/lib/recommendation/core/sql-agent"
import { PHANTOM_GUARDED_FIELDS, isGroundedCategoricalValue } from "@/lib/recommendation/core/deterministic-scr"
import { SEMANTIC_CONFIG } from "@/lib/recommendation/infrastructure/config/resolver-config"

const SEMANTIC_TURN_MODEL = resolveModel("sonnet", "semantic-turn-extractor")
const MIN_CONFIDENCE = SEMANTIC_CONFIG.minConfidence
const MAX_SEMANTIC_ATTEMPTS = SEMANTIC_CONFIG.maxSemanticAttempts

export type SemanticReplyRoute =
  | "inventory"
  | "product_info"
  | "entity_profile"
  | "brand_reference"
  | "cutting_conditions"
  | "general_chat"

export interface SemanticDirectContext {
  lookupCode: string | null
  entityNames: string[]
  entityFocus: "series" | "brand" | null
  comparisonRequested: boolean | null
  requestedField: string | null
  isoGroup: string | null
  workPieceName: string | null
  hardnessMinHrc: number | null
  hardnessMaxHrc: number | null
}

type SemanticActionType =
  | "continue_narrowing"
  | "skip_field"
  | "show_recommendation"
  | "go_back_one_step"
  | "reset_session"
  | "compare_products"
  | "refine_condition"
  | "filter_by_stock"
  | "answer_general"
  | "none"

interface RawSemanticFilter {
  field?: unknown
  value?: unknown
  op?: unknown
}

const ALLOWED_FILTER_OPS = new Set(["eq", "neq", "gte", "lte", "between", "includes"])
function normalizeFilterOp(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const v = raw.trim().toLowerCase()
  return ALLOWED_FILTER_OPS.has(v) ? v : null
}

interface RawSemanticTurnResult {
  action?: unknown
  filters?: unknown
  compareTargets?: unknown
  refineField?: unknown
  stockFilter?: unknown
  stockThreshold?: unknown
  replyRoute?: unknown
  directContext?: unknown
  confidence?: unknown
  reasoning?: unknown
}

export interface SemanticTurnDecision {
  action: OrchestratorAction
  extraFilters: AppliedFilter[]
  replyRoute: SemanticReplyRoute | null
  directContext: SemanticDirectContext | null
  confidence: number
  reasoning: string
}

interface ValidatedFilterResult {
  filters: AppliedFilter[]
  errors: string[]
}

interface SemanticValidationResult {
  decision: SemanticTurnDecision | null
  errors: string[]
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "")
}

function buildFieldCatalog(): string {
  return getRegisteredFilterFields().map(field => {
    const aliases = getFilterFieldQueryAliases(field)
      .filter(alias => alias !== field)
      .slice(0, 8)
      .join(", ")
    const suffix = aliases ? ` | aliases: ${aliases}` : ""
    return `- ${field} (${getFilterFieldLabel(field)})${suffix}`
  }).join("\n")
}

function resolveFilterField(field: string): string | null {
  const normalized = normalizeKey(field)
  if (!normalized) return null

  for (const candidate of getRegisteredFilterFields()) {
    if (normalizeKey(candidate) === normalized) return candidate

    const aliases = getFilterFieldQueryAliases(candidate)
    if (aliases.some(alias => normalizeKey(alias) === normalized)) {
      return candidate
    }
  }

  return null
}

function sanitizeRawJson(raw: string): string {
  return raw.trim().replace(/```json\n?|\n?```/g, "")
}

function parseJsonObject(raw: string): RawSemanticTurnResult | null {
  try {
    const parsed = JSON.parse(sanitizeRawJson(raw))
    return parsed && typeof parsed === "object" ? parsed as RawSemanticTurnResult : null
  } catch {
    return null
  }
}

function validateReplyRoute(value: unknown): SemanticReplyRoute | null {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return null

  const normalized = raw.toLowerCase()
  switch (normalized) {
    case "inventory":
      return "inventory"
    case "product_info":
      return "product_info"
    case "entity_profile":
      return "entity_profile"
    case "brand_reference":
      return "brand_reference"
    case "cutting_conditions":
      return "cutting_conditions"
    case "general_chat":
      return "general_chat"
    default:
      return null
  }
}

function validateAction(value: unknown): SemanticActionType {
  const raw = typeof value === "string" ? value.trim() : ""
  switch (raw) {
    case "continue_narrowing":
    case "skip_field":
    case "show_recommendation":
    case "go_back_one_step":
    case "reset_session":
    case "compare_products":
    case "refine_condition":
    case "filter_by_stock":
    case "answer_general":
      return raw
    default:
      return "none"
  }
}

function validateRefineField(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : ""
  switch (raw) {
    case "material":
    case "소재":
    case "재질":
      return "material"
    case "diameter":
    case "diametermm":
    case "직경":
    case "지름":
      return "diameter"
    case "coating":
    case "코팅":
      return "coating"
    case "flutecount":
    case "날수":
    case "날":
    case "플루트":
      return "fluteCount"
    case "toolsubtype":
    case "형상":
      return "toolSubtype"
    default:
      return null
  }
}

function validateStockFilter(value: unknown): "instock" | "limited" | "all" | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : ""
  switch (raw) {
    case "instock":
    case "in_stock":
    case "stock":
      return "instock"
    case "limited":
      return "limited"
    case "all":
      return "all"
    default:
      return null
  }
}

function buildValidatedFilters(
  rawFilters: unknown,
  sessionState: ExplorationSessionState | null
): ValidatedFilterResult {
  if (!Array.isArray(rawFilters)) {
    return { filters: [], errors: ["filters must be an array"] }
  }

  const validated: AppliedFilter[] = []
  const errors: string[] = []
  for (const item of rawFilters as RawSemanticFilter[]) {
    const rawField = typeof item?.field === "string"
      ? item.field
      : (typeof sessionState?.lastAskedField === "string" ? sessionState.lastAskedField : "")
    const resolvedField = resolveFilterField(rawField)
    if (!resolvedField) {
      errors.push(`unknown filter field: ${String(item?.field ?? "") || "(missing)"}`)
      continue
    }

    const rawValue = item?.value
    // Allow array (for between) in addition to primitives
    const isPrimitive = typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean"
    const isArray = Array.isArray(rawValue) && rawValue.every(v => typeof v === "string" || typeof v === "number")
    if (!isPrimitive && !isArray) {
      errors.push(`invalid value for ${resolvedField}`)
      continue
    }

    let op = normalizeFilterOp(item?.op) ?? undefined
    // Coerce: op=between with string value → extract two numbers
    let coercedValue: typeof rawValue = rawValue
    if (op === "between" && typeof rawValue === "string") {
      const nums = rawValue.match(/-?\d+(?:\.\d+)?/g)
      if (nums && nums.length >= 2) {
        const a = Number(nums[0]); const b = Number(nums[1])
        if (Number.isFinite(a) && Number.isFinite(b)) {
          coercedValue = [Math.min(a, b), Math.max(a, b)] as any
        }
      } else {
        // Single number for between → treat as eq
        op = "eq"
      }
    }
    const filter = buildAppliedFilterFromValue(resolvedField, coercedValue as any, 0, op)
    if (!filter) {
      errors.push(`failed to canonicalize ${resolvedField}=${String(rawValue)}`)
      continue
    }
    validated.push(filter)
  }

  // Merge same-field filters ONLY when op is identical (don't merge gte+lte etc).
  const mergedKey = (f: AppliedFilter) => `${f.field}|${f.op}`
  const mergedRawValuesByKey = new Map<string, { field: string; op: string; values: Array<string | number | boolean> }>()
  for (const filter of validated) {
    const key = mergedKey(filter)
    const slot = mergedRawValuesByKey.get(key)
    const rawValues = Array.isArray(filter.rawValue) ? filter.rawValue : [filter.rawValue]
    if (slot) slot.values.push(...rawValues)
    else mergedRawValuesByKey.set(key, { field: filter.field, op: filter.op, values: [...rawValues] })
  }

  const mergedFilters: AppliedFilter[] = []
  for (const { field, op, values } of mergedRawValuesByKey.values()) {
    const merged = buildAppliedFilterFromValue(field, values, 0, op)
    if (merged) mergedFilters.push(merged)
  }

  return {
    filters: mergedFilters,
    errors,
  }
}

function buildCompareTargets(rawTargets: unknown): string[] {
  if (!Array.isArray(rawTargets)) return []

  const targets = rawTargets
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean)

  return Array.from(new Set(targets)).slice(0, 4)
}

function validateRequestedField(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return null

  const allowedFields = new Set([
    "toolMaterial",
    "coating",
    "fluteCount",
    "toolSubtype",
    "diameterMm",
    "shankDiameterMm",
    "lengthOfCutMm",
    "overallLengthMm",
    "helixAngleDeg",
    "coolantHole",
    "seriesName",
    "brand",
    "productName",
  ])

  return allowedFields.has(raw) ? raw : null
}

function validateEntityFocus(value: unknown): "series" | "brand" | null {
  if (value === "series" || value === "brand") return value
  return null
}

function validateDirectContext(value: unknown): SemanticDirectContext | null {
  if (!value || typeof value !== "object") return null

  const source = value as Record<string, unknown>
  const lookupCode = typeof source.lookupCode === "string" ? source.lookupCode.trim() || null : null
  const entityNames = Array.isArray(source.entityNames)
    ? Array.from(new Set(source.entityNames.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean))).slice(0, 8)
    : []
  const entityFocus = validateEntityFocus(source.entityFocus)
  const comparisonRequested = typeof source.comparisonRequested === "boolean" ? source.comparisonRequested : null
  const requestedField = validateRequestedField(source.requestedField)
  const isoGroupRaw = typeof source.isoGroup === "string" ? source.isoGroup.trim().toUpperCase() : ""
  const isoGroup = /^[PMKNSH]$/.test(isoGroupRaw) ? isoGroupRaw : null
  const workPieceName = typeof source.workPieceName === "string" ? source.workPieceName.trim() || null : null
  const hardnessMinHrc = typeof source.hardnessMinHrc === "number" && Number.isFinite(source.hardnessMinHrc) ? source.hardnessMinHrc : null
  const hardnessMaxHrc = typeof source.hardnessMaxHrc === "number" && Number.isFinite(source.hardnessMaxHrc) ? source.hardnessMaxHrc : null

  if (
    !lookupCode &&
    entityNames.length === 0 &&
    !entityFocus &&
    comparisonRequested == null &&
    !requestedField &&
    !isoGroup &&
    !workPieceName &&
    hardnessMinHrc == null &&
    hardnessMaxHrc == null
  ) {
    return null
  }

  return {
    lookupCode,
    entityNames,
    entityFocus,
    comparisonRequested,
    requestedField,
    isoGroup,
    workPieceName,
    hardnessMinHrc,
    hardnessMaxHrc,
  }
}

function buildSessionSummary(sessionState: ExplorationSessionState | null): string {
  if (!sessionState) return "없음"

  const activeFilters = (sessionState.appliedFilters ?? [])
    .filter(filter => filter.op !== "skip")
    .map(filter => `${filter.field}=${filter.value}`)
    .join(", ") || "없음"
  const displayedOptions = (sessionState.displayedOptions ?? [])
    .slice(0, 8)
    .map(option => `${option.field}:${option.value}`)
    .join(", ") || "없음"
  const displayedChips = (sessionState.displayedChips ?? []).slice(0, 8).join(", ") || "없음"

  return [
    `pendingField=${sessionState.lastAskedField ?? "없음"}`,
    `mode=${sessionState.currentMode ?? "없음"}`,
    `resolution=${sessionState.resolutionStatus ?? "없음"}`,
    `candidateCount=${sessionState.candidateCount ?? 0}`,
    `activeFilters=${activeFilters}`,
    `displayedOptions=${displayedOptions}`,
    `displayedChips=${displayedChips}`,
  ].join("\n")
}

/**
 * Build a "filter field → DB-actual values" snippet from the startup schema cache.
 * Same idea as the orchestrator's buildDbFilterValueSnippet — gives the SCR LLM the
 * canonical vocabulary so it can map "카바이드/하이스/티알엔" to real values without
 * hardcoded aliases. Returns "" before the cache warms up.
 */
function buildDbFilterValueCatalog(): string {
  const schema = getDbSchemaSync()
  if (!schema) return ""

  const valuesByField = new Map<string, Set<string>>()
  for (const [col, field] of Object.entries(DB_COL_TO_FILTER_FIELD)) {
    const samples = schema.sampleValues[col]
    if (!samples || samples.length === 0) continue
    const slot = valuesByField.get(field) ?? new Set<string>()
    for (const v of samples) {
      const trimmed = v.trim()
      if (trimmed && trimmed.length <= 40) slot.add(trimmed)
    }
    valuesByField.set(field, slot)
  }
  if (schema.brands.length > 0) valuesByField.set("brand", new Set(schema.brands))
  if (schema.countries.length > 0) valuesByField.set("country", new Set(schema.countries))

  if (valuesByField.size === 0) return ""

  const lines: string[] = []
  for (const [field, set] of valuesByField) {
    const values = Array.from(set).slice(0, 40)
    if (values.length === 0) continue
    lines.push(`- ${field}: ${values.join(", ")}`)
  }
  if (lines.length === 0) return ""

  return `\nDB 실측 값 (시작 시 1회 로드, canonical):\n${lines.join("\n")}\n사용자 한글 표현(카바이드/하이스/티알엔/볼/스퀘어 등)은 위 영문 canonical 값으로 매핑해 filters[].value 에 그대로 넣는다. 위에 없는 값은 만들지 말 것.\n`
}

function buildSystemPrompt(repairFeedback: string | null): string {
  return `당신은 절삭공구 추천 시스템의 의미 해석기입니다.
최신 사용자 발화를 세션 맥락과 함께 읽고, 실행 가능한 JSON만 반환하세요.

반드시 지킬 규칙:
1. 필터링/조건변경/대기 질문 응답은 action="continue_narrowing" 또는 "skip_field" 로 판단한다.
1-1. pendingField가 있을 때 "상관없음", "아무거나", "괜찮은 걸로", "추천으로 골라줘", "알아서", "무난한 걸로", "적당한 걸로"는 현재 필드를 건너뛰는 의미이므로 action="skip_field" 로 판단한다. show_recommendation으로 보내지 않는다.
2. 제품정보/재고/절삭조건/시리즈비교/브랜드기준표 같은 DB성 질문은 action="answer_general" 으로 두고 replyRoute를 지정한다.
3. 일반 지식/회사 질문/도메인 설명도 action="answer_general" 으로 두고 replyRoute="general_chat" 으로 둔다.
4. 여러 필터가 있으면 filters 배열에 모두 넣는다. 단 **사용자가 이번 발화에서 직접 언급한 조건만** 추출한다. DB 실측 값 카탈로그는 canonical 매핑용 어휘일 뿐이며, 사용자가 말하지 않은 brand/소재/형상 등을 카탈로그에서 임의로 골라 채우지 말 것. 발화에 근거가 없으면 그 필드는 비워둔다.
5. filters[].field 는 아래 허용 필드 중 하나만 사용한다.
6. filters[].value 는 canonical value를 우선 사용한다. 예: Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed, Bright Finish.
6-1. filters[].op 는 비교 연산자다. 생략시 "eq". 매우 중요: 사용자 발화에 비교 표현이 있으면 반드시 op를 명시한다.
     - "eq" 정확값 (기본). 표현: "10mm", "4날", "T-Coating"
     - "neq" 제외/아닌. 표현: "X 말고", "X 빼고", "X 제외"
     - "gte" 이상/넘는/초과/N부터. 표현: "100mm 이상", "45도 이상", "5개 이상", "100 넘는", "100 이상의 것만"
     - "lte" 이하/미만/N까지. 표현: "80mm 이하", "30도 이하", "100 미만", "80 이하인 것만"
     - "between" 범위. value 는 반드시 [min, max] 형태의 배열. 표현: "8~12mm", "8mm 이상 12mm 이하", "8 to 12", "6에서 10 사이", "직경 8과 12 사이"
     주의: "이상" 또는 "이하" 단어가 단위 뒤에 붙는 경우(45도 이상, 100mm 이하)에도 반드시 gte/lte를 사용해야 한다. 단순 eq로 응답하지 말 것.
6-2. 중복 추출 금지: 같은 숫자를 두 필드에 동시에 넣지 않는다.
     예: "전체 길이 100mm 이상" → overallLengthMm gte 100 만. diameterMm 100 추가 금지.
     예: "직경 10mm" → diameterMm eq 10 만. overallLengthMm 추가 금지.
     판단 기준: 숫자 바로 앞에 붙은 라벨(전체 길이/전장/OAL/날장/LOC/CL/샹크/헬릭스/직경/외경/지름) 이 그 숫자의 소속을 결정한다.
7. pendingField가 존재하고 사용자가 값만 답한 경우, 그 field를 명시해서 반환한다.
8. "이전 단계", "뒤로"는 action="go_back_one_step" 으로 반환한다.
9. "재고 있는 것만"은 action="filter_by_stock" + stockFilter="instock" 으로 반환한다.
9-1. "재고 50개 이상", "재고 100개 넘는 것만" 등 숫자 기준 재고 필터는 action="filter_by_stock" + stockFilter="instock" + stockThreshold=숫자 로 반환한다.
10. "다른 직경/소재/코팅/형상/날수로"는 action="refine_condition" + refineField를 설정한다.
11. 불확실하면 action="none" 으로 반환한다.
9. DB성 질문이면 directContext에 실행 힌트를 함께 넣는다.
10. 제품코드는 lookupCode, 시리즈/브랜드명은 entityNames, 제품 단일 필드 질문은 requestedField를 canonical key로 넣는다.
11. entity_profile 질문이면 entityFocus에 "series" 또는 "brand"를 넣고, 비교 요청이면 comparisonRequested=true를 넣는다.

허용 action:
- continue_narrowing
- skip_field
- show_recommendation
- go_back_one_step
- reset_session
- compare_products
- refine_condition
- filter_by_stock
- answer_general
- none

replyRoute 허용값:
- inventory
- product_info
- entity_profile
- brand_reference
- cutting_conditions
- general_chat

허용 필드:
${buildFieldCatalog()}
${buildDbFilterValueCatalog()}
${repairFeedback ? `\n이전 응답 검증 실패 사유:\n${repairFeedback}\n위 오류를 수정한 JSON만 다시 출력하세요.` : ""}

JSON 형식:
{
  "action": "continue_narrowing|skip_field|show_recommendation|reset_session|compare_products|answer_general|none",
  "filters": [
    {"field":"toolSubtype","value":"Square"},
    {"field":"overallLengthMm","op":"gte","value":100},
    {"field":"diameterMm","op":"between","value":[8,12]},
    {"field":"helixAngleDeg","op":"gte","value":45}
  ],
  "compareTargets": ["A","B"],
  "refineField": "material|diameter|coating|fluteCount|toolSubtype|null",
  "stockFilter": "instock|limited|all|null",
  "stockThreshold": "number|null",
  "replyRoute": "inventory|product_info|entity_profile|brand_reference|cutting_conditions|general_chat|null",
  "directContext": {
    "lookupCode": "E5E8310045",
    "entityNames": ["E5D74", "GMG31"],
    "entityFocus": "series",
    "comparisonRequested": true,
    "requestedField": "coating",
    "isoGroup": "N",
    "workPieceName": "알루미늄",
    "hardnessMinHrc": 45,
    "hardnessMaxHrc": 55
  },
  "confidence": 0.0,
  "reasoning": "짧은 근거"
}`
}

function buildUserPrompt(userMessage: string, sessionState: ExplorationSessionState | null): string {
  return `세션 상태:
${buildSessionSummary(sessionState)}

사용자 메시지:
${userMessage}`
}

function validateSemanticTurnResult(
  parsed: RawSemanticTurnResult | null,
  sessionState: ExplorationSessionState | null,
  clean: string
): SemanticValidationResult {
  if (!parsed) {
    return { decision: null, errors: ["response was not valid JSON"] }
  }

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0
  if (confidence < MIN_CONFIDENCE) {
    return { decision: null, errors: [`confidence too low: ${confidence}`] }
  }

  const actionType = validateAction(parsed.action)
  const replyRoute = validateReplyRoute(parsed.replyRoute)
  const refineField = validateRefineField(parsed.refineField)
  const stockFilter = validateStockFilter(parsed.stockFilter)
  const stockThreshold = typeof parsed.stockThreshold === "number" && parsed.stockThreshold > 0
    ? parsed.stockThreshold
    : null
  const directContext = validateDirectContext(parsed.directContext)
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "semantic_turn"

  if (actionType === "skip_field") {
    if (!sessionState?.lastAskedField) {
      return { decision: null, errors: ["skip_field requires an active pending field"] }
    }
    return {
      decision: {
        action: { type: "skip_field" },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "show_recommendation") {
    return {
      decision: {
        action: { type: "show_recommendation" },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "go_back_one_step") {
    return {
      decision: {
        action: { type: "go_back_one_step" },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "reset_session") {
    return {
      decision: {
        action: { type: "reset_session" },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "compare_products") {
    const targets = buildCompareTargets(parsed.compareTargets)
    if (targets.length < 2) {
      return { decision: null, errors: ["compare_products requires at least 2 compareTargets"] }
    }

    return {
      decision: {
        action: { type: "compare_products", targets },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "refine_condition") {
    if (!refineField) {
      return { decision: null, errors: ["refine_condition requires refineField"] }
    }
    return {
      decision: {
        action: { type: "refine_condition", field: refineField },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "filter_by_stock") {
    if (!stockFilter) {
      return { decision: null, errors: ["filter_by_stock requires stockFilter"] }
    }
    return {
      decision: {
        action: { type: "filter_by_stock", stockFilter, stockThreshold },
        extraFilters: [],
        replyRoute,
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType === "answer_general") {
    return {
      decision: {
        action: { type: "answer_general", message: clean },
        extraFilters: [],
        replyRoute: replyRoute ?? "general_chat",
        directContext,
        confidence,
        reasoning,
      },
      errors: [],
    }
  }

  if (actionType !== "continue_narrowing") {
    return { decision: null, errors: [`unsupported or empty action: ${String(parsed.action ?? "null")}`] }
  }

  const validatedFilters = buildValidatedFilters(parsed.filters, sessionState)
  if (validatedFilters.filters.length === 0) {
    return {
      decision: null,
      errors: validatedFilters.errors.length > 0
        ? validatedFilters.errors
        : ["continue_narrowing requires at least one valid filter"],
    }
  }

  return {
    decision: {
      action: (() => {
        const primaryFilter = validatedFilters.filters[0]
        const existingFilter = sessionState?.appliedFilters?.find(filter =>
          filter.op !== "skip" && filter.field === primaryFilter.field
        )

        if (existingFilter && String(existingFilter.rawValue ?? existingFilter.value) !== String(primaryFilter.rawValue ?? primaryFilter.value)) {
          return {
            type: "replace_existing_filter" as const,
            targetField: existingFilter.field,
            previousValue: String(existingFilter.rawValue ?? existingFilter.value),
            nextFilter: { ...primaryFilter },
          }
        }

        return { type: "continue_narrowing" as const, filter: { ...primaryFilter } }
      })(),
      extraFilters: validatedFilters.filters.slice(1),
      replyRoute,
      directContext,
      confidence,
      reasoning,
    },
    errors: [],
  }
}

// Hard guard against LLM hallucinating categorical values (brand/country/series
// /workPieceName/material). Proper-noun fields require a literal bounded mention.
// Material/workPieceName tolerate Korean/English transliteration through the
// shared alias registry (WORKPIECE_PATTERNS / MATERIAL_ALIAS_MAP) — so "티타늄"
// still grounds "Titanium" — but industry words like "에어로스페이스" do NOT.

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "")
}

function isPhantomFilter(field: string, value: unknown, _normalizedMessage: string, rawMessage: string): boolean {
  if (!PHANTOM_GUARDED_FIELDS.has(field)) return false
  const valueStr = Array.isArray(value) ? value.join(" ") : String(value ?? "")
  if (!valueStr) return false
  return !isGroundedCategoricalValue(field, valueStr, rawMessage)
}

function stripPhantomCategoricalFilters(
  decision: SemanticTurnDecision,
  userMessage: string
): SemanticTurnDecision | null {
  const normalizedMessage = normalizeForMatch(userMessage)
  const extraFilters = decision.extraFilters.filter(
    f => !isPhantomFilter(f.field, f.rawValue ?? f.value, normalizedMessage, userMessage)
  )

  const action = decision.action
  if (action.type === "continue_narrowing") {
    if (isPhantomFilter(action.filter.field, action.filter.rawValue ?? action.filter.value, normalizedMessage, userMessage)) {
      // Promote first surviving extra filter, or drop the action entirely.
      if (extraFilters.length === 0) return null
      const [next, ...rest] = extraFilters
      return {
        ...decision,
        action: { type: "continue_narrowing", filter: next },
        extraFilters: rest,
      }
    }
  } else if (action.type === "replace_existing_filter") {
    if (isPhantomFilter(action.nextFilter.field, action.nextFilter.rawValue ?? action.nextFilter.value, normalizedMessage, userMessage)) {
      if (extraFilters.length === 0) return null
      const [next, ...rest] = extraFilters
      return {
        ...decision,
        action: { type: "continue_narrowing", filter: next },
        extraFilters: rest,
      }
    }
  }

  return { ...decision, extraFilters }
}

export async function extractSemanticTurnDecision(params: {
  userMessage: string
  sessionState: ExplorationSessionState | null
  provider: LLMProvider
}): Promise<SemanticTurnDecision | null> {
  const { userMessage, sessionState, provider } = params
  const clean = userMessage.trim()
  if (!clean || !provider.available()) return null

  let repairFeedback: string | null = null

  for (let attempt = 1; attempt <= MAX_SEMANTIC_ATTEMPTS; attempt++) {
    const raw = await provider.complete(
      buildSystemPrompt(repairFeedback),
      [{ role: "user", content: buildUserPrompt(clean, sessionState) }],
      1800,
      SEMANTIC_TURN_MODEL,
      "semantic-turn-extractor"
    )
    const validation = validateSemanticTurnResult(parseJsonObject(raw), sessionState, clean)
    if (validation.decision) {
      const guarded = stripPhantomCategoricalFilters(validation.decision, clean)
      if (guarded) {
        const reasoning = guarded.reasoning
        return {
          ...guarded,
          reasoning: attempt > 1 ? `${reasoning} [repair:${attempt}]` : reasoning,
        }
      }
      // All filters were phantom and decision became empty → treat as no-op
      return null
    }

    repairFeedback = [
      `attempt=${attempt}`,
      ...validation.errors.slice(0, 6),
    ].join("\n- ")
  }

  return null
}
