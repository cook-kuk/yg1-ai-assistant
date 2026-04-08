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

export interface DeterministicAction {
  type: "apply_filter"
  field: string
  value: string | number
  value2?: string | number
  op: "eq" | "neq" | "gte" | "lte" | "between"
  source: "deterministic"
}

// ── Field cue patterns (한국어 + 영어). 우선순위 순 ──────────────
// 더 구체적인 패턴이 먼저 와야 함 (전체 길이 → overallLength 가 직경보다 우선)
const FIELD_CUES: Array<{ pattern: RegExp; field: string; numeric: boolean }> = [
  // OAL 전장
  { pattern: /(전체\s*길이|전장|오버롤|overall\s*length|\boal\b)/i, field: "overallLengthMm", numeric: true },
  // LOC 날장
  { pattern: /(절삭\s*길이|날\s*길이|날장|\bloc\b|\bcl\b|length\s*of\s*cut)/i, field: "lengthOfCutMm", numeric: true },
  // 샹크 직경
  { pattern: /(샹크\s*(?:직경|지름)|생크\s*(?:직경|지름)|shank\s*(?:dia|diameter))/i, field: "shankDiameterMm", numeric: true },
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

// Brand values (대표적인 것들 — runtime 시 registry에서 가져오면 더 정확)
const BRAND_VALUES = [
  "X-POWER", "X-POWER PRO", "TitaNox-Power", "TitaNox", "CRX-S", "CRX S",
  "ALU-POWER", "3S MILL", "ONLY ONE", "K2 CARBIDE", "K-2 CARBIDE",
  "TANK-POWER", "JET-POWER", "X1-EH", "X5070", "X5070S", "E-FORCE",
  "V7", "V7 PLUS", "V7 PLUS A", "V7 INOX", "GMG", "GAA29", "SUS-CUT",
  "SUPER ALLOY", "BASIX",
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
  /재고\s*있/, /재고만/, /재고\s*\d/, /재고로/, /재고\b/, /in[-\s]?stock/i, /즉시\s*출하/, /빠른\s*납기/, /납기\s*빠른/,
]

// 쿨런트홀 (coolant hole)
const COOLANT_PATTERNS = [
  /쿨런트\s*홀/, /쿨런트\s*구멍/, /coolant\s*hole/i, /내부\s*냉각/,
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

// ── Main parser ──────────────────────────────────────────────
export function parseDeterministic(message: string): DeterministicAction[] {
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

  // 3) Inch fraction → diameter (1/4인치)
  if (!seen.has("diameterMm")) {
    const inch = parseInchFraction(text)
    if (inch != null) {
      actions.push({ type: "apply_filter", field: "diameterMm", value: inch, op: "eq", source: "deterministic" })
      seen.add("diameterMm")
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
    const v = findValueIn(text, COATING_VALUES)
    if (v) {
      const isNeg = NEG_MARKERS.test(text.slice(text.toLowerCase().indexOf(v.toLowerCase()) + v.length, text.toLowerCase().indexOf(v.toLowerCase()) + v.length + 8))
      actions.push({ type: "apply_filter", field: "coating", value: v, op: isNeg ? "neq" : "eq", source: "deterministic" })
      seen.add("coating")
    } else if (/(코팅\s*없는|무\s*코팅|uncoated|bright\s*finish)/i.test(text)) {
      actions.push({ type: "apply_filter", field: "coating", value: "Bright Finish", op: "eq", source: "deterministic" })
      seen.add("coating")
    }
  }

  // 6) Brand
  if (!seen.has("brand")) {
    const v = findValueIn(text, BRAND_VALUES)
    if (v) {
      // 부정 marker 가 brand 근처에 있는지 (앞 30자 또는 뒤 8자)
      const idx = text.toLowerCase().indexOf(v.toLowerCase())
      const ctx = text.slice(Math.max(0, idx - 5), idx + v.length + 12)
      const isNeg = NEG_MARKERS.test(ctx)
      actions.push({ type: "apply_filter", field: "brand", value: v, op: isNeg ? "neq" : "eq", source: "deterministic" })
      seen.add("brand")
    }
  }

  // 7) 재고
  if (!seen.has("stockStatus")) {
    if (STOCK_PATTERNS.some(p => p.test(text))) {
      actions.push({ type: "apply_filter", field: "stockStatus", value: "instock", op: "eq", source: "deterministic" })
      seen.add("stockStatus")
    }
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

  return actions
}
