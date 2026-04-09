import type {
  AppliedFilter,
  CanonicalProduct,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import {
  SKIP_TOKENS as SHARED_SKIP_TOKENS,
  COATING_KO_ALIASES as SHARED_COATING_KO_ALIASES,
  COATING_CHEMICAL_DB_ALIASES,
  canonicalizeCoating as sharedCanonicalizeCoating,
  canonicalizeToolSubtype as sharedCanonicalizeToolSubtype,
  stripKoreanParticles,
  inferIsoGroupsFromText,
} from "@/lib/recommendation/shared/patterns"
import { getDbSchemaSync } from "@/lib/recommendation/core/sql-agent-schema-cache"
import { createFilterFieldFactories } from "@/lib/recommendation/shared/filter-field-factories"

type FilterPrimitive = string | number | boolean
type FilterValueKind = "string" | "number" | "boolean"
export type FilterMatchPolicy = "strict_identifier" | "fuzzy" | "llm_assisted"

type FilterRecord = CanonicalProduct | ScoredProduct | Record<string, unknown>

type DbClauseBuilder = (filter: AppliedFilter, next: (value: unknown) => string) => string | null

interface FilterFieldDefinition {
  field: string
  label?: string
  queryAliases?: string[]
  kind: FilterValueKind
  matchPolicy?: FilterMatchPolicy
  op: "eq" | "includes" | "range"
  canonicalField?: string
  unit?: string
  canonicalizeRawValue?: (rawValue: string | number | boolean) => string | number | boolean | null
  setInput?: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
  clearInput?: (input: RecommendationInput) => RecommendationInput
  extractValues?: (record: FilterRecord) => Array<string | number | boolean>
  matches?: (record: FilterRecord, filter: AppliedFilter) => boolean | null
  buildDbClause?: DbClauseBuilder
}

const SKIP_TOKENS = SHARED_SKIP_TOKENS
const MULTI_VALUE_SEPARATOR_PATTERN = /\s*(?:,|\/|\||또는|아니면| and | or |(?<=[0-9A-Za-z가-힣])(?:이나|과|와)(?=\s*[0-9A-Za-z가-힣]))\s*/iu

function unwrapRecord(record: FilterRecord): Record<string, unknown> {
  if (record && typeof record === "object" && "product" in record && record.product && typeof record.product === "object") {
    return record.product as Record<string, unknown>
  }
  return record as Record<string, unknown>
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function normalizeCompactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "")
}

function normalizeIdentifierText(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "")
}

function stripFilterAnswer(answer: string): string {
  return answer.trim().replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
}

function stripLeadingFieldPhrase(answer: string, aliases: string[] | undefined): string {
  let clean = stripFilterAnswer(answer)
  if (!aliases || aliases.length === 0) return clean

  const sortedAliases = [...aliases].sort((a, b) => b.length - a.length)
  for (const alias of sortedAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`^${escaped}(?=\\s|[은는이가을를로]|$)\\s*(?:은|는|이|가|을|를|로|으로)?\\s*`, "iu")
    if (!pattern.test(clean)) continue
    const stripped = clean.replace(pattern, "").trim()
    if (!stripped) continue  // alias consumed the entire answer — it IS the value, not a prefix
    clean = stripped
    break
  }

  return clean
}

/**
 * Strip Korean approximate prefixes/suffixes before numeric extraction:
 * "약 10mm" → "10mm", "한 10mm쯤" → "10mm", "10mm정도" → "10mm"
 */
function stripApproximateAffixes(value: string): string {
  return value
    .replace(/^(?:약|한)\s+/u, "")
    .replace(/(?:쯤|정도)\s*$/u, "")
}

/**
 * Strip Korean unit aliases for diameter:
 * "10밀리" → "10", "10미리" → "10", "파이10" → "10", "Φ10" → "10"
 */
function stripKoreanDiameterAliases(value: string): string {
  return value
    .replace(/^(?:파이)\s*/u, "")
    .replace(/(?:밀리|미리|파이)\s*$/u, "")
}

/**
 * Strip trailing Korean particles from values:
 * "알루미늄으로" → "알루미늄", "2날이요" → "2날"
 */
// stripKoreanParticles는 shared/patterns.ts에서 import

const KOREAN_NUMBERS: Record<string, number> = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6,
  일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 스물: 20,
}

function extractNumericValue(value: string): number | null {
  const cleaned = stripApproximateAffixes(value)
  // Try Korean number first: "열미리" → 10, "두날" → 2
  for (const [ko, num] of Object.entries(KOREAN_NUMBERS)) {
    if (cleaned.startsWith(ko)) return num
  }
  const match = cleaned.match(/([-+]?\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = parseFloat(match[1])
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Parse fractional inch notation (e.g. "3/8\"", "1-1/2\"", "3/4 inch") and convert to mm.
 * Returns the mm value if the input matches an inch fraction pattern, otherwise null.
 */
function parseFractionalInchToMm(value: string): number | null {
  const trimmed = value.trim()

  // Pattern: optional whole number + fraction + optional inch indicator
  // Matches: "3/8\"", "3/8"", "3/8 inch", "1-1/2\"", "1 1/2\"", "1-1/2 inch", "1\"", "2\""
  const fractionPattern = /^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)\s*(?:"|"|"|''|inch|in|인치)?$/i
  const simpleFractionPattern = /^(\d+)\s*\/\s*(\d+)\s*(?:"|"|"|''|inch|in|인치)?$/i
  const wholeInchPattern = /^(\d+(?:\.\d+)?)\s*(?:"|"|"|''|inch|in|인치)$/i

  let inches: number | null = null

  // Mixed number: "1-1/2"", "1 1/2 inch"
  const mixedMatch = trimmed.match(fractionPattern)
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10)
    const numerator = parseInt(mixedMatch[2], 10)
    const denominator = parseInt(mixedMatch[3], 10)
    if (denominator !== 0) {
      inches = whole + numerator / denominator
    }
  }

  // Simple fraction: "3/8"", "1/2 inch"
  if (inches == null) {
    const simpleMatch = trimmed.match(simpleFractionPattern)
    if (simpleMatch) {
      const numerator = parseInt(simpleMatch[1], 10)
      const denominator = parseInt(simpleMatch[2], 10)
      if (denominator !== 0) {
        inches = numerator / denominator
      }
    }
  }

  // Whole inch: "1\"", "2 inch"
  if (inches == null) {
    const wholeMatch = trimmed.match(wholeInchPattern)
    if (wholeMatch) {
      inches = parseFloat(wholeMatch[1])
    }
  }

  if (inches == null || Number.isNaN(inches)) return null

  // Round to 4 decimal places to avoid floating point artifacts
  return Math.round(inches * 25.4 * 10000) / 10000
}

function splitRawStringValues(value: string): string[] {
  const normalized = value.trim()
  if (!normalized) return []
  return normalized
    .split(MULTI_VALUE_SEPARATOR_PATTERN)
    .map(part => part.trim())
    .filter(Boolean)
}

function normalizeInputValues(kind: FilterValueKind, rawValue: string | number | boolean | Array<string | number | boolean>): FilterPrimitive[] {
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap(value => normalizeInputValues(kind, value))
  }

  if (typeof rawValue === "string") {
    const splitValues = splitRawStringValues(rawValue)
    if (splitValues.length > 1) return splitValues
    return [rawValue]
  }

  return [rawValue]
}

function uniqPrimitiveValues(values: FilterPrimitive[]): FilterPrimitive[] {
  const seen = new Set<string>()
  const result: FilterPrimitive[] = []

  for (const value of values) {
    const key = typeof value === "string"
      ? `s:${normalizeCompactText(value)}`
      : typeof value === "number"
        ? `n:${value}`
        : `b:${value ? "1" : "0"}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}

function extractFilterRawValues(filter: AppliedFilter): FilterPrimitive[] {
  const raw = filter.rawValue ?? filter.value
  return Array.isArray(raw) ? raw : [raw]
}

function extractStringFilterRawValues(filter: AppliedFilter): string[] {
  return uniqPrimitiveValues(
    extractFilterRawValues(filter)
      .flatMap(value => typeof value === "string" ? splitRawStringValues(value) : [String(value)])
      .map(value => value.trim())
      .filter(Boolean)
  ).map(value => String(value))
}

function extractNumericFilterRawValues(filter: AppliedFilter): number[] {
  return uniqPrimitiveValues(
    extractFilterRawValues(filter)
      .map(value => typeof value === "number" ? value : extractNumericValue(String(value)))
      .filter((value): value is number => value != null && !Number.isNaN(value))
  ).map(value => Number(value))
}

function extractBooleanFilterRawValues(filter: AppliedFilter): boolean[] {
  return uniqPrimitiveValues(
    extractFilterRawValues(filter)
      .map(value => parseBooleanValue(value))
      .filter((value): value is boolean => value != null)
  ).map(value => Boolean(value))
}

function displayRawValue(rawValue: FilterPrimitive, unit?: string): string {
  if (typeof rawValue === "number") return `${formatNumericValue(rawValue)}${unit ?? ""}`
  if (typeof rawValue === "boolean") return rawValue ? "true" : "false"
  return rawValue
}

function firstFilterNumberValue(filter: AppliedFilter): number | undefined {
  return extractNumericFilterRawValues(filter)[0]
}

function firstFilterBooleanValue(filter: AppliedFilter): boolean | undefined {
  return extractBooleanFilterRawValues(filter)[0]
}

function joinedFilterStringValue(filter: AppliedFilter, separator = ", "): string | undefined {
  const values = extractStringFilterRawValues(filter)
  if (values.length === 0) return undefined
  return values.join(separator)
}

function formatNumericValue(num: number): string {
  return Number.isInteger(num) ? String(num) : String(num)
}

function parseBooleanValue(value: string | number | boolean): boolean | null {
  if (typeof value === "boolean") return value
  const normalized = String(value).trim().toLowerCase()
  if (["true", "yes", "y", "있음", "유", "있다"].includes(normalized)) return true
  if (["false", "no", "n", "없음", "무", "없다"].includes(normalized)) return false
  return null
}

function includesText(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeCompactText(haystack)
  const normalizedNeedle = normalizeCompactText(needle)
  return normalizedHaystack.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedHaystack)
}

function identifierMatch(record: FilterRecord, filter: AppliedFilter, key: string): boolean {
  const queries = extractStringFilterRawValues(filter).map(value => normalizeIdentifierText(value)).filter(Boolean)
  if (queries.length === 0) return false

  return extractPrimitiveValues(record, key).some(value => queries.includes(normalizeIdentifierText(String(value))))
}

/**
 * Korean → English coating alias map.
 * These are stable industry terms unlikely to change;
 * the map only bridges the language gap so that the DB LIKE clause
 * can match the English `search_coating` column.
 */
const COATING_KO_ALIASES = SHARED_COATING_KO_ALIASES

function canonicalizeCoatingRawValue(rawValue: string | number | boolean): string | null {
  const raw = String(rawValue)
  const canonical = sharedCanonicalizeCoating(raw)
  if (canonical) return canonical
  // 매칭 실패 시 particle 제거 후 원본 반환 (기존 동작 유지)
  const stripped = stripKoreanParticles(raw.trim())
  return stripped || null
}

function canonicalizeToolSubtypeRawValue(rawValue: string | number | boolean): string | null {
  const raw = String(rawValue)
  const canonical = sharedCanonicalizeToolSubtype(raw)
  if (canonical) return canonical
  // 매칭 실패 시 particle 제거 후 원본 반환 (기존 동작 유지)
  const stripped = stripKoreanParticles(raw.trim())
  return stripped || null
}

function firstNumberFromColumns(columns: string[]): string {
  const coalesced = `COALESCE(${columns.map(column => `NULLIF(CAST(${column} AS text), '')`).join(", ")})`
  return `NULLIF(substring(${coalesced} from '[-+]?[0-9]*\\.?[0-9]+'), '')::numeric`
}

function buildLikeClause(columns: string[], filter: AppliedFilter, next: (value: unknown) => string): string | null {
  const rawValues = extractStringFilterRawValues(filter).map(value => value.toLowerCase()).filter(Boolean)
  if (rawValues.length === 0) return null
  const valueClauses = rawValues.map(raw => {
    const param = next(`%${raw}%`)
    return `(${columns.map(column => `LOWER(COALESCE(${column}, '')) LIKE ${param}`).join(" OR ")})`
  })
  return valueClauses.length === 1 ? valueClauses[0] : `(${valueClauses.join(" OR ")})`
}

/** 화학명("AlCrN") → DB 내부명("Y-Coating") 확장 LIKE 쿼리 */
function buildCoatingLikeClause(filter: AppliedFilter, next: (value: unknown) => string): string | null {
  const rawValues = extractStringFilterRawValues(filter).map(v => v.toLowerCase()).filter(Boolean)
  if (rawValues.length === 0) return null
  // 화학명에 해당하는 DB aliases 추가 (e.g., "alcrn" → ["y-coating", "y coating"])
  const expandedValues = new Set(rawValues)
  for (const raw of rawValues) {
    const aliases = COATING_CHEMICAL_DB_ALIASES[raw]
    if (aliases) for (const alias of aliases) expandedValues.add(alias.toLowerCase())
  }
  const columns = ["search_coating", "milling_coating"]
  const valueClauses = [...expandedValues].map(raw => {
    const param = next(`%${raw}%`)
    return `(${columns.map(column => `LOWER(COALESCE(${column}, '')) LIKE ${param}`).join(" OR ")})`
  })
  return valueClauses.length === 1 ? valueClauses[0] : `(${valueClauses.join(" OR ")})`
}

/** post-SQL: 화학명↔내부명 교차 매칭 */
function coatingAliasMatch(record: FilterRecord, filter: AppliedFilter): boolean {
  const queries = extractStringFilterRawValues(filter).map(v => v.toLowerCase()).filter(Boolean)
  const productCoating = String(extractPrimitiveValues(record, "coating")[0] ?? "").toLowerCase()
  if (!productCoating) return false
  for (const q of queries) {
    const aliases = COATING_CHEMICAL_DB_ALIASES[q]
    if (aliases?.some(a => productCoating.includes(a.toLowerCase()))) return true
  }
  return false
}

function buildExactIdentifierClause(columns: string[], filter: AppliedFilter, next: (value: unknown) => string): string | null {
  const rawValues = extractStringFilterRawValues(filter).map(value => normalizeIdentifierText(value)).filter(Boolean)
  if (rawValues.length === 0) return null
  const param = next(rawValues)
  return `(${columns.map(column => `regexp_replace(LOWER(COALESCE(${column}, '')), '[^a-z0-9가-힣]+', '', 'g') = ANY(${param}::text[])`).join(" OR ")})`
}

function buildNumericEqualityClause(
  columns: string[],
  filter: AppliedFilter,
  next: (value: unknown) => string,
  tolerance = 0.0001
): string | null {
  const rawValues = extractNumericFilterRawValues(filter)
  if (rawValues.length === 0) return null
  // Drop any column that doesn't exist in the live MV — older field
  // definitions still reference legacy columns (holemaking_point_angle,
  // threading_pitch, threading_tpi) that the new compact MV no longer has.
  // Without this guard the SQL fails with "column ... does not exist".
  const liveSchema = getDbSchemaSync()
  const knownCols = liveSchema ? new Set(liveSchema.columns.map(c => c.column_name)) : null
  const presentColumns = knownCols ? columns.filter(c => knownCols.has(c)) : columns
  if (presentColumns.length === 0) return null
  const numericExpr = firstNumberFromColumns(presentColumns)

  // Range ops: gte / lte / between are handled here so each numeric field
  // automatically supports range filters without needing to know columns
  // outside this helper. (Previously a separate range handler in
  // buildDbWhereClauseForFilter tried to regex-parse the eq clause to extract
  // the column expression — that silently failed because the eq clause uses
  // ABS(expr - $) <= tol, not `col = $N`.)
  if (filter.op === "gte" || filter.op === "lte") {
    const numVal = Number(rawValues[0])
    if (!Number.isFinite(numVal)) return null
    const param = next(numVal)
    const cmp = filter.op === "gte" ? ">=" : "<="
    return `${numericExpr} IS NOT NULL AND ${numericExpr} ${cmp} ${param}`
  }
  if (filter.op === "between") {
    const lo = Number(rawValues[0])
    const hi = Number((filter as { rawValue2?: unknown }).rawValue2 ?? rawValues[1] ?? rawValues[0])
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
    const [lowVal, highVal] = lo <= hi ? [lo, hi] : [hi, lo]
    return `${numericExpr} IS NOT NULL AND ${numericExpr} BETWEEN ${next(lowVal)} AND ${next(highVal)}`
  }

  const clauses = rawValues.map(raw => {
    const param = next(raw)
    if (tolerance <= 0) {
      return `${numericExpr} = ${param}`
    }
    return `${numericExpr} IS NOT NULL AND ABS(${numericExpr} - ${param}) <= ${tolerance}`
  })
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`
}

/**
 * Boolean-as-text columns (Y/N/Yes/No/Coolant/Through/Null).
 * filter.value: true  → any column matches truthy text
 *               false → all present columns are falsy (or all null)
 * Uses COALESCE(LOWER(col),'') IN (...) for cross-DB safety.
 */
function buildBooleanStringClause(
  columns: string[],
  filter: AppliedFilter,
): string | null {
  const wants = extractBooleanFilterRawValues(filter)
  if (wants.length === 0 || columns.length === 0) return null
  const want = wants[0]
  const TRUE_SET = "('y','yes','true','1','coolant','through')"
  const FALSE_SET = "('n','no','false','0')"
  const set = want ? TRUE_SET : FALSE_SET
  const perColumn = columns.map(col =>
    `LOWER(COALESCE(CAST(${col} AS text), '')) IN ${set}`
  )
  // true: ANY column truthy → OR
  // false: EVERY non-null column falsy → AND (NULL treated as unknown-excluded)
  return want
    ? `(${perColumn.join(" OR ")})`
    : `(${perColumn.join(" AND ")})`
}

function extractPrimitiveValues(record: FilterRecord, key: string): Array<string | number | boolean> {
  const source = unwrapRecord(record)
  const value = source[key]
  if (Array.isArray(value)) {
    return value.filter((item): item is string | number | boolean => (
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    ))
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [value]
  }
  return []
}

function stringMatch(record: FilterRecord, filter: AppliedFilter, key: string): boolean {
  const queries = extractStringFilterRawValues(filter)
  return extractPrimitiveValues(record, key).some(value =>
    queries.some(query => includesText(String(value), query))
  )
}

function numericMatch(record: FilterRecord, filter: AppliedFilter, key: string, tolerance = 0.0001): boolean {
  const rawValues = extractNumericFilterRawValues(filter)
  if (rawValues.length === 0) return false
  const numericValues = extractPrimitiveValues(record, key).filter((v): v is number => typeof v === "number")
  if (numericValues.length === 0) return false

  // Range ops must be honored here too — otherwise SQL returns rows but the
  // in-memory matches() pass drops them all because exact-equality fails.
  if (filter.op === "gte" || filter.op === "lte") {
    const threshold = Number(rawValues[0])
    if (!Number.isFinite(threshold)) return false
    return numericValues.some(v => filter.op === "gte" ? v >= threshold : v <= threshold)
  }
  if (filter.op === "between") {
    const lo = Number(rawValues[0])
    const hi = Number((filter as { rawValue2?: unknown }).rawValue2 ?? rawValues[1] ?? rawValues[0])
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false
    const [lowVal, highVal] = lo <= hi ? [lo, hi] : [hi, lo]
    return numericValues.some(v => v >= lowVal && v <= highVal)
  }

  return numericValues.some(value =>
    rawValues.some(raw => Math.abs(value - raw) <= tolerance)
  )
}

function booleanMatch(record: FilterRecord, filter: AppliedFilter, key: string): boolean {
  const wants = extractBooleanFilterRawValues(filter)
  if (wants.length === 0) return false
  return extractPrimitiveValues(record, key).some(value => {
    const parsed = parseBooleanValue(value)
    return parsed != null && wants.includes(parsed)
  })
}

// Bundle of internal helpers passed to the factory module. Declared here so
// factories can construct method closures without importing from this file
// (which would create a circular dependency).
const { makeNumberRangeFieldDef, makeBooleanFieldDef } = createFilterFieldFactories({
  firstFilterNumberValue,
  firstFilterBooleanValue,
  extractPrimitiveValues,
  numericMatch,
  booleanMatch,
  buildNumericEqualityClause,
  buildBooleanStringClause,
})

const FILTER_FIELD_DEFINITIONS: Record<string, FilterFieldDefinition> = {
  diameterMm: {
    field: "diameterMm",
    label: "직경",
    queryAliases: ["직경", "지름", "파이", "diameter", "dia", "mm"],
    kind: "number",
    op: "eq",
    unit: "mm",
    canonicalizeRawValue: (rawValue) => {
      let s = stripApproximateAffixes(String(rawValue).trim())
      s = stripKoreanDiameterAliases(s)
      // Strip Φ/φ prefix
      s = s.replace(/^[Φφ]\s*/u, "")
      const inchMm = parseFractionalInchToMm(s)
      if (inchMm != null) return inchMm
      return extractNumericValue(s) ?? rawValue
    },
    setInput: (input, filter) => ({ ...input, diameterMm: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, diameterMm: undefined }),
    extractValues: record => extractPrimitiveValues(record, "diameterMm"),
    matches: (record, filter) => numericMatch(record, filter, "diameterMm"),
    buildDbClause: (filter, next) => buildNumericEqualityClause(["search_diameter_mm"], filter, next, 0.05),
  },
  diameterRefine: {
    field: "diameterRefine",
    label: "직경",
    queryAliases: ["직경", "지름", "파이", "diameter", "dia", "mm"],
    canonicalField: "diameterMm",
    kind: "number",
    op: "eq",
    unit: "mm",
    canonicalizeRawValue: (rawValue) => {
      let s = stripApproximateAffixes(String(rawValue).trim())
      s = stripKoreanDiameterAliases(s)
      s = s.replace(/^[Φφ]\s*/u, "")
      const inchMm = parseFractionalInchToMm(s)
      if (inchMm != null) return inchMm
      return extractNumericValue(s) ?? rawValue
    },
    setInput: (input, filter) => ({ ...input, diameterMm: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, diameterMm: undefined }),
    extractValues: record => extractPrimitiveValues(record, "diameterMm"),
    matches: (record, filter) => numericMatch(record, filter, "diameterMm"),
  },
  material: {
    field: "material",
    label: "소재",
    queryAliases: ["소재", "재질", "material"],
    kind: "string",
    op: "eq",
    // 새 material 이 들어오면 stale workPieceName(이전 턴에서 다른 ISO 그룹으로
    // 박힌 값) 도 같이 클리어. 두 값이 같은 ISO 그룹에 속하면 보존.
    // (이전엔 무조건 보존 → "스테인리스" 입력해도 workPieceName=경화강 carryover 버그)
    setInput: (input, filter) => {
      const newMaterial = joinedFilterStringValue(filter)
      const next = { ...input, material: newMaterial }
      const stale = input.workPieceName
      if (stale && newMaterial) {
        const newIso = inferIsoGroupsFromText(newMaterial)
        const staleIso = inferIsoGroupsFromText(String(stale))
        // 교집합 0 → 다른 그룹 → 클리어. 한쪽이 비면 (불명확) → 보존.
        if (newIso.size > 0 && staleIso.size > 0) {
          let overlap = false
          for (const g of newIso) if (staleIso.has(g)) { overlap = true; break }
          if (!overlap) next.workPieceName = undefined
        }
      }
      return next
    },
    clearInput: input => ({ ...input, material: undefined }),
  },
  workPieceName: {
    field: "workPieceName",
    label: "피삭재",
    queryAliases: ["피삭재", "소재", "재질", "workpiece", "material"],
    kind: "string",
    op: "includes",
    canonicalizeRawValue: rawValue => {
      const WORKPIECE_KO_ALIASES: Record<string, string> = {
        스텐: "stainless",
        스테인리스: "stainless",
        스테인레스: "stainless",
        copper: "구리",
        cu: "구리",
        redcopper: "구리",
        동: "구리",
        황동: "구리",
        구리합금: "구리",
        aluminum: "알루미늄",
        alu: "알루미늄",
        알루: "알루미늄",
        초내열합금: "인코넬",
        내열합금: "인코넬",
        superalloy: "인코넬",
      }
      // Strip Korean particles first: "알루미늄으로" → "알루미늄"
      const stripped = stripKoreanParticles(String(rawValue).trim())
      const normalized = stripped.toLowerCase().replace(/\s+/g, "")
      return WORKPIECE_KO_ALIASES[normalized] ?? (stripped || null)
    },
    setInput: (input, filter) => ({ ...input, workPieceName: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, workPieceName: undefined }),
    matches: (record, _filter) => {
      // DB에서 workpiece_name_matched 플래그로 판별: 해당 시리즈가 요청 피삭재를 지원하는지
      // workpieceMatched가 없는 경우(DB 미조회) → 통과시킴 (false negative 방지)
      if (record.workpieceMatched === undefined) return true
      return record.workpieceMatched === true
    },
  },
  fluteCount: makeNumberRangeFieldDef({
    field: "fluteCount",
    label: "날 수",
    queryAliases: ["날 수", "날수", "몇 날", "flute", "날"],
    unit: "날",
    inputKey: "flutePreference",
    dbColumns: ["option_numberofflute", "option_z", "milling_number_of_flute", "holemaking_number_of_flute", "threading_number_of_flute"],
    canonicalizeRawValue: (rawValue) => {
      // Strip Korean particles from flute expressions: "2날이요" → "2날" → 2
      const s = stripKoreanParticles(String(rawValue).trim())
      const WORD_NUMBERS: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10,
      }
      const wordMatch = s.toLowerCase().match(/^(one|two|three|four|five|six|seven|eight|nine|ten)\b/)
      if (wordMatch) return WORD_NUMBERS[wordMatch[1]] ?? rawValue
      const reversedMatch = s.match(/^날\s*(\d+)\s*개?$/)
      if (reversedMatch) return parseInt(reversedMatch[1], 10)
      return extractNumericValue(s) ?? rawValue
    },
  }),
  coating: {
    field: "coating",
    label: "코팅",
    queryAliases: ["코팅", "coat", "coating", "블루코팅", "골드코팅", "블랙코팅", "실버코팅", "무코팅", "비코팅"],
    kind: "string",
    op: "includes",
    canonicalizeRawValue: canonicalizeCoatingRawValue,
    setInput: (input, filter) => ({ ...input, coatingPreference: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, coatingPreference: undefined }),
    extractValues: record => extractPrimitiveValues(record, "coating"),
    matches: (record, filter) => stringMatch(record, filter, "coating") || coatingAliasMatch(record, filter),
    buildDbClause: (filter, next) => buildCoatingLikeClause(filter, next),
  },
  cuttingType: {
    field: "cuttingType",
    label: "가공 타입",
    queryAliases: ["가공", "작업", "커팅", "cutting"],
    kind: "string",
    matchPolicy: "strict_identifier",
    op: "eq",
    setInput: (input, filter) => ({ ...input, operationType: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, operationType: undefined }),
  },
  toolSubtype: {
    field: "toolSubtype",
    label: "형상",
    queryAliases: ["형상", "타입", "subtype", "square", "radius", "ball", "roughing", "rough", "황삭", "라디우스", "볼", "스퀘어", "코너레디우스", "코너 레디우스", "테이퍼", "챔퍼", "하이피드"],
    kind: "string",
    op: "includes",
    canonicalizeRawValue: canonicalizeToolSubtypeRawValue,
    setInput: (input, filter) => ({ ...input, toolSubtype: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, toolSubtype: undefined }),
    extractValues: record => extractPrimitiveValues(record, "toolSubtype"),
    matches: (record, filter) => stringMatch(record, filter, "toolSubtype"),
    buildDbClause: (filter, next) => buildLikeClause(["search_subtype"], filter, next),
  },
  seriesName: {
    field: "seriesName",
    label: "시리즈",
    queryAliases: ["시리즈", "series"],
    kind: "string",
    matchPolicy: "strict_identifier",
    op: "includes",
    setInput: (input, filter) => ({ ...input, seriesName: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, seriesName: undefined }),
    extractValues: record => extractPrimitiveValues(record, "seriesName"),
    matches: (record, filter) => identifierMatch(record, filter, "seriesName"),
    buildDbClause: (filter, next) => buildExactIdentifierClause(["edp_series_name"], filter, next),
  },
  toolMaterial: {
    field: "toolMaterial",
    label: "공구 소재",
    queryAliases: ["공구 소재", "tool material", "초경", "카바이드", "carbide", "hss", "하이스", "고속도강", "high speed steel"],
    kind: "string",
    op: "includes",
    setInput: (input, filter) => ({ ...input, toolMaterial: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, toolMaterial: undefined }),
    extractValues: record => extractPrimitiveValues(record, "toolMaterial"),
    matches: (record, filter) => stringMatch(record, filter, "toolMaterial"),
    buildDbClause: (filter, next) => buildLikeClause(
      ["milling_tool_material", "holemaking_tool_material", "threading_tool_material"],
      filter,
      next
    ),
  },
  toolType: {
    field: "toolType",
    label: "공구 타입",
    queryAliases: ["공구 타입", "tool type", "카테고리"],
    kind: "string",
    matchPolicy: "strict_identifier",
    op: "includes",
    setInput: (input, filter) => ({ ...input, toolType: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, toolType: undefined }),
    extractValues: record => extractPrimitiveValues(record, "toolType"),
    matches: (record, filter) => identifierMatch(record, filter, "toolType"),
    buildDbClause: (filter, next) => buildExactIdentifierClause(
      ["series_tool_type", "series_product_type", "edp_root_category"],
      filter,
      next
    ),
  },
  brand: {
    field: "brand",
    label: "브랜드",
    queryAliases: ["브랜드", "brand"],
    kind: "string",
    matchPolicy: "strict_identifier",
    op: "includes",
    setInput: (input, filter) => ({ ...input, brand: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, brand: undefined }),
    extractValues: record => extractPrimitiveValues(record, "brand"),
    matches: (record, filter) => identifierMatch(record, filter, "brand"),
    buildDbClause: (filter, next) => buildExactIdentifierClause(["series_brand_name", "edp_brand_name"], filter, next),
  },
  country: {
    field: "country",
    label: "국가",
    queryAliases: [
      "국가", "나라", "시장", "생산국", "원산지",
      "country", "market", "region",
    ],
    kind: "string",
    matchPolicy: "strict_identifier",
    canonicalizeRawValue: rawValue => {
      /**
       * Natural-language → catalog_app.product_recommendation_mv.country_codes 실값.
       * MV는 region 단위로만 저장: KOREA / AMERICA / EUROPE / ASIA
       * (대소문자 혼재 더러움은 buildDbClause의 case-insensitive overlap에서 흡수)
       */
      const COUNTRY_NAME_MAP: Record<string, string> = {
        // KOREA (단일 국가지만 별도 토큰)
        한국: "KOREA", 대한민국: "KOREA", 국내: "KOREA", 국산: "KOREA", 내수: "KOREA",
        korea: "KOREA", "south korea": "KOREA", kr: "KOREA", kor: "KOREA",
        // AMERICA
        미국: "AMERICA", usa: "AMERICA", "united states": "AMERICA", america: "AMERICA",
        us: "AMERICA", "north america": "AMERICA",
        // ASIA (Korea 외 아시아 국가는 ASIA로 매핑)
        일본: "ASIA", japan: "ASIA", jp: "ASIA", jpn: "ASIA",
        중국: "ASIA", china: "ASIA", cn: "ASIA", chn: "ASIA",
        태국: "ASIA", thailand: "ASIA", tha: "ASIA",
        베트남: "ASIA", vietnam: "ASIA", vnm: "ASIA",
        인도: "ASIA", india: "ASIA", ind: "ASIA",
        // EUROPE
        독일: "EUROPE", germany: "EUROPE", de: "EUROPE", deu: "EUROPE",
        영국: "EUROPE", england: "EUROPE", uk: "EUROPE", "united kingdom": "EUROPE", britain: "EUROPE", eng: "EUROPE",
        프랑스: "EUROPE", france: "EUROPE", fra: "EUROPE",
        이탈리아: "EUROPE", italy: "EUROPE", ita: "EUROPE",
        스페인: "EUROPE", spain: "EUROPE", esp: "EUROPE",
        러시아: "EUROPE", russia: "EUROPE", rus: "EUROPE",
        폴란드: "EUROPE", poland: "EUROPE", pol: "EUROPE",
        헝가리: "EUROPE", hungary: "EUROPE", hun: "EUROPE",
        튀르키예: "EUROPE", 터키: "EUROPE", turkey: "EUROPE", türkiye: "EUROPE", tur: "EUROPE",
        체코: "EUROPE", czech: "EUROPE", czechia: "EUROPE", "czech republic": "EUROPE", cze: "EUROPE",
        포르투갈: "EUROPE", portugal: "EUROPE", prt: "EUROPE",
      }
      /** Region 직접 입력 */
      const REGION_MAP: Record<string, string> = {
        아시아: "ASIA", asia: "ASIA",
        유럽: "EUROPE", europe: "EUROPE",
        미주: "AMERICA", 북미: "AMERICA",
      }
      const trimmed = String(rawValue).trim()
      const lower = trimmed.toLowerCase()
      if (REGION_MAP[lower]) return REGION_MAP[lower]
      return COUNTRY_NAME_MAP[lower] ?? (trimmed.toUpperCase() || null)
    },
    op: "includes",
    setInput: (input, filter) => {
      const value = joinedFilterStringValue(filter)
      return { ...input, country: value ? value.toUpperCase() : undefined }
    },
    clearInput: input => ({ ...input, country: undefined }),
    extractValues: record => {
      // record.country_codes(array) 우선, 없으면 record.country(콤마 문자열) 분해
      const r = record as Record<string, unknown>
      const arr = r.country_codes
      if (Array.isArray(arr)) return arr.map(v => String(v).toUpperCase()).filter(Boolean)
      const str = r.country
      if (typeof str === "string" && str.length > 0) {
        return str.split(/[,/]/).map(v => v.trim().toUpperCase()).filter(Boolean)
      }
      return []
    },
    matches: (record, filter) => {
      const targets = extractStringFilterRawValues(filter).map(v => String(v).trim().toUpperCase()).filter(Boolean)
      if (targets.length === 0) return true
      const r = record as Record<string, unknown>
      const arr = r.country_codes
      const tokens: string[] = Array.isArray(arr)
        ? arr.map(v => String(v).toUpperCase())
        : (typeof r.country === "string" ? r.country.split(/[,/]/).map(v => v.trim().toUpperCase()) : [])
      const has = targets.some(t => tokens.includes(t))
      return filter.op === "neq" ? !has : has
    },
    buildDbClause: (filter, next) => {
      const normalized = extractStringFilterRawValues(filter)
        .map(value => value.trim().toUpperCase())
        .filter(Boolean)
      if (normalized.length === 0) return null
      const param = next(normalized)
      // Case-insensitive array overlap: MV에 'KOREA'/'Korea'/'korea' 혼재해도 매치
      return `EXISTS (SELECT 1 FROM unnest(COALESCE(country_codes, ARRAY[]::text[])) AS _c WHERE upper(_c) = ANY(${param}::text[]))`
    },
  },
  shankDiameterMm: makeNumberRangeFieldDef({
    field: "shankDiameterMm",
    label: "생크 직경",
    queryAliases: ["생크", "shank"],
    unit: "mm",
    tolerance: 0.5,
    dbColumns: ["milling_shank_dia", "holemaking_shank_dia", "threading_shank_dia", "option_shank_diameter", "option_dcon"],
  }),
  shankType: {
    field: "shankType",
    label: "생크 타입",
    queryAliases: ["생크 타입", "싱크 타입", "shank type"],
    kind: "string",
    op: "eq",
    setInput: (input, filter) => input, // shankType은 RecommendationInput에 없으므로 pass-through
    clearInput: input => input,
    extractValues: record => extractPrimitiveValues(record, "shankType"),
    matches: (record, filter) => {
      const val = String((record as Record<string, unknown>).shankType ?? "").toLowerCase()
      const target = String(filter.rawValue ?? filter.value).toLowerCase()
      if (filter.op === "neq") return !val.includes(target)
      return val.includes(target)
    },
    buildDbClause: (filter, next) => {
      const target = String(filter.rawValue ?? filter.value).toLowerCase()
      // Real columns in product_recommendation_mv: search_shank_type, milling_shank_type, series_shank_type, tooling_shank_type
      const param = next("%" + target + "%")
      return `(LOWER(COALESCE(search_shank_type, '')) LIKE ${param} OR LOWER(COALESCE(milling_shank_type, '')) LIKE ${param} OR LOWER(COALESCE(series_shank_type, '')) LIKE ${param} OR LOWER(COALESCE(tooling_shank_type, '')) LIKE ${param})`
    },
  },
  lengthOfCutMm: makeNumberRangeFieldDef({
    field: "lengthOfCutMm",
    label: "절삭 길이",
    queryAliases: ["절삭길이", "절삭 길이", "날길이", "날 길이", "loc"],
    unit: "mm",
    tolerance: 2,
    dbColumns: ["milling_length_of_cut", "holemaking_flute_length", "threading_thread_length", "option_flute_length", "option_loc"],
  }),
  overallLengthMm: makeNumberRangeFieldDef({
    field: "overallLengthMm",
    label: "전장",
    queryAliases: ["전장", "전체 길이", "oal"],
    unit: "mm",
    tolerance: 5,
    dbColumns: ["milling_overall_length", "holemaking_overall_length", "threading_overall_length", "option_overall_length", "option_oal"],
  }),
  helixAngleDeg: makeNumberRangeFieldDef({
    field: "helixAngleDeg",
    label: "헬릭스각",
    queryAliases: ["헬릭스", "헬릭스각", "헬릭스 각", "헬릭스 각도", "나선각", "나선 각도", "helix", "helixAngle", "helix angle"],
    unit: "°",
    tolerance: 2,
    dbColumns: ["milling_helix_angle", "holemaking_helix_angle"],
  }),
  ballRadiusMm: makeNumberRangeFieldDef({
    field: "ballRadiusMm",
    label: "볼 반경",
    queryAliases: ["볼 반경", "ball radius"],
    unit: "mm",
    dbColumns: ["milling_ball_radius", "option_r", "option_re"],
  }),
  taperAngleDeg: makeNumberRangeFieldDef({
    field: "taperAngleDeg",
    label: "테이퍼각",
    queryAliases: ["테이퍼각", "taper"],
    unit: "°",
    tolerance: 0.5,
    dbColumns: ["milling_taper_angle", "option_taperangle"],
  }),
  coolantHole: makeBooleanFieldDef({
    field: "coolantHole",
    label: "쿨런트 홀",
    queryAliases: ["쿨런트", "절삭유홀", "coolant", "coolant hole"],
    dbColumns: ["milling_coolant_hole", "holemaking_coolant_hole", "threading_coolant_hole", "option_coolanthole"],
  }),
  pointAngleDeg: {
    field: "pointAngleDeg",
    label: "포인트 각도",
    queryAliases: ["포인트 각도", "포인트각도", "포인트 앵글", "드릴 포인트", "드릴 각도", "드릴 끝 각도", "drill point", "point angle", "point_angle"],
    kind: "number",
    op: "eq",
    unit: "°",
    setInput: (input, filter) => input,
    extractValues: record => extractPrimitiveValues(record, "pointAngleDeg"),
    matches: (record, filter) => numericMatch(record, filter, "pointAngleDeg", 1),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["holemaking_point_angle"],
      filter,
      next,
      1,
    ),
  },
  threadPitchMm: {
    field: "threadPitchMm",
    label: "나사 피치",
    queryAliases: ["피치", "나사 피치", "나사피치", "스레드 피치", "thread pitch", "thread_pitch", "pitch"],
    kind: "number",
    op: "eq",
    unit: "mm",
    setInput: (input, filter) => input,
    extractValues: record => extractPrimitiveValues(record, "threadPitchMm"),
    matches: (record, filter) => numericMatch(record, filter, "threadPitchMm", 0.01),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["threading_pitch"],
      filter,
      next,
      0.01,
    ),
  },
  stockStatus: {
    field: "stockStatus",
    label: "재고",
    queryAliases: ["재고", "재고 있는", "재고있는", "재고 있음", "instock", "in stock", "stock", "납기"],
    kind: "string",
    op: "eq",
    extractValues: record => {
      if (record && typeof record === "object" && "stockStatus" in record) {
        const value = (record as Record<string, unknown>).stockStatus
        if (typeof value === "string") return [value]
      }
      return []
    },
    matches: (record, filter) => {
      if (!(record && typeof record === "object" && "stockStatus" in record)) return null
      return stringMatch(record, filter, "stockStatus")
    },
    // SQL: catalog_app.product_inventory_summary_mv 와 EXISTS join 으로 재고 검사
    // value="instock" 또는 truthy 면 quantity > 0
    buildDbClause: (filter, next) => {
      const raw = String((filter as { rawValue?: unknown }).rawValue ?? filter.value ?? "").trim().toLowerCase()
      const wantInStock = raw === "instock" || raw === "in_stock" || raw === "true" || raw === "재고있음" || raw === "재고 있음" || raw === "있음"
      // 숫자 임계값 (예: "재고 50개 이상")
      const numMatch = raw.match(/^\d+/)
      if (numMatch) {
        const threshold = parseInt(numMatch[0], 10)
        const param = next(threshold)
        // 외부 FROM은 unaliased mv, EXISTS 내부에서 bare edp_no 가 outer 컬럼을 가리킴
        return `EXISTS (SELECT 1 FROM catalog_app.product_inventory_summary_mv inv WHERE inv.edp = edp_no AND inv.total_stock >= ${param})`
      }
      if (wantInStock || filter.op === "eq") {
        return `EXISTS (SELECT 1 FROM catalog_app.product_inventory_summary_mv inv WHERE inv.edp = edp_no AND inv.total_stock > 0)`
      }
      return null
    },
  },
  applicationShapes: {
    field: "applicationShapes",
    kind: "string",
    op: "includes",
    extractValues: record => extractPrimitiveValues(record, "applicationShapes"),
    matches: (record, filter) => stringMatch(record, filter, "applicationShapes"),
    buildDbClause: (filter, next) => buildLikeClause(["series_application_shape"], filter, next),
  },
  materialTags: {
    field: "materialTags",
    kind: "string",
    op: "includes",
    extractValues: record => extractPrimitiveValues(record, "materialTags"),
    matches: (record, filter) => stringMatch(record, filter, "materialTags"),
    buildDbClause: (filter, next) => {
      const raw = extractStringFilterRawValues(filter).map(value => value.trim().toUpperCase()).filter(Boolean)
      if (raw.length === 0) return null
      const param = next(raw)
      return `COALESCE(material_tags, ARRAY[]::text[]) && ${param}::text[]`
    },
  },
  materialTag: {
    field: "materialTag",
    kind: "string",
    op: "includes",
    buildDbClause: (filter, next) => {
      const raw = extractStringFilterRawValues(filter).map(value => value.trim().toUpperCase()).filter(Boolean)
      if (raw.length === 0) return null
      const param = next(raw)
      return `COALESCE(material_tags, ARRAY[]::text[]) && ${param}::text[]`
    },
  },
  edpBrandName: {
    field: "edpBrandName",
    matchPolicy: "strict_identifier",
    kind: "string",
    op: "includes",
    buildDbClause: (filter, next) => {
      const brands = extractStringFilterRawValues(filter)
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
      if (brands.length === 0) return null
      const param = next(brands)
      return `LOWER(COALESCE(edp_brand_name, '')) = ANY(${param}::text[])`
    },
  },
  edpSeriesName: {
    field: "edpSeriesName",
    matchPolicy: "strict_identifier",
    kind: "string",
    op: "includes",
    buildDbClause: (filter, next) => {
      const seriesNames = extractStringFilterRawValues(filter)
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
      if (seriesNames.length === 0) return null
      const param = next(seriesNames)
      return `LOWER(COALESCE(edp_series_name, '')) = ANY(${param}::text[])`
    },
  },
}

/**
 * Manifest → registry field alias map.
 *
 * Phase A landed with `query-spec-manifest.ts` exposing semantic IDs
 * (workpiece, materialGroup, toolFamily, operationType, shankType,
 * operationShape) that the SCR LLM now emits directly via
 * `buildManifestPromptSection()`. The registry below uses legacy IDs
 * (workPieceName, material, toolType, …). Without this alias map the
 * canonicalization in `buildAppliedFilterFromValue` silently fails with
 * `_canonFailed` for every manifest-ID the LLM emits.
 *
 * Phase B note: a full rename would require touching query-spec.ts
 * (QueryField union type — reserved for Phase C) or single-call-router.ts
 * (reserved — just landed), so we bridge transparently inside the registry.
 * operationType / operationShape have no registry equivalent yet — they
 * return null and are logged as unsupported; SCR already tolerates this.
 */
const MANIFEST_FIELD_ALIASES: Record<string, string> = {
  workpiece: "workPieceName",
  materialGroup: "material",
  toolFamily: "toolType",
  // toolSubtype, diameterMm, fluteCount, coating, brand, seriesName,
  // shankType, country, overallLengthMm, lengthOfCutMm, shankDiameterMm,
  // helixAngleDeg, coolantHole, pointAngleDeg, threadPitchMm — identical
}

function resolveFieldAlias(field: string): string {
  return MANIFEST_FIELD_ALIASES[field] ?? field
}

export function getFilterFieldDefinition(field: string): FilterFieldDefinition | null {
  return FILTER_FIELD_DEFINITIONS[resolveFieldAlias(field)] ?? null
}

export function getFilterFieldLabel(field: string): string {
  return FILTER_FIELD_DEFINITIONS[field]?.label ?? field
}

export function getFilterFieldQueryAliases(field: string): string[] {
  const definition = FILTER_FIELD_DEFINITIONS[field]
  if (!definition) return []

  return Array.from(new Set([
    definition.field,
    definition.label ?? "",
    ...(definition.queryAliases ?? []),
  ].filter(Boolean)))
}

export function getFilterFieldMatchPolicy(field: string): FilterMatchPolicy {
  return FILTER_FIELD_DEFINITIONS[field]?.matchPolicy ?? "llm_assisted"
}

export function getRegisteredFilterFields(): string[] {
  return Object.keys(FILTER_FIELD_DEFINITIONS)
}

export function buildAppliedFilterFromValue(
  field: string,
  rawValue: string | number | boolean | Array<string | number | boolean>,
  appliedAt = 0,
  opOverride?: string
): AppliedFilter | null {
  const definition = getFilterFieldDefinition(field)
  if (!definition) return null

  const targetField = definition.canonicalField ?? definition.field

  // For numeric fields, check fractional inch BEFORE multi-value splitting
  // so "5/16" doesn't get split into ["5", "16"] by MULTI_VALUE_SEPARATOR_PATTERN
  if (definition.kind === "number" && typeof rawValue === "string") {
    const inchMm = parseFractionalInchToMm(rawValue.trim())
    if (inchMm != null) {
      return buildAppliedFilterFromValue(field, inchMm, appliedAt)
    }
  }

  const inputValues = normalizeInputValues(definition.kind, rawValue)
  const normalizedValues = uniqPrimitiveValues(
    inputValues
      .map(value => definition.canonicalizeRawValue ? definition.canonicalizeRawValue(value) : value)
      .filter((value): value is FilterPrimitive => value != null)
  )
  if (normalizedValues.length === 0) return null

  if (definition.kind === "boolean") {
    const parsedValues = uniqPrimitiveValues(
      normalizedValues
        .map(value => parseBooleanValue(value))
        .filter((value): value is boolean => value != null)
    ).map(value => Boolean(value))
    if (parsedValues.length === 0) return null
    const rawBooleanValue = parsedValues.length === 1 ? parsedValues[0] : parsedValues
    return {
      field: targetField,
      op: opOverride ?? definition.op,
      value: parsedValues.map(value => value ? "true" : "false").join(", "),
      rawValue: rawBooleanValue,
      appliedAt,
    }
  }

  if (definition.kind === "number") {
    const parsedValues = uniqPrimitiveValues(
      normalizedValues
        .map(value => typeof value === "number" ? value : extractNumericValue(String(value)))
        .filter((value): value is number => value != null && !Number.isNaN(value))
    ).map(value => Number(value))
    if (parsedValues.length === 0) return null
    const rawNumberValue = parsedValues.length === 1 ? parsedValues[0] : parsedValues
    return {
      field: targetField,
      op: opOverride ?? definition.op,
      value: parsedValues.map(value => `${formatNumericValue(value)}${definition.unit ?? ""}`).join(", "),
      rawValue: rawNumberValue,
      appliedAt,
    }
  }

  const stringValues = normalizedValues
    .map(value => String(value).trim())
    .filter(Boolean)
  if (stringValues.length === 0) return null
  const rawStringValue = stringValues.length === 1 ? stringValues[0] : stringValues
  return {
    field: targetField,
    op: opOverride ?? definition.op,
    value: stringValues.join(", "),
    rawValue: rawStringValue,
    appliedAt,
  }
}

export function parseFieldAnswerToFilter(field: string, answer: string): AppliedFilter | null {
  const definition = getFilterFieldDefinition(field)
  if (!definition) return null

  const clean = stripLeadingFieldPhrase(answer, getFilterFieldQueryAliases(field))
  if (!clean) return null
  if (SKIP_TOKENS.has(clean.toLowerCase())) return null

  // For numeric fields, try fractional inch conversion BEFORE multi-value splitting
  // so that "3/8\"" doesn't get split on "/" by MULTI_VALUE_SEPARATOR_PATTERN.
  if (definition.kind === "number") {
    const inchMm = parseFractionalInchToMm(clean)
    if (inchMm != null) {
      return buildAppliedFilterFromValue(field, inchMm, 0)
    }
  }

  return buildAppliedFilterFromValue(field, clean, 0)
}

export function applyFilterToRecommendationInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  if (filter.op === "skip") {
    // skip 필터는 해당 필드를 클리어 — "skip" 문자열이 값으로 들어가면 안 됨
    const definition = getFilterFieldDefinition(filter.field)
    if (definition?.clearInput) return definition.clearInput(input)
    return { ...input }
  }
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition?.setInput) return { ...input }
  return definition.setInput(input, filter)
}

export function clearFilterFromRecommendationInput(input: RecommendationInput, field: string): RecommendationInput {
  const definition = getFilterFieldDefinition(field)
  if (!definition?.clearInput) return { ...input }
  return definition.clearInput(input)
}

export function extractDistinctFilterFieldValues(
  records: Array<Record<string, unknown>>,
  field: string
): string[] {
  const definition = getFilterFieldDefinition(field)
  if (!definition?.extractValues) return []

  const values = new Set<string>()
  for (const record of records) {
    for (const value of definition.extractValues(record)) {
      if (value == null) continue
      values.add(String(value))
    }
  }
  return Array.from(values)
}

export function buildFilterValueScope(
  records: Array<Record<string, unknown>>,
  fields: string[] = getRegisteredFilterFields()
): Record<string, string[]> {
  const scope: Record<string, string[]> = {}

  for (const field of fields) {
    scope[field] = extractDistinctFilterFieldValues(records, field)
  }

  return scope
}

export function extractFilterFieldValueMap(
  candidates: ScoredProduct[],
  fields: string[]
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()

  for (const field of fields) {
    const definition = getFilterFieldDefinition(field)
    if (!definition?.extractValues) continue

    const distribution = new Map<string, number>()
    for (const candidate of candidates) {
      for (const value of definition.extractValues(candidate)) {
        if (value == null) continue
        const label = String(value)
        distribution.set(label, (distribution.get(label) ?? 0) + 1)
      }
    }
    if (distribution.size > 1) {
      result.set(field, distribution)
    }
  }

  return result
}

export function applyPostFilterToProducts(
  products: CanonicalProduct[],
  filter: AppliedFilter
): CanonicalProduct[] | null {
  // skip 필터는 후처리에서도 제외
  if (filter.op === "skip") return null
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition?.matches) return null

  const isNeg = filter.op === "neq" || filter.op === "exclude"
  return products.filter(product => {
    const matched = definition.matches?.(product, filter) === true
    return isNeg ? !matched : matched
  })
}

export function buildDbWhereClauseForFilter(
  filter: AppliedFilter,
  next: (value: unknown) => string
): string | null {
  // skip 필터는 DB 쿼리에서 제외 — "상관없음"으로 WHERE 걸리면 0건
  if (filter.op === "skip") return null

  // SQL Agent rawSqlField → 동적 스키마 검증 후 직접 WHERE절 생성.
  // 화이트리스트 제거: DB에 추가되는 모든 컬럼이 자동으로 필터 가능해야 함.
  // 안전장치: ① identifier 정규식 ② live schema 컬럼 존재 여부 ③ numeric op는 numeric 컬럼만
  if (filter.rawSqlField) {
    // 1. SQL injection 방어: 안전한 식별자 패턴만
    const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,63}$/
    if (!SAFE_IDENT.test(filter.rawSqlField)) {
      console.warn(`[where:rawSql] reject unsafe identifier: ${filter.rawSqlField}`)
      return null
    }

    // 2. 실제 MV에 존재하는 컬럼인지 검증 (sql-agent에서 1차 검증했지만 belt-and-suspenders)
    const schema = getDbSchemaSync()
    const colMeta = schema?.columns.find(c => c.column_name === filter.rawSqlField)
    if (!colMeta) {
      console.warn(`[where:rawSql] reject unknown column: ${filter.rawSqlField}`)
      return null
    }

    const op = filter.rawSqlOp
    const dataType = colMeta.data_type
    const isNumericColumn = /int|numeric|real|double|float|decimal/i.test(dataType)
    const isArrayColumn = dataType === "ARRAY" || /\[\]$/.test(dataType)
    const isNumericOp = op === "gte" || op === "lte" || op === "between"
    if (isNumericOp && !isNumericColumn) {
      console.warn(`[where:rawSql] numeric op ${op} on non-numeric column ${filter.rawSqlField} (${dataType})`)
      return null
    }

    // 3a. text[] 배열 컬럼은 overlap 연산자 사용 (country_codes 등)
    if (isArrayColumn && (op === "eq" || op === "like")) {
      const val = filter.rawValue
      const arr = Array.isArray(val) ? val.map(String) : [String(val)]
      return `COALESCE(${filter.rawSqlField}, ARRAY[]::text[]) && ${next(arr)}::text[]`
    }

    // 3b. 일반 컬럼
    switch (op) {
      case "eq": return `${filter.rawSqlField} = ${next(filter.rawValue)}`
      case "neq": return `${filter.rawSqlField} != ${next(filter.rawValue)}`
      case "like": return `LOWER(COALESCE(${filter.rawSqlField}::text, '')) LIKE ${next("%" + String(filter.rawValue).toLowerCase() + "%")}`
      case "gte": return `${filter.rawSqlField} >= ${next(filter.rawValue)}`
      case "lte": return `${filter.rawSqlField} <= ${next(filter.rawValue)}`
      case "between": {
        const v2 = (filter as { rawValue2?: unknown }).rawValue2
        if (v2 == null) return null
        return `${filter.rawSqlField} BETWEEN ${next(filter.rawValue)} AND ${next(v2)}`
      }
      default: return null
    }
  }

  // NEQ 필터: 해당 값을 가진 제품만 제외 (NULL/빈값은 포함)
  if (filter.op === "neq") {
    const definition = getFilterFieldDefinition(filter.field)
    if (!definition?.buildDbClause) return null
    const eqClause = definition.buildDbClause({ ...filter, op: "eq" }, next)
    if (!eqClause) return null
    return `NOT (${eqClause})`
  }

  // Range ops (gte/lte/between): numeric 필드만 허용. buildNumericEqualityClause
  // 가 filter.op를 직접 보고 range SQL을 만들어주므로 그대로 위임한다.
  if (filter.op === "gte" || filter.op === "lte" || filter.op === "between") {
    const definition = getFilterFieldDefinition(filter.field)
    if (!definition || definition.kind !== "number") return null
    if (!definition.buildDbClause) return null
    return definition.buildDbClause(filter, next)
  }

  const definition = getFilterFieldDefinition(filter.field)
  if (!definition?.buildDbClause) return null
  return definition.buildDbClause(filter, next)
}
