/**
 * Knowledge Graph — Deterministic Intent & Entity Resolution
 *
 * Replaces LLM calls (semantic-turn-extractor, unified-judgment)
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
import type { QueryField, QuerySort, QuerySimilarity, QueryConstraint } from "./query-spec"
import { QUERY_FIELD_MANIFEST, getSortableFields } from "./query-spec-manifest"

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

export const ENTITY_NODES: EntityNode[] = [
  // machiningCategory (root tool family) — mirrors toolType for SQL WHERE
  // and drives the CATEGORY_SHAPE_MAP post-filter in hybrid-retrieval. Direct
  // toolType entries would post-filter 0 candidates because product.toolType
  // is normalized to Solid/Indexable (FORM), not the root category.
  { canonical: "Milling", field: "machiningCategory", aliases: ["엔드밀", "엔드밀공구", "endmill", "end mill", "밀링", "milling", "밀링공구"] },
  { canonical: "Holemaking", field: "machiningCategory", aliases: ["드릴", "드릴링", "drill", "drilling", "홀가공", "구멍가공", "holemaking"] },
  { canonical: "Threading", field: "machiningCategory", aliases: ["탭", "탭핑", "tap", "tapping", "나사가공", "threading"] },
  // toolSubtype
  { canonical: "Square", field: "toolSubtype", aliases: ["square", "스퀘어", "스퀘어엔드밀", "평엔드밀", "플랫", "플랫엔드밀", "flat", "플랫엔드", "스퀘어엔드"] },
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
  { canonical: "DLC", field: "coating", aliases: ["dlc", "dlc코팅", "디엘씨", "다이아몬드라이크카본"] },
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
  // shankType
  { canonical: "Plain", field: "shankType", aliases: ["플레인", "plain", "일반생크", "스트레이트생크", "스트레이트", "straight shank", "원통생크", "원통", "straight"] },
  { canonical: "Weldon", field: "shankType", aliases: ["웰던", "weldon", "웰돈"] },
  { canonical: "HA", field: "shankType", aliases: ["ha생크", "ha shank"] },
  { canonical: "HSK", field: "shankType", aliases: ["hsk", "hsk생크", "hsk shank"] },
  { canonical: "BT", field: "shankType", aliases: ["bt", "bt생크", "bt shank"] },
  { canonical: "CAT", field: "shankType", aliases: ["cat", "cat생크", "cat shank"] },
  // Boolean: coolantHole
  { canonical: "true", field: "coolantHole", aliases: ["쿨런트", "쿨런트홀", "절삭유홀", "coolant", "coolant hole", "내부급유", "내부냉각", "쓰루쿨런트", "through coolant"] },
  // cuttingType (→ input.operationType → series_application_shape LIKE).
  // Canonical values must be resolvable by getOperationShapeSearchTexts in
  // operation-resolver.ts (which maps keywords → series_application_shape text).
  { canonical: "Pocketing", field: "cuttingType", aliases: ["포켓가공", "포켓 가공", "포켓팅", "pocket", "pocketing", "pocket milling", "포켓밀링"] },
  { canonical: "Side_Milling", field: "cuttingType", aliases: ["측면가공", "측면 가공", "측면", "side milling", "사이드밀링", "사이드 밀링"] },
  { canonical: "Slotting", field: "cuttingType", aliases: ["슬로팅", "슬로팅가공", "슬롯가공", "슬롯", "slot", "slotting", "홈가공"] },
  { canonical: "Facing", field: "cuttingType", aliases: ["정면가공", "정면 가공", "정면", "facing", "페이싱"] },
  { canonical: "Profiling", field: "cuttingType", aliases: ["프로파일", "프로파일링", "윤곽가공", "윤곽", "profile", "profiling", "contour"] },
  { canonical: "Roughing", field: "cuttingType", aliases: ["황삭", "황삭가공", "rough", "roughing", "러핑", "헤비컷"] },
  { canonical: "Finishing", field: "cuttingType", aliases: ["정삭", "정삭가공", "finish", "finishing", "마무리"] },
  { canonical: "Drilling", field: "cuttingType", aliases: ["드릴", "드릴링", "구멍가공", "구멍 가공", "drill", "drilling"] },
  { canonical: "Threading_Blind", field: "cuttingType", aliases: ["탭핑", "나사가공", "탭가공", "tapping", "threading"] },
  { canonical: "Chamfering", field: "cuttingType", aliases: ["챔퍼가공", "챔퍼링", "모따기", "면취", "chamfering"] },
  // Countries
  { canonical: "KOREA", field: "country", aliases: ["한국", "korea", "국내", "코리아", "국내제품", "국내산", "국산", "국내용", "국내전용"] },
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
      /(?:직경|지름|파이|φ|Φ|ø|dia(?:meter)?)(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
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
      /(?:날\s*수|플루트|flute)(?:[이가은는을를도만])?\s*(\d+)/i,
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
      /(?:생크|shank)(?:[이가은는을를도만])?\s*(?:직경|지름)?(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "lengthOfCutMm",
    patterns: [
      /(?:날장|절삭길이|절삭\s*길이|loc)(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "overallLengthMm",
    patterns: [
      /(?:전장|전체\s*길이|oal)(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "helixAngleDeg",
    patterns: [
      /(?:헬릭스|나선각|비틀림각|helix)(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:도|°)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "taperAngleDeg",
    patterns: [
      /(?:테이퍼|테이퍼각|taper)(?:\s*각)?(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:도|°)?/i,
    ],
    extract: (m) => parseFloat(m[1]),
  },
  {
    field: "cornerRadiusMm",
    patterns: [
      /(?:코너\s*R|코너\s*알|인선\s*R|R\s*값)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
      /(?:코너\s*반경|코너\s*래디우스|코너\s*레디우스|corner\s*radius|corner\s*r)(?:[이가은는을를도만])?\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
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
  /(?:재고(?:[가는은이도만])?\s*(?:있|만|확인|된)|즉시\s*구매|바로\s*구매|in\s*stock)/iu,
]
// 숫자 임계값: "재고 200개 이상", "재고 50개 넘는", "stock >= 100", "재고 100 이상만" 등
const STOCK_THRESHOLD_PATTERN = /(?:재고|stock)(?:[가는은이])?\s*(?:>=?|≥)?\s*(\d+)\s*(?:개)?\s*(?:이상|넘는|초과|over|more)?/iu
// 수량 조회 의문문: "재고 몇개", "재고 얼마", "재고 수량", "how much stock" 등 — 임계값 없이 조회.
// filter_by_stock (instock) 으로 라우팅하여 재고 있는 제품만 + 재고 표시로 응답.
const STOCK_QUERY_PATTERNS = [
  /(?:재고|stock)(?:[가는은이])?\s*(?:몇\s*(?:개|대)?|얼마|수량|개수|어느\s*정도|how\s*(?:much|many))/iu,
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

// ── §9 Phase E — Sort / Tolerance / Similarity pattern matchers ───

/**
 * Build an alias→QueryField lookup from the manifest (lowercase).
 * Covers both canonical labels and the aliases array. Manifest-driven:
 * no hardcoded field names below.
 */
const _fieldAliasIndex: Array<{ alias: string; field: QueryField }> = (() => {
  const entries: Array<{ alias: string; field: QueryField }> = []
  for (const e of QUERY_FIELD_MANIFEST) {
    const push = (s: string) => entries.push({ alias: s.toLowerCase(), field: e.field })
    push(e.field)
    push(e.label)
    for (const a of e.aliases) push(a)
  }
  // Longest-first so "shank diameter" beats "diameter"
  return entries.sort((a, b) => b.alias.length - a.alias.length)
})()

/** Find the first field alias that appears in `lower` and is sortable. */
function _findSortableFieldMention(lower: string): QueryField | null {
  const sortable = new Set(getSortableFields())
  for (const { alias, field } of _fieldAliasIndex) {
    if (!sortable.has(field)) continue
    if (alias.length < 2) continue
    if (lower.includes(alias)) return field
  }
  return null
}

/** Find the first numeric field alias that appears before the `near` position. */
function _findNumericFieldNear(lower: string, numIdx: number): QueryField | null {
  // Scan for an alias whose last occurrence is BEFORE the number
  let best: { field: QueryField; pos: number } | null = null
  for (const { alias, field } of _fieldAliasIndex) {
    const entry = QUERY_FIELD_MANIFEST.find(e => e.field === field)
    if (entry?.valueType !== "number") continue
    if (alias.length < 2) continue
    const pos = lower.lastIndexOf(alias, numIdx)
    if (pos >= 0 && (!best || pos > best.pos)) {
      best = { field, pos }
    }
  }
  return best?.field ?? null
}

// "직경 작은 순", "OAL 짧은 순으로", "날수 많은 순서로"
const SORT_ASC_WORDS = ["작은", "짧은", "적은", "낮은", "얇은"]
const SORT_DESC_WORDS = ["큰", "긴", "많은", "높은", "두꺼운"]
const SORT_SUFFIX_RE = /(?:순으로|순서로|순서|\s순\b|^순\b|[가-힣]\s*순(?:$|\s))/u

/** Try to parse a sort phrase. Returns null if not a pure-numeric sort on a sortable field. */
export function tryParseSortPhrase(message: string): QuerySort | null {
  const lower = message.toLowerCase()
  if (!SORT_SUFFIX_RE.test(lower)) return null

  // Scan for `<field alias> ... <direction word> ... 순`
  let dir: "asc" | "desc" | null = null
  for (const w of SORT_ASC_WORDS) {
    if (lower.includes(w)) { dir = "asc"; break }
  }
  if (!dir) {
    for (const w of SORT_DESC_WORDS) {
      if (lower.includes(w)) { dir = "desc"; break }
    }
  }
  if (!dir) return null

  const field = _findSortableFieldMention(lower)
  if (!field) return null

  return { field, direction: dir }
}

// "10mm 근처", "약 10mm", "얼추 8", "OAL 50mm 정도", "10mm쯤"
const TOLERANCE_FUZZY_RE = /(?:(약|대략|얼추)\s*)?(\d+(?:\.\d+)?)\s*(mm)?\s*(근처|쯤|정도)?/iu
// Must contain at least one fuzzy marker (either prefix "약/대략/얼추" or suffix "근처/쯤/정도")
const TOLERANCE_HAS_MARKER_RE = /(?:약|대략|얼추|근처|쯤|정도)/u

/** Try to parse a tolerance phrase. Returns a QueryConstraint with tolerance populated. */
export function tryParseTolerancePhrase(message: string): QueryConstraint | null {
  if (!TOLERANCE_HAS_MARKER_RE.test(message)) return null
  const lower = message.toLowerCase()
  const m = lower.match(TOLERANCE_FUZZY_RE)
  if (!m || !m.index && m.index !== 0) return null
  // Require at least one marker group present
  if (!m[1] && !m[4]) return null

  const numVal = parseFloat(m[2])
  if (!Number.isFinite(numVal) || numVal <= 0) return null

  const numIdx = m.index!
  // Prefer a field mentioned BEFORE the number (e.g., "OAL 50mm 근처")
  let field = _findNumericFieldNear(lower, numIdx)
  // Otherwise default to diameter when unit is "mm" and no other context
  if (!field) {
    if (m[3] === "mm" || !m[3]) field = "diameterMm"
  }
  if (!field) return null

  // Default tolerance: 1.0 absolute for mm diameters, otherwise 10% ratio (handled by compiler)
  const tolerance = 1.0
  return {
    field,
    op: "eq",
    value: numVal,
    display: `${field}: ~${numVal}mm`,
    tolerance,
  }
}

// "이거랑 비슷한", "이 제품이랑 비슷한 spec", "비슷한 거로", "유사 스펙으로"
const SIMILARITY_PATTERNS: RegExp[] = [
  /(?:이거\s*랑|이것\s*이?랑|이\s*제품(?:이|과)?\s*(?:랑|와|같은))\s*비슷/iu,
  /비슷한\s*(?:spec|스펙|거|것|걸|제품이랑)/iu,
  /유사(?:한|\s*스펙|\s*spec)/iu,
]

/** Try to parse a similarity phrase. Returns null if no reference-product context exists. */
export function tryParseSimilarityPhrase(
  message: string,
  sessionState: ExplorationSessionState | null,
): QuerySimilarity | null {
  if (!SIMILARITY_PATTERNS.some(p => p.test(message))) return null
  // KG requires a current product context; otherwise fall through to LLM/SCR.
  // We use a sentinel so the runtime can fill in the real id from session state.
  // Guard: session must have at least ONE displayed/last product.
  const hasCurrent = !!(sessionState && (
    (sessionState as any).lastRecommendedProductId ||
    (sessionState as any).lastRecommended ||
    ((sessionState as any).displayedProducts?.length ?? 0) > 0
  ))
  if (!hasCurrent) return null
  return { referenceProductId: "__current__", topK: 10 }
}

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

  // 0. Compound patterns: "싱크/생크 타입 X" → shankType=X
  const shankTypeMatch = lower.match(/(?:싱크|생크|shank)(?:[이가은는을를도만])?\s*(?:타입|type)(?:[이가은는을를도만])?\s*(\S+)/i)
  if (shankTypeMatch) {
    const rawVal = shankTypeMatch[1]
    // resolve through entity index or use raw
    const entity = _entityIndex.get(rawVal)
    if (entity?.field === "shankType") {
      results.push({ field: "shankType", value: rawVal, canonical: entity.canonical })
    } else {
      // capitalize first letter for DB value
      const canonical = rawVal.charAt(0).toUpperCase() + rawVal.slice(1).toLowerCase()
      results.push({ field: "shankType", value: rawVal, canonical })
    }
  }

  // 0b. Material group pattern: "P소재", "ISO P", "ISO P 소재", "P 소재" → single alpha ISO code
  const materialGroupMatch =
    lower.match(/iso\s*([pmknsh])\b/i) ||
    lower.match(/^([pmknsh])\s*소재/i) ||
    lower.match(/([pmknsh])\s*소재\b/i)
  if (materialGroupMatch && !results.some(r => r.field === "material")) {
    const code = materialGroupMatch[1].toUpperCase()
    results.push({ field: "material", value: code, canonical: code })
  }

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
  // Collect all candidates per field, then pick the longest alias match to avoid
  // short-alias false positives (e.g., "c코팅" matching inside "dlc코팅")
  const fieldCandidates = new Map<string, { node: EntityNode; alias: string }>()
  for (const node of ENTITY_NODES) {
    if (results.some(r => r.field === node.field)) continue
    for (const alias of node.aliases) {
      if (matchesAsWord(lower, alias)) {
        const existing = fieldCandidates.get(node.field)
        if (!existing || alias.length > existing.alias.length) {
          fieldCandidates.set(node.field, { node, alias })
        }
        break
      }
    }
  }
  for (const [, { node, alias }] of fieldCandidates) {
    results.push({ field: node.field, value: alias, canonical: node.canonical })
  }

  // 2b. Numeric pattern matching (fluteCount, diameterMm, etc.)
  // NOTE: These are collected into extractEntities results so that §6 (exclude)
  // and regression tests can see them. They do NOT flow into sql-agent filters
  // directly — §8 (multi-entity dispatch) is disabled, and call sites in
  // serve-engine-runtime only use the results as string hints. This prevents
  // the historical "bare <num>mm hijacks OAL/LOC" regression.
  for (const { field, patterns, extract } of NUMERIC_PATTERNS) {
    if (results.some(r => r.field === field)) continue
    for (const pat of patterns) {
      const m = message.match(pat)
      if (m) {
        const num = extract(m)
        if (Number.isFinite(num) && num > 0) {
          const canonical = String(num)
          results.push({ field, value: m[0], canonical })
        }
        break
      }
    }
  }

  // 3. Dynamic brand matching from DB schema cache (no hardcoding)
  //    Normalize hyphens/spaces: "CRX-S" ↔ "CRX S" ↔ "CRXS"
  if (!results.some(r => r.field === "brand")) {
    const schema = getDbSchemaSync()
    if (schema?.brands) {
      const normMsg = lower.replace(/[-\s]/g, "")
      for (const brand of schema.brands) {
        const brandLower = brand.toLowerCase()
        const normBrand = brandLower.replace(/[-\s]/g, "")
        if (matchesAsWord(lower, brandLower) || lower.includes(brandLower)
          || (normBrand.length >= 3 && normMsg.includes(normBrand))) {
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

/**
 * Phase E — partial QuerySpec emitted by KG §9 (sort / tolerance / similarity).
 * Consumed by serve-engine-runtime which stashes it on session state so the
 * downstream compileProductQuery path can pick it up. The runtime resolves
 * `similarTo.referenceProductId === "__current__"` into a real product id
 * from session state before compiling.
 */
export interface KGSpecPatch {
  sort?: QuerySort
  similarTo?: QuerySimilarity
  /** constraints whose `tolerance`/`toleranceRatio` must be merged into an existing eq constraint (or added new). */
  toleranceConstraints?: QueryConstraint[]
}

export interface KGDecisionResult {
  decision: SemanticTurnDecision | null
  confidence: number
  source: "kg-intent" | "kg-entity" | "kg-exclude" | "kg-skip" | "kg-sort" | "kg-tolerance" | "kg-similarity" | "none"
  reason: string
  /** Phase E — partial QuerySpec additions. Coexist with `decision`; runtime merges. */
  specPatch?: KGSpecPatch
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
  // 숫자 임계값 ("재고 200개 이상") 우선 확인 — STOCK_PATTERNS 보다 먼저 매칭하여
  // threshold 가 누락된 채 instock 으로 떨어지는 것을 막는다.
  const stockThresholdMatch = msg.match(STOCK_THRESHOLD_PATTERN)
  if (stockThresholdMatch) {
    const threshold = parseInt(stockThresholdMatch[1], 10)
    if (Number.isFinite(threshold) && threshold > 0) {
      return {
        decision: buildDecision(
          { type: "filter_by_stock", stockFilter: "instock", stockThreshold: threshold } as OrchestratorAction,
          [],
          0.92,
          `KG: stock threshold ${threshold}`,
        ),
        confidence: 0.92,
        source: "kg-intent",
        reason: `stock threshold ${threshold}`,
      }
    }
  }
  // 재고 수량 조회 의문문 ("재고 몇개 있어?") — threshold 없이 instock 으로 라우팅하여
  // serve-engine-stock 이 재고 있는 후보 + totalStock 값을 표시하도록 위임.
  if (STOCK_QUERY_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "filter_by_stock", stockFilter: "instock" } as OrchestratorAction, [], 0.92, "KG: stock query (수량 조회)"),
      confidence: 0.92,
      source: "kg-intent",
      reason: "stock query",
    }
  }
  if (STOCK_PATTERNS.some(p => p.test(msg))) {
    return {
      decision: buildDecision({ type: "filter_by_stock", stockFilter: "instock" } as OrchestratorAction, [], 0.90, "KG: stock filter"),
      confidence: 0.90,
      source: "kg-intent",
      reason: "stock filter",
    }
  }
  // 재고 정렬 (예: "재고 많은 순으로", "재고 적은 순"). totalStock 은 sortable manifest 에
  // 없어서 tryParseSortPhrase 가 잡지 못함 → 명시 패턴으로 filter_by_stock 라우팅 후
  // serve-engine-stock 의 desc rerank 에 위임. MFM04/MFM10 골든셋 fix.
  if (/재고[가는은이도만]?\s*(?:많|적)[은는]\s*순/u.test(msg)) {
    return {
      decision: buildDecision({ type: "filter_by_stock", stockFilter: "instock" } as OrchestratorAction, [], 0.92, "KG: stock sort"),
      confidence: 0.92,
      source: "kg-intent",
      reason: "stock sort",
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
    /(?:뭐야|뭐예요|뭐에요|뭘까|뭔가요|무엇|무슨\s*뜻|알려줘|알려\s*주세요|설명|차이가?\s*뭐|차이$|차이점|어떤\s*거야|란\s*뭐|이란|이\s*뭐|중요해|중요한가|필요해)/iu,
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

  // ── §9 Phase E. Sort / Tolerance / Similarity dispatch ──
  // Produces a `specPatch` that the runtime merges into the QuerySpec flowing
  // into compileProductQuery (sort → ORDER BY, tolerance → BETWEEN rewrite,
  // similarTo → similarity CTE). We still emit a benign `show_recommendation`
  // decision so the runtime treats it as a handled turn — the actual SQL
  // behavior comes from the specPatch.
  //
  // Order inside this block:
  //   (a) similarity — most specific phrase shape, and must win over competitor §5b
  //   (b) sort — "직경 작은 순" etc. Stock sort stays on existing post-display
  //       rerank path (option b) since stockStatus isn't a numeric QueryField.
  //   (c) tolerance — "10mm 근처", "약 50mm"
  //
  // Each sub-matcher returns null on miss → plain fall-through to §5a.
  {
    const sim = tryParseSimilarityPhrase(msg, sessionState)
    if (sim) {
      return {
        decision: buildDecision({ type: "show_recommendation" }, [], 0.92, `KG §9: similarity → ${sim.referenceProductId}`),
        confidence: 0.92,
        source: "kg-similarity",
        reason: `similarity referenceProductId=${sim.referenceProductId}`,
        specPatch: { similarTo: sim },
      }
    }
  }
  {
    const sort = tryParseSortPhrase(msg)
    if (sort) {
      return {
        decision: buildDecision({ type: "show_recommendation" }, [], 0.92, `KG §9: sort ${sort.field} ${sort.direction}`),
        confidence: 0.92,
        source: "kg-sort",
        reason: `sort ${sort.field} ${sort.direction}`,
        specPatch: { sort },
      }
    }
  }
  {
    const tol = tryParseTolerancePhrase(msg)
    if (tol) {
      return {
        decision: buildDecision({ type: "show_recommendation" }, [], 0.90, `KG §9: tolerance ${tol.field} ~${tol.value}`),
        confidence: 0.90,
        source: "kg-tolerance",
        reason: `tolerance ${tol.field}=${tol.value}±${tol.tolerance}`,
        specPatch: { toleranceConstraints: [tol] },
      }
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
  // "CRX S 말고 다른 브랜드" = exclude, not competitor query → negation이면 skip
  const hasNegSignal = /빼고|제외|말고|아닌|않은/u.test(msg)
  if (COMPETITOR_PATTERNS.some(p => p.test(msg)) && !hasNegSignal) {
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
  // Also handles "X 말고 Y로" → apply Y as eq (not just exclude X)
  for (const pattern of EXCLUDE_PATTERNS) {
    const match = msg.match(pattern)
    if (match) {
      const excludeRaw = (match[1] || match[2]).toLowerCase()
      const entity = resolveEntity(excludeRaw)
      const resolved = entity
        ? { field: entity.field, canonical: entity.canonical }
        : (() => {
            const numEntities = extractEntities(excludeRaw)
            return numEntities.length > 0 ? { field: numEntities[0].field, canonical: numEntities[0].canonical } : null
          })()
      if (resolved) {
        // Check if there's a replacement entity in the rest of the message
        // "2날 말고 4날로", "Square 빼고 Ball로", "TiAlN 말고 DLC" etc.
        const afterExclude = msg.slice(match.index! + match[0].length)
        const replacementEntities = extractEntities(afterExclude)
        const replacement = replacementEntities.find(e => e.field === resolved.field)

        if (replacement) {
          // "X 말고 Y로" → apply Y as eq (user wants Y, not just "not X")
          const filter: AppliedFilter = {
            field: replacement.field,
            op: "eq",
            value: replacement.canonical,
            rawValue: replacement.canonical,
            appliedAt: 0,
          }
          return {
            decision: buildDecision({ type: "continue_narrowing", filter } as OrchestratorAction, [], 0.95, `KG: replace ${resolved.canonical} → ${replacement.canonical}`),
            confidence: 0.95,
            source: "kg-exclude",
            reason: `replace ${resolved.field}: ${resolved.canonical} → ${replacement.canonical}`,
          }
        }

        // No replacement → pure exclusion
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

  // ── 8. Bare-token entity dispatch ──
  // Principle: KG may only dispatch when it is highly confident that its
  // extraction represents the *entire* user intent, not a fragment of it.
  // The practical test for "lossless" is conservative: the message must be
  // at most 2 whitespace tokens, and KG must have matched all of them as
  // entities. Longer utterances (e.g. "4날 TiAlN Square") historically
  // caused §8 leaks where KG partially extracted and hijacked the turn —
  // deterministic-scr / LLM handle those correctly. See kg-disabled-
  // multientity.test.ts for the behavioral contract.
  //
  // Two explicit exceptions allowed because they are high-signal compound
  // phrases whose shape the KG alias index does not tokenize cleanly but
  // whose meaning is unambiguous:
  //   (a) "싱크/생크 타입 X" → shankType compound
  //   (b) "P/M/K/N/S/H 소재" → ISO material group
  //
  // Additional guard: `diameterMm` is excluded unconditionally. "<num>mm" is
  // lexically ambiguous (OAL / LOC / shank / cutting diameter) and only SCR
  // has the context to disambiguate safely.
  const entities = extractEntities(msg)
  const tokenCount = msg.split(/\s+/).filter(Boolean).length
  const hasDiameter = entities.some(e => e.field === "diameterMm")

  const isLosslessShortUtterance =
    entities.length >= 1 &&
    entities.length === tokenCount &&
    tokenCount <= 2 &&
    !hasDiameter
  const isShankCompound = /(?:싱크|생크|shank)\s*(?:타입|type)\s*\S+/i.test(msg)
  const isMaterialGroup = /(?:^|\s)[pmknshPMKNSH]\s*소재/.test(msg)

  const shouldDispatch =
    entities.length >= 1 &&
    (isLosslessShortUtterance || isShankCompound || isMaterialGroup)
  if (shouldDispatch && !COMPANY_PATTERNS.some(p => p.test(msg))) {
    // Negation check: "4날 말고", "TiAlN 빼고" 등 → op: "exclude"
    const isNegation = /빼고|제외|아닌\s*것|아닌\s*걸|아닌걸|없는\s*거|말고|만\s*아니면|없이|아닌\s*거|없는\s*거로|가\s*아닌|이\s*아닌/u.test(msg)
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
