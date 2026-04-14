/**
 * Canonical Pattern Registry — 중복 keyword/regex 단일 소스
 *
 * 이 모듈은 여러 consumer(intent-classifier, input-normalizer, filter-field-registry,
 * inquiry-analyzer, session-action-classifier)에서 중복되던 keyword/regex를 통합한다.
 * 순수 상수 + 순수 함수만 export. 외부 import 없음 (leaf module).
 */

import {
  TOOL_SUBTYPE_ALIAS_MAP as CANONICAL_TOOL_SUBTYPE_ALIAS_MAP,
  COATING_ALIAS_MAP as CANONICAL_COATING_ALIAS_MAP,
  COATING_DB_ALIAS_MAP as CANONICAL_COATING_DB_ALIAS_MAP,
  canonicalizeToolSubtypeValue,
  canonicalizeCoatingValue,
  buildCanonicalDomainKnowledgeSnippet,
} from "@/lib/recommendation/shared/canonical-values"

// ═══════════════════════════════════════════════════════════════
// 1. Material keywords
// ═══════════════════════════════════════════════════════════════

// TODO(SSOT): derive from DB material/operation tables instead of hardcoding.
// prod_work_piece_by_category holds 34 canonical workpiece values (ISO P/M/K/N/S/H/O).
// Korean aliases could live in a material_aliases table keyed to those canonicals.
// See CLAUDE.md.
export const MATERIAL_KEYWORDS: Record<string, string[]> = {
  "알루미늄": ["알루미늄", "알루", "aluminum", "aluminium", "AL", "alu", "ADC", "두랄루민", "duralumin"],
  "스테인리스": ["스테인리스", "스테인레스", "스텐", "STS", "sus", "stainless"],
  "주철": ["주철", "cast iron", "GC", "FC"],
  "탄소강": ["탄소강", "일반강", "합금강", "구조강", "프리하든", "carbon", "carbon steel", "S45C", "SM45C", "SCM440", "scm", "sncm"],
  "티타늄": ["티타늄", "티타", "titanium", "Ti"],
  "인코넬": ["인코넬", "inconel", "내열합금", "초내열", "super alloy", "superalloy", "하스텔로이", "hastelloy"],
  "고경도강": ["고경도", "경화강", "hardened", "HRC", "담금질", "die steel", "skd", "공구강"],
  "구리": ["구리", "동", "황동", "copper", "brass"],
  "그라파이트": ["그라파이트", "graphite"],
  "CFRP": ["CFRP", "탄소섬유"],
  "비철금속": ["비철"],
}

/**
 * 모든 소재 alias를 flat Set으로. Substring `.includes()` 체크 용도로만 사용하므로
 * 2자 이하 토큰("AL", "Ti", "Cu", "GC", "FC")은 false-positive 방지 위해 제외.
 * 짧은 토큰은 matchMaterial() 의 word-boundary regex 경로로 처리됨.
 */
export const MATERIAL_KEYWORD_FLAT: Set<string> = new Set(
  Object.values(MATERIAL_KEYWORDS)
    .flat()
    .map(k => k.toLowerCase())
    .filter(k => k.length > 2)
)

export function matchMaterial(text: string): string | null {
  const lower = text.toLowerCase()
  for (const [mat, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
    if (keywords.some(k => {
      const kl = k.toLowerCase()
      if (kl.length <= 2) {
        // Short keywords (AL, Ti, Cu, FC, GC) need word boundary check
        const re = new RegExp(`(?:^|[^a-z])${kl}(?:$|[^a-z])`, "i")
        return re.test(text)
      }
      return lower.includes(kl)
    })) return mat
  }
  return null
}

/**
 * Canonical material name → ISO turning group (P/M/K/N/S/H).
 * Single source so any consumer that needs an ISO group can derive it from
 * MATERIAL_KEYWORDS alone. Keep keys in sync with MATERIAL_KEYWORDS entries.
 */
export const MATERIAL_ISO_GROUP: Record<string, "P" | "M" | "K" | "N" | "S" | "H"> = {
  "탄소강": "P",
  "스테인리스": "M",
  "주철": "K",
  "알루미늄": "N",
  "구리": "N",
  "비철금속": "N",
  "그라파이트": "N",
  "CFRP": "N",
  "티타늄": "S",
  "인코넬": "S",
  "고경도강": "H",
}

/**
 * Extract all ISO turning groups implied by a free-form material text.
 * Iterates every MATERIAL_KEYWORDS entry so multi-material phrases like
 * "구리, 알루미늄 가공" produce the full set.
 */
export function inferIsoGroupsFromText(text: string): Set<string> {
  const lower = text.toLowerCase()
  const groups = new Set<string>()
  for (const [mat, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
    const hit = keywords.some(k => {
      const kl = k.toLowerCase()
      if (kl.length <= 2) {
        return new RegExp(`(?:^|[^a-z])${kl}(?:$|[^a-z])`, "i").test(text)
      }
      return lower.includes(kl)
    })
    if (!hit) continue
    const iso = MATERIAL_ISO_GROUP[mat]
    if (iso) groups.add(iso)
  }
  return groups
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
  고이송: "High-Feed",
  플랫: "Square",
  플랫엔드밀: "Square",
  사각: "Square",
  각형: "Square",
  엔드밀볼: "Ball",
  구형: "Ball",
  볼형: "Ball",
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
  /\bD(\d+(?:\.\d+)?)\b/i,
  /([0-9]+(?:\.[0-9]+)?)\s*[Pp]/,
  /([\d.]+)\s*밀리/,
  /([\d.]+)\s*미리/,
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
  "처음부터 다시", "다시 처음부터", "다시 시작", "리셋", "처음부터",
  "처음부터 다시 시작", "처음부터 다시 해줘", "리셋해줘",
  "새로 시작", "초기화", "reset", "다시 처음부터 시작",
]

export const REPLACE_SIGNAL_PATTERNS: RegExp[] = [
  /바꿔/, /변경/, /대신/, /아니고/, /아니라/, /말고/,
  /ㄴㄴ/, /수정/, /교체/, /다시/, /다른\s*걸로/,
]

export const NONSENSE_PATTERNS: RegExp[] = [/^[ㅋㅎㅠㅜ]+$/, /^[?!.]+$/, /^\s*$/]

// ═══════════════════════════════════════════════════════════════
// 6. Coating keywords & Korean→English mapping
// ═══════════════════════════════════════════════════════════════

// TODO(SSOT): merge into `COATING_ALIAS_MAP` in canonical-values.ts.
// Current divergence: this map uses legacy values ("Blue"/"Gold"/"Bright") while
// canonical-values uses DB values ("Blue-Coating"/"TiN"/"Bright Finish").
// Merging requires updating tests in autoagent-round-1.test.ts and filter-pipeline-e2e-150.test.ts
// to expect the canonical DB values. See CLAUDE.md.
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
  무코닝: "Uncoated",
  비코팅: "Uncoated",
  비코닝: "Uncoated",
  코팅없: "Uncoated",
  코팅없음: "Uncoated",
  노코팅: "Uncoated",
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
  와이코팅: "Y-Coating",
  엑스코팅: "X-Coating",
  티코팅: "T-Coating",
}

/**
 * 화학명 ↔ YG-1 내부 코팅명 양방향 매핑.
 * DB search_coating 컬럼은 YG-1 내부명("Y Coating", "X-Coating" 등)으로 저장됨.
 * 사용자가 화학명("AlCrN")으로 검색 시 내부명도 함께 조회해야 매칭 가능.
 * 소스: knowledge-graph.ts ENTITY_NODES의 coating aliases.
 */
export const COATING_CHEMICAL_DB_ALIASES: Record<string, string[]> = {
  alcrn: ["Y-Coating", "Y Coating"],
  tialn: ["X-Coating", "X Coating"],
  ticn: ["C-Coating", "C Coating"],
  altin: ["Z-Coating", "XC-Coating"],
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
  const normalizedLoose = normalized.replace(/([a-z])\1+/g, "$1")
  if (!normalized) return null

  for (const [alias, canonical] of Object.entries(COATING_KO_ALIASES)) {
    const compactAlias = alias.replace(/[\s\-_]+/g, "")
    const looseAlias = compactAlias.replace(/([a-z])\1+/g, "$1")
    if (normalized === alias || normalized === compactAlias || normalizedLoose === looseAlias) {
      return canonical
    }
  }

  // Preserve YG-1 internal coating labels regardless of spacing/hyphenation.
  // Example: "T coating", "tcoating", "Y-Coating" -> canonical internal label.
  const internalCoatingMatch = normalizedLoose.match(/^(x|y|t|z|c|h)coating$/i)
  if (internalCoatingMatch) {
    return `${internalCoatingMatch[1].toUpperCase()}-Coating`
  }

  // "코팅없는걸로", "코팅없는거", "없는거" 등 → Uncoated
  if (/코팅없|(?:^|\s)없는/.test(normalized)) return "Uncoated"

  // "Ti-Al-N" → "TiAlN" (단, "Y-Coating"/"X-Coating" 등 YG-1 내부명은 하이픈 보존)
  if (/[A-Za-z]+-[A-Za-z]/.test(stripped) && !/-coating\b/i.test(stripped)) {
    return stripped.replace(/-/g, "")
  }

  return stripped || null
}

// ═══════════════════════════════════════════════════════════════
// 7. Operation type keywords
// ═══════════════════════════════════════════════════════════════

// TODO(SSOT): derive from DB operation/application_shape tables instead of hardcoding.
// series_application_shape and machining condition tables carry canonical operation names;
// Korean aliases could live in an operation_aliases table. See CLAUDE.md.
export const OPERATION_KEYWORDS: Record<string, string[]> = {
  "황삭": ["황삭", "roughing", "rough", "헤비컷"],
  "정삭": ["정삭", "finishing", "finish", "마무리", "fine"],
  "중삭": ["중삭", "semi", "반정삭"],
  "고이송": ["고이송", "high feed", "highfeed", "hfm", "빠른이송"],
  "슬롯": ["슬롯", "slot", "slotting", "홈가공", "홈", "슬롯가공"],
  "측면": ["측면", "side", "side milling", "윤곽", "contour", "측면가공"],
  "프로파일": ["프로파일", "profile", "profiling", "프로파일가공"],
  "페이싱": ["페이싱", "facing"],
  "포켓": ["포켓", "pocket", "pocketing"],
  "3D": ["3d"],
}

export const OPERATION_KEYWORD_FLAT: Set<string> = new Set(
  Object.values(OPERATION_KEYWORDS).flat().map(k => k.toLowerCase())
)

// ═══════════════════════════════════════════════════════════════
// 7.5 Tool type keywords (SSOT)
// ═══════════════════════════════════════════════════════════════

export const TOOL_KEYWORDS: Record<string, string[]> = {
  "엔드밀": ["엔드밀", "endmill", "end mill"],
  "드릴": ["드릴", "drill"],
  "밀링": ["밀링", "milling"],
  "탭": ["탭", "tap", "tapping"],
  "리머": ["리머", "reamer"],
  "인서트": ["인서트", "insert"],
  "볼": ["볼", "ball"],
  "플랫": ["플랫", "flat", "스퀘어", "square"],
  "챔퍼": ["챔퍼", "chamfer"],
  "테이퍼": ["테이퍼", "taper"],
  "선삭": ["선삭"],
  "보링": ["보링", "boring"],
}

export const TOOL_KEYWORD_FLAT: Set<string> = new Set(
  Object.values(TOOL_KEYWORDS).flat().map(k => k.toLowerCase())
)

// ═══════════════════════════════════════════════════════════════
// 7.6 Coating flat Set (derived from COATING_KEYWORDS + 일반 표현)
// ═══════════════════════════════════════════════════════════════

/** Flat lowercase Set — O(1) 체크용. COATING_KEYWORD_SET + 일반 표현("코팅", "y-코팅" 등). */
export const COATING_KEYWORD_FLAT: Set<string> = new Set<string>([
  ...COATING_KEYWORD_SET,
  "코팅",
  "y-코팅",
  "x-코팅",
  "t-코팅",
  "c-코팅",
  "h-코팅",
  "z-코팅",
])

// ═══════════════════════════════════════════════════════════════
// 7.7 Product code patterns (SSOT)
// ═══════════════════════════════════════════════════════════════

export const PRODUCT_CODE_PATTERNS: RegExp[] = [
  /\b(CE[57]\w{2,})/i,
  /\b(GNX\d{2,})/i,
  /\b(SEM[A-Z]*\d{3,})/i,
  /\b(E[0-9]{4})/i,
  /\b(GAA?\d{2,})/i,
  /\b(GMG?\d{2,})/i,
  /\b(EHD\d{2,})/i,
  /\b(ALU[\s-]*PLUS)/i,
]

// ═══════════════════════════════════════════════════════════════
// 7.8 Reverse material map (alias → canonical)
// ═══════════════════════════════════════════════════════════════

/**
 * MATERIAL_KEYWORDS 의 역방향 매핑 (alias lowercase → canonical 한국어 키).
 * free-form 소재 문자열을 canonical 이름으로 정규화할 때 사용.
 */
export function buildReverseMaterialMap(): Record<string, string> {
  const reverseMap: Record<string, string> = {}
  for (const [canonical, aliases] of Object.entries(MATERIAL_KEYWORDS)) {
    for (const alias of aliases) {
      reverseMap[alias.toLowerCase()] = canonical
    }
  }
  return reverseMap
}

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

// ═══════════════════════════════════════════════════════════════
// Domain knowledge snippet for LLM prompts (data-driven, not rules)
// ═══════════════════════════════════════════════════════════════

/**
 * Build candidate distribution snippet from live candidates.
 * Shows actual value counts per field for LLM context.
 */
export function buildCandidateDistributionSnippet(
  distributions: Map<string, Map<string, number>>,
  candidateCount: number
): string {
  if (distributions.size === 0) return ""

  const FIELD_LABELS: Record<string, string> = {
    toolSubtype: "형상", coating: "코팅", fluteCount: "날 수",
    material: "소재", seriesName: "시리즈", diameterMm: "직경(mm)",
    workPieceName: "피삭재",
  }

  const lines: string[] = [`[현재 후보 ${candidateCount}개 분포]`]
  for (const [field, dist] of distributions) {
    const label = FIELD_LABELS[field] ?? field
    const top = [...dist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([v, c]) => `${v}(${c})`)
      .join(", ")
    lines.push(`- ${label}: ${top}`)
  }
  return lines.join("\n")
}

/** Returns a concise domain knowledge block for LLM prompt injection. */
export function buildDomainKnowledgeSnippet(): string {
  const subtypes = [...new Set(Object.values(TOOL_SUBTYPE_ALIASES))].sort().join(", ")
  const coatings = ["TiAlN", "AlCrN", "DLC", "TiN", "TiCN", "Diamond", "Bright Finish", "Blue-Coating", "X-Coating", "Y-Coating", "Uncoated"].join(", ")
  const materials = Object.keys(MATERIAL_KEYWORDS).join(", ")
  const operations = Object.keys(OPERATION_KEYWORDS).join(", ")

  return `[참고: DB에 존재하는 값]
- 공구 형상(toolSubtype): ${subtypes}
- 코팅(coating): ${coatings}
- 소재(material): ${materials}
- 가공 종류: ${operations}
- 필터 필드: diameterMm, fluteCount, coating, toolSubtype, material, seriesName, workPieceName, lengthOfCutMm, overallLengthMm, shankDiameterMm

## 도메인 지식 (YG-1 제품/소재/가공)

### CRX-S 시리즈 (구리/비철 전용)
- CRX S SGED31: 구리 전용 DLC 코팅 2날 스퀘어, D1.0~D12.0, 30° 헬릭스
- CRX S SGED30: 구리 전용 DLC 코팅 2날 스퀘어 롱넥, D1.0~D12.0
- CRX S SGED27: 구리 전용 DLC 코팅 2날 볼노즈

### 피삭재 → ISO 그룹 + 추천 코팅
- 구리/동/copper/황동/청동 = ISO N(비철), DLC 코팅 추천
- 탄소강/SM45C/S45C = ISO P(일반강), TiAlN(X-Coating) 추천
- 스테인리스/SUS304/SUS316 = ISO M, AlCrN(Y-Coating) 추천
- 알루미늄/A6061/A7075 = ISO N(비철), 무���팅/DLC 추천
- 주철/FC/FCD = ISO K, TiAlN/AlCrN 추천
- 티타늄/Ti6Al4V = ISO S, AlCrN/TiAlN ���천
- 고경도강/SKD11/SKD61/HRC50+ = ISO H, AlCrN/TiAlN 추천
- 합금강/SCM440 = ISO P, TiAlN 추천
- 인코넬/니켈합금 = ISO S, AlCrN 추천

### 가공 목적 → 추천 스펙
- 떨림 최소화 → 부등분할 4날 스퀘어
- 면조도 우수 → 6날 45° 래디우스 / 스트레이트 볼
- 리브/깊은홈 가공 → 테이퍼넥 래디우스 (롱넥)
- ��삭 효율 → Roughing (멀티플헬���스+코너R)
- 고이송 가공 → High-Feed / 3날 더블코너 래디우스
- 강력절삭 → 2날/4날 Edge 스퀘어
- 칩 배출 중시 ��� 2날 (날수 적을수록 배출 유리)

### 소재 그레이드별 가공 주의사항 (응답에 녹여야 할 내용)
- SUS304: 오스테나이트계 스테인리스, 가공경화 발생 → 이송 끊김 금지, AlCrN(Y-Coating) 추천.
- SUS316L: SUS304보다 Mo 첨가로 가공경화·점성 더 심함 → 절삭열 집중 주의, 절삭유 충분, AlCrN(Y-Coating) 필수.
- SUS440C: 마르텐사이트계, HRC58+ 가능 → 코팅 필수, 절삭속도 일반강 대비 60% 이하.
- A6061/A7075: 알루미늄, 구성인선(BUE) 발생 → V_c 200m/min 이상 권장, 무코팅/DLC.
- Ti6Al4V: 열전도율 낮음, 절삭열이 공구 끝에 집중 → 절삭속도 매우 낮춤(일반강의 30~50%), AlCrN/TiAlN.
- Inconel 718: 가공경화 + 발열 양대 지뢰 → 저속 + 충분 절삭유, AlCrN.
- SCM440/SCM435: 합금강, TiAlN(X-Coating) 균형 좋음.
- SKD11/SKD61(HRC50+): 고경도강, AlCrN 필수, 저속 가공.
- SM45C/S45C: 일반 탄소강, TiAlN(X-Coating) 표준.

### 코팅 비교 (둘 이상 언급 시 모두 짚을 것)
- AlCrN: 1100℃ 내열, 스테인리스/티타늄/고경도강에서 우세, 건식 고속 가공 강점.
- TiAlN: 800℃대 내열, 일반강·합금강에서 균형, 습식 가공에서 안정.
- DLC: 비철(알루미늄/구리)에 강함, 내열 한계 400℃로 스테인리스/티타늄 비추.
- TiN: 범용 입문용, 건식 한계, 가격 저렴.
- TiCN: 내마모성 우수, 일반강 황삭에 강함.
- Diamond(PCD): 비철 정밀 가공 전용, 철계 절대 금지.`
}

// ═══════════════════════════════════════════════════════════════
// Session Contradiction Patterns
// ═══════════════════════════════════════════════════════════════
// 세션 상태와 사용자 입력이 모순인 케이스를 LLM 호출 전에 잡아내는 단축회로용.
// 정확도보다 "명백한 모순만" 잡는 안전망이 목적 — 놓친 케이스는 orchestrator 가
// LLM 경로로 정상 처리하므로 false-negative 비용이 낮다.
// 중앙화 이유: 한국어 활용형 / 영어 동의어 확장 시 한 곳에서만 건드리면 됨.
export const CONTRADICTION_PATTERNS = {
  // "수정/변경/바꿈" — 기존 조건을 고치려는 요청
  modify: /(수정|변경|바꾸|바꿔|고치|고쳐|modify|change)/,
  // "비교" — 둘 이상을 대비하려는 요청
  compare: /(비교|compare|\bvs\b)/,
  // "제거/되돌리기/취소" — 적용된 것을 없애려는 요청
  undo: /(제거|삭제|되돌|취소|undo|remove|delete)/,
  // "추천" — 재요청
  recommend: /(추천해|recommend)/,
  // "다시/새로/재요청" — recommend 과 결합해 "재추천" 으로 해석
  reRecommend: /(다시|다른|새로|re-?recommend)/,
} as const

export type ContradictionPatternName = keyof typeof CONTRADICTION_PATTERNS

/**
 * 단일 패턴 매칭 헬퍼. 소문자 처리된 텍스트만 입력으로 받는다.
 */
export function matchContradictionPattern(
  name: ContradictionPatternName,
  lowerText: string
): boolean {
  return CONTRADICTION_PATTERNS[name].test(lowerText)
}
