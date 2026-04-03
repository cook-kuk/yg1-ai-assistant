import type {
  AppliedFilter,
  CanonicalProduct,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

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

const SKIP_TOKENS = new Set(["상관없음", "상관 없음", "모름", "skip"])
const MULTI_VALUE_SEPARATOR_PATTERN = /\s*(?:,|\/|\||또는|아니면| and | or |(?<=[0-9A-Za-z가-힣])(?:과|와)(?=\s*[0-9A-Za-z가-힣]))\s*/iu

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

function extractNumericValue(value: string): number | null {
  const match = value.match(/([-+]?\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = parseFloat(match[1])
  return Number.isNaN(parsed) ? null : parsed
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

function canonicalizeToolSubtypeRawValue(rawValue: string | number | boolean): string | null {
  const normalized = String(rawValue)
    .trim()
    .toLowerCase()
    .replace(/[()\s_-]+/g, "")

  if (!normalized) return null

  const aliases: Record<string, string> = {
    square: "Square",
    스퀘어: "Square",
    ball: "Ball",
    볼: "Ball",
    radius: "Radius",
    라디우스: "Radius",
    cornerradius: "Corner Radius",
    roughing: "Roughing",
    rough: "Roughing",
    황삭: "Roughing",
    taper: "Taper",
    테이퍼: "Taper",
    chamfer: "Chamfer",
    챔퍼: "Chamfer",
    highfeed: "High-Feed",
    하이피드: "High-Feed",
  }

  for (const [alias, canonical] of Object.entries(aliases)) {
    if (normalized.includes(alias)) return canonical
  }

  return String(rawValue).trim() || null
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
    queryAliases: ["코팅", "coat", "coating"],
    kind: "string",
    op: "includes",
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
    queryAliases: ["형상", "타입", "subtype", "square", "radius", "ball", "roughing", "rough", "황삭", "라디우스", "볼", "스퀘어"],
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
    queryAliases: ["국가", "생산국", "원산지", "country"],
    kind: "string",
    matchPolicy: "strict_identifier",
    canonicalizeRawValue: rawValue => String(rawValue).trim().toUpperCase() || null,
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
      return `EXISTS (SELECT 1 FROM unnest(COALESCE(country_codes, ARRAY[]::text[])) AS country_row(country_code) WHERE UPPER(BTRIM(country_row.country_code)) = ANY(${param}::text[]))`
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

  return buildAppliedFilterFromValue(field, clean, 0)
}

export function applyFilterToRecommendationInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
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
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition?.matches) return null

  return products.filter(product => definition.matches?.(product, filter) === true)
}

export function buildDbWhereClauseForFilter(
  filter: AppliedFilter,
  next: (value: unknown) => string
): string | null {
  const definition = getFilterFieldDefinition(filter.field)
  if (!definition?.buildDbClause) return null
  return definition.buildDbClause(filter, next)
}
