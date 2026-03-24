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

// ── Query Target Types ──────────────────────────────────────

export type QueryTargetType =
  | "series_comparison"    // "ALU-CUT vs ALU-CUT POWER"
  | "brand_comparison"     // "E·FORCE vs 4G MILLS"
  | "product_comparison"   // "1번이랑 2번 비교"
  | "series_info"          // "ALU-CUT 시리즈 특징"
  | "brand_info"           // "E·FORCE 브랜드 특징"
  | "product_info"         // "E5D70 스펙"
  | "field_explanation"    // "DLC가 뭐야?" (about the active filter field)
  | "field_count"          // "Ball은 몇개야?"
  | "general_question"     // general knowledge
  | "active_field_query"   // explicitly about the pending field
  | "unknown"

export interface QueryTarget {
  type: QueryTargetType
  /** Explicit entities mentioned (series names, product codes) */
  entities: string[]
  /** Whether the query target is DIFFERENT from the active filter field */
  overridesActiveFilter: boolean
  /** The inferred answer topic */
  answerTopic: string
  /** Active filters should only be search scope, not answer topic */
  searchScopeOnly: boolean
  /** Whether this query requires search/data lookup (not just explanation) */
  requiresSearch: boolean
  /** Preferred search scope */
  searchScope: "current_candidates" | "targeted_entity" | "targeted_comparison" | "series_lookup" | "brand_lookup" | "broad_search" | "none"
}

// ── Patterns ────────────────────────────────────────────────

// Series/product name patterns (YG-1 specific)
const SERIES_NAME_PATTERN = /\b(ALU[-\s]?CUT(?:\s+(?:POWER|HPC|for\s+Korean\s+Market))?|TANK[-\s]?POWER|X[-\s]?POWER|I[-\s]?POWER|V[-\s]?POWER|ALU[-\s]?MILL|ALU[-\s]?POWER(?:\s+HPC)?|INOX[-\s]?POWER|X\d{4,}|E\d[A-Z]\d+|GAA\d+|GEE\d+|JAH\d+|ALM\d+|EI\d+|[A-Z]{2,5}\d{2,4}[A-Z]?|[A-Z]{1,4}\d[A-Z]{1,3}\d{2,4}[A-Z]?)\b/gi
const BRAND_NAME_PATTERN = /\b(E[·∙ㆍ.]?\s*FORCE(?:\s+BLUE)?(?:\s+for\s+Korean\s+Market)?|4G\s*MILLS(?:\s*-\s*KOR)?|SUPER\s+ALLOY|X5070\s*S)\b/gi
const PRODUCT_CODE_PATTERN = /\b[A-Z]{2,5}\d{4,}[A-Z]*\d*\b/g
const COMPARISON_PATTERN = /차이|비교|vs|대비|어떤.*게.*낫|뭐가.*다른|뭐가.*좋|어떤.*게.*좋/i
const SERIES_INFO_PATTERN = /시리즈|특징|장점|단점|용도|적합/i
const COUNT_PATTERN = /몇\s*개|갯수|분포|몇\s*종/i
const ENTITY_COMPARISON_PATTERN = /([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)\s*(?:vs\.?|VS\.?|와|과|이랑|랑|대비)\s*([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)(?=\s*(?:의|은|는|이|가|를|을|차이|비교|특징|설명|$))/giu

// Active filter field keywords
const FIELD_KEYWORDS: Record<string, RegExp> = {
  coating: /코팅|DLC|TiAlN|AlCrN|AlTiN|무코팅|Bright\s*Finish/i,
  fluteCount: /날\s*수|날수|플루트|flute|\d날/i,
  toolSubtype: /형상|서브타입|Square|Ball|Radius|Taper|스퀘어|볼|라디우스/i,
  material: /소재|재질|피삭재|알루미늄|스테인리스|탄소강/i,
  diameterMm: /직경|지름|mm/i,
  toolMaterial: /공구\s*소재|카바이드|초경|HSS|고속도강/i,
}

/**
 * Classify the query target from the user's latest message.
 * Determines whether the user is asking about the active filter field
 * or about a completely different entity.
 */
export function classifyQueryTarget(
  userMessage: string,
  activeFilterField?: string | null,
  pendingField?: string | null
): QueryTarget {
  const clean = userMessage.trim()
  const lower = clean.toLowerCase()

  // 1. Extract explicit entities (series names, product codes)
  const seriesMatches = Array.from(clean.matchAll(SERIES_NAME_PATTERN)).map(m => m[0])
  const brandMatches = Array.from(clean.matchAll(BRAND_NAME_PATTERN)).map(m => m[0])
  const productMatches = Array.from(clean.matchAll(PRODUCT_CODE_PATTERN)).map(m => m[0])
  const comparisonEntityMatches = Array.from(clean.matchAll(ENTITY_COMPARISON_PATTERN)).flatMap(match => [match[1], match[2]])
  const entities = [...new Set([...seriesMatches, ...brandMatches, ...productMatches, ...comparisonEntityMatches].map(entity => entity.trim()).filter(Boolean))]
  const hasBrandEntities = brandMatches.length > 0 && seriesMatches.length === 0 && productMatches.length === 0
  const mentionsBrand = /브랜드|brand/i.test(clean)

  // 2. Check for comparison request with 2+ entities
  const isComparison = COMPARISON_PATTERN.test(lower)
  if (isComparison && entities.length >= 2) {
    return {
      type: hasBrandEntities || mentionsBrand ? "brand_comparison" : "series_comparison", entities, overridesActiveFilter: true,
      answerTopic: `${entities.join(" vs ")} 비교`, searchScopeOnly: true,
      requiresSearch: true, searchScope: "targeted_comparison",
    }
  }

  // 3. Check for comparison with "과/와/이랑" pattern
  const comparisonWithConjunction = Array.from(clean.matchAll(ENTITY_COMPARISON_PATTERN))[0] ?? null
  if (comparisonWithConjunction) {
    const entity1 = comparisonWithConjunction[1].trim()
    const entity2 = comparisonWithConjunction[2].trim()
    if (entity1.length >= 2 && entity2.length >= 2) {
      return {
        type: hasBrandEntities || mentionsBrand ? "brand_comparison" : "series_comparison", entities: [entity1, entity2], overridesActiveFilter: true,
        answerTopic: `${entity1} vs ${entity2} 비교`, searchScopeOnly: true,
        requiresSearch: true, searchScope: "targeted_comparison",
      }
    }
  }

  // 4. Series info request with explicit entity
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

  // 5. Product code question
  if (productMatches.length >= 1) {
    return {
      type: "product_info", entities: productMatches, overridesActiveFilter: true,
      answerTopic: `${productMatches[0]} 제품 정보`, searchScopeOnly: true,
      requiresSearch: true, searchScope: "targeted_entity",
    }
  }

  // 6. Check if query is explicitly about the active filter field
  const activeField = activeFilterField ?? pendingField
  if (activeField) {
    const fieldPattern = FIELD_KEYWORDS[activeField]
    if (fieldPattern && fieldPattern.test(lower)) {
      return {
        type: "active_field_query", entities: [], overridesActiveFilter: false,
        answerTopic: `${activeField} 설명`, searchScopeOnly: false,
        requiresSearch: false, searchScope: "none",
      }
    }
  }

  // 7. Series name mentioned (even without comparison/info pattern)
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

  // 8. Count/distribution question
  if (COUNT_PATTERN.test(lower)) {
    return {
      type: "field_count", entities: [], overridesActiveFilter: false,
      answerTopic: "분포/개수", searchScopeOnly: false,
      requiresSearch: true, searchScope: "current_candidates",
    }
  }

  // 9. General explanation
  if (/설명|알려|뭐야|차이/.test(lower) && !activeField) {
    return {
      type: "general_question", entities: [], overridesActiveFilter: false,
      answerTopic: "일반 질문", searchScopeOnly: false,
      requiresSearch: false, searchScope: "none",
    }
  }

  return {
    type: "unknown", entities: [], overridesActiveFilter: false,
    answerTopic: "unknown", searchScopeOnly: false,
    requiresSearch: false, searchScope: "none",
  }
}

/**
 * Check if an answer text is about the wrong topic.
 * Returns true if the answer is mainly about the active filter field
 * but the user asked about something else.
 */
export function isWrongTopicAnswer(
  answerText: string,
  queryTarget: QueryTarget,
  activeFilterField?: string | null
): boolean {
  if (!queryTarget.overridesActiveFilter || !activeFilterField) return false

  const fieldPattern = FIELD_KEYWORDS[activeFilterField]
  if (!fieldPattern) return false

  // Count mentions of the active filter field in the answer (global match)
  const globalFieldPattern = new RegExp(fieldPattern.source, "gi")
  const fieldMentions = (answerText.match(globalFieldPattern) ?? []).length

  // Count mentions of the actual query target entities
  let entityMentions = 0
  for (const entity of queryTarget.entities) {
    const entityPattern = new RegExp(entity.replace(/[-\s]/g, "[-\\s]?"), "gi")
    entityMentions += (answerText.match(entityPattern) ?? []).length
  }

  // Wrong topic if:
  // 1. Active filter field mentioned 2+ times AND entities barely mentioned
  // 2. OR active filter field dominates the answer content
  if (fieldMentions >= 2 && entityMentions <= 1) {
    return true
  }

  return false
}
