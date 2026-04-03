import type {
  AppliedFilter,
  CanonicalProduct,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import {
  SKIP_TOKENS as SHARED_SKIP_TOKENS,
  COATING_KO_ALIASES as SHARED_COATING_KO_ALIASES,
  canonicalizeCoating as sharedCanonicalizeCoating,
  canonicalizeToolSubtype as sharedCanonicalizeToolSubtype,
  stripKoreanParticles,
} from "@/lib/recommendation/shared/patterns"

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
    .replace(/(?:밀리|미리)\s*$/u, "")
}

/**
 * Strip trailing Korean particles from values:
 * "알루미늄으로" → "알루미늄", "2날이요" → "2날"
 */
// stripKoreanParticles는 shared/patterns.ts에서 import

function extractNumericValue(value: string): number | null {
  const cleaned = stripApproximateAffixes(value)
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
  const coalesced = `COALESCE(${columns.map(column => `NULLIF(${column}, '')`).join(", ")}, '')`
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
  const numericExpr = firstNumberFromColumns(columns)
  const clauses = rawValues.map(raw => {
    const param = next(raw)
    if (tolerance <= 0) {
      return `${numericExpr} = ${param}`
    }
    return `${numericExpr} IS NOT NULL AND ABS(${numericExpr} - ${param}) <= ${tolerance}`
  })
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`
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
  return extractPrimitiveValues(record, key).some(value => {
    if (typeof value !== "number") return false
    return rawValues.some(raw => Math.abs(value - raw) <= tolerance)
  })
}

function booleanMatch(record: FilterRecord, filter: AppliedFilter, key: string): boolean {
  const wants = extractBooleanFilterRawValues(filter)
  if (wants.length === 0) return false
  return extractPrimitiveValues(record, key).some(value => {
    const parsed = parseBooleanValue(value)
    return parsed != null && wants.includes(parsed)
  })
}

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
    setInput: (input, filter) => ({ ...input, material: joinedFilterStringValue(filter), workPieceName: undefined }),
    clearInput: input => ({ ...input, material: undefined, workPieceName: undefined }),
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
      }
      // Strip Korean particles first: "알루미늄으로" → "알루미늄"
      const stripped = stripKoreanParticles(String(rawValue).trim())
      const normalized = stripped.toLowerCase().replace(/\s+/g, "")
      return WORKPIECE_KO_ALIASES[normalized] ?? (stripped || null)
    },
    setInput: (input, filter) => ({ ...input, workPieceName: joinedFilterStringValue(filter) }),
    clearInput: input => ({ ...input, workPieceName: undefined }),
  },
  fluteCount: {
    field: "fluteCount",
    label: "날 수",
    queryAliases: ["날 수", "날수", "몇 날", "flute", "날"],
    kind: "number",
    op: "eq",
    unit: "날",
    canonicalizeRawValue: (rawValue) => {
      // Strip Korean particles from flute expressions: "2날이요" → "2날" → 2
      const s = stripKoreanParticles(String(rawValue).trim())
      // English word numbers: "two flute" → 2, "four flute" → 4
      const WORD_NUMBERS: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10,
      }
      const wordMatch = s.toLowerCase().match(/^(one|two|three|four|five|six|seven|eight|nine|ten)\b/)
      if (wordMatch) return WORD_NUMBERS[wordMatch[1]] ?? rawValue
      // Reversed Korean order: "날 2개" → 2
      const reversedMatch = s.match(/^날\s*(\d+)\s*개?$/)
      if (reversedMatch) return parseInt(reversedMatch[1], 10)
      return extractNumericValue(s) ?? rawValue
    },
    setInput: (input, filter) => ({ ...input, flutePreference: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, flutePreference: undefined }),
    extractValues: record => extractPrimitiveValues(record, "fluteCount"),
    matches: (record, filter) => numericMatch(record, filter, "fluteCount"),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["option_numberofflute", "option_z", "milling_number_of_flute", "holemaking_number_of_flute", "threading_number_of_flute"],
      filter,
      next,
      0.0001
    ),
  },
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
    matches: (record, filter) => stringMatch(record, filter, "coating"),
    buildDbClause: (filter, next) => buildLikeClause(["search_coating"], filter, next),
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
    queryAliases: ["공구 소재", "tool material", "초경", "카바이드", "hss"],
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
      /** Natural-language → ISO 3166-1 alpha-3 (DB standard) */
      const COUNTRY_NAME_MAP: Record<string, string> = {
        // Korean names
        한국: "KOR", 대한민국: "KOR",
        미국: "USA",
        일본: "JPN",
        중국: "CHN",
        독일: "DEU",
        영국: "ENG",
        프랑스: "FRA",
        이탈리아: "ITA",
        스페인: "ESP",
        러시아: "RUS",
        태국: "THA",
        베트남: "VNM",
        폴란드: "POL",
        헝가리: "HUN",
        튀르키예: "TUR", 터키: "TUR",
        체코: "CZE",
        포르투갈: "PRT",
        // English names
        korea: "KOR", "south korea": "KOR",
        usa: "USA", "united states": "USA", america: "USA",
        japan: "JPN",
        china: "CHN",
        germany: "DEU",
        england: "ENG", uk: "ENG", "united kingdom": "ENG", britain: "ENG",
        france: "FRA",
        italy: "ITA",
        spain: "ESP",
        russia: "RUS",
        thailand: "THA",
        vietnam: "VNM",
        poland: "POL",
        hungary: "HUN",
        turkey: "TUR", türkiye: "TUR",
        czech: "CZE", czechia: "CZE", "czech republic": "CZE",
        portugal: "PRT",
        // Old alpha-2 backward compat
        kr: "KOR",
        us: "USA",
        jp: "JPN",
        cn: "CHN",
        de: "DEU",
      }
      /** Region → multiple country codes (comma-separated for downstream split) */
      const REGION_MAP: Record<string, string> = {
        아시아: "KOR,JPN,CHN,THA,VNM",
        유럽: "ENG,DEU,ESP,FRA,HUN,ITA,POL,PRT,RUS,TUR,CZE",
        asia: "KOR,JPN,CHN,THA,VNM",
        europe: "ENG,DEU,ESP,FRA,HUN,ITA,POL,PRT,RUS,TUR,CZE",
      }
      const trimmed = String(rawValue).trim()
      const lower = trimmed.toLowerCase()
      // Check region first
      if (REGION_MAP[lower] || REGION_MAP[trimmed]) {
        return REGION_MAP[lower] ?? REGION_MAP[trimmed]
      }
      return COUNTRY_NAME_MAP[lower] ?? COUNTRY_NAME_MAP[trimmed] ?? (trimmed.toUpperCase() || null)
    },
    op: "includes",
    setInput: (input, filter) => {
      const value = joinedFilterStringValue(filter)
      return { ...input, country: value ? value.toUpperCase() : undefined }
    },
    clearInput: input => ({ ...input, country: undefined }),
    extractValues: record => extractPrimitiveValues(record, "country"),
    matches: (record, filter) => stringMatch(record, {
      ...filter,
      rawValue: extractStringFilterRawValues(filter).map(value => value.toUpperCase()),
    }, "country"),
    buildDbClause: (filter, next) => {
      const normalized = extractStringFilterRawValues(filter)
        .map(value => value.trim().toUpperCase())
        .filter(Boolean)
      if (normalized.length === 0) return null
      const param = next(normalized)
      return `COALESCE(country_codes, ARRAY[]::text[]) && ${param}::text[]`
    },
  },
  shankDiameterMm: {
    field: "shankDiameterMm",
    label: "생크 직경",
    queryAliases: ["생크", "shank"],
    kind: "number",
    op: "eq",
    unit: "mm",
    setInput: (input, filter) => ({ ...input, shankDiameterMm: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, shankDiameterMm: undefined }),
    extractValues: record => extractPrimitiveValues(record, "shankDiameterMm"),
    matches: (record, filter) => numericMatch(record, filter, "shankDiameterMm", 0.5),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["milling_shank_dia", "holemaking_shank_dia", "threading_shank_dia", "option_shank_diameter", "option_dcon"],
      filter,
      next,
      0.5
    ),
  },
  lengthOfCutMm: {
    field: "lengthOfCutMm",
    label: "절삭 길이",
    queryAliases: ["절삭길이", "절삭 길이", "날길이", "날 길이", "loc"],
    kind: "number",
    op: "eq",
    unit: "mm",
    setInput: (input, filter) => ({ ...input, lengthOfCutMm: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, lengthOfCutMm: undefined }),
    extractValues: record => extractPrimitiveValues(record, "lengthOfCutMm"),
    matches: (record, filter) => numericMatch(record, filter, "lengthOfCutMm", 2),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["milling_length_of_cut", "holemaking_flute_length", "threading_thread_length", "option_flute_length", "option_loc"],
      filter,
      next,
      2
    ),
  },
  overallLengthMm: {
    field: "overallLengthMm",
    label: "전장",
    queryAliases: ["전장", "전체 길이", "oal"],
    kind: "number",
    op: "eq",
    unit: "mm",
    setInput: (input, filter) => ({ ...input, overallLengthMm: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, overallLengthMm: undefined }),
    extractValues: record => extractPrimitiveValues(record, "overallLengthMm"),
    matches: (record, filter) => numericMatch(record, filter, "overallLengthMm", 5),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["milling_overall_length", "holemaking_overall_length", "threading_overall_length", "option_overall_length", "option_oal"],
      filter,
      next,
      5
    ),
  },
  helixAngleDeg: {
    field: "helixAngleDeg",
    label: "헬릭스각",
    queryAliases: ["헬릭스", "나선각", "helix"],
    kind: "number",
    op: "eq",
    unit: "°",
    setInput: (input, filter) => ({ ...input, helixAngleDeg: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, helixAngleDeg: undefined }),
    extractValues: record => extractPrimitiveValues(record, "helixAngleDeg"),
    matches: (record, filter) => numericMatch(record, filter, "helixAngleDeg", 2),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["milling_helix_angle", "holemaking_helix_angle"],
      filter,
      next,
      2
    ),
  },
  ballRadiusMm: {
    field: "ballRadiusMm",
    label: "볼 반경",
    queryAliases: ["볼 반경", "ball radius"],
    kind: "number",
    op: "eq",
    unit: "mm",
    setInput: (input, filter) => ({ ...input, ballRadiusMm: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, ballRadiusMm: undefined }),
    extractValues: record => extractPrimitiveValues(record, "ballRadiusMm"),
    matches: (record, filter) => numericMatch(record, filter, "ballRadiusMm"),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["milling_ball_radius", "option_r", "option_re"],
      filter,
      next,
      0.0001
    ),
  },
  taperAngleDeg: {
    field: "taperAngleDeg",
    label: "테이퍼각",
    queryAliases: ["테이퍼각", "taper"],
    kind: "number",
    op: "eq",
    unit: "°",
    setInput: (input, filter) => ({ ...input, taperAngleDeg: firstFilterNumberValue(filter) }),
    clearInput: input => ({ ...input, taperAngleDeg: undefined }),
    extractValues: record => extractPrimitiveValues(record, "taperAngleDeg"),
    matches: (record, filter) => numericMatch(record, filter, "taperAngleDeg", 0.5),
    buildDbClause: (filter, next) => buildNumericEqualityClause(
      ["milling_taper_angle", "option_taperangle"],
      filter,
      next,
      0.5
    ),
  },
  coolantHole: {
    field: "coolantHole",
    label: "쿨런트 홀",
    queryAliases: ["쿨런트", "절삭유홀", "coolant", "coolant hole"],
    kind: "boolean",
    op: "eq",
    setInput: (input, filter) => ({ ...input, coolantHole: firstFilterBooleanValue(filter) }),
    clearInput: input => ({ ...input, coolantHole: undefined }),
    extractValues: record => extractPrimitiveValues(record, "coolantHole"),
    matches: (record, filter) => booleanMatch(record, filter, "coolantHole"),
  },
  stockStatus: {
    field: "stockStatus",
    kind: "string",
    op: "includes",
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

export function getFilterFieldDefinition(field: string): FilterFieldDefinition | null {
  return FILTER_FIELD_DEFINITIONS[field] ?? null
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
  appliedAt = 0
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
      op: definition.op,
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
      op: definition.op,
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
    op: definition.op,
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

  return products.filter(product => definition.matches?.(product, filter) === true)
}

export function buildDbWhereClauseForFilter(
  filter: AppliedFilter,
  next: (value: unknown) => string
): string | null {
  // skip 필터는 DB 쿼리에서 제외 — "상관없음"으로 WHERE 걸리면 0건
  if (filter.op === "skip") return null
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition?.buildDbClause) return null
  return definition.buildDbClause(filter, next)
}
