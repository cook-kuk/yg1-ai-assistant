import { findKnownEntityMentions } from "@/lib/recommendation/shared/entity-registry"

export type QueryTargetType =
  | "series_comparison"
  | "brand_comparison"
  | "product_comparison"
  | "series_info"
  | "brand_info"
  | "product_info"
  | "company_info"
  | "field_explanation"
  | "field_count"
  | "general_question"
  | "active_field_query"
  | "unknown"

export interface QueryTarget {
  entities: string[]
  overridesActiveFilter: boolean
  answerTopic: string
  searchScopeOnly: boolean
  requiresSearch: boolean
  searchScope: "current_candidates" | "targeted_entity" | "targeted_comparison" | "series_lookup" | "brand_lookup" | "broad_search" | "none"
  type: QueryTargetType
}

const PRODUCT_CODE_PATTERN = /\b(?:[A-Z]{2,5}\d{4,}[A-Z]*\d*|[A-Z]\d[A-Z]\d{4,}[A-Z]?)\b/g
const COMPARISON_PATTERN = /차이|비교|vs|대비|어떤.*(게|것).*(좋|나아)|뭐가.*(더|더욱).*(좋|나아)/i
const SERIES_INFO_PATTERN = /시리즈|특징|장점|용도|적합/i
const COUNT_PATTERN = /몇\s*개|개수|분포|몇\s*종/i
const COMPANY_INFO_PATTERN = /영업소|공장|본사|대표|회장|매출|주주|경영|설립|창업|직원|채용|전화|연락|번호|카탈로그|인증|수상|연구소/i
const ENTITY_COMPARISON_PATTERN = /([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)\s*(?:vs\.?|VS\.?|와|과|이랑|랑|대비)\s*([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)(?=\s*(?:의|은|는|이|가|를|을|차이|비교|특징|설명|$))/giu

const FIELD_KEYWORDS: Record<string, RegExp> = {
  coating: /코팅|DLC|TiAlN|AlCrN|AlTiN|무코팅|Bright\s*Finish/i,
  fluteCount: /날\s*수|날수|플루트|flute|\d\s*날/i,
  toolSubtype: /형상|서브타입|Square|Ball|Radius|Taper|스퀘어|볼|라디우스/i,
  material: /소재|재질|피삭재|알루미늄|스테인리스|탄소강/i,
  diameterMm: /직경|지름|diameter|파이|mm/i,
  toolMaterial: /공구\s*소재|카바이드|초경|HSS|고속도강/i,
}

function dedupeEntities(values: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    const key = trimmed.toUpperCase().replace(/[\s\-·∙ㆍ.]+/g, "")
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(trimmed)
  }

  return deduped
}

function resolveComparisonType(
  productMatches: string[],
  hasBrandEntities: boolean,
  mentionsBrand: boolean,
): QueryTargetType {
  if (productMatches.length >= 2) return "product_comparison"
  return hasBrandEntities || mentionsBrand ? "brand_comparison" : "series_comparison"
}

export function classifyQueryTarget(
  userMessage: string,
  activeFilterField?: string | null,
  pendingField?: string | null,
): QueryTarget {
  const clean = userMessage.trim()

  const seriesMatches = findKnownEntityMentions("series", clean)
  const brandMatches = findKnownEntityMentions("brand", clean).filter(brand => !seriesMatches.includes(brand))
  const productMatches = Array.from(clean.matchAll(PRODUCT_CODE_PATTERN)).map(match => match[0])
  const comparisonEntityMatches = Array.from(clean.matchAll(ENTITY_COMPARISON_PATTERN))
    .flatMap(match => [match[1], match[2]])
    .filter(Boolean)
  const entities = dedupeEntities([
    ...seriesMatches,
    ...brandMatches,
    ...productMatches,
    ...comparisonEntityMatches,
  ])

  const mentionsBrand = /브랜드|brand/i.test(clean)
  const hasBrandEntities = mentionsBrand && brandMatches.length > 0 && seriesMatches.length === 0 && productMatches.length === 0

  if (COMPARISON_PATTERN.test(clean) && entities.length >= 2) {
    const comparisonType = resolveComparisonType(productMatches, hasBrandEntities, mentionsBrand)
    return {
      type: comparisonType,
      entities,
      overridesActiveFilter: true,
      answerTopic: `${entities.join(" vs ")} 비교`,
      searchScopeOnly: true,
      requiresSearch: true,
      searchScope: "targeted_comparison",
    }
  }

  const comparisonWithConjunction = Array.from(clean.matchAll(ENTITY_COMPARISON_PATTERN))[0] ?? null
  if (comparisonWithConjunction) {
    const entity1 = comparisonWithConjunction[1].trim()
    const entity2 = comparisonWithConjunction[2].trim()
    if (entity1.length >= 2 && entity2.length >= 2) {
      const comparisonType = resolveComparisonType(productMatches, hasBrandEntities, mentionsBrand)
      return {
        type: comparisonType,
        entities: [entity1, entity2],
        overridesActiveFilter: true,
        answerTopic: `${entity1} vs ${entity2} 비교`,
        searchScopeOnly: true,
        requiresSearch: true,
        searchScope: "targeted_comparison",
      }
    }
  }

  const looseComparisonWithConjunction = clean.match(/(.+?)\s*(?:와|과|이랑|랑)\s*(.+?)\s*(차이|비교|다른|비교해|뭐)/i)
  if (looseComparisonWithConjunction) {
    const entity1 = looseComparisonWithConjunction[1].trim()
    const entity2 = looseComparisonWithConjunction[2].trim()
    if (entity1.length >= 2 && entity2.length >= 2) {
      const comparisonType = resolveComparisonType(productMatches, hasBrandEntities, mentionsBrand)
      return {
        type: comparisonType,
        entities: [entity1, entity2],
        overridesActiveFilter: true,
        answerTopic: `${entity1} vs ${entity2} 비교`,
        searchScopeOnly: true,
        requiresSearch: true,
        searchScope: "targeted_comparison",
      }
    }
  }

  if (entities.length >= 1 && SERIES_INFO_PATTERN.test(clean)) {
    const type = hasBrandEntities ? "brand_info" : "series_info"
    return {
      type,
      entities,
      overridesActiveFilter: true,
      answerTopic: type === "brand_info" ? `${entities[0]} 브랜드 정보` : `${entities[0]} 시리즈 정보`,
      searchScopeOnly: true,
      requiresSearch: true,
      searchScope: type === "brand_info" ? "brand_lookup" : "series_lookup",
    }
  }

  if (productMatches.length >= 1) {
    return {
      type: "product_info",
      entities: productMatches,
      overridesActiveFilter: true,
      answerTopic: `${productMatches[0]} 제품 정보`,
      searchScopeOnly: true,
      requiresSearch: true,
      searchScope: "targeted_entity",
    }
  }

  if (COMPANY_INFO_PATTERN.test(clean)) {
    return {
      type: "company_info",
      entities: [],
      overridesActiveFilter: true,
      answerTopic: "company_info",
      searchScopeOnly: false,
      requiresSearch: false,
      searchScope: "none",
    }
  }

  const activeField = activeFilterField ?? pendingField
  if (activeField) {
    if (activeField === "diameterMm" && /^\s*\d+(?:\.\d+)?\s*mm(?:\s+\S+)?\s*$/i.test(clean)) {
      return {
        type: "unknown",
        entities: [],
        overridesActiveFilter: false,
        answerTopic: "unknown",
        searchScopeOnly: false,
        requiresSearch: false,
        searchScope: "none",
      }
    }
    const fieldPattern = FIELD_KEYWORDS[activeField]
    if (fieldPattern && fieldPattern.test(clean)) {
      return {
        type: "active_field_query",
        entities: [],
        overridesActiveFilter: false,
        answerTopic: `${activeField} 설명`,
        searchScopeOnly: false,
        requiresSearch: false,
        searchScope: "none",
      }
    }
  }

  if (entities.length >= 1) {
    const type = hasBrandEntities ? "brand_info" : "series_info"
    return {
      type,
      entities,
      overridesActiveFilter: true,
      answerTopic: `${entities[0]} 정보`,
      searchScopeOnly: true,
      requiresSearch: true,
      searchScope: type === "brand_info" ? "brand_lookup" : "series_lookup",
    }
  }

  if (COUNT_PATTERN.test(clean)) {
    return {
      type: "field_count",
      entities: [],
      overridesActiveFilter: false,
      answerTopic: "분포/개수",
      searchScopeOnly: false,
      requiresSearch: true,
      searchScope: "current_candidates",
    }
  }

  if (/설명|알려|뭐야|차이/.test(clean) && !activeField) {
    return {
      type: "general_question",
      entities: [],
      overridesActiveFilter: false,
      answerTopic: "일반 질문",
      searchScopeOnly: false,
      requiresSearch: false,
      searchScope: "none",
    }
  }

  return {
    type: "unknown",
    entities: [],
    overridesActiveFilter: false,
    answerTopic: "unknown",
    searchScopeOnly: false,
    requiresSearch: false,
    searchScope: "none",
  }
}

export function isWrongTopicAnswer(
  answerText: string,
  queryTarget: QueryTarget,
  activeFilterField?: string | null,
): boolean {
  if (!queryTarget.overridesActiveFilter || !activeFilterField) return false

  const fieldPattern = FIELD_KEYWORDS[activeFilterField]
  if (!fieldPattern) return false

  const globalFieldPattern = new RegExp(fieldPattern.source, "gi")
  const fieldMentions = (answerText.match(globalFieldPattern) ?? []).length

  let entityMentions = 0
  for (const entity of queryTarget.entities) {
    const entityPattern = new RegExp(entity.replace(/[-\s]/g, "[-\\s]?"), "gi")
    entityMentions += (answerText.match(entityPattern) ?? []).length
  }

  return fieldMentions >= 2 && entityMentions <= 1
}
