/**
 * Knowledge Graph — Deterministic Intent & Entity Resolution
 *
 * Replaces LLM calls (semantic-turn-extractor, llm-filter-extractor, unified-judgment)
 * with graph-based pattern matching for ~90% of user inputs.
 *
 * Fallback chain: KG lookup → regex → LLM (only if confidence < threshold)
 */

import {
  buildAppliedFilterFromValue,
  getRegisteredFilterFields,
  getFilterFieldQueryAliases,
} from "@/lib/recommendation/shared/filter-field-registry"
import { getDbSchemaSync } from "./sql-agent-schema-cache"
import type { AppliedFilter, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { OrchestratorAction } from "@/lib/recommendation/infrastructure/agents/types"
import type { SemanticReplyRoute, SemanticDirectContext, SemanticTurnDecision } from "./semantic-turn-extractor"

// ── Node Types ─────────────────────────────────────────────────

interface EntityNode {
  canonical: string
  field: string
  aliases: string[]  // lowercase
}

interface IntentPattern {
  patterns: RegExp[]
  action: OrchestratorAction["type"]
  buildAction: (match: RegExpMatchArray, msg: string, state: ExplorationSessionState | null) => OrchestratorAction | null
  confidence: number
  replyRoute?: SemanticReplyRoute
}

// ── Entity Graph (Filter Values) ──────────────────────────────

const ENTITY_NODES: EntityNode[] = [
  // toolSubtype
  { canonical: "Square", field: "toolSubtype", aliases: ["square", "스퀘어", "스퀘어엔드밀", "평엔드밀"] },
  { canonical: "Ball", field: "toolSubtype", aliases: ["ball", "볼", "볼엔드밀", "볼노즈"] },
  { canonical: "Radius", field: "toolSubtype", aliases: ["radius", "라디우스", "레디우스", "레디어스", "코너r", "코너알", "코너반경", "코너레디우스", "코너레디어스", "코너래디우스", "corner radius"] },
  { canonical: "Roughing", field: "toolSubtype", aliases: ["roughing", "황삭", "러핑", "황삭용"] },
  { canonical: "Taper", field: "toolSubtype", aliases: ["taper", "테이퍼", "테이퍼엔드밀"] },
  { canonical: "Chamfer", field: "toolSubtype", aliases: ["chamfer", "챔퍼", "모따기", "면취"] },
  { canonical: "High-Feed", field: "toolSubtype", aliases: ["high-feed", "하이피드", "고이송", "highfeed"] },
  // coating (including YG-1 internal names: X/Y/C/Z/XC/RCH-Coating)
  { canonical: "TiAlN", field: "coating", aliases: ["tialn", "티알엔", "티아인", "x-coating", "x코팅", "엑스코팅"] },
  { canonical: "AlTiN", field: "coating", aliases: ["altin", "알틴", "알티엔"] },
  { canonical: "AlCrN", field: "coating", aliases: ["alcrn", "알크롬", "y-coating", "y코팅", "와이코팅"] },
  { canonical: "TiCN", field: "coating", aliases: ["ticn", "티씨엔", "c-coating", "c코팅", "씨코팅"] },
  { canonical: "TiN", field: "coating", aliases: ["tin", "티엔"] },
  { canonical: "DLC", field: "coating", aliases: ["dlc", "디엘씨", "다이아몬드라이크카본"] },
  { canonical: "Diamond", field: "coating", aliases: ["diamond", "다이아몬드코팅", "다이아몬드"] },
  { canonical: "Uncoated", field: "coating", aliases: ["uncoated", "무코팅", "브라이트", "bright", "bright finish", "코팅 없", "코팅���"] },
  { canonical: "Z-Coating", field: "coating", aliases: ["z-coating", "z코팅", "지코팅"] },
  { canonical: "XC-Coating", field: "coating", aliases: ["xc-coating", "xc코팅"] },
  { canonical: "RCH-Coating", field: "coating", aliases: ["rch-coating", "rch코팅"] },
  { canonical: "Hardslick", field: "coating", aliases: ["hardslick", "하드슬릭"] },
  // workPieceName (expanded with JIS grades + terminology aliases)
  { canonical: "Stainless Steels", field: "workPieceName", aliases: ["스테인리스", "스텐", "sus", "stainless", "sus304", "sus316", "sus316l", "sus303", "sus420", "sus630", "sts304", "스테인리스강"] },
  { canonical: "Carbon Steels", field: "workPieceName", aliases: ["탄소강", "carbon steel", "carbon", "s45c", "s50c", "s55c", "sk3", "sk5", "sm45c", "비합금강", "일반강"] },
  { canonical: "Alloy Steels", field: "workPieceName", aliases: ["합금강", "alloy steel", "alloy", "scm440", "scm415", "sncm439", "suj2", "금형강", "구조용강", "고합금강", "저합금강", "공구강"] },
  { canonical: "Cast Iron", field: "workPieceName", aliases: ["주철", "cast iron", "주물", "fc", "fcd", "회주철", "구상흑연주철", "가단주철", "칠드주철"] },
  { canonical: "Aluminum", field: "workPieceName", aliases: ["알루미늄", "알미늄", "aluminum", "aluminium", "a6061", "a7075", "a5052", "두랄루민", "알루미늄합금"] },
  { canonical: "Copper", field: "workPieceName", aliases: ["구리", "copper", "동", "황동", "청동", "구리합금", "brass", "bronze", "cu", "redcopper"] },
  { canonical: "Titanium", field: "workPieceName", aliases: ["티타늄", "titanium", "ti6al4v", "초내열합금", "내열합금", "티타늄합금", "내열초합금"] },
  { canonical: "Inconel", field: "workPieceName", aliases: ["인코넬", "inconel", "니켈합금", "nickel alloy", "하스텔로이", "hastelloy"] },
  { canonical: "Hardened Steels", field: "workPieceName", aliases: ["경화강", "열처리강", "hardened", "hrc", "고경도강", "skd11", "skd61", "다이스강", "die steel", "hrc45", "hrc50", "hrc55", "hrc60", "hrc65"] },
  { canonical: "Prehardened Steels", field: "workPieceName", aliases: ["조질강", "프리하든", "prehardened", "nakhrc", "hp강"] },
  { canonical: "Cast Steel", field: "workPieceName", aliases: ["주강", "cast steel"] },
  { canonical: "Graphite", field: "workPieceName", aliases: ["흑연", "graphite", "카본"] },
  { canonical: "FRP", field: "workPieceName", aliases: ["frp", "섬유강화플라스틱", "cfrp", "gfrp", "복합재"] },
  // Boolean: coolantHole
  { canonical: "true", field: "coolantHole", aliases: ["쿨런트", "쿨런트홀", "절삭유홀", "coolant", "coolant hole", "내부급유", "내부냉각", "쓰루쿨런트", "through coolant"] },
  // Countries
  { canonical: "KOREA", field: "country", aliases: ["한국", "korea", "국내", "코리아"] },
  { canonical: "USA", field: "country", aliases: ["미국", "usa", "us", "america", "미합중국"] },
  { canonical: "CHINA", field: "country", aliases: ["중국", "china", "차이나"] },
  { canonical: "JAPAN", field: "country", aliases: ["일본", "japan"] },
  { canonical: "GERMANY", field: "country", aliases: ["독일", "germany"] },
  { canonical: "INDIA", field: "country", aliases: ["인도", "india"] },
  { canonical: "TURKEY", field: "country", aliases: ["터키", "turkey", "튀르키예"] },
  { canonical: "MEXICO", field: "country", aliases: ["멕시코", "mexico"] },
]

// Build lookup index for O(1) resolution
const _entityIndex = new Map<string, EntityNode>()
for (const node of ENTITY_NODES) {
  for (const alias of node.aliases) {
    _entityIndex.set(alias, node)
  }
}

// ── Numeric Extraction Patterns ────────────────────────────────

// Korean number → digit mapping for "열미리", "두날" etc.
const KO_NUM: Record<string, number> = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6,
  일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 스물: 20,
}
const KO_NUM_KEYS = Object.keys(KO_NUM).sort((a, b) => b.length - a.length).join("|")

const NUMERIC_PATTERNS: Array<{ field: string; patterns: RegExp[]; extract: (m: RegExpMatchArray) => number }> = [
  {
    field: "diameterMm",
    patterns: [
      /(?:직경|지름|파이|φ|Φ|ø|dia(?:meter)?)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
      /(\d+(?:\.\d+)?)\s*(?:mm|파이)\b/i,
      new RegExp(`(${KO_NUM_KEYS})\\s*(?:미리|밀리|파이|mm)`, "i"),
    ],
    extract: (m) => {
      if (KO_NUM[m[1]]) return KO_NUM[m[1]]
      return parseFloat(m[1])
    },
  },
  {
    field: "fluteCount",
    patterns: [
      /(\d+)\s*(?:날|f|플루트|flute)/i,
      /(?:날\s*수|플루트|flute)\s*(\d+)/i,
      new RegExp(`(${KO_NUM_KEYS})\\s*날`, "i"),
    ],
    extract: (m) => {
      if (KO_NUM[m[1]]) return KO_NUM[m[1]]
      return parseInt(m[1])
    },
  },
  {
    field: "shankDiameterMm",
    patterns: [
      /(?:생크|shank)\s*(?:직경|지름)?\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "lengthOfCutMm",
    patterns: [
      /(?:날장|절삭길이|절삭\s*길이|loc)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "overallLengthMm",
    patterns: [
      /(?:전장|전체\s*길이|oal)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "helixAngleDeg",
    patterns: [
      /(?:헬릭스|나선각|helix)\s*(\d+(?:\.\d+)?)\s*(?:도|°)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
]

// ── Intent Patterns (deterministic) ───────────────────────────

const SKIP_PATTERNS = [
  /^(?:상관없음|아무거나|괜찮은\s*걸로|추천으로\s*골라|알아서|any|don'?t\s*care|skip|no\s*preference)$/iu,
  /^(?:상관\s*없|아무\s*거나|다\s*괜찮|상관x|상관없어|몰라|모르겠)/iu,
]

const BACK_PATTERNS = [
  /(?:이전\s*단계|이전으로|뒤로|한\s*단계\s*전|되돌려|전\s*단계|⟵|previous\s*step|go\s*back)/iu,
]

const RESET_PATTERNS = [
  /(?:처음부터\s*다시|다시\s*처음부터|처음으로|초기화|리셋|새로\s*시작|start\s*over|reset)/iu,
]

const STOCK_PATTERNS = [
  /(?:재고\s*(?:있|만|확인|된)|즉시\s*구매|바로\s*구매|in\s*stock)/iu,
]

const COMPETITOR_PATTERNS = [
  /경쟁사/iu,
  /타사/iu,
  /다른\s*브랜드/iu,
  /비슷한\s*(?:제품|공구)/iu,
  /유사\s*(?:제품|공구)/iu,
  /대체\s*(?:제품|공구)/iu,
  /(?:sandvik|kennametal|osg|mitsubishi|walter|seco|nachi|iscar|이스카|미쓰비시)/iu,
  /competitor/iu,
  /alternative\s*(?:product|tool)/iu,
]

const SHOW_RESULT_PATTERNS = [
  /(?:추천\s*(?:해|받|보)|결과\s*보|지금\s*조건으로|제품\s*보기|바로\s*보여|show\s*(?:results?|recommendation))/iu,
]

const COMPARE_PATTERNS = [
  /(?:비교\s*(?:해|하)|차이\s*(?:점|가)|뭐가\s*다|compare|difference|vs\.?)\s/iu,
]

const EXCLUDE_PATTERNS = [
  // "square 타입 말고" → capture "square" (skip 타입/종류/형상 suffixes)
  /(\S+)\s+(?:타입|종류|형상|코팅|계열)\s*(?:말고|빼고|제외|외에)/iu,
  /(\S+)\s*(?:말고|빼고|제외|외에)/iu,
  /(\S+?)(?:이|가|을|를)\s*(?:아닌|않은|아니고)/iu,
  /(\S+)\s+(?:아닌|않은|아니고)/iu,
  /(?:not|except|without|exclude|other\s+than)\s+(\S+)/iu,
]

const REFINE_PATTERNS = [
  /(?:다른|변경|바꿔|바꾸|change|different)\s*(?:직경|소재|코팅|날수|형상|diameter|material|coating|flute|subtype)/iu,
]

// "좁히기" chips: "코팅으로 좁히기", "날수로 좁히기" → refine_condition (show options, don't apply directly)
const NARROWING_CHIP_PATTERNS = [
  /(?:코팅|날수|형상|소재|직경)(?:으로|로)\s*좁히기/iu,
  /좁히기\s*\(/iu, // e.g., "코팅으로 좁히기 (TiAlN/AlTiN)"
]

// ── Company / Domain Knowledge Patterns ────────────────────────

const COMPANY_PATTERNS = [
  /(?:yg-?1|와이지원)\s*(?:회사|소개|설립|역사|대표|공장|영업소|매출|직원)/iu,
  /(?:회사|공장|영업소|전화|연락처|주소|위치)\s*(?:정보|알려|어디)/iu,
]

const CUTTING_CONDITION_PATTERNS = [
  /(?:절삭\s*조건|가공\s*조건|회전수|이송|절입|rpm|spindle|feed\s*rate|cutting\s*speed|Vc|fz)/iu,
]

// ── Core Resolution Functions ──────────────────────────────────

/** Resolve entity from text → { field, canonical } or null */
export function resolveEntity(text: string): EntityNode | null {
  const normalized = text.trim().toLowerCase().replace(/[^a-z0-9가-힣]/g, "")
  return _entityIndex.get(normalized) ?? null
}

/** Check if alias appears as a whole word/token in the message */
function matchesAsWord(message: string, alias: string): boolean {
  // For short aliases (≤2 chars), require exact word boundary
  if (alias.length <= 2) {
    const pattern = new RegExp(`(?:^|[\\s,.()])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s,.()이가을를은는])`, "i")
    return pattern.test(message)
  }
  // For longer aliases, simple includes is safe enough
  return message.includes(alias)
}

/** Extract all entities from a message */
export function extractEntities(message: string): Array<{ field: string; value: string; canonical: string }> {
  const results: Array<{ field: string; value: string; canonical: string }> = []
  const lower = message.toLowerCase()

  // 1. Check learned patterns first (self-supervised)
  try {
    const { getLearnedEntityIndex } = require("./self-learning")
    const learnedIndex = getLearnedEntityIndex() as Map<string, { field: string; canonical: string; confidence: number }>
    for (const [trigger, entity] of learnedIndex) {
      if (matchesAsWord(lower, trigger)) {
        results.push({ field: entity.field, value: trigger, canonical: entity.canonical })
      }
    }
  } catch { /* self-learning module not available */ }

  // 2. Static entity node matching (with word boundary check)
  for (const node of ENTITY_NODES) {
    // Skip if already matched by learned patterns
    if (results.some(r => r.field === node.field)) continue
    for (const alias of node.aliases) {
      if (matchesAsWord(lower, alias)) {
        results.push({ field: node.field, value: alias, canonical: node.canonical })
        break // one match per node
      }
    }
  }

  // Numeric pattern matching
  for (const np of NUMERIC_PATTERNS) {
    for (const pattern of np.patterns) {
      const match = message.match(pattern)
      if (match) {
        results.push({ field: np.field, value: match[0], canonical: String(np.extract(match)) })
        break
      }
    }
  }

  // 3. Dynamic brand matching from DB schema cache (no hardcoding)
  if (!results.some(r => r.field === "brand")) {
    const schema = getDbSchemaSync()
    if (schema?.brands) {
      for (const brand of schema.brands) {
        const brandLower = brand.toLowerCase()
        // Exact or partial match — brand names are typically uppercase identifiers
        if (matchesAsWord(lower, brandLower) || lower.includes(brandLower)) {
          results.push({ field: "brand", value: brand, canonical: brand })
          break
        }
      }
    }
  }

  return results
}

/** Build filters from extracted entities */
export function entitiesToFilters(entities: Array<{ field: string; canonical: string }>, appliedAt: number): AppliedFilter[] {
  return entities.map(e => {
    const filter = buildAppliedFilterFromValue(e.field, e.canonical)
    if (filter) {
      filter.appliedAt = appliedAt
      return filter
    }
    return {
      field: e.field,
      op: "eq" as const,
      value: e.canonical,
      rawValue: e.canonical,
      appliedAt,
    }
  })
}

// ── Main KG Decision Function ──────────────────────────────────

export interface KGDecisionResult {
  decision: SemanticTurnDecision | null
  confidence: number
  source: "kg-intent" | "kg-entity" | "kg-exclude" | "kg-skip" | "none"
  reason: string
}

/**
 * Try to resolve user intent deterministically via Knowledge Graph.
 * Returns null if KG can't decide with sufficient confidence → fallback to LLM.
 */
export function tryKGDecision(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
): KGDecisionResult {
  const msg = userMessage.trim()
  const lower = msg.toLowerCase()
  const pendingField = sessionState?.lastAskedField ?? null

  // ── 1. Skip patterns ──
  if (SKIP_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "skip_field" }, [], 0.95, "KG: skip pattern matched"),
      confidence: 0.95,
      source: "kg-intent",
      reason: "skip pattern",
    }
  }

  // ── 2. Back patterns ──
  if (BACK_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "go_back_one_step" }, [], 0.95, "KG: back pattern matched"),
      confidence: 0.95,
      source: "kg-intent",
      reason: "back pattern",
    }
  }

  // ── 3. Reset patterns ──
  if (RESET_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "reset_session" }, [], 0.95, "KG: reset pattern matched"),
      confidence: 0.95,
      source: "kg-intent",
      reason: "reset pattern",
    }
  }

  // ── 4. Stock filter patterns ──
  if (STOCK_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "filter_by_stock", stockFilter: "instock" } as OrchestratorAction, [], 0.90, "KG: stock filter"),
      confidence: 0.90,
      source: "kg-intent",
      reason: "stock filter",
    }
  }

  // ── 4b. "좁히기" chip patterns → refine_condition (show selection options) ──
  if (NARROWING_CHIP_PATTERNS.some(p => p.test(msg))) {
    // Extract the field from the chip label: "코팅으로 좁히기" → "coating", "날수로 좁히기" → "fluteCount"
    const fieldMap: Record<string, string> = { "코팅": "coating", "날수": "fluteCount", "형상": "toolSubtype", "소재": "workPieceName", "직경": "diameter" }
    let refineField = "coating" // default
    for (const [ko, field] of Object.entries(fieldMap)) {
      if (msg.includes(ko)) { refineField = field; break }
    }
    return {
      decision: buildDecision({ type: "refine_condition", field: refineField } as OrchestratorAction, [], 0.95, `KG: narrowing chip → refine_condition(${refineField})`),
      confidence: 0.95,
      source: "kg-intent",
      reason: `narrowing chip → ${refineField}`,
    }
  }

  // ── 4c. Question patterns ("X가 뭐야?", "X란?", "X 알려줘") → answer_general ──
  // Must come BEFORE entity extraction to prevent "TiAlN이 뭐야?" from becoming a coating filter
  const QUESTION_PATTERNS = [
    /(?:뭐야|뭐예요|뭐에요|뭘까|뭔가요|무엇|무슨\s*뜻|알려줘|알려\s*주세요|설명|차이가?\s*뭐|어떤\s*거야|란\s*뭐|이란|이\s*뭐)/iu,
    /(?:what\s*is|explain|tell\s*me\s*about|difference\s*between)/iu,
  ]
  if (QUESTION_PATTERNS.some(p => p.test(msg)) && msg.length < 60) {
    return {
      decision: buildDecision(
        { type: "answer_general", message: msg, preGenerated: false } as OrchestratorAction,
        [], 0.90, "KG: question pattern → answer_general"
      ),
      confidence: 0.90,
      source: "kg-intent",
      reason: "question pattern",
    }
  }

  // ── 5a. Comparative/superlative patterns → answer_general for LLM with product context ──
  // Superlatives: "가장 큰", "제일 작은", "최대"
  // Comparatives: "더 큰", "좀더 작은", "좀 긴", "더 짧은", "약간 큰"
  // Relative: "이거보다 큰", "이것보다 작은"
  const COMPARATIVE_SUPERLATIVE_PATTERN = /(?:가장|제일|최대|최소|최고|최저|더|좀더|좀\s*더|조금\s*더|약간|훨씬|좀|조금)\s*(?:큰|작은|긴|짧은|높은|낮은|많은|적은|좋은|비싼|싼|두꺼운|얇은|큰거|작은거|긴거|짧은거)/iu
  if (COMPARATIVE_SUPERLATIVE_PATTERN.test(msg)) {
    return {
      decision: buildDecision({ type: "answer_general", message: msg } as OrchestratorAction, [], 0.93, "KG: comparative/superlative → answer_general with product sorting"),
      confidence: 0.93,
      source: "kg-intent",
      reason: "comparative sorting",
    }
  }

  // ── 5b. Competitor patterns (must check BEFORE show_recommendation) ──
  if (COMPETITOR_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "answer_general", message: msg } as OrchestratorAction, [], 0.92, "KG: competitor query → answer_general with web search"),
      confidence: 0.92,
      source: "kg-intent",
      reason: "competitor query",
    }
  }

  // ── 5c. Application purpose → concrete filter (domain knowledge mapping) ──
  // 가공 목적에서 toolSubtype/fluteCount를 결정적으로 추출
  const APPLICATION_FILTER_MAP: Array<{ pattern: RegExp; filters: Array<{ field: string; value: string }> }> = [
    { pattern: /(?:곡면|3d|서피스|surface|contouring|구면)/iu, filters: [{ field: "toolSubtype", value: "Ball" }] },
    { pattern: /(?:포켓|pocket)/iu, filters: [{ field: "toolSubtype", value: "Square" }] },
    { pattern: /(?:칩\s*배출|chip\s*evacuation)/iu, filters: [{ field: "fluteCount", value: "2" }] },
    { pattern: /(?:깊은\s*홈|깊은\s*슬롯|deep\s*slot)/iu, filters: [{ field: "toolSubtype", value: "Square" }] },
    { pattern: /(?:리브|rib)/iu, filters: [{ field: "toolSubtype", value: "Taper" }] },
    { pattern: /(?:진동|떨림|vibration|채터|chatter)/iu, filters: [{ field: "fluteCount", value: "4" }] },
    { pattern: /(?:긴\s*가공|깊은\s*가공|deep\s*cut|long\s*reach|롱넥|롱리치|long\s*neck)/iu, filters: [{ field: "toolSubtype", value: "Taper" }] },
  ]
  for (const { pattern, filters: appFilters } of APPLICATION_FILTER_MAP) {
    if (pattern.test(msg)) {
      const primary = appFilters[0]
      const primaryFilter: AppliedFilter = {
        field: primary.field, op: "eq", value: primary.value, rawValue: primary.value, appliedAt: 0,
      }
      const extraFilters = appFilters.slice(1).map(f => ({
        field: f.field, op: "eq" as const, value: f.value, rawValue: f.value, appliedAt: 0,
      }))
      return {
        decision: buildDecision({ type: "continue_narrowing", filter: primaryFilter } as OrchestratorAction, extraFilters, 0.85, `KG: application purpose → ${appFilters.map(f => `${f.field}=${f.value}`).join(", ")}`),
        confidence: 0.85,
        source: "kg-entity",
        reason: `application: ${appFilters.map(f => `${f.field}=${f.value}`).join(", ")}`,
      }
    }
  }

  // ── 5d. Show results patterns ──
  // "추천해줘" + entities → extract filters AND show recommendation
  if (SHOW_RESULT_PATTERNS.some(p => p.test(msg))) {
    const showEntities = extractEntities(msg)
    if (showEntities.length > 0) {
      // Entities + show_recommendation → apply filters then show results
      const primary = showEntities[0]
      const extras = showEntities.slice(1)
      const primaryFilter: AppliedFilter = {
        field: primary.field, op: "eq", value: primary.canonical, rawValue: primary.canonical, appliedAt: 0,
      }
      const extraFilters = entitiesToFilters(extras, 0)
      return {
        decision: buildDecision({ type: "show_recommendation" }, [primaryFilter, ...extraFilters], 0.92, `KG: show_recommendation + ${showEntities.length} entities`),
        confidence: 0.92,
        source: "kg-entity",
        reason: `show_recommendation + ${showEntities.map(e => `${e.field}=${e.canonical}`).join(", ")}`,
      }
    }
    return {
      decision: buildDecision({ type: "show_recommendation" }, [], 0.90, "KG: show recommendation"),
      confidence: 0.90,
      source: "kg-intent",
      reason: "show recommendation",
    }
  }

  // ── 6. Exclude patterns ("X 말고", "except X") ──
  for (const pattern of EXCLUDE_PATTERNS) {
    const match = msg.match(pattern)
    if (match) {
      const excludeRaw = (match[1] || match[2]).toLowerCase()
      const entity = resolveEntity(excludeRaw)
      // resolveEntity 실패 시 숫자 패턴으로 fallback ("4날 말고" → fluteCount=4)
      const resolved = entity
        ? { field: entity.field, canonical: entity.canonical }
        : (() => {
            const numEntities = extractEntities(excludeRaw)
            return numEntities.length > 0 ? { field: numEntities[0].field, canonical: numEntities[0].canonical } : null
          })()
      if (resolved) {
        const filter: AppliedFilter = {
          field: resolved.field,
          op: "exclude",
          value: resolved.canonical,
          rawValue: resolved.canonical,
          appliedAt: 0,
        }
        return {
          decision: buildDecision({ type: "continue_narrowing", filter } as OrchestratorAction, [], 0.95, `KG: exclude ${resolved.canonical}`),
          confidence: 0.95,
          source: "kg-exclude",
          reason: `exclude ${resolved.field}=${resolved.canonical}`,
        }
      }
    }
  }

  // ── 7. Direct entity answer to pending field ──
  if (pendingField) {
    // Check if the entire message is an entity match
    const entity = resolveEntity(msg)
    if (entity) {
      const filter: AppliedFilter = {
        field: entity.field,
        op: "eq",
        value: entity.canonical,
        rawValue: entity.canonical,
        appliedAt: 0,
      }
      return {
        decision: buildDecision({ type: "continue_narrowing", filter } as OrchestratorAction, [], 0.90, `KG: entity match ${entity.canonical}`),
        confidence: 0.90,
        source: "kg-entity",
        reason: `entity ${entity.field}=${entity.canonical}`,
      }
    }

    // Bare number for numeric pending fields (e.g., "10" when asking diameter)
    const NUMERIC_PENDING_FIELDS = new Set(["diameterMm", "fluteCount", "shankDiameterMm", "lengthOfCutMm", "overallLengthMm"])
    if (NUMERIC_PENDING_FIELDS.has(pendingField)) {
      const bareNum = msg.match(/^(\d+(?:\.\d+)?)\s*$/)
      if (bareNum) {
        const numVal = parseFloat(bareNum[1])
        if (!isNaN(numVal) && numVal > 0) {
          const filter: AppliedFilter = {
            field: pendingField,
            op: "eq",
            value: String(numVal),
            rawValue: msg,
            appliedAt: 0,
          }
          return {
            decision: buildDecision({ type: "continue_narrowing", filter } as OrchestratorAction, [], 0.92, `KG: bare number ${numVal} for pending ${pendingField}`),
            confidence: 0.92,
            source: "kg-entity",
            reason: `bare number ${numVal} → ${pendingField}`,
          }
        }
      }
    }

    // Check if message contains entities for the pending field
    const entities = extractEntities(msg)
    const fieldMatch = entities.find(e => e.field === pendingField)
    if (fieldMatch) {
      const filter: AppliedFilter = {
        field: fieldMatch.field,
        op: "eq",
        value: fieldMatch.canonical,
        rawValue: fieldMatch.canonical,
        appliedAt: 0,
      }
      return {
        decision: buildDecision({ type: "continue_narrowing", filter } as OrchestratorAction, [], 0.85, `KG: field match ${fieldMatch.canonical}`),
        confidence: 0.85,
        source: "kg-entity",
        reason: `pending field match ${fieldMatch.field}=${fieldMatch.canonical}`,
      }
    }
  }

  // ── 8. Multi-entity extraction (e.g., "4날 스퀘어", "10mm") ──
  const entities = extractEntities(msg)
  if (entities.length > 0 && !COMPANY_PATTERNS.some(p => p.test(msg))) {
    // Negation check: "4날 말고", "TiAlN 빼고" 등 → op: "exclude"
    const isNegation = /빼고|제외|아닌\s*것|없는\s*거|말고\s*다른|만\s*아니면|없이|아닌\s*거|없는\s*거로/u.test(msg)
    const primary = entities[0]
    const extras = entities.slice(1)
    const filter: AppliedFilter = {
      field: primary.field,
      op: isNegation ? "exclude" : "eq",
      value: primary.canonical,
      rawValue: primary.canonical,
      appliedAt: 0,
    }
    const extraFilters = entitiesToFilters(extras, 0)
    // 숫자 필드(직경, 날수 등)는 regex 추출이므로 오탐 위험이 거의 없음 → 0.92
    // 문자열 필드(코팅, 형상 등)는 alias 매칭이므로 0.90
    // 복합 엔티티(2개+)는 결합 정확도가 높으므로 0.92
    const NUMERIC_FIELDS = new Set(["diameterMm", "fluteCount", "shankDiameterMm", "lengthOfCutMm", "overallLengthMm"])
    const hasNumericField = entities.some(e => NUMERIC_FIELDS.has(e.field))
    const confidence = entities.length >= 2 ? 0.92 : hasNumericField ? 0.92 : 0.90
    return {
      decision: buildDecision({ type: "continue_narrowing", filter } as OrchestratorAction, extraFilters, confidence, `KG: multi-entity ${entities.map(e => e.canonical).join(", ")}`),
      confidence,
      source: "kg-entity",
      reason: `multi-entity: ${entities.map(e => `${e.field}=${e.canonical}`).join(", ")}`,
    }
  }

  // ── 9. Cutting condition routing (BEFORE company to prevent misrouting) ──
  if (CUTTING_CONDITION_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision(
        { type: "answer_general", message: msg, preGenerated: false } as OrchestratorAction,
        [], 0.85, "KG: cutting condition query"
      ),
      confidence: 0.85,
      source: "kg-intent",
      reason: "cutting condition query",
    }
  }

  // ── 10. Company/domain knowledge routing (after technical guard) ──
  if (COMPANY_PATTERNS.some(p => p.test(msg)) && !CUTTING_CONDITION_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision(
        { type: "answer_general", message: msg, preGenerated: false } as OrchestratorAction,
        [], 0.85, "KG: company query"
      ),
      confidence: 0.85,
      source: "kg-intent",
      reason: "company knowledge query",
    }
  }

  // ── No KG match → fallback to LLM ──
  return {
    decision: null,
    confidence: 0,
    source: "none",
    reason: "no KG pattern matched",
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function buildDecision(
  action: OrchestratorAction,
  extraFilters: AppliedFilter[],
  confidence: number,
  reasoning: string,
): SemanticTurnDecision {
  return {
    action,
    extraFilters,
    replyRoute: null,
    directContext: null,
    confidence,
    reasoning,
  }
}

// ── Statistics ──────────────────────────────────────────────────

export function getKGStats() {
  // Count unique fields as relation types
  const fieldSet = new Set(ENTITY_NODES.map(n => n.field))
  // Relations = entity→field mappings + numeric patterns + intent pattern groups
  const intentGroupCount = [SKIP_PATTERNS, BACK_PATTERNS, RESET_PATTERNS, STOCK_PATTERNS, SHOW_RESULT_PATTERNS, EXCLUDE_PATTERNS].filter(p => p.length > 0).length
  const totalRelations = ENTITY_NODES.length + NUMERIC_PATTERNS.length + intentGroupCount

  return {
    totalEntities: ENTITY_NODES.length,
    totalRelations,
    aliases: _entityIndex.size,
    seriesCount: 0, // populated by API route from DB
    // detailed breakdown (for debugging)
    _detail: {
      fields: fieldSet.size,
      numericPatterns: NUMERIC_PATTERNS.length,
      intentGroups: intentGroupCount,
    },
  }
}
