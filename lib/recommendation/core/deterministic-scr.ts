/**
 * Deterministic Single-Call Router (DB-driven NL → SQL filter parser)
 *
 * 목적: LLM 변덕 없이 자연어 메시지에서 SQL 필터를 추출.
 * 한국어/영어 정형 패턴 (label + 숫자 + 단위 + 비교 표현) 90%+ 잡음.
 *
 * 사용:
 *   const actions = parseDeterministic(message)
 *   if (actions.length > 0) → 사용
 *   else → LLM SCR로 fallback (hybrid)
 *
 * Output shape: single-call-router.ts 의 SingleCallAction 과 동일.
 */

import { findColumnsForToken, findValueByPhonetic } from "./sql-agent-schema-cache"
import { DB_COL_TO_FILTER_FIELD } from "./sql-agent"
import { stripKoreanParticles } from "@/lib/recommendation/shared/patterns"
import { findFuzzyMatch } from "./phonetic-match"

// Brand values — sample of clean YG-1 brands from prod_brand.brand_name (421
// distinct, dumped 2026-04-08). Phonetic fuzzy match (consonant skeleton) lets
// Korean transliterations like 엑스파워/알루파워/타이타녹스 hit these without
// any hardcoded alias map. New brands appearing in DB still flow through the
// LLM SCR fallback path until this list is refreshed.
const BRAND_VALUES = [
  "X-POWER", "X-POWER PRO", "TitaNox-Power", "TitaNox", "CRX-S", "CRX S",
  "ALU-POWER", "3S MILL", "3S PLUS", "ONLY ONE", "K2 CARBIDE", "K-2 CARBIDE",
  "TANK-POWER", "JET-POWER", "X1-EH", "X5070", "X5070S", "E-FORCE",
  "V7", "V7 PLUS", "V7 PLUS A", "V7 INOX", "GMG", "GAA29", "SUS-CUT",
  "SUPER ALLOY", "BASIX", "4G MILL", "4G MILLS",
]

export interface DeterministicAction {
  type: "apply_filter"
  field: string
  value: string | number
  value2?: string | number
  op: "eq" | "neq" | "gte" | "lte" | "between"
  source: "deterministic"
}

/**
 * An ambiguity surfaced by the MV reverse-index extractor: a single user
 * token resolved to multiple distinct registry fields, so we cannot pick
 * a slot deterministically. The router converts these into a clarification
 * question instead of guessing.
 */
export interface MvAmbiguity {
  /** The user-supplied token (lowercased, particle-stripped) */
  token: string
  /** Candidate registry fields the token could belong to */
  fields: string[]
}

export interface DeterministicMeta {
  ambiguities: MvAmbiguity[]
}

// ── Field cue patterns (한국어 + 영어). 우선순위 순 ──────────────
// 더 구체적인 패턴이 먼저 와야 함 (전체 길이 → overallLength 가 직경보다 우선)
const FIELD_CUES: Array<{ pattern: RegExp; field: string; numeric: boolean }> = [
  // OAL 전장
  { pattern: /(전체\s*길이|전장|오버롤|overall\s*length|\boal\b)/i, field: "overallLengthMm", numeric: true },
  // LOC 날장
  { pattern: /(절삭\s*길이|날\s*길이|날장|\bloc\b|\bcl\b|length\s*of\s*cut)/i, field: "lengthOfCutMm", numeric: true },
  // 샹크 직경
  { pattern: /(샹크\s*(?:직경|지름)?|생크\s*(?:직경|지름)?|shank\s*(?:dia|diameter)?)/i, field: "shankDiameterMm", numeric: true },
  // 헬릭스
  { pattern: /(헬릭스\s*각?도?|나선\s*각?도?|helix\s*angle|\bhelix\b)/i, field: "helixAngleDeg", numeric: true },
  // 포인트 각도 (drill)
  { pattern: /(포인트\s*각도|드릴\s*포인트|point\s*angle|드릴\s*끝)/i, field: "pointAngleDeg", numeric: true },
  // 피치 (thread)
  { pattern: /(나사\s*피치|스레드\s*피치|thread\s*pitch|\bpitch\b|\bp\s*\d)/i, field: "threadPitchMm", numeric: true },
  // 볼/코너 R
  { pattern: /(코너\s*r|코너\s*반경|볼\s*반경|ball\s*radius|corner\s*r)/i, field: "ballRadiusMm", numeric: true },
  // 직경 (가장 일반적이라 마지막). 단 "샹크 직경"/"생크 직경"은 위에서 이미 처리됨
  { pattern: /(?<![샹생][크])\s*(직경|지름|외경|파이|\bdia(?:meter)?\b|\bφ|\bø)/i, field: "diameterMm", numeric: true },
  // 날수
  { pattern: /(날수|날\s*수|\bflute\s*count\b|\bflutes?\b)/i, field: "fluteCount", numeric: true },
]

// "4날", "2 flute", "5F" 같은 inline flute count 패턴
const INLINE_FLUTE_RE = /(\d+)\s*(?:날|flutes?|fl\b|f\b)/i

// Operator markers (range). 위치는 value 뒤에 와야 함.
const OP_MARKERS: Array<{ pattern: RegExp; op: "gte" | "lte" }> = [
  { pattern: /(이상|넘는|초과|위로|부터|over|above|≥|>=)/i, op: "gte" },
  { pattern: /(이하|미만|밑|까지|under|below|≤|<=)/i, op: "lte" },
]

// Between markers
const BETWEEN_MARKERS = /(?:사이|between|~|에서|to)/i

// Negation markers
const NEG_MARKERS = /(말고|빼고|제외|exclude|아닌)/i

// Coating values (registry queryAliases 와 일치 — DB에 있는 값)
const COATING_VALUES = [
  "TiAlN", "AlTiN", "AlCrN", "DLC", "TiCN", "TiN",
  "Y-Coating", "T-Coating", "X-Coating", "Z-Coating", "H-Coating",
  "Bright Finish", "Steam Homo", "Hardslick", "Diamond", "Coloring",
  "Blue-Coating", "Uncoated", "Non-Coating",
]

// ── DB meta constants (source: scripts/dump-meta.mjs → test-results/db-meta.json, 2026-04-08) ──
// DB가 확장될 일 없어서 정적 하드코딩. 정제 규칙: TEST/cyr/excel/단일문자/경로/숫자만 제거.

// ISO 가공재질 코드 (P/M/K/N/S/H/O). prod_work_piece_by_category 34건을 ISO로 매핑.
const WORK_MATERIAL_VALUES = ["P", "M", "K", "N", "S", "H", "O"] as const

// 자연어 → ISO workMaterial 코드 매핑
const WORK_MATERIAL_CUES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /(스테인리스|스텐|스뎅|sus\b|stainless|inox)/i, value: "M" },
  { pattern: /(티타늄|titanium|\bti\b|타이태늄)/i, value: "S" },
  { pattern: /(인코넬|inconel|하스텔로이|hastelloy|내열\s*합금|heat[\s-]?resistant|hrsa|nimonic|waspaloy)/i, value: "S" },
  { pattern: /(알루미늄|알미늄|aluminum|aluminium|\bal\b)/i, value: "N" },
  { pattern: /(구리|동\b|copper|황동|brass|청동|bronze)/i, value: "N" },
  { pattern: /(주철|cast\s*iron|덕타일|ductile|fcd|\bfc\b\d*)/i, value: "K" },
  { pattern: /(고경도|경화강|hardened|HRc?\s*\d|hrc)/i, value: "H" },
  { pattern: /(탄소강|carbon\s*steel|sm45c|s45c|s50c|구조용\s*강|structural\s*steel|합금강|alloy\s*steel|공구강|tool\s*steel|prehardened)/i, value: "P" },
  { pattern: /(cfrp|gfrp|kfrp|복합재|honeycomb|허니컴|아크릴|acrylic|플라스틱|plastic|graphite|그라파이트)/i, value: "O" },
]

// prod_edp_option_turning.option_turning_grade (23 distinct, cleaned)
const GRADE_VALUES = [
  "YBN50", "YBN65", "YBN65A", "YBN90",
  "YG10", "YG100", "YG1001", "YG1010", "YG2025",
  "YG211", "YG213", "YG214",
  "YG3010", "YG3015", "YG3020", "YG3030", "YG3115",
  "YG401", "YG602", "YG602G", "YG603", "YG801", "YT100",
] as const

// turning + milling chip_breaker distinct 값을 합친 정제 셋
const CHIP_BREAKER_VALUES = [
  "-AL", "-GL", "-GM", "-GN", "-GW", "-KR", "-M", "-MF", "-MM", "-MR",
  "-N", "-P", "-PW", "-RG", "-SF", "-ST", "-TR", "-UC", "-UF", "-UG",
  "-UL", "-UM", "-UR", "-Y",
  "AL", "GENERAL", "GL", "GM", "KR", "MA", "MF", "MG", "MM", "MR",
  "PF", "PM", "PSF", "PWM", "RG", "SF", "ST", "TR", "Wiper",
] as const

// ISO 인서트 형상 코드 (DB dump엔 IC만 있어 ISO 표준에서 직접). prefix가 형상.
const INSERT_SHAPE_VALUES = [
  "CNMG", "CNMA", "CCMT", "CCGT",
  "WNMG", "WNMA",
  "DNMG", "DNMA", "DCMT", "DCGT",
  "TNMG", "TNMA", "TCMT",
  "SNMG", "SNMA",
  "VNMG", "VNMA", "VCMT", "VBMT",
  "RCMT", "RCGT",
] as const

// prod_edp_option_threading 정제 셋 (threadshape/threaddirection/internal_external + TPI 표현)
const THREAD_SHAPE_VALUES = [
  "M", "MF", "M/MF", "UN", "UNC", "UNF", "UNEF", "UNS",
  "G", "G(BSP)", "BSPT", "PT", "PF", "PF(G)", "PS",
  "NPT", "NPTF", "NPS", "NPSF", "W",
] as const
const THREAD_DIRECTION_VALUES = ["RH Thread", "LH Thread", "RH / LH Thread"] as const
const THREAD_INT_EXT_VALUES = ["INTERNAL", "EXTERNAL", "INTERNAL/EXTERNAL"] as const

// prod_edp_option_holemaking 정제
const DRILL_TYPE_VALUES = [
  "ANSI", "JIS", "KS (JIS)", "NAS 907/D", "YG STD",
  "DIN 333", "DIN 338", "DIN 340", "DIN 341", "DIN 345",
  "DIN 1869/1", "DIN 1869/2", "DIN 1869/3",
  "DIN 1870/1", "DIN 1870/2", "DIN 1897",
  "DIN 6537", "DIN 6539",
] as const
const HOLE_SHAPE_VALUES = ["Blind", "Through", "Blind / Through"] as const

// 냉각 방식 (자연어 표현 — tooling.coolant_system 코드는 사용자가 부르지 않음)
const COOLANT_SYSTEM_VALUES = [
  "Wet", "Dry", "Oil mist", "Air blow", "MQL",
  "Through coolant", "External coolant",
] as const

// 가공조건 (황삭/중삭/정삭) — DB 컬럼은 노이즈가 심해 ISO 카테고리만
const MACHINING_CONDITION_VALUES = ["Roughing", "Medium", "Finishing"] as const
const MACHINING_CONDITION_CUES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /(황삭|거친\s*가공|roughing|rough\b)/i, value: "Roughing" },
  { pattern: /(중삭|medium\s*cut|중간\s*가공)/i, value: "Medium" },
  { pattern: /(정삭|마무리|finishing|finish\s*cut)/i, value: "Finishing" },
]

// 가공 형상 (prod_series.application_shape 콤마결합 → atom 분해 후 정제)
const APPLICATION_SHAPE_VALUES = [
  "Corner_Radius", "Die-Sinking", "Facing", "Helical_Interpolation",
  "Side_Milling", "Slotting", "Trochoidal", "Small_Part",
  "Taper_Side_Milling", "Profiling", "Ramping", "Plunging",
  "Chamfering", "Center_Drill",
] as const

// TODO: MV 확장 후 연결 — tooling 클램핑 범위 (현재 dump엔 cryptic 코드만, NL match 무의미)
const CLAMPING_RANGE_VALUES: readonly string[] = []

// TODO: MV 확장 후 연결 — prod_series_work_material_statu (시리즈-재질 적합도). CRX-S scoring source.
const SERIES_WORK_MATERIAL_VALUES: readonly string[] = []

// ── 추가 NL 패턴 (Phase 2 expansion) ──────────────────────────
// 현장 사용 표현 / DB 컬럼 추가 매핑.

// 툴홀더 타입 (BT/HSK/HSK-A/HSK-E/SK/CAT/ER/SLN/SDS/CTH/Capto)
// option_tooling_producttype, option_tooling_shanktype, option_tooling_taper_no
const TOOL_HOLDER_VALUES = [
  "BT30", "BT40", "BT50",
  "HSK32", "HSK40", "HSK50", "HSK63", "HSK80", "HSK100",
  "HSK-A40", "HSK-A50", "HSK-A63", "HSK-A100",
  "HSK-E25", "HSK-E32", "HSK-E40",
  "HSK-F40", "HSK-F50", "HSK-F63",
  "SK30", "SK40", "SK50",
  "CAT40", "CAT50",
  "ISO30", "ISO40", "ISO50",
  "ER8", "ER11", "ER16", "ER20", "ER25", "ER32", "ER40", "ER50",
  "DIN 69871", "MAS-BT", "Capto C3", "Capto C4", "Capto C5", "Capto C6", "Capto C8",
] as const

// ISO 인서트 정밀 지정 (CNMG120408 같은 풀 코드의 inscribed circle / thickness / corner R 부분만)
// 풀 코드 매칭은 별도 함수에서.
const INSERT_FULL_CODE_RE = /\b([CDSTVWR][CN]M[AGT])(\d{2})(\d{2})(\d{2})(?:[A-Z]{1,2})?\b/i

// 나사 사이즈 패턴 (M8x1.25, M10×1.5, 1/4-20 UNC, 3/8-16 UNF, M6x0.75 등)
const THREAD_SIZE_METRIC_RE = /\bM(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\b/i
const THREAD_SIZE_INCH_RE = /\b(\d+\/\d+)\s*[-]\s*(\d+)\s*(UNC|UNF|UNEF)\b/i
const THREAD_SIZE_NUMBER_RE = /\b#(\d+)\s*[-]\s*(\d+)\s*(UNC|UNF)\b/i

// 정밀도 클래스 (h6/h7/h8/H7/H8/IT6/IT7)
const PRECISION_CLASS_RE = /\b(h[5-9]|H[5-9]|h1[0-2]|H1[0-2]|IT[5-9]|IT1[0-2])\b/

// 탭 정밀도 (6H, 6G, 7H, 6HX 등)
const TAP_TOLERANCE_RE = /\b([4-7])\s*([HGX])\b/

// 표면 거칠기 / 마무리 (Ra, mirror, 미러)
const SURFACE_FINISH_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /(미러|mirror|경면|거울)/i, value: "Mirror" },
  { pattern: /\bRa\s*0?\.?\d+/i, value: "Polished" },
  { pattern: /(폴리시|polished|광택)/i, value: "Polished" },
]

// 추가 재질 (기존 WORK_MATERIAL_CUES 보강)
const EXTRA_MATERIAL_CUES: Array<{ pattern: RegExp; value: string }> = [
  // 인코넬/하스텔로이 특정 그레이드
  { pattern: /(inconel\s*718|inco\s*718|in718|니켈\s*718)/i, value: "S" },
  { pattern: /(inconel\s*625|inconel\s*600|inconel\s*825)/i, value: "S" },
  { pattern: /(hastelloy\s*[a-z]?-?\d*|monel|stellite|\bnimonic\b|\bwaspaloy\b)/i, value: "S" },
  // 스테인리스 강종 별
  { pattern: /(sus\s*?304|sus\s*?316l?|sus\s*?420|sus\s*?630|sts\s*?304|17[\-\s]?4\s*ph|duplex)/i, value: "M" },
  // 탄소강 강종 별
  { pattern: /(s[ck]\s*?45c?|s[ck]\s*?50c?|sm45c|s50c|aisi\s*?10\d{2}|c45|ck45)/i, value: "P" },
  // 합금강 SCM/SKD/SKH
  { pattern: /(scm\s*?4\d{2}|skd\s*?\d+|skh\s*?\d+|h13|d2\b|m2\b|cr-?mo|크롬몰리)/i, value: "P" },
  // 금형강 (경화강 분기)
  { pattern: /(p20\b|nak80|stavax|hpm|kp4m|금형강|mold\s*steel|die\s*steel)/i, value: "H" },
  // 알루미늄 합금
  { pattern: /(a\s*?6061|a\s*?7075|a\s*?5052|a\s*?2024|al7075|al6061|두랄루민|duralumin|alloy\s*70[0-9]{2})/i, value: "N" },
  // 황동/청동 세분
  { pattern: /(c\s*?36000|c360|naval\s*brass|leaded\s*brass|free[\s-]?cutting\s*brass)/i, value: "N" },
  // 마그네슘
  { pattern: /(magnesium|az31|az91|마그네슘|마그네)/i, value: "N" },
  // 그라파이트/세라믹
  { pattern: /(graphite|그라파이트|carbon\s*graphite)/i, value: "O" },
  { pattern: /(ceramic|세라믹|sialon|silicon\s*nitride|si3n4)/i, value: "K" },
  // 강 hardness 표현
  { pattern: /\bHRC\s*[3-7]\d|로크웰\s*[3-7]\d|\bhrb\s*\d+/i, value: "H" },
]

// 가공 작업 추가 (counterbore, countersink, spot, peck, deep, high-feed)
const EXTRA_OPERATION_CUES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /(카운터\s*보어|counter\s*bore|cbore|c\.b\.)/i, value: "Counterbore" },
  { pattern: /(카운터\s*싱크|counter\s*sink|csk|c\.s\.k)/i, value: "Countersink" },
  { pattern: /(스팟\s*드릴|spot\s*drill|중심\s*드릴|센터링)/i, value: "Spot_Drill" },
  { pattern: /(펙\s*드릴|peck\s*drill|단계\s*드릴|peck\s*cycle)/i, value: "Peck_Drill" },
  { pattern: /(딥\s*드릴|deep\s*hole|건드릴|gun\s*drill|심공)/i, value: "Deep_Hole" },
  { pattern: /(하이\s*피드|high[\s-]?feed|고이송)/i, value: "High_Feed" },
  { pattern: /(보링|boring|내경\s*가공)/i, value: "Boring" },
  { pattern: /(리밍|reaming|reamer|리머)/i, value: "Reaming" },
  { pattern: /(탭핑|tapping|탭\s*가공)/i, value: "Tapping" },
  { pattern: /(롤링|roll\s*tap|롤탭)/i, value: "Roll_Tap" },
  { pattern: /(쓰레드\s*밀|thread\s*mill|나사\s*밀)/i, value: "Thread_Mill" },
  { pattern: /(엔그레이빙|engraving|각인)/i, value: "Engraving" },
]

// 칩 배출 / 쿨란트 압력
const CHIP_EVACUATION_CUES: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /(고압\s*쿨런트|high\s*pressure\s*coolant|hpc\b)/i, value: "HighPressureCoolant" },
  { pattern: /(저압\s*쿨런트|low\s*pressure)/i, value: "LowPressureCoolant" },
  { pattern: /(칩\s*배출|chip\s*evacuation|칩\s*제거)/i, value: "ChipEvacuation" },
]

// 코팅 / 브랜드 표시 정규화
function findValueIn(text: string, values: string[]): string | null {
  const t = text.toLowerCase()
  // longest first
  const sorted = [...values].sort((a, b) => b.length - a.length)
  for (const v of sorted) if (t.includes(v.toLowerCase())) return v
  return null
}

// 인접 숫자 추출 (cue 위치 기준 ±N자 내)
function extractNumberNear(text: string, startIdx: number, endIdx: number): { value: number; idxStart: number; idxEnd: number } | null {
  // search forward from cue end (within 30 chars)
  const window = text.slice(endIdx, endIdx + 30)
  const m = window.match(/(-?\d+(?:\.\d+)?)/)
  if (m && m.index != null) {
    return { value: parseFloat(m[1]), idxStart: endIdx + m.index, idxEnd: endIdx + m.index + m[0].length }
  }
  // backward (within 20 chars)
  const before = text.slice(Math.max(0, startIdx - 20), startIdx)
  const matches = [...before.matchAll(/(-?\d+(?:\.\d+)?)/g)]
  if (matches.length > 0) {
    const last = matches[matches.length - 1]
    if (last.index != null) {
      const absStart = Math.max(0, startIdx - 20) + last.index
      return { value: parseFloat(last[1]), idxStart: absStart, idxEnd: absStart + last[0].length }
    }
  }
  return null
}

// 두 숫자 사이 between 패턴 detect (예: "8mm 이상 12mm 이하", "6에서 10 사이", "8~12")
function tryBetween(text: string): { lo: number; hi: number } | null {
  const patterns = [
    /(-?\d+(?:\.\d+)?)\s*(?:mm)?\s*[~\-]\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?/i,
    /(-?\d+(?:\.\d+)?)\s*(?:mm)?\s*에서\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?\s*(?:사이|까지)/i,
    /(-?\d+(?:\.\d+)?)\s*(?:mm)?\s*이상\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?\s*이하/i,
    /between\s*(-?\d+(?:\.\d+)?)\s*and\s*(-?\d+(?:\.\d+)?)/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const a = parseFloat(m[1]); const b = parseFloat(m[2])
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
        return { lo: Math.min(a, b), hi: Math.max(a, b) }
      }
    }
  }
  return null
}

// Op detect: cue + value 다음 12자 내에서 marker 찾기
function detectOpAfter(text: string, valueEnd: number): "gte" | "lte" | null {
  const tail = text.slice(valueEnd, valueEnd + 12)
  for (const { pattern, op } of OP_MARKERS) if (pattern.test(tail)) return op
  return null
}

// 1/4인치 → 6.35mm
function parseInchFraction(text: string): number | null {
  const m = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:인치|inch|in|")/)
  if (m) {
    const a = parseInt(m[1]); const b = parseInt(m[2])
    if (b > 0) return Math.round(a / b * 25.4 * 100) / 100
  }
  return null
}

// M10 → 10 (Threading), 1.5pitch → pitch 1.5
function parseThreadPattern(text: string): { dia?: number; pitch?: number } {
  const result: { dia?: number; pitch?: number } = {}
  // M10 / M8 / M12 = metric thread diameter
  const mDia = text.match(/\bM(\d+(?:\.\d+)?)/i)
  if (mDia) result.dia = parseFloat(mDia[1])
  // P1.5 / 1.5 pitch / 1.5피치
  const mPitch = text.match(/\bP\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:pitch|피치)/i)
  if (mPitch) result.pitch = parseFloat(mPitch[1] || mPitch[2])
  return result
}

// 재고 (stock)
const STOCK_PATTERNS = [
  /재고[가는은이도]?\s*있/, /재고만/, /재고[가는은이]?\s*\d/, /재고로/, /재고\b/, /in[-\s]?stock/i, /즉시\s*출하/, /빠른\s*납기/, /납기\s*빠른/,
]

// 쿨런트홀 (coolant hole)
const COOLANT_PATTERNS = [
  /쿨런트\s*홀/, /쿨런트\s*구멍/, /coolant\s*hole/i, /내부\s*냉각/,
]

// 공구 소재 (tool material) — registry queryAliases (filter-field-registry.ts:704) 와 동기화.
// DB 값은 영문 (Carbide / HSS) 이라 한국어 별칭은 canonical 영문으로 매핑한다.
// 우선순위 주의: 더 구체적인 패턴(예: HSS-Co)을 먼저 두지 않으므로 NL 매칭에서
// 가장 흔한 용어부터. PCD/Diamond 는 동일 value(Diamond)로 매핑.
const TOOL_MATERIAL_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /카바이드|초경|carbide/i, value: "Carbide" },
  { pattern: /하이스|고속도강|high\s*speed\s*steel|\bhss\b/i, value: "HSS" },
  { pattern: /\bcbn\b|씨비엔|큐빅\s*보론|cubic\s*boron\s*nitride/i, value: "CBN" },
  { pattern: /다이아몬드|\bpcd\b|\bdiamond\b|폴리크리스탈|polycrystalline\s*diamond/i, value: "Diamond" },
]

// 국가
const COUNTRY_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /한국|국내|국산|내수|korea/i, value: "한국" },
  { pattern: /유럽|europe|유럽판매/i, value: "유럽" },
  { pattern: /일본|japan/i, value: "일본" },
  { pattern: /독일|germany/i, value: "독일" },
  { pattern: /미국|usa|america/i, value: "미국" },
  { pattern: /중국|china/i, value: "중국" },
]

// ── Extended extractors (workMaterial / grade / chipBreaker / insertShape / thread / drill / coolantSystem / machiningCondition / applicationShape) ──
// 모두 동일한 시그니처: (text) → DeterministicAction[] (0개 또는 1개+).
// NEG_MARKERS 인접 시 op = "neq". MV 미연결 카테고리는 호출되어도 no-op이 되도록 _VALUES 비어있으면 skip.

function negNear(text: string, idx: number, len: number): boolean {
  const ctx = text.slice(Math.max(0, idx - 8), idx + len + 12)
  return NEG_MARKERS.test(ctx)
}

function findValueWithPos(text: string, values: readonly string[]): { value: string; idx: number } | null {
  const lower = text.toLowerCase()
  const sorted = [...values].sort((a, b) => b.length - a.length)
  for (const v of sorted) {
    const needle = v.toLowerCase()
    let from = 0
    // 단어 경계 검사: 매치 직전/직후 글자가 영숫자면 substring 매치 (예: "10mm" 안의 "mm")로 간주하고 skip
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = lower.indexOf(needle, from)
      if (i < 0) break
      const before = i > 0 ? lower[i - 1] : ""
      const after = i + needle.length < lower.length ? lower[i + needle.length] : ""
      const isAlnum = (c: string) => /[a-z0-9]/.test(c)
      const startsAlnum = isAlnum(needle[0])
      const endsAlnum = isAlnum(needle[needle.length - 1])
      const beforeOk = !startsAlnum || !before || !isAlnum(before)
      const afterOk = !endsAlnum || !after || !isAlnum(after)
      if (beforeOk && afterOk) return { value: v, idx: i }
      from = i + 1
    }
  }
  return null
}

// ── workPieceName patterns (14 canonical groups, mirrors knowledge-graph.ts) ─
// Order matters: more specific groups first (e.g., Hardened/Prehardened before Alloy),
// and grade-level aliases are included to route to the correct group.
const WORKPIECE_PATTERNS: Array<{ pattern: RegExp; value: string }> = [
  // Hardened Steels (HRC / SKD / 경화강) — before Alloy Steels to avoid SKD → alloy
  { pattern: /(경화강|열처리강|고경도강|다이스강|die\s*steel|hardened|\bskd\s*\d*|\bhrc\s*\d*)/i, value: "Hardened Steels" },
  // Prehardened Steels — before Alloy
  { pattern: /(조질강|프리하든|prehardened|nakhrc|hp\s*강)/i, value: "Prehardened Steels" },
  // Stainless Steels
  { pattern: /(스테인리스|스테인레스|스텐|\bsus\s*\d*|\bsts\s*\d*|stainless|inox)/i, value: "Stainless Steels" },
  // Titanium (before Alloy; before general Ti6Al4V)
  { pattern: /(티타늄|티타늄합금|titanium|ti6al4v|\bti-6al-4v\b|초내열합금|내열초합금|내열합금)/i, value: "Titanium" },
  // Inconel / Nickel alloys
  { pattern: /(인코넬|inconel|니켈합금|nickel\s*alloy|하스텔로이|hastelloy)/i, value: "Inconel" },
  // Aluminum
  { pattern: /(알루미늄|알미늄|알루미늄합금|aluminum|aluminium|두랄루민|\ba[\s-]?(?:6061|7075|5052)\b)/i, value: "Aluminum" },
  // Copper / Brass / Bronze
  { pattern: /(구리|구리합금|황동|청동|copper|brass|bronze|redcopper|\bcu\b)/i, value: "Copper" },
  // Cast Iron (주철 / FC / FCD)
  { pattern: /(주철|회주철|구상흑연주철|가단주철|칠드주철|cast\s*iron|\bfcd\s*\d*|\bfc\s*\d+)/i, value: "Cast Iron" },
  // Cast Steel
  { pattern: /(주강|cast\s*steel)/i, value: "Cast Steel" },
  // Alloy Steels (SCM / SNCM / SUJ / 합금강 / 공구강)
  { pattern: /(합금강|고합금강|저합금강|금형강|구조용강|공구강|alloy\s*steel|\bscm\s*\d+|\bsncm\s*\d+|\bsuj\s*\d*)/i, value: "Alloy Steels" },
  // Carbon Steels (S45C / SK / SM45C / 탄소강)
  { pattern: /(탄소강|비합금강|일반강|carbon\s*steel|\bs\s*\d{2}c\b|\bsm\s*\d{2}c\b|\bsk\s*\d\b)/i, value: "Carbon Steels" },
  // Graphite
  { pattern: /(흑연|graphite)/i, value: "Graphite" },
  // FRP
  { pattern: /(\bfrp\b|\bcfrp\b|\bgfrp\b|섬유강화플라스틱|복합재)/i, value: "FRP" },
]

export function extractWorkPieceName(text: string): DeterministicAction | null {
  for (const { pattern, value } of WORKPIECE_PATTERNS) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
      return { type: "apply_filter", field: "workPieceName", value, op, source: "deterministic" }
    }
  }
  return null
}

export function extractWorkMaterial(text: string): DeterministicAction | null {
  for (const { pattern, value } of WORK_MATERIAL_CUES) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
      return { type: "apply_filter", field: "workMaterial", value, op, source: "deterministic" }
    }
  }
  return null
}

export function extractGrade(text: string): DeterministicAction | null {
  // 1) 정확 등급 코드 (YG3010 등)
  const hit = findValueWithPos(text, GRADE_VALUES)
  if (hit) {
    const op = negNear(text, hit.idx, hit.value.length) ? "neq" : "eq"
    return { type: "apply_filter", field: "grade", value: hit.value, op, source: "deterministic" }
  }
  // 2) cue만 있고 값 없음 — 추출 안 함 (질문 트리거는 LLM이 처리)
  return null
}

export function extractChipBreaker(text: string): DeterministicAction | null {
  const hit = findValueWithPos(text, CHIP_BREAKER_VALUES)
  if (hit) {
    const op = negNear(text, hit.idx, hit.value.length) ? "neq" : "eq"
    return { type: "apply_filter", field: "chipBreaker", value: hit.value, op, source: "deterministic" }
  }
  return null
}

export function extractInsertShape(text: string): DeterministicAction | null {
  // ISO 인서트 코드 (4-6자, 대문자) — 단어 경계로
  const re = /\b(C[CN]M[AGT]|W[CN]M[AGT]|D[CN]M[AGT]|T[CN]M[AGT]|S[CN]M[AGT]|V[CN]M[AGT]|VBMT|RC[GM]T)\b/i
  const m = text.match(re)
  if (m && m.index != null) {
    const v = m[1].toUpperCase()
    const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
    return { type: "apply_filter", field: "insertShape", value: v, op, source: "deterministic" }
  }
  return null
}

export function extractThreadShape(text: string): DeterministicAction | null {
  // M10 / UNC / NPT 등. M+숫자는 diameter 추출에서 별도 잡으므로 thread shape는 단어 단위.
  const hit = findValueWithPos(text, THREAD_SHAPE_VALUES)
  if (hit) {
    // M 단독은 너무 흔해서 길이 1짜리는 스킵
    if (hit.value.length < 2) return null
    const op = negNear(text, hit.idx, hit.value.length) ? "neq" : "eq"
    return { type: "apply_filter", field: "threadShape", value: hit.value, op, source: "deterministic" }
  }
  return null
}

export function extractThreadDirection(text: string): DeterministicAction | null {
  if (/\b(LH|left[-\s]?hand|왼나사|역나사)\b/i.test(text)) {
    return { type: "apply_filter", field: "threadDirection", value: "LH Thread", op: "eq", source: "deterministic" }
  }
  if (/\b(RH|right[-\s]?hand|오른나사|정나사)\b/i.test(text)) {
    return { type: "apply_filter", field: "threadDirection", value: "RH Thread", op: "eq", source: "deterministic" }
  }
  return null
}

export function extractThreadIntExt(text: string): DeterministicAction | null {
  if (/(내경|내부|internal|암나사)/i.test(text)) {
    return { type: "apply_filter", field: "threadInternalExternal", value: "INTERNAL", op: "eq", source: "deterministic" }
  }
  if (/(외경|외부|external|수나사)/i.test(text)) {
    return { type: "apply_filter", field: "threadInternalExternal", value: "EXTERNAL", op: "eq", source: "deterministic" }
  }
  return null
}

export function extractDrillType(text: string): DeterministicAction | null {
  // DIN xxx / ANSI / JIS 표준 코드
  const hit = findValueWithPos(text, DRILL_TYPE_VALUES)
  if (hit) {
    const op = negNear(text, hit.idx, hit.value.length) ? "neq" : "eq"
    return { type: "apply_filter", field: "drillType", value: hit.value, op, source: "deterministic" }
  }
  return null
}

export function extractHoleShape(text: string): DeterministicAction | null {
  if (/(관통|through|뚫린)/i.test(text) && /(막힌|blind|장님)/i.test(text)) {
    return { type: "apply_filter", field: "holeShape", value: "Blind / Through", op: "eq", source: "deterministic" }
  }
  if (/(관통|through|뚫린)/i.test(text)) {
    return { type: "apply_filter", field: "holeShape", value: "Through", op: "eq", source: "deterministic" }
  }
  if (/(막힌|blind|장님|블라인드)/i.test(text)) {
    return { type: "apply_filter", field: "holeShape", value: "Blind", op: "eq", source: "deterministic" }
  }
  return null
}

export function extractCoolantSystem(text: string): DeterministicAction | null {
  if (/(mql|미스트|oil\s*mist|미세\s*분무)/i.test(text))
    return { type: "apply_filter", field: "coolantSystem", value: "Oil mist", op: "eq", source: "deterministic" }
  if (/(에어\s*블로|air\s*blow|공기\s*분사)/i.test(text))
    return { type: "apply_filter", field: "coolantSystem", value: "Air blow", op: "eq", source: "deterministic" }
  if (/(through\s*coolant|내부\s*냉각|쓰루\s*쿨런트)/i.test(text))
    return { type: "apply_filter", field: "coolantSystem", value: "Through coolant", op: "eq", source: "deterministic" }
  if (/(건식|dry\s*cut|드라이)/i.test(text))
    return { type: "apply_filter", field: "coolantSystem", value: "Dry", op: "eq", source: "deterministic" }
  if (/(습식|wet\s*cut|쿨런트\s*사용)/i.test(text))
    return { type: "apply_filter", field: "coolantSystem", value: "Wet", op: "eq", source: "deterministic" }
  return null
}

export function extractMachiningCondition(text: string): DeterministicAction | null {
  for (const { pattern, value } of MACHINING_CONDITION_CUES) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
      return { type: "apply_filter", field: "machiningCondition", value, op, source: "deterministic" }
    }
  }
  return null
}

export function extractApplicationShape(text: string): DeterministicAction | null {
  // 한글 cue → 영문 atom 매핑
  const cues: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /(코너\s*r|corner\s*radius)/i, value: "Corner_Radius" },
    { pattern: /(다이\s*싱킹|die[\s-]?sinking|금형|몰드)/i, value: "Die-Sinking" },
    { pattern: /(페이싱|facing|면\s*가공)/i, value: "Facing" },
    { pattern: /(헬리컬|helical\s*interpolation)/i, value: "Helical_Interpolation" },
    { pattern: /(사이드\s*밀링|side\s*milling|측면\s*가공)/i, value: "Side_Milling" },
    { pattern: /(슬로팅|slotting|슬롯\s*가공|홈\s*가공)/i, value: "Slotting" },
    { pattern: /(트로코이달|trochoidal)/i, value: "Trochoidal" },
    { pattern: /(테이퍼\s*사이드|taper\s*side)/i, value: "Taper_Side_Milling" },
    { pattern: /(프로파일링|profiling|윤곽\s*가공)/i, value: "Profiling" },
    { pattern: /(램핑|ramping|경사\s*진입)/i, value: "Ramping" },
    { pattern: /(플런징|plunging|수직\s*진입)/i, value: "Plunging" },
    { pattern: /(챔퍼|chamfer)/i, value: "Chamfering" },
    { pattern: /(센터\s*드릴|center\s*drill)/i, value: "Center_Drill" },
  ]
  for (const { pattern, value } of cues) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
      return { type: "apply_filter", field: "applicationShape", value, op, source: "deterministic" }
    }
  }
  return null
}

// ── Phase 2 extractors ──────────────────────────────────────
export function extractToolHolder(text: string): DeterministicAction | null {
  const hit = findValueWithPos(text, TOOL_HOLDER_VALUES as unknown as string[])
  if (hit) {
    const op = negNear(text, hit.idx, hit.value.length) ? "neq" : "eq"
    return { type: "apply_filter", field: "toolHolderType", value: hit.value, op, source: "deterministic" }
  }
  return null
}

export function extractInsertFullCode(text: string): DeterministicAction | null {
  const m = text.match(INSERT_FULL_CODE_RE)
  if (m && m.index != null) {
    // m[1] = 형상 (CNMG), m[2] = inscribed circle*10, m[3] = thickness*10, m[4] = corner R*100
    const fullCode = m[0].toUpperCase()
    const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
    return { type: "apply_filter", field: "insertFullCode", value: fullCode, op, source: "deterministic" }
  }
  return null
}

export function extractThreadSize(text: string): DeterministicAction[] {
  const out: DeterministicAction[] = []
  // Metric: M8x1.25
  const mm = text.match(THREAD_SIZE_METRIC_RE)
  if (mm) {
    const dia = parseFloat(mm[1]); const pitch = parseFloat(mm[2])
    if (Number.isFinite(dia)) out.push({ type: "apply_filter", field: "threadDiameterMm", value: dia, op: "eq", source: "deterministic" })
    if (Number.isFinite(pitch)) out.push({ type: "apply_filter", field: "threadPitchMm", value: pitch, op: "eq", source: "deterministic" })
    return out
  }
  // Inch: 1/4-20 UNC
  const im = text.match(THREAD_SIZE_INCH_RE)
  if (im) {
    out.push({ type: "apply_filter", field: "threadSize", value: `${im[1]}-${im[2]} ${im[3].toUpperCase()}`, op: "eq", source: "deterministic" })
    out.push({ type: "apply_filter", field: "threadShape", value: im[3].toUpperCase(), op: "eq", source: "deterministic" })
    return out
  }
  // Number: #10-32 UNF
  const nm = text.match(THREAD_SIZE_NUMBER_RE)
  if (nm) {
    out.push({ type: "apply_filter", field: "threadSize", value: `#${nm[1]}-${nm[2]} ${nm[3].toUpperCase()}`, op: "eq", source: "deterministic" })
    out.push({ type: "apply_filter", field: "threadShape", value: nm[3].toUpperCase(), op: "eq", source: "deterministic" })
    return out
  }
  return out
}

export function extractPrecisionClass(text: string): DeterministicAction | null {
  const m = text.match(PRECISION_CLASS_RE)
  if (m && m.index != null) {
    const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
    return { type: "apply_filter", field: "tolClass", value: m[1].toLowerCase(), op, source: "deterministic" }
  }
  return null
}

export function extractTapTolerance(text: string): DeterministicAction | null {
  // Only fire if context suggests tap (탭/tap/threading) — avoid false-positive on "4H" elsewhere
  if (!/(탭\b|tap\b|tapping|나사|thread)/i.test(text)) return null
  const m = text.match(TAP_TOLERANCE_RE)
  if (m && m.index != null) {
    return { type: "apply_filter", field: "tapTolerance", value: `${m[1]}${m[2].toUpperCase()}`, op: "eq", source: "deterministic" }
  }
  return null
}

export function extractSurfaceFinish(text: string): DeterministicAction | null {
  for (const { pattern, value } of SURFACE_FINISH_PATTERNS) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      return { type: "apply_filter", field: "surfaceFinish", value, op: "eq", source: "deterministic" }
    }
  }
  return null
}

export function extractExtraMaterial(text: string): DeterministicAction | null {
  for (const { pattern, value } of EXTRA_MATERIAL_CUES) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
      return { type: "apply_filter", field: "workMaterial", value, op, source: "deterministic" }
    }
  }
  return null
}

export function extractExtraOperation(text: string): DeterministicAction | null {
  for (const { pattern, value } of EXTRA_OPERATION_CUES) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      const op = negNear(text, m.index, m[0].length) ? "neq" : "eq"
      return { type: "apply_filter", field: "operationType", value, op, source: "deterministic" }
    }
  }
  return null
}

export function extractChipEvacuation(text: string): DeterministicAction | null {
  for (const { pattern, value } of CHIP_EVACUATION_CUES) {
    const m = text.match(pattern)
    if (m && m.index != null) {
      return { type: "apply_filter", field: "coolantPressure", value, op: "eq", source: "deterministic" }
    }
  }
  return null
}

// ── MV reverse-index extractor (data-driven, no hardcoded value lists) ──
//
// 사용자가 필드명을 같이 말하지 않은 단일 토큰("티타늄으로 바꿔줘")이라도
// MV 컬럼 값 역인덱스로 어느 슬롯인지 자동 결정.
//
// 동작:
//  1) 텍스트를 토큰/2-3그램으로 쪼갠다 (한국어 조사 제거, lowercase)
//  2) 각 토큰을 schema-cache.findColumnsForToken 으로 조회
//  3) 매치된 컬럼들을 DB_COL_TO_FILTER_FIELD 로 registry field에 매핑
//  4) 한 토큰이 단일 field에만 매핑되면 → action emit (모호하면 skip,
//     LLM/clarification 단계가 처리)
//  5) 이미 seen된 field는 건드리지 않음 (정형 추출기 우선)
//
// schema cache 콜드 상태(getDbSchemaSync null)면 silently no-op.

const MV_INDEX_SKIP_TOKENS = new Set([
  "the", "and", "or", "for", "with", "from", "to", "of", "in", "on", "at",
  "이거", "저거", "그거", "이것", "저것", "그것", "바꿔", "바꿔줘", "변경",
  "추천", "해줘", "주세요", "쓸", "쓰는", "사용", "필요", "있어", "없어",
  "이거로", "저거로", "그거로",
])

function tokenizeForMvIndex(text: string): string[] {
  // 1) split on whitespace + common punctuation
  const raw = text.split(/[\s,./;:!?()"'`~+\-=*&^%$#@[\]{}<>|\\]+/u).filter(Boolean)
  const out = new Set<string>()
  // unigrams
  for (const w of raw) {
    const stripped = stripKoreanParticles(w).toLowerCase().trim()
    if (!stripped || stripped.length < 2) continue
    if (MV_INDEX_SKIP_TOKENS.has(stripped)) continue
    if (/^-?\d+(?:\.\d+)?$/.test(stripped)) continue
    out.add(stripped)
  }
  // bigrams + trigrams (DB values like "RH Thread" / "Carbon Steels")
  for (let i = 0; i < raw.length - 1; i++) {
    const a = stripKoreanParticles(raw[i]).toLowerCase().trim()
    const b = stripKoreanParticles(raw[i + 1]).toLowerCase().trim()
    if (a && b) out.add(`${a} ${b}`)
    if (i < raw.length - 2) {
      const c = stripKoreanParticles(raw[i + 2]).toLowerCase().trim()
      if (a && b && c) out.add(`${a} ${b} ${c}`)
    }
  }
  return Array.from(out)
}

/**
 * Heuristic column-name → registry-field fallback. DB_COL_TO_FILTER_FIELD only
 * covers known recommendation MV columns; turning_options_mv and any future MVs
 * carry novel column names. Pattern matching keeps the routing data-driven
 * without requiring an exhaustive enumeration.
 *
 * Order matters: more specific patterns first.
 */
function inferFieldFromColumnName(col: string): string | null {
  const c = col.toLowerCase()
  // Compound shapes / very specific first
  if (/work[_\s]?piece/.test(c)) return "workPieceName"
  if (/chip[_\s]?breaker/.test(c)) return "chipBreaker"
  if (/insert[_\s]?shape|insert[_\s]?type/.test(c)) return "insertShape"
  if (/thread[_\s]?direction/.test(c)) return "threadDirection"
  if (/internal[_\s]?external|int[_\s]?ext/.test(c)) return "threadInternalExternal"
  if (/thread[_\s]?shape|thread[_\s]?form/.test(c)) return "threadShape"
  if (/thread[_\s]?pitch|^pitch$|_pitch$/.test(c)) return "threadPitchMm"
  if (/drill[_\s]?type/.test(c)) return "drillType"
  if (/hole[_\s]?shape/.test(c)) return "holeShape"
  if (/coolant[_\s]?hole/.test(c)) return "coolantHole"
  if (/coolant[_\s]?system|coolant[_\s]?type/.test(c)) return "coolantSystem"
  if (/point[_\s]?angle/.test(c)) return "pointAngleDeg"
  if (/helix[_\s]?angle/.test(c)) return "helixAngleDeg"
  if (/taper[_\s]?angle/.test(c)) return "taperAngleDeg"
  if (/ball[_\s]?radius|corner[_\s]?r/.test(c)) return "ballRadiusMm"
  if (/shank[_\s]?dia/.test(c)) return "shankDiameterMm"
  if (/shank[_\s]?type/.test(c)) return "shankType"
  if (/length[_\s]?of[_\s]?cut|^loc$|_loc$/.test(c)) return "lengthOfCutMm"
  if (/overall[_\s]?length|^oal$|_oal$/.test(c)) return "overallLengthMm"
  if (/tool[_\s]?material/.test(c)) return "toolMaterial"
  if (/tool[_\s]?type|tool[_\s]?category/.test(c)) return "toolType"
  // Generic last
  if (/(?:^|_)grade(?:$|_)/.test(c)) return "grade"
  if (/coating/.test(c)) return "coating"
  if (/brand/.test(c)) return "brand"
  if (/country/.test(c)) return "country"
  if (/series[_\s]?name/.test(c)) return "seriesName"
  if (/flute/.test(c)) return "fluteCount"
  if (/diameter|^dia$|_dia$|^d1?$|_d1?$/.test(c)) return "diameterMm"
  if (/stock|inventory/.test(c)) return "stockStatus"
  if (/application[_\s]?shape|operation[_\s]?type/.test(c)) return "applicationShape"
  return null
}

function resolveFieldForColumn(col: string): string | null {
  return DB_COL_TO_FILTER_FIELD[col] ?? inferFieldFromColumnName(col)
}

export function extractFromMvIndex(
  text: string,
  alreadySeen: Set<string>,
  meta?: DeterministicMeta
): DeterministicAction[] {
  const tokens = tokenizeForMvIndex(text)
  if (tokens.length === 0) return []

  const actions: DeterministicAction[] = []
  const localSeen = new Set<string>()

  for (const token of tokens) {
    const cols = findColumnsForToken(token)
    if (cols.length === 0) continue

    // Map columns → registry fields (explicit map first, heuristic fallback), dedup
    const fields = new Set<string>()
    for (const col of cols) {
      const field = resolveFieldForColumn(col)
      if (field) fields.add(field)
    }
    if (fields.size === 0) continue // unmapped — schema knows the value but we have no field for it
    if (fields.size > 1) {
      // 다중 슬롯 후보 → 추측 금지. clarification으로 위임.
      // 이미 다른 추출기로 잡힌 후보는 제거 (사용자가 그 슬롯을 명시했을 가능성).
      const candidates = [...fields].filter(f => !alreadySeen.has(f) && !localSeen.has(f))
      if (candidates.length >= 2 && meta) {
        // dedup ambiguity by token
        if (!meta.ambiguities.some(a => a.token === token)) {
          meta.ambiguities.push({ token, fields: candidates })
        }
      }
      continue
    }

    const field = fields.values().next().value as string
    if (alreadySeen.has(field) || localSeen.has(field)) continue

    // Find token position to detect negation context
    const idx = text.toLowerCase().indexOf(token)
    const op: "eq" | "neq" =
      idx >= 0 && negNear(text, idx, token.length) ? "neq" : "eq"

    actions.push({
      type: "apply_filter",
      field,
      // Pass the matched token as the raw value — registry canonicalizers
      // (e.g. country, coating) will normalize to the canonical DB form.
      value: token,
      op,
      source: "deterministic",
    })
    localSeen.add(field)
  }

  return actions
}

// ── Main parser ──────────────────────────────────────────────
export function parseDeterministic(message: string, meta?: DeterministicMeta): DeterministicAction[] {
  if (!message || message.trim().length === 0) return []
  const text = message.trim()
  const actions: DeterministicAction[] = []
  const seen = new Set<string>() // dedup by field

  // 1) Field cue 매칭 (label + 숫자 + 비교)
  // 이미 사용한 텍스트 범위를 추적해서 한 숫자가 두 필드에 동시 잡히는 것 방지
  const consumedRanges: Array<[number, number]> = []
  const isConsumed = (a: number, b: number) => consumedRanges.some(([s, e]) => a < e && b > s)

  for (const { pattern, field, numeric } of FIELD_CUES) {
    if (seen.has(field)) continue
    if (!numeric) continue
    const m = text.match(pattern)
    if (!m || m.index == null) continue
    const cueStart = m.index
    const cueEnd = m.index + m[0].length
    // 이미 더 구체적인 cue (예: 샹크 직경)가 이 위치를 잡았으면 skip
    if (isConsumed(cueStart, cueEnd)) continue

    // between pattern 우선 (cue 뒤 50자 내)
    const tail = text.slice(cueEnd, cueEnd + 50)
    const betw = tryBetween(tail)
    if (betw) {
      // mark consumed range (cue + tail with the matched between)
      consumedRanges.push([cueStart, cueEnd + 50])
      actions.push({ type: "apply_filter", field, value: betw.lo, value2: betw.hi, op: "between", source: "deterministic" })
      seen.add(field)
      continue
    }

    // 단일 숫자 + op
    const num = extractNumberNear(text, cueStart, cueEnd)
    if (num) {
      // 이미 다른 (더 구체적인) cue가 그 숫자를 가져갔으면 skip
      if (isConsumed(num.idxStart, num.idxEnd)) continue
      const op = detectOpAfter(text, num.idxEnd) ?? "eq"
      consumedRanges.push([cueStart, num.idxEnd + 6])
      actions.push({ type: "apply_filter", field, value: num.value, op, source: "deterministic" })
      seen.add(field)
    }
  }

  // 2) Inline flute count (label 없는 "4날", "2 flute") — fluteCount 안 잡힌 경우만
  if (!seen.has("fluteCount")) {
    // 교체 패턴 우선: "2날 말고 4날로", "2날 대신 4날", "2 flute → 4 flute" — 마지막(=새) 값 선택
    const replaceRe = /(\d+)\s*(?:날|flutes?|fl\b|f\b)[^가-힣a-z0-9]*?(?:말고|대신|아니고|아니라|바꿔|변경|→|->|to)[^가-힣a-z0-9]*?(\d+)\s*(?:날|flutes?|fl\b|f\b)/i
    const repM = text.match(replaceRe)
    if (repM) {
      const value = parseInt(repM[2], 10)
      if (Number.isFinite(value) && value > 0 && value <= 20) {
        actions.push({ type: "apply_filter", field: "fluteCount", value, op: "eq", source: "deterministic" })
        seen.add("fluteCount")
      }
    }
  }
  if (!seen.has("fluteCount")) {
    const m = text.match(INLINE_FLUTE_RE)
    if (m) {
      const value = parseInt(m[1], 10)
      if (Number.isFinite(value) && value > 0 && value <= 20) {
        // 뒤에 op marker 있는지
        const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 8)
        const op = OP_MARKERS.find(o => o.pattern.test(after))?.op ?? "eq"
        actions.push({ type: "apply_filter", field: "fluteCount", value, op, source: "deterministic" })
        seen.add("fluteCount")
      }
    }
  }

  // 2.5) Relative shape/length cues — value 없는 op-only 필터들
  // M51 "다날", M39 "긴", M40 "짧은", M17 "더블엔드"
  if (!seen.has("fluteCount") && /(다\s*날|다인|multi[- ]?flute)/i.test(text)) {
    actions.push({ type: "apply_filter", field: "fluteCount", value: 5, op: "gte", source: "deterministic" })
    seen.add("fluteCount")
  }
  if (!seen.has("fluteCount") && /(소수\s*날|날\s*적은|적은\s*날|few[- ]?flute)/i.test(text)) {
    actions.push({ type: "apply_filter", field: "fluteCount", value: 3, op: "lte", source: "deterministic" })
    seen.add("fluteCount")
  }
  if (!seen.has("overallLengthMm") && /(긴\s*엔드밀|길이\s*가\s*긴|long\s*(?:endmill|reach|length))/i.test(text)) {
    actions.push({ type: "apply_filter", field: "overallLengthMm", value: 100, op: "gte", source: "deterministic" })
    seen.add("overallLengthMm")
  }
  if (!seen.has("overallLengthMm") && /(짧은\s*엔드밀|길이\s*가\s*짧은|short\s*(?:endmill|reach|length))/i.test(text)) {
    actions.push({ type: "apply_filter", field: "overallLengthMm", value: 80, op: "lte", source: "deterministic" })
    seen.add("overallLengthMm")
  }
  if (!seen.has("toolSubtype") && /(더블\s*엔드|양\s*날\s*엔드밀|양\s*끝\s*날|double[- ]?end(?:ed)?)/i.test(text)) {
    actions.push({ type: "apply_filter", field: "toolSubtype", value: "Double", op: "eq", source: "deterministic" })
    seen.add("toolSubtype")
  }
  if (!seen.has("toolSubtype") && /(싱글\s*엔드|single[- ]?end(?:ed)?)/i.test(text)) {
    actions.push({ type: "apply_filter", field: "toolSubtype", value: "Single", op: "eq", source: "deterministic" })
    seen.add("toolSubtype")
  }

  // 3) Inch fraction → diameter (1/4인치)
  if (!seen.has("diameterMm")) {
    const inch = parseInchFraction(text)
    if (inch != null) {
      actions.push({ type: "apply_filter", field: "diameterMm", value: inch, op: "eq", source: "deterministic" })
      seen.add("diameterMm")
    }
  }

  // 3.5) Bare-mm-only fallback: "10mm", "8.5 mm", "10" — 메시지가 숫자(+mm)뿐이면 직경으로 해석
  if (!seen.has("diameterMm")) {
    const bare = text.match(/^\s*(\d+(?:\.\d+)?)\s*(?:mm|밀리)?\s*$/i)
    if (bare) {
      const v = parseFloat(bare[1])
      if (Number.isFinite(v) && v > 0 && v <= 100) {
        actions.push({ type: "apply_filter", field: "diameterMm", value: v, op: "eq", source: "deterministic" })
        seen.add("diameterMm")
      }
    }
  }

  // 4) Thread pattern: M10 P1.5
  const thread = parseThreadPattern(text)
  if (thread.dia != null && !seen.has("diameterMm")) {
    actions.push({ type: "apply_filter", field: "diameterMm", value: thread.dia, op: "eq", source: "deterministic" })
    seen.add("diameterMm")
  }
  if (thread.pitch != null && !seen.has("threadPitchMm")) {
    actions.push({ type: "apply_filter", field: "threadPitchMm", value: thread.pitch, op: "eq", source: "deterministic" })
    seen.add("threadPitchMm")
  }

  // 5) Coating
  if (!seen.has("coating")) {
    // "Y 코팅", "T코팅", "x coating" 등 한글/공백 변형을 canonical 하이픈 형태로 pre-match.
    // 이전: findValueIn(text, ["Y-Coating",...]) 이 "Y 코팅" 을 놓쳐서 SCR LLM 으로 빠졌다가
    // "Y" 를 yes/whatever 로 오해석해 coating=상관없음 할루시네이션 발생 (J06 버그).
    let v: string | null = null
    const letterCoatingMatch = text.match(/\b([YTXZH])[\s-]*(?:코팅|coating)/i)
    if (letterCoatingMatch) {
      v = `${letterCoatingMatch[1].toUpperCase()}-Coating`
    } else {
      v = findValueIn(text, COATING_VALUES)
    }
    if (v) {
      const idx = text.toLowerCase().indexOf(v.slice(0, 1).toLowerCase())
      const neighborhood = idx >= 0 ? text.slice(idx, idx + v.length + 12) : text
      const isNeg = NEG_MARKERS.test(neighborhood)
      actions.push({ type: "apply_filter", field: "coating", value: v, op: isNeg ? "neq" : "eq", source: "deterministic" })
      seen.add("coating")
    } else if (/(코팅\s*없는|무\s*코팅|uncoated|bright\s*finish)/i.test(text)) {
      actions.push({ type: "apply_filter", field: "coating", value: "Bright Finish", op: "eq", source: "deterministic" })
      seen.add("coating")
    }
  }

  // 6) Brand — phonetic fuzzy match.
  // 이전엔 영문 substring 매칭만이라 한글 표기(엑스파워/타이타녹스 등)를 못 잡아서
  // 비활성화했지만, 음역 fuzzy 매칭(consonant-skeleton phonetic key)은 alias map이
  // 아닌 phoneme 비교라 no-hardcoding 원칙과 충돌 X. BRAND_VALUES가 source of truth.
  if (!seen.has("brand")) {
    const fuzzy = findFuzzyMatch(text, BRAND_VALUES)
    if (fuzzy) {
      const idx = text.toLowerCase().indexOf(fuzzy.value.toLowerCase())
      const ctx = idx >= 0
        ? text.slice(Math.max(0, idx - 5), idx + fuzzy.value.length + 12)
        : text.slice(0, 40)
      const isNeg = NEG_MARKERS.test(ctx)
      actions.push({
        type: "apply_filter",
        field: "brand",
        value: fuzzy.value,
        op: isNeg ? "neq" : "eq",
        source: "deterministic",
      })
      seen.add("brand")
    }
  }

  // 7) 재고
  // "재고 30개 이상", "재고 50 이상", "stock >= 100" 같이 숫자 임계값이 있으면
  // value=숫자, op=gte 로 보내고, filter-field-registry SQL 빌더가
  // total_stock >= N 절을 만든다. 숫자가 없으면 단순 in-stock 필터.
  if (!seen.has("stockStatus")) {
    const numMatch = text.match(/(?:재고|stock)\s*(\d+)\s*(?:개)?\s*(?:이상|over|이상\s*만|만)?/i)
    if (numMatch) {
      const n = parseInt(numMatch[1], 10)
      if (Number.isFinite(n) && n > 0) {
        actions.push({
          type: "apply_filter",
          field: "stockStatus",
          value: String(n),
          op: "gte",
          source: "deterministic",
        })
        seen.add("stockStatus")
      }
    }
    if (!seen.has("stockStatus") && STOCK_PATTERNS.some(p => p.test(text))) {
      actions.push({ type: "apply_filter", field: "stockStatus", value: "instock", op: "eq", source: "deterministic" })
      seen.add("stockStatus")
    }
  }

  // 7.5) RPM (절삭조건 — 가상 필드, 실제 narrowing은 tool-forge가 처리)
  // "RPM 3000 이상", "회전수 5000 이상", "spindle 4000+" 같이 임계값과 함께 들어오면
  // 가상 rpm 필터를 만들어 좌측 패널에 칩으로 노출. 실제 cutting_condition_table
  // 조회는 tool-forge LLM이 별도로 한다. buildDbClause는 no-op이라 double-filter X.
  if (!seen.has("rpm")) {
    const rpmGte = text.match(/(?:rpm|회전수|스핀들(?:\s*속도)?|spindle(?:\s*speed)?)\s*([\d,]+)\s*(?:이상|over|\+|초과|올라가는|넘는)/i)
    const rpmLte = text.match(/(?:rpm|회전수|스핀들(?:\s*속도)?|spindle(?:\s*speed)?)\s*([\d,]+)\s*(?:이하|under|미만)/i)
    const m = rpmGte ?? rpmLte
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ""), 10)
      if (Number.isFinite(n) && n > 0) {
        actions.push({
          type: "apply_filter",
          field: "rpm",
          value: n,
          op: rpmGte ? "gte" : "lte",
          source: "deterministic",
        })
        seen.add("rpm")
      }
    }
  }

  // 7.6) 이송속도 / 절삭속도 / 절입량 — rpm 과 동일하게 가상 필드.
  // 실제 narrowing 은 tool-forge 가 cutting_condition_table 을 조회해 처리하고,
  // 여기서는 임계값을 뽑아 칩으로 노출하기 위한 가시성 extraction 만 수행한다.
  const cuttingConditionPatterns: Array<{ field: "feedRate" | "cuttingSpeed" | "depthOfCut"; gte: RegExp; lte: RegExp }> = [
    {
      field: "feedRate",
      gte: /(?:feed\s*rate|feed|이송(?:\s*속도)?|\bfz)\s*([\d.,]+)\s*(?:mm\s*\/\s*rev|mm\/rev)?\s*(?:이상|over|\+|초과)/i,
      lte: /(?:feed\s*rate|feed|이송(?:\s*속도)?|\bfz)\s*([\d.,]+)\s*(?:mm\s*\/\s*rev|mm\/rev)?\s*(?:이하|under|미만)/i,
    },
    {
      field: "cuttingSpeed",
      gte: /(?:cutting\s*speed|절삭\s*속도|\bvc)\s*([\d.,]+)\s*(?:m\s*\/\s*min|m\/min)?\s*(?:이상|over|\+|초과)/i,
      lte: /(?:cutting\s*speed|절삭\s*속도|\bvc)\s*([\d.,]+)\s*(?:m\s*\/\s*min|m\/min)?\s*(?:이하|under|미만)/i,
    },
    {
      field: "depthOfCut",
      gte: /(?:depth\s*of\s*cut|절입(?:량|\s*깊이)?|\bap)\s*([\d.,]+)\s*(?:mm)?\s*(?:이상|over|\+|초과)/i,
      lte: /(?:depth\s*of\s*cut|절입(?:량|\s*깊이)?|\bap)\s*([\d.,]+)\s*(?:mm)?\s*(?:이하|under|미만)/i,
    },
  ]
  for (const { field, gte, lte } of cuttingConditionPatterns) {
    if (seen.has(field)) continue
    const gteMatch = text.match(gte)
    const lteMatch = text.match(lte)
    const m = gteMatch ?? lteMatch
    if (!m) continue
    const n = parseFloat(m[1].replace(/,/g, ""))
    if (!Number.isFinite(n) || n <= 0) continue
    actions.push({
      type: "apply_filter",
      field,
      value: n,
      op: gteMatch ? "gte" : "lte",
      source: "deterministic",
    })
    seen.add(field)
  }

  // 8) 쿨런트홀
  if (!seen.has("coolantHole")) {
    if (COOLANT_PATTERNS.some(p => p.test(text))) {
      const isNeg = /(쿨런트\s*없|coolant.*없|쿨런트\s*홀\s*없)/i.test(text)
      actions.push({ type: "apply_filter", field: "coolantHole", value: isNeg ? "false" : "true", op: "eq", source: "deterministic" })
      seen.add("coolantHole")
    }
  }

  // 9) 국가
  if (!seen.has("country")) {
    for (const { pattern, value } of COUNTRY_PATTERNS) {
      if (pattern.test(text)) {
        actions.push({ type: "apply_filter", field: "country", value, op: "eq", source: "deterministic" })
        seen.add("country")
        break
      }
    }
  }

  // 10) 공구 소재 (toolMaterial) — 한국어 별칭("카바이드","초경","하이스")을 canonical 영문 DB값으로 매핑.
  // 별도 extractor가 없으면 LLM SCR 게이트가 false일 때 골든 C10 같은 케이스를 놓친다.
  if (!seen.has("toolMaterial")) {
    for (const { pattern, value } of TOOL_MATERIAL_PATTERNS) {
      const m = text.match(pattern)
      if (m && m.index != null) {
        const isNeg = negNear(text, m.index, m[0].length)
        actions.push({ type: "apply_filter", field: "toolMaterial", value, op: isNeg ? "neq" : "eq", source: "deterministic" })
        seen.add("toolMaterial")
        break
      }
    }
  }

  // ── Extended fields (workMaterial / grade / chipBreaker / insertShape / thread / drill / coolant / machining / applicationShape) ──
  // Each helper returns 0 or 1 action; dedup by field via `seen`.
  // TODO: MV 확장 후 turning/tooling/threading/holemaking 필드는 실 쿼리로 연결.
  const extraExtractors: Array<{ field: string; fn: (t: string) => DeterministicAction | null }> = [
    { field: "workPieceName", fn: extractWorkPieceName },
    { field: "workMaterial", fn: extractWorkMaterial },
    { field: "grade", fn: extractGrade },
    { field: "chipBreaker", fn: extractChipBreaker },
    { field: "insertShape", fn: extractInsertShape },
    { field: "threadShape", fn: extractThreadShape },
    { field: "threadDirection", fn: extractThreadDirection },
    { field: "threadInternalExternal", fn: extractThreadIntExt },
    { field: "drillType", fn: extractDrillType },
    { field: "holeShape", fn: extractHoleShape },
    { field: "coolantSystem", fn: extractCoolantSystem },
    { field: "machiningCondition", fn: extractMachiningCondition },
    { field: "applicationShape", fn: extractApplicationShape },
  ]
  for (const { field, fn } of extraExtractors) {
    if (seen.has(field)) continue
    const a = fn(text)
    if (a) {
      actions.push(a)
      seen.add(field)
    }
  }

  // ── Phase 2 추가 추출기 (extra material/operation/holder/insert/thread/precision/finish) ──
  // workMaterial은 이미 ISO 매핑 됐으면 EXTRA로 또 잡지 않음 (extra는 더 구체적인 강종 매핑)
  if (!seen.has("workMaterial")) {
    const a = extractExtraMaterial(text)
    if (a) { actions.push(a); seen.add("workMaterial") }
  }
  if (!seen.has("operationType")) {
    const a = extractExtraOperation(text)
    if (a) { actions.push(a); seen.add("operationType") }
  }
  if (!seen.has("toolHolderType")) {
    const a = extractToolHolder(text)
    if (a) { actions.push(a); seen.add("toolHolderType") }
  }
  if (!seen.has("insertFullCode")) {
    const a = extractInsertFullCode(text)
    if (a) { actions.push(a); seen.add("insertFullCode") }
  }
  // Thread size emits up to 2 actions (diameter + pitch). Don't dedup on a single field.
  for (const a of extractThreadSize(text)) {
    if (seen.has(a.field)) continue
    actions.push(a); seen.add(a.field)
  }
  if (!seen.has("tolClass")) {
    const a = extractPrecisionClass(text)
    if (a) { actions.push(a); seen.add("tolClass") }
  }
  if (!seen.has("tapTolerance")) {
    const a = extractTapTolerance(text)
    if (a) { actions.push(a); seen.add("tapTolerance") }
  }
  if (!seen.has("surfaceFinish")) {
    const a = extractSurfaceFinish(text)
    if (a) { actions.push(a); seen.add("surfaceFinish") }
  }
  if (!seen.has("coolantPressure")) {
    const a = extractChipEvacuation(text)
    if (a) { actions.push(a); seen.add("coolantPressure") }
  }

  // ── MV reverse-index fallback ────────────────────────────────
  // 위 정형 추출기로 잡히지 않은 토큰을 MV 컬럼 값 역인덱스로 자동 라우팅.
  // 사용자가 필드명 안 말해도 단일 슬롯에만 매치되면 해당 필드로 emit.
  // schema cache 콜드면 no-op.
  for (const a of extractFromMvIndex(text, seen, meta)) {
    if (seen.has(a.field)) continue
    actions.push(a)
    seen.add(a.field)
  }

  // ── Phonetic backstop (모든 DB 컬럼 일반화) ──────────────────
  // 위 모든 추출기 + MV exact 인덱스가 다 미스했지만 사용자 토큰이 DB 값의
  // 한국어 음역/약칭/오타일 수 있는 경우를 잡는다. schema cache의
  // phoneticIndex가 sampleValues + brands + countries + workpieces 전체에서
  // consonant-skeleton key를 사전 빌드해 두어, 신규 컬럼이 MV에 추가돼도
  // 코드 변경 0번으로 매칭됨. 캐시 콜드면 no-op.
  for (const a of extractFromPhoneticIndex(text, seen)) {
    if (seen.has(a.field)) continue
    actions.push(a)
    seen.add(a.field)
  }

  // ── Phantom categorical guard ────────────────────────────────
  // brand/country/seriesName are proper-noun filters: fuzzy/phonetic/MV
  // backstops can false-positive on unrelated Korean text (e.g. "엔드밀 추천"
  // consonant-skeleton ≈ "SUPER ALLOY"). Drop any categorical filter whose
  // canonical value does not actually appear (normalized substring) in the
  // user message. Principled guard — no hardcoded value lists.
  return filterPhantomCategoricalActions(actions, text)
}

const PHANTOM_GUARDED_FIELDS = new Set(["brand", "country", "seriesName"])

// Word-boundary aware match: value is a "real" mention only when it isn't glued
// to other alphanumerics on either side. Drops cases like brand="GMG" being
// pulled out of product code "GMG55100" (prefix-of-token), while still allowing
// transliteration with collapsed whitespace ("ONLY ONE" ↔ "onlyone").
function hasBoundedPhantomMatch(value: string, message: string): boolean {
  const v = String(value).toLowerCase().trim()
  const m = String(message).toLowerCase()
  if (!v || !m) return false
  const parts = v.split(/[\s\-_]+/).filter(Boolean)
  if (parts.length === 0) return false
  const escaped = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\-_]*")
  const re = new RegExp(`(^|[^a-z0-9가-힣])${escaped}(?![a-z0-9가-힣])`, "i")
  return re.test(m)
}

function filterPhantomCategoricalActions(
  actions: DeterministicAction[],
  userMessage: string,
): DeterministicAction[] {
  return actions.filter(a => {
    if (!PHANTOM_GUARDED_FIELDS.has(a.field)) return true
    const valueStr = String(a.value ?? "")
    if (!valueStr) return true
    if (hasBoundedPhantomMatch(valueStr, userMessage)) return true
    console.warn(
      `[deterministic-scr] phantom ${a.field} filter dropped: "${valueStr}" not a bounded mention in "${userMessage.slice(0, 80)}"`,
    )
    return false
  })
}

/**
 * Phonetic index backstop. Mirror of extractFromMvIndex but uses
 * consonant-skeleton phonetic matching against the schema cache's
 * phoneticIndex. Catches Korean transliterations of any DB value across
 * any column without per-field hardcoded alias maps.
 */
export function extractFromPhoneticIndex(
  text: string,
  alreadySeen: Set<string>,
): DeterministicAction[] {
  const match = findValueByPhonetic(text)
  if (!match) return []
  const field = resolveFieldForColumn(match.column)
  if (!field) return []
  if (alreadySeen.has(field)) return []

  const tok = match.matchedToken
  const idx = text.toLowerCase().indexOf(tok.toLowerCase())
  const op: "eq" | "neq" =
    idx >= 0 && negNear(text, idx, tok.length) ? "neq" : "eq"

  return [{
    type: "apply_filter",
    field,
    value: match.value, // canonical DB value, not the user token
    op,
    source: "deterministic",
  }]
}
