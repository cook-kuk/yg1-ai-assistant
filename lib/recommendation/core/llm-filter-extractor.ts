import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import {
  buildAppliedFilterFromValue,
  getFilterFieldDefinition,
  getFilterFieldMatchPolicy,
  getRegisteredFilterFields,
} from "@/lib/recommendation/shared/filter-field-registry"

const LLM_FILTER_EXTRACTOR_MODEL = resolveModel("haiku", "llm-filter-extractor")

export interface LlmFilterValidationOptions {
  allowedFields?: string[]
  fieldValueScope?: Record<string, string[]>
}

export interface LlmFilterResult {
  extractedFilters: Record<string, string | number | Array<string | number>>
  skippedFields: string[]
  skipPendingField: boolean
  isSideQuestion: boolean
  confidence: number
  validationIssues?: string[]
}

export async function extractFiltersWithLLM(
  userMessage: string,
  lastAskedField: string | null,
  currentFilters: AppliedFilter[],
  provider: LLMProvider,
  validationOptions: LlmFilterValidationOptions = {}
): Promise<LlmFilterResult> {
  const DEFAULT_RESULT: LlmFilterResult = {
    extractedFilters: {},
    skippedFields: [],
    skipPendingField: false,
    isSideQuestion: false,
    confidence: 0,
    validationIssues: [],
  }

  if (!provider.available() || !userMessage.trim()) return DEFAULT_RESULT

  const currentFilterSummary = currentFilters
    .filter(f => f.op !== "skip")
    .map(f => `${f.field}=${f.value}`)
    .join(", ") || "없음"

  const systemPrompt = `절삭공구 추천 챗봇 필터 추출기. JSON만 반환.`

  const userPrompt = `사용자 메시지에서 절삭공구 필터를 추출하라. 여러 개 가능.

현재 적용된 필터: ${currentFilterSummary}
현재 대기 질문 필드: ${lastAskedField ?? "없음"}
사용자 메시지: "${userMessage}"

매핑 규칙:
- "Corner radius" / "코너R" / "래디우스" / "라디우스" → toolSubtype: "Radius"
- "스퀘어" / "평날" / "Square" → toolSubtype: "Square"
- "볼" / "볼노즈" / "볼엔드" / "Ball" → toolSubtype: "Ball"
- "황삭" / "러핑" / "Roughing" → toolSubtype: "Roughing"
- "테이퍼" / "Taper" → toolSubtype: "Taper"
- "챔퍼" / "Chamfer" → toolSubtype: "Chamfer"
- "하이피드" / "High-Feed" → toolSubtype: "High-Feed"
- "램핑" → toolSubtype: "Radius" (램핑에 적합)
- "알루미늄" → workPieceName: "알루미늄"
- "SUS" / "스테인리스" / "스텐" → workPieceName: "스테인리스강"
- "탄소강" → workPieceName: "탄소강"
- "티타늄" → workPieceName: "티타늄"
- "주철" → workPieceName: "주철"
- "인코넬" → workPieceName: "인코넬"
- "10mm" / "φ10" / "10파이" / "직경 10" → diameterMm: 10
- "3날" / "3F" / "3플루트" → fluteCount: 3
- "4날 또는 5날" / "4,5날" → fluteCount: [4, 5]
- "무코팅" → coating: "Bright Finish"
- "DLC" / "TiAlN" / "AlTiN" / "TiCN" / "AlCrN" → coating: (해당값)
- "TiAlN이나 AlTiN" → coating: ["TiAlN", "AlTiN"]
- "엔드밀" → toolType: "엔드밀"
- "날장 30mm" / "커팅 길이 30" / "날 길이 30" → lengthOfCutMm: 30
- "전장 100mm" / "전체 길이 100" / "OAL 100" → overallLengthMm: 100
- "생크 8mm" / "생크 직경 8" / "shank 8" → shankDiameterMm: 8
- "쿨런트홀 있는" / "쿨런트 홀" / "내부 급유" → coolantHole: true
- "쿨런트홀 없는" / "외부 급유" → coolantHole: false
- "헬릭스 45도" / "나선각 45" / "helix 45" → helixAngleDeg: 45
- "A 말고 B로" / "A 대신 B" / "B로 바꿔" → extractedFilters에 B값만 넣어라 (A는 시스템이 자동 제거)
- 특정 필드가 함께 언급되면 그 필드를 skippedFields에 넣어라. 예: "코팅은 아무거나" → skippedFields: ["coating"], "형상은 상관없고 3날" → skippedFields: ["toolSubtype"], extractedFilters: {"fluteCount": 3}
- "상관없음" / "몰라" / "아무거나" / "아무거나 괜찮은 걸로" / "괜찮은 걸로" / "무난한 걸로" / "적당한 걸로" / "패스" / "스킵" / "추천으로 골라줘" / "알아서 해줘" 가 필드 없이 단독으로 현재 질문에 대한 답이면 skipPendingField: true
- 공장/회사/지점/본사/영업소/연락처/전화번호 질문 → isSideQuestion: true

이미 적용된 필터와 동일한 필드는 추출하지 마라.
한 문장에 여러 필터가 있으면 전부 추출하라.
skippedFields에 들어간 필드는 extractedFilters에 중복해서 넣지 마라.

반드시 이 JSON만 반환:
{"extractedFilters": {}, "skippedFields": [], "skipPendingField": false, "isSideQuestion": false, "confidence": 0.9}`

  try {
    const raw = await provider.complete(systemPrompt, [{ role: "user", content: userPrompt }], 1500, LLM_FILTER_EXTRACTOR_MODEL, "llm-filter-extractor")
    const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "")
    const parsed = JSON.parse(cleaned)

    const sanitized = sanitizeLlmResult(
      {
        extractedFilters: parsed.extractedFilters ?? {},
        skippedFields: Array.isArray(parsed.skippedFields)
          ? parsed.skippedFields.filter((field: unknown): field is string => typeof field === "string" && field.trim().length > 0)
          : [],
        skipPendingField: !!parsed.skipPendingField,
        isSideQuestion: !!parsed.isSideQuestion,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      },
      currentFilters,
      validationOptions
    )
    return sanitized
  } catch (err) {
    console.warn("[llm-filter-extractor] Failed:", err)
    return DEFAULT_RESULT
  }
}

/**
 * Convert LLM extracted filters (Record) to AppliedFilter[] for the runtime
 */
export function llmResultToAppliedFilters(
  extractedFilters: Record<string, string | number | Array<string | number>>,
  turnCount: number
): AppliedFilter[] {
  const results: AppliedFilter[] = []

  for (const [field, value] of Object.entries(extractedFilters)) {
    const filter =
      buildAppliedFilterFromValue(field, value, turnCount)
      ?? parseAnswerToFilter(field, String(value))
    if (!filter) continue
    filter.appliedAt = turnCount
    results.push(filter)
  }

  return results
}

function sanitizeLlmResult(
  raw: LlmFilterResult,
  currentFilters: AppliedFilter[],
  validationOptions: LlmFilterValidationOptions
): LlmFilterResult {
  const issues: string[] = []
  const allowedFields = validationOptions.allowedFields
    ? new Set(validationOptions.allowedFields)
    : null

  const skippedFields = Array.from(new Set(
    raw.skippedFields.filter(field => isAllowedField(field, allowedFields))
  ))

  const extractedFilters: Record<string, string | number | Array<string | number>> = {}
  for (const [field, rawValue] of Object.entries(raw.extractedFilters ?? {})) {
    if (skippedFields.includes(field)) continue
    const filter = sanitizeSingleFilter(field, rawValue, currentFilters, validationOptions, issues)
    if (!filter) continue
    extractedFilters[filter.field] = typeof filter.rawValue === "number"
      ? filter.rawValue
      : Array.isArray(filter.rawValue)
        ? filter.rawValue.every(item => typeof item === "number")
          ? filter.rawValue.map(item => Number(item))
          : filter.rawValue.map(item => String(item))
        : String(filter.rawValue)
  }

  return {
    extractedFilters,
    skippedFields,
    skipPendingField: !!raw.skipPendingField,
    isSideQuestion: !!raw.isSideQuestion,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    validationIssues: issues,
  }
}

function sanitizeSingleFilter(
  field: string,
  rawValue: string | number | Array<string | number>,
  currentFilters: AppliedFilter[],
  validationOptions: LlmFilterValidationOptions,
  issues: string[]
): AppliedFilter | null {
  const allowedFields = validationOptions.allowedFields
    ? new Set(validationOptions.allowedFields)
    : null
  if (!isAllowedField(field, allowedFields)) {
    issues.push(`disallowed field: ${field}`)
    return null
  }

  const parsed =
    buildAppliedFilterFromValue(field, rawValue, 0)
    ?? parseAnswerToFilter(field, String(rawValue))
  if (!parsed) {
    issues.push(`invalid value for ${field}: ${String(rawValue)}`)
    return null
  }

  const scopedFilter = matchFilterToScope(parsed, validationOptions.fieldValueScope?.[field] ?? null)
  if (!scopedFilter) {
    issues.push(`out-of-scope value for ${field}: ${String(rawValue)}`)
    return null
  }

  if (isDuplicateFilter(currentFilters, scopedFilter)) {
    issues.push(`duplicate current filter for ${field}: ${scopedFilter.value}`)
    return null
  }

  return scopedFilter
}

function isAllowedField(field: string, allowedFields: Set<string> | null): boolean {
  if (!getRegisteredFilterFields().includes(field)) return false
  if (!allowedFields) return true
  return allowedFields.has(field)
}

function isDuplicateFilter(currentFilters: AppliedFilter[], nextFilter: AppliedFilter): boolean {
  return currentFilters.some(filter => {
    if (filter.op === "skip") return false
    if (filter.field !== nextFilter.field) return false
    return normalizeFilterComparableValue(filter) === normalizeFilterComparableValue(nextFilter)
  })
}

function normalizeFilterComparableValue(filter: AppliedFilter): string {
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition) return String(filter.rawValue ?? filter.value)

  if (definition.kind === "number") {
    return String(extractNumericValue(filter.rawValue ?? filter.value))
  }
  if (definition.kind === "boolean") {
    return String(parseBooleanValue(filter.rawValue ?? filter.value))
  }
  if (getFilterFieldMatchPolicy(filter.field) === "strict_identifier") {
    return normalizeIdentifierText(String(filter.rawValue ?? filter.value))
  }
  return normalizeCompactText(String(filter.rawValue ?? filter.value))
}

function matchFilterToScope(filter: AppliedFilter, scopeValues: string[] | null): AppliedFilter | null {
  if (!scopeValues || scopeValues.length === 0) return filter

  const definition = getFilterFieldDefinition(filter.field)
  if (!definition) return null

  const matchedValues = findScopeMatches(filter, scopeValues)
  if (matchedValues.length === 0) return null

  return buildAppliedFilterFromValue(filter.field, matchedValues.length === 1 ? matchedValues[0] : matchedValues, filter.appliedAt)
}

function findScopeMatches(filter: AppliedFilter, scopeValues: string[]): Array<string | number | boolean> {
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition) return []

  if (definition.kind === "number") {
    const targets = extractNumericArray(filter.rawValue ?? filter.value)
    if (targets.length === 0) return []
    const matches: number[] = []
    for (const target of targets) {
      for (const scopeValue of scopeValues) {
        const candidate = extractNumericValue(scopeValue)
        if (candidate == null) continue
        if (Math.abs(candidate - target) <= 0.0001 && !matches.includes(candidate)) matches.push(candidate)
      }
    }
    return matches
  }

  if (definition.kind === "boolean") {
    const targets = extractBooleanArray(filter.rawValue ?? filter.value)
    if (targets.length === 0) return []
    const matches: boolean[] = []
    for (const target of targets) {
      for (const scopeValue of scopeValues) {
        const candidate = parseBooleanValue(scopeValue)
        if (candidate === target && !matches.includes(candidate)) matches.push(candidate)
      }
    }
    return matches
  }

  const rawValues = extractStringArray(filter.rawValue ?? filter.value)
  if (rawValues.length === 0) return []

  if (getFilterFieldMatchPolicy(filter.field) === "strict_identifier") {
    const matches: string[] = []
    for (const raw of rawValues) {
      const normalizedRaw = normalizeIdentifierText(raw)
      const exact = scopeValues.find(scopeValue => normalizeIdentifierText(scopeValue) === normalizedRaw)
      if (exact && !matches.includes(exact)) matches.push(exact)
    }
    return matches
  }

  const matches: string[] = []
  for (const raw of rawValues) {
    const normalizedRaw = normalizeCompactText(raw)
    const exact = scopeValues.find(scopeValue => normalizeCompactText(scopeValue) === normalizedRaw)
    if (exact) {
      if (!matches.includes(exact)) matches.push(exact)
      continue
    }
    for (const scopeValue of scopeValues) {
      const normalizedScope = normalizeCompactText(scopeValue)
      if (normalizedScope.includes(normalizedRaw) || normalizedRaw.includes(normalizedScope)) {
        if (!matches.includes(scopeValue)) matches.push(scopeValue)
        break
      }
    }
  }
  return matches
}

function extractStringArray(value: string | number | boolean | Array<string | number>): string[] {
  const source = Array.isArray(value) ? value : [value]
  return source.map(item => String(item).trim()).filter(Boolean)
}

function extractNumericArray(value: string | number | boolean | Array<string | number>): number[] {
  const source = Array.isArray(value) ? value : [value]
  return source
    .map(item => typeof item === "number" ? item : extractNumericValue(String(item)))
    .filter((item): item is number => item != null && !Number.isNaN(item))
}

function extractBooleanArray(value: string | number | boolean | Array<string | number>): boolean[] {
  const source = Array.isArray(value) ? value : [value]
  return source
    .map(item => parseBooleanValue(item))
    .filter((item): item is boolean => item != null)
}

function normalizeCompactText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function normalizeIdentifierText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "")
}

function extractNumericValue(value: string | number | boolean): number | null {
  if (typeof value === "number") return Number.isNaN(value) ? null : value
  const match = String(value).match(/[-+]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = parseFloat(match[0])
  return Number.isNaN(parsed) ? null : parsed
}

function parseBooleanValue(value: string | number | boolean): boolean | null {
  if (typeof value === "boolean") return value
  const normalized = String(value).trim().toLowerCase()
  if (["true", "yes", "y", "있음", "유", "있다"].includes(normalized)) return true
  if (["false", "no", "n", "없음", "무", "없다"].includes(normalized)) return false
  return null
}
