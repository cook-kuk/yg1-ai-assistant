/**
 * Query Target Classifier — Separates answer topic from search scope constraints.
 *
 * RULE: Active filters are constraints, NOT the topic of the current question.
 *
 * Priority for topic selection:
 * 1. Latest user query target (explicit entities, comparison requests)
 * 2. Explicit entity mentions in latest user query
 * 3. Current visible UI context
 * 4. Active filters (ONLY as scope constraint)
 * 5. Pending field / generic fallback
 *
 * Deterministic. No LLM calls.
 */

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

const SERIES_NAME_PATTERN = /\b(ALU[-\s]?CUT(?:\s+(?:POWER|HPC|for\s+Korean\s+Market))?|TANK[-\s]?POWER|X[-\s]?POWER|I[-\s]?POWER|V[-\s]?POWER|ALU[-\s]?MILL|ALU[-\s]?POWER(?:\s+HPC)?|INOX[-\s]?POWER|X\d{4,}|E\d[A-Z]\d+|GAA\d+|GEE\d+|JAH\d+|ALM\d+|EI\d+|[A-Z]{2,5}\d{2,4}[A-Z]?|[A-Z]{1,4}\d[A-Z]{1,3}\d{2,4}[A-Z]?)\b/gi
const BRAND_NAME_PATTERN = /\b(E[·∙ㆍ.]?\s*FORCE(?:\s+BLUE)?(?:\s+for\s+Korean\s+Market)?|4G\s*MILLS(?:\s*-\s*KOR)?|SUPER\s+ALLOY|X5070\s*S)\b/gi
const PRODUCT_CODE_PATTERN = /\b(?:[A-Z]{2,5}\d{4,}[A-Z]*\d*|[A-Z]\d[A-Z]\d{4,}[A-Z]?)\b/g
const COMPARISON_PATTERN = /차이|비교|vs|대비|어떤.*게.*낫|뭐가.*다른|뭐가.*좋|어떤.*게.*좋/i
const SERIES_INFO_PATTERN = /시리즈|특징|장점|단점|용도|적합/i
const COUNT_PATTERN = /몇\s*개|갯수|분포|몇\s*종/i
const COMPANY_INFO_PATTERN = /영업소|공장|본사|대표|회장|사장|매출|주주|연혁|설립|창업|직원|채용|전화|연락|번호|카탈로그|인증|수상|연구소/i
const ENTITY_COMPARISON_PATTERN = /([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)\s*(?:vs\.?|VS\.?|와|과|이랑|랑|대비)\s*([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)(?=\s*(?:의|은|는|이|가|를|을|차이|비교|특징|설명|$))/giu

const FIELD_KEYWORDS: Record<string, RegExp> = {
  coating: /코팅|DLC|TiAlN|AlCrN|AlTiN|무코팅|Bright\s*Finish/i,
  fluteCount: /날\s*수|날수|플루트|flute|\d날/i,
  toolSubtype: /형상|서브타입|Square|Ball|Radius|Taper|스퀘어|볼|라디우스/i,
  material: /소재|재질|피삭재|알루미늄|스테인리스|탄소강/i,
  diameterMm: /직경|지름|mm/i,
  toolMaterial: /공구\s*소재|카바이드|초경|HSS|고속도강/i,
}

function resolveComparisonType(
  productMatches: string[],
  hasBrandEntities: boolean,
  mentionsBrand: boolean
): QueryTargetType {
  if (productMatches.length >= 2) return "product_comparison"
  return hasBrandEntities || mentionsBrand ? "brand_comparison" : "series_comparison"
}

export function classifyQueryTarget(
  userMessage: string,
  activeFilterField?: string | null,
  pendingField?: string | null
): QueryTarget {
  const clean = userMessage.trim()
  const lower = clean.toLowerCase()

  const seriesMatches = Array.from(clean.matchAll(SERIES_NAME_PATTERN)).map(match => match[0])
  const brandMatches = Array.from(clean.matchAll(BRAND_NAME_PATTERN)).map(match => match[0])
  const productMatches = Array.from(clean.matchAll(PRODUCT_CODE_PATTERN)).map(match => match[0])
  const comparisonEntityMatches = Array.from(clean.matchAll(ENTITY_COMPARISON_PATTERN)).flatMap(match => [match[1], match[2]])
  const entities = [...new Set([...seriesMatches, ...brandMatches, ...productMatches, ...comparisonEntityMatches].map(entity => entity.trim()).filter(Boolean))]
  const hasBrandEntities = brandMatches.length > 0 && seriesMatches.length === 0 && productMatches.length === 0
  const mentionsBrand = /브랜드|brand/i.test(clean)

  const isComparison = COMPARISON_PATTERN.test(lower)
  if (isComparison && entities.length >= 2) {
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

  const looseComparisonWithConjunction = clean.match(/(.+?)\s*[과와랑]\s*(.+?)\s*(차이|비교|다른|좋|별로|뭐)/i)
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

  if (entities.length >= 1 && SERIES_INFO_PATTERN.test(lower)) {
    return {
      type: hasBrandEntities || mentionsBrand ? "brand_info" : "series_info",
      entities,
      overridesActiveFilter: true,
      answerTopic: hasBrandEntities || mentionsBrand ? `${entities[0]} 브랜드 정보` : `${entities[0]} 시리즈 정보`,
      searchScopeOnly: true,
      requiresSearch: true,
      searchScope: hasBrandEntities || mentionsBrand ? "brand_lookup" : "series_lookup",
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

  if (COMPANY_INFO_PATTERN.test(lower)) {
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
    const fieldPattern = FIELD_KEYWORDS[activeField]
    if (fieldPattern && fieldPattern.test(lower)) {
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
    return {
      type: hasBrandEntities || mentionsBrand ? "brand_info" : "series_info",
      entities,
      overridesActiveFilter: true,
      answerTopic: `${entities[0]} 정보`,
      searchScopeOnly: true,
      requiresSearch: true,
      searchScope: hasBrandEntities || mentionsBrand ? "brand_lookup" : "series_lookup",
    }
  }

  if (COUNT_PATTERN.test(lower)) {
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

  if (/설명|알려|뭐야|차이/.test(lower) && !activeField) {
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
  activeFilterField?: string | null
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

  if (fieldMentions >= 2 && entityMentions <= 1) {
    return true
  }

  return false
}
