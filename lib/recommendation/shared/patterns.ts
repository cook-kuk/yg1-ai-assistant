/**
 * Canonical Pattern Registry — 중복 keyword/regex 단일 소스
 *
 * 이 모듈은 여러 consumer(intent-classifier, input-normalizer, filter-field-registry,
 * inquiry-analyzer, session-action-classifier)에서 중복되던 keyword/regex를 통합한다.
 * 순수 상수 + 순수 함수만 export. 외부 import 없음 (leaf module).
 */

// ═══════════════════════════════════════════════════════════════
// 1. Material keywords
// ═══════════════════════════════════════════════════════════════

export const MATERIAL_KEYWORDS: Record<string, string[]> = {
  "알루미늄": ["알루미늄", "알루", "aluminum", "aluminium", "AL", "alu"],
  "스테인리스": ["스테인리스", "스테인레스", "스텐", "STS", "sus", "stainless"],
  "주철": ["주철", "cast iron", "GC", "FC"],
  "탄소강": ["탄소강", "일반강", "합금강", "구조강", "carbon", "S45C", "scm", "sncm"],
  "티타늄": ["티타늄", "티타", "titanium", "Ti"],
  "인코넬": ["인코넬", "inconel", "내열합금"],
  "고경도강": ["고경도", "경화강", "hardened", "HRC", "담금질", "die steel", "skd", "공구강"],
  "구리": ["구리", "동", "황동", "copper", "brass"],
  "그라파이트": ["그라파이트", "graphite"],
  "CFRP": ["CFRP", "탄소섬유"],
  "비철금속": ["비철"],
}

/** 모든 소재 alias를 flat Set으로 — O(1) .has() 용 */
export const MATERIAL_KEYWORD_FLAT: Set<string> = new Set(
  Object.values(MATERIAL_KEYWORDS).flat().map(k => k.toLowerCase())
)

export function matchMaterial(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [mat, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k.toLowerCase()))) return mat
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 2. Skip / don't-care tokens
// ═══════════════════════════════════════════════════════════════

export const SKIP_TOKENS = new Set([
  "상관없음", "상관 없음", "모름", "skip",
  "패스", "스킵", "아무거나", "아무거나요",
  "넘어가", "넘어가줘", "넘어갈게",
  "넘어", "넘겨",
  "모르겠어", "모르겠어요",
  "다 괜찮아", "다괜찮아", "뭐든 상관없어", "뭐든상관없어",
  "다음", "다음으로",
])

/** includes 기반 체크 — "상관없음" 이 "상관없음요" 안에서도 매칭 */
export function isSkipToken(text: string): boolean {
  const clean = text.trim().toLowerCase()
  if (SKIP_TOKENS.has(clean)) return true
  for (const token of SKIP_TOKENS) {
    if (clean.includes(token)) return true
  }
  return false
}

// ═══════════════════════════════════════════════════════════════
// 3. Tool subtype 한→영 mapping
// ═══════════════════════════════════════════════════════════════

export const TOOL_SUBTYPE_ALIASES: Record<string, string> = {
  square: "Square",
  스퀘어: "Square",
  평엔드밀: "Square",
  평날: "Square",
  flat: "Square",
  ball: "Ball",
  볼: "Ball",
  볼엔드밀: "Ball",
  볼노즈: "Ball",
  radius: "Radius",
  라디우스: "Radius",
  래디우스: "Radius",
  레디우스: "Radius",
  코너레디우스: "Radius",
  "코너r": "Radius",
  cornerr: "Radius",
  cornerradius: "Corner Radius",
  "r엔드밀": "Radius",
  roughing: "Roughing",
  rough: "Roughing",
  황삭: "Roughing",
  러핑: "Roughing",
  러프: "Roughing",
  taper: "Taper",
  테이퍼: "Taper",
  chamfer: "Chamfer",
  챔퍼: "Chamfer",
  highfeed: "High-Feed",
  하이피드: "High-Feed",
}

export function canonicalizeToolSubtype(raw: string): string | null {
  const normalized = stripKoreanParticles(raw.trim())
    .toLowerCase()
    .replace(/[()\s_-]+/g, "")
  if (!normalized) return null

  for (const [alias, canonical] of Object.entries(TOOL_SUBTYPE_ALIASES)) {
    if (normalized.includes(alias)) return canonical
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 4. Diameter & flute count extraction
// ═══════════════════════════════════════════════════════════════

export const DIAMETER_PATTERNS: RegExp[] = [
  /(\d+(?:\.\d+)?)\s*mm/i,
  /(\d+(?:\.\d+)?)\s*파이/,
  /(\d+(?:\.\d+)?)\s*φ/,
  /(\d+(?:\.\d+)?)\s*직경/,
  /직경\s*(\d+(?:\.\d+)?)/,
  /파이\s*(\d+(?:\.\d+)?)/,
  /φ\s*(\d+(?:\.\d+)?)/,
  /D(\d+(?:\.\d+)?)/i,
  /([0-9]+(?:\.[0-9]+)?)\s*[Pp]/,
  /([\d.]+)\s*밀리/,
]

export const FLUTE_PATTERNS: RegExp[] = [
  /(\d+)\s*날/,
  /날수?\s*(\d+)/,
  /(\d+)\s*flute/i,
  /(\d+)F\b/i,
  /(\d+)\s*fl\b/i,
  /(\d+)\s*플루트/,
]

export function extractDiameter(text: string): number | null {
  for (const pattern of DIAMETER_PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      const val = parseFloat(m[1])
      if (!isNaN(val) && val > 0 && val < 200) return val
    }
  }
  return null
}

export function extractFluteCount(text: string): number | null {
  for (const pattern of FLUTE_PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      const val = parseInt(m[1], 10)
      if (!isNaN(val) && val >= 2 && val <= 12) return val
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 5. Reset / compare / replace intent patterns
// ═══════════════════════════════════════════════════════════════

export const RESET_KEYWORDS: string[] = [
  "처음부터 다시", "다시 시작", "리셋", "처음부터",
  "처음부터 다시 시작", "처음부터 다시 해줘", "리셋해줘",
  "새로 시작", "초기화", "reset",
]

export const COMPARE_PATTERNS: RegExp[] = [
  /비교/, /차이/, /(\d+)번.*(\d+)번/, /상위.*비교/, /위.*비교/, /이\s*중/,
  /(\d+)\s*번.*이랑/, /(\d+)~(\d+)\s*번/, /(\d+)\s*번.*하고.*(\d+)\s*번/,
  /둘.*비교/, /셋.*비교/, /전부.*비교/, /다.*비교/,
  /(\d+)\s*개.*비교/, /상위\s*(\d+)\s*개/,
]

export const REPLACE_SIGNAL_PATTERNS: RegExp[] = [
  /바꿔/, /변경/, /대신/, /아니고/, /아니라/, /말고/,
  /ㄴㄴ/, /수정/, /교체/, /다시/, /다른\s*걸로/,
]

export const RECOMMEND_PATTERNS: string[] = [
  "추천해주세요", "바로 보여주세요", "결과 보기", "추천 받기",
  "추가 조건 없음", "그냥 줘", "빨리", "알아서", "그냥",
  "보여줘", "결과", "추천해줘", "추천 해줘", "결과보기",
]

export const NONSENSE_PATTERNS: RegExp[] = [/^[ㅋㅎㅠㅜ]+$/, /^[?!.]+$/, /^\s*$/]

// ═══════════════════════════════════════════════════════════════
// 6. Coating keywords & Korean→English mapping
// ═══════════════════════════════════════════════════════════════

export const COATING_KO_ALIASES: Record<string, string> = {
  블루: "Blue",
  블루코팅: "Blue",
  "blue-coating": "Blue-Coating",
  골드: "Gold",
  골드코팅: "TiN",
  블랙: "Black",
  블랙코팅: "TiAlN",
  실버: "Bright",
  실버코팅: "Bright",
  무코팅: "Uncoated",
  비코팅: "Uncoated",
  코팅없: "Uncoated",
  코팅없음: "Uncoated",
  다이아몬드: "Diamond",
  다이아몬드코팅: "Diamond",
  // Korean phonetic spellings of English coating names
  타이알엔: "TiAlN",
  알씨알엔: "AlCrN",
  디엘씨: "DLC",
  티씨엔: "TiCN",
  티아이엔: "TiN",
  브라이트피니시: "Bright",
  브라이트: "Bright",
}

/** Flat list: English canonical names + Korean aliases — for quick .includes() 검사 */
export const COATING_KEYWORDS: string[] = [
  "TiAlN", "AlCrN", "DLC", "nACo", "TiN", "AlTiN", "CrN",
  "TiCN", "uncoated", "bright finish", "diamond",
  "x-coating", "y-coating", "t-coating", "blue-coating",
  ...Object.keys(COATING_KO_ALIASES),
]

export const COATING_KEYWORD_SET: Set<string> = new Set(
  COATING_KEYWORDS.map(k => k.toLowerCase())
)

export function canonicalizeCoating(raw: string): string | null {
  const stripped = stripKoreanParticles(String(raw).trim())
  const normalized = stripped.toLowerCase().replace(/[\s\-_]+/g, "")
  if (!normalized) return null

  for (const [alias, canonical] of Object.entries(COATING_KO_ALIASES)) {
    if (normalized === alias || normalized === alias.replace(/[\s\-_]+/g, "")) {
      return canonical
    }
  }

  // "Ti-Al-N" → "TiAlN"
  if (/[A-Za-z]+-[A-Za-z]/.test(stripped)) {
    return stripped.replace(/-/g, "")
  }

  return stripped || null
}

// ═══════════════════════════════════════════════════════════════
// 7. Operation type keywords
// ═══════════════════════════════════════════════════════════════

export const OPERATION_KEYWORDS: Record<string, string[]> = {
  "황삭": ["황삭", "roughing", "rough", "헤비컷"],
  "정삭": ["정삭", "finishing", "finish", "마무리", "fine"],
  "중삭": ["중삭", "semi", "반정삭"],
  "고이송": ["고이송", "high feed", "highfeed", "hfm", "빠른이송"],
  "슬롯": ["슬롯", "slot", "홈가공", "홈"],
  "측면": ["측면", "side milling", "윤곽", "contour"],
}

export const OPERATION_KEYWORD_FLAT: Set<string> = new Set(
  Object.values(OPERATION_KEYWORDS).flat().map(k => k.toLowerCase())
)

export function matchOperation(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [op, keywords] of Object.entries(OPERATION_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k.toLowerCase()))) return op
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// Shared utility: Korean particle stripping
// ═══════════════════════════════════════════════════════════════

export function stripKoreanParticles(value: string): string {
  return value.replace(/(?:이요|으로|이랑|에서|한테|부터|까지|로|은|는|이|가|을|를|요)\s*$/u, "")
}
