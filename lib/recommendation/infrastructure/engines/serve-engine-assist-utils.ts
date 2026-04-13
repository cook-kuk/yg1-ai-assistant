import type { ScoredProduct } from "@/lib/recommendation/domain/types"

// ── Regex Pattern Constants ──────────────────────────────────────────

export const TOOL_DOMAIN_PATTERN = /slot|milling|side.?mill|shoulder|plunge|ball|taper|square|corner.?r|radius|flute|날수|날 수|날.*형|coating|코팅|dlc|tialn|alcrn|rpm|feed|이송|절삭|ap |ae |vc |fz |추천.*이유|왜.*추천|어떤.*형상|뭐가.*좋|뭐가.*맞|차이점|형상|가공|황삭|정삭|엔드밀|드릴|탭|인서트|시리즈|제품/i

export const DIRECT_PRODUCT_CODE_PATTERN = /\b([A-Z]{2,5}\d{3,}[A-Z0-9-]*|[A-Z]\d[A-Z]\d{4,}[A-Z]?)\b/i
export const DIRECT_SERIES_CODE_PATTERN = /\b([A-Z]\d[A-Z]\d{2,3}[A-Z]?)\b/i
export const DIRECT_PRODUCT_CODE_GLOBAL_PATTERN = /\b([A-Z]{2,5}\d{3,}[A-Z0-9-]*|[A-Z]\d[A-Z]\d{4,}[A-Z]?)\b/gi
export const DIRECT_SERIES_CODE_GLOBAL_PATTERN = /\b([A-Z]\d[A-Z]\d{2,3}[A-Z]?)\b/gi
export const CUTTING_CONDITION_QUERY_PATTERN = /절삭조건|가공조건|vc|fz|이송|회전수|rpm|feed/i
export const INVENTORY_QUERY_PATTERN = /재고|stock|inventory|available|availability|수량|남았/i
export const PRODUCT_INFO_TRIGGER_PATTERN = /공구\s*소재|재질|코팅|직경|지름|날\s*수|날수|플루트|형상|스퀘어|볼|라디우스|테이퍼|생크|절삭길이|날길이|전장|헬릭스|쿨런트|제품명|품명|스펙|사양|전체\s*사양|상세\s*사양|전체\s*정보|상세\s*정보|무슨\s*제품|어떤\s*제품|뭐야|뭐예요|알려/i
export const BRAND_REFERENCE_TRIGGER_PATTERN = /(브랜드|brand).*(추천|기준|표|어떤|무슨|뭐|찾|조회)|(?:iso\s*[pmknsh]|hrc|경도|피삭재|소재).*(브랜드|brand)/i
export const ENTITY_PROFILE_TRIGGER_PATTERN = /시리즈|series|브랜드|brand|차이|비교|vs|대비|특징|용도|적합|형상|설명|몇\s*날|날\s*수|날수|플루트|어떤\s*제품|무슨\s*제품/i
export const ENTITY_COMPARISON_PATTERN = /([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)\s*(?:vs\.?|VS\.?|와|과|이랑|랑|대비)\s*([A-Z0-9][A-Z0-9·∙ㆍ.\-\s]{1,40}?)(?=\s*(?:의|은|는|이|가|를|을|차이|비교|특징|설명|$))/giu
export const LATIN_ENTITY_PHRASE_PATTERN = /\b[A-Za-z0-9][A-Za-z0-9&.+/-]*(?:\s+[A-Za-z0-9][A-Za-z0-9&.+/-]*){0,5}\b/g
export const CUTTING_KNOWLEDGE_PATTERNS = /절삭|공구|엔드밀|드릴|인서트|코팅|소재|가공|선반|밀링|CNC|초경|CBN|세라믹|황삭|정삭|면취|보링|리머|탭|나사|칩|인선|마모|수명|이송|회전|절입|쿨란트|치핑|버|진동|채터|tialn|alcrn|dlc|hss|carbide|endmill|milling|turning|drilling/i
export const KNOWLEDGE_QUESTION_PATTERN = /차이|비교|뭐야|무엇|누구|언제|어디|알려|설명|원리|방법|팁|주의|장단점|특징|어떤|왜|어떻게|추천|좋은|의미|정의|역사|사례|규격|표준|최신|트렌드|뉴스|동향|중요|필요|가능/i
export const SIMPLE_CHAT_PATTERN = /^(안녕(?:하세요)?|hello|hi|hey|반가워|고마워|고맙습니다|thanks|thank you|네|응|ㅇㅇ|ㅇ|ok|좋아|그래|알겠어|테스트)\s*[!.?~]*$/i
export const WORKFLOW_ONLY_PATTERN = /^(추천해줘|결과 보여줘|보여줘|다음|이전으로|처음부터 다시|리셋|초기화|상관없음|패스|스킵)\s*[!.?~]*$/i

// ── Data Constants ───────────────────────────────────────────────────

export const WORK_PIECE_ALIASES: Array<{ canonical: string; patterns: RegExp[] }> = [
  { canonical: "스테인레스강(PH)", patterns: [/스테인(?:레)?스강\s*\(ph\)/i, /\bph\b/i, /석출경화/i] },
  { canonical: "스테인레스강 300", patterns: [/스테인(?:레)?스강\s*300/i, /\b30[46]\b/i, /\b31[46]\b/i, /\bsus3\d\d\b/i, /\bsts3\d\d\b/i, /오스테나이트/i] },
  { canonical: "스테인레스강 400", patterns: [/스테인(?:레)?스강\s*400/i, /\b4(10|20|30|40)\b/i, /\bsus4\d\d\b/i, /\bsts4\d\d\b/i, /페라이트/i, /마르텐사이트/i] },
  { canonical: "스테인레스강", patterns: [/스테인(?:레)?스강/i, /스테인리스/i, /스텐/i, /\bsus\b/i, /\bsts\b/i, /stainless/i] },
  { canonical: "고경도강", patterns: [/고경도강/i, /고경도/i, /경화강/i, /hardened/i] },
  { canonical: "프리하든강", patterns: [/프리하든/i, /pre-?harden/i] },
  { canonical: "내열합금", patterns: [/내열합금/i, /superalloy/i] },
  { canonical: "내열강", patterns: [/내열강/i, /heat resistant steel/i] },
  { canonical: "합금강", patterns: [/합금강/i, /alloy steel/i] },
  { canonical: "탄소강", patterns: [/탄소강/i, /carbon steel/i] },
  { canonical: "공구강", patterns: [/공구강/i, /tool steel/i] },
  { canonical: "주철", patterns: [/주철/i, /cast iron/i] },
  { canonical: "합금주철", patterns: [/합금주철/i] },
  { canonical: "알루미늄 단조 합금", patterns: [/알루미늄.*단조/i, /단조.*알루미늄/i] },
  { canonical: "알루미늄 주조 합금", patterns: [/알루미늄.*주조/i, /주조.*알루미늄/i] },
  { canonical: "알루미늄 합금", patterns: [/알루미늄 합금/i] },
  { canonical: "알루미늄 (연질)", patterns: [/연질.*알루미늄/i, /알루미늄.*연질/i] },
  { canonical: "알루미늄", patterns: [/알루미늄/i, /\baluminum\b/i, /\baluminium\b/i] },
  { canonical: "비철금속", patterns: [/비철금속/i, /비철/i, /non-?ferrous/i] },
  { canonical: "구리", patterns: [/구리/i, /copper/i] },
  { canonical: "동합금", patterns: [/동합금/i, /copper alloy/i] },
  { canonical: "티타늄 합금", patterns: [/티타늄 합금/i, /titanium alloy/i] },
  { canonical: "티타늄", patterns: [/티타늄/i, /titanium/i] },
  { canonical: "인코넬", patterns: [/인코넬/i, /inconel/i] },
  { canonical: "니켈 기반 내열합금", patterns: [/니켈 기반 내열합금/i] },
  { canonical: "철 기반 내열합금", patterns: [/철 기반 내열합금/i] },
  { canonical: "코발트 기반 내열합금", patterns: [/코발트 기반 내열합금/i] },
  { canonical: "플라스틱", patterns: [/플라스틱/i, /plastic/i] },
  { canonical: "열가소성 플라스틱", patterns: [/열가소성/i, /thermoplastic/i] },
  { canonical: "열경화성 플라스틱", patterns: [/열경화성/i, /thermoset/i] },
  { canonical: "아크릴", patterns: [/아크릴/i, /acrylic/i] },
  { canonical: "흑연", patterns: [/흑연/i, /graphite/i] },
]

// ── Normalizers ──────────────────────────────────────────────────────

export function normalizeLookupCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "").trim()
}

export function normalizeEntityLookupKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-·∙ㆍ./(),]+/g, "")
}

// ── Formatters ───────────────────────────────────────────────────────

export function escapeMarkdownTableCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-"
  return String(value).replace(/\|/g, "/").replace(/\n/g, " ").trim() || "-"
}

export function buildMarkdownTable(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const headerRow = `| ${headers.map(escapeMarkdownTableCell).join(" | ")} |`
  const dividerRow = `| ${headers.map(() => "---").join(" | ")} |`
  const bodyRows = rows.map(row => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`)
  return [headerRow, dividerRow, ...bodyRows].join("\n")
}

export function formatStockStatusLabel(stockStatus: "instock" | "limited" | "outofstock" | "unknown"): string {
  if (stockStatus === "instock") return "재고 있음"
  if (stockStatus === "limited") return "소량 재고"
  if (stockStatus === "outofstock") return "재고 없음"
  return "재고 미확인"
}

export function summarizeInventoryRowsByWarehouse(rows: Array<{ warehouseOrRegion: string; quantity: number | null }>): Array<{ warehouseOrRegion: string; quantity: number }> {
  return Array.from(
    rows.reduce((acc, row) => {
      if (row.quantity === null) return acc
      const key = row.warehouseOrRegion?.trim()
      if (!key) return acc
      acc.set(key, (acc.get(key) ?? 0) + row.quantity)
      return acc
    }, new Map<string, number>())
  )
    .map(([warehouseOrRegion, quantity]) => ({ warehouseOrRegion, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.warehouseOrRegion.localeCompare(b.warehouseOrRegion))
}

export function getLatestInventorySnapshotDateFromRows(rows: Array<{ snapshotDate: string | null }>): string | null {
  const dates = rows
    .map(row => row.snapshotDate)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort()
  return dates.length > 0 ? dates[dates.length - 1] : null
}

export function formatHrcRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${min}~${max}`
  if (min != null) return `${min}+`
  if (max != null) return `~${max}`
  return "-"
}

export function compactList(values: string[], max = 5): string {
  const unique = Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
  if (unique.length === 0) return "-"
  if (unique.length <= max) return unique.join(", ")
  return `${unique.slice(0, max).join(", ")} 외 ${unique.length - max}개`
}

export function formatNullableValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-"
  if (typeof value === "boolean") return value ? "있음" : "없음"
  return String(value)
}

export function formatMmValue(value: number | null | undefined): string {
  return value == null ? "-" : `φ${value}mm`
}

export function formatLengthValue(value: number | null | undefined): string {
  return value == null ? "-" : `${value}mm`
}

// 인치 제품(diameterInch != null)일 때는 inch 단위로 표시.
// mm 변환 값(diameterMm)이 동시에 있으면 괄호로 병기.
// 한웅희 피드백(2026-04-06): 인치 사이즈 제품에 mm suffix가 잘못 붙던 문제 해결.
export function formatDiameterDual(
  diameterMm: number | null | undefined,
  diameterInch: number | null | undefined
): string {
  if (diameterInch != null) {
    if (diameterMm != null) return `φ${diameterInch}″ (${diameterMm}mm)`
    return `φ${diameterInch}″`
  }
  return formatMmValue(diameterMm)
}

export function formatLengthDual(
  lengthMm: number | null | undefined,
  isInch: boolean
): string {
  if (lengthMm == null) return "-"
  if (isInch) {
    const inchValue = Number((lengthMm / 25.4).toFixed(3))
    return `${inchValue}″ (${lengthMm}mm)`
  }
  return `${lengthMm}mm`
}

export function formatAngleValue(value: number | null | undefined): string {
  return value == null ? "-" : `${value}°`
}

export function countValues<T extends string | number>(candidates: ScoredProduct[], getter: (c: ScoredProduct) => T | null | undefined): Map<T, number> {
  const counts = new Map<T, number>()
  for (const c of candidates) {
    const v = getter(c)
    if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

export function buildProductInfoChips(displayCode: string, includeFullSpec = false): string[] {
  const chips = [`${displayCode} 재고 알려줘`, `${displayCode} 절삭조건 알려줘`]
  if (includeFullSpec) chips.unshift(`${displayCode} 전체 사양 알려줘`)
  else chips.push("추천 제품 보기")
  return chips
}

export function formatDiameterRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `φ${min}~${max}mm`
  if (min != null) return `φ${min}mm+`
  if (max != null) return `~φ${max}mm`
  return "-"
}

export function formatFluteCounts(values: number[]): string {
  const unique = Array.from(new Set(values)).sort((a, b) => a - b)
  if (unique.length === 0) return "-"
  return unique.map(value => `${value}날`).join(", ")
}

export function dedupeEntityNames(values: string[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of values) {
    const name = raw.trim()
    const normalized = normalizeEntityLookupKey(name)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    names.push(name)
  }
  return names
}

// ── Helpers ──────────────────────────────────────────────────────────

export function collectRegexMatches(pattern: RegExp, value: string): string[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  return Array.from(value.matchAll(globalPattern))
    .map(match => (match[1] ?? match[0] ?? "").trim())
    .filter(Boolean)
}

export function isLikelyLookupPhrase(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2) return false

  const normalized = normalizeEntityLookupKey(trimmed)
  if (normalized.length < 2) return false

  return /[A-Z]/.test(trimmed) || /\d/.test(trimmed)
}

export function isLikelyProductLookupCandidate(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 3 || /\s/.test(trimmed) || !/[A-Za-z]/.test(trimmed) || !/\d/.test(trimmed)) return false
  // Reject measurement patterns: 10mm, 8MM, 12.5mm, 3파이, 10인치, etc.
  if (/^\d+(?:\.\d+)?(?:mm|파이|인치|inch|cm|°|deg)$/i.test(trimmed)) return false
  // Reject fraction-like patterns: 3/8", 1/4inch
  if (/^\d+\/\d+[""]?$/i.test(trimmed)) return false
  // Reject pure unit tokens: mm, cm
  if (/^[a-z]{1,3}$/i.test(trimmed)) return false
  // Must start with a letter (product codes like EIE2610050, SGED31100 always start with letters)
  if (!/^[A-Za-z]/.test(trimmed)) return false
  return true
}
