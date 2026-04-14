export type CanonicalCountryValue = "KOREA" | "AMERICA" | "ASIA" | "EUROPE"

export function stripKoreanParticles(value: string): string {
  return String(value ?? "")
    .replace(/(?:이에요|예요|으로|로|에서|에게|한테|부터|까지|는|은|이|가|을|를|도|만|요|임|입니까|입니다)\s*$/u, "")
    .trim()
}

export function normalizeCompactText(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_·∙ㆍ./(),]+/g, "")
}

export function normalizeIdentifierLookupKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z\u3131-\u318E\uAC00-\uD7A3]+/g, "")
}

export function tokenizeIdentifierWords(value: string): string[] {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/[^0-9a-z\u3131-\u318E\uAC00-\uD7A3]+/g)
    .map(token => token.trim())
    .filter(Boolean)
}

export const IDENTIFIER_DESCRIPTOR_STOPWORDS = new Set([
  "brand",
  "edition",
  "for",
  "global",
  "korea",
  "korean",
  "market",
  "model",
  "series",
  "ver",
  "version",
  "yg",
  "yg1",
])

export function stripIdentifierDescriptorSuffix(value: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return trimmed

  const stopwordPattern = [...IDENTIFIER_DESCRIPTOR_STOPWORDS]
    .sort((left, right) => right.length - left.length)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")

  if (!stopwordPattern) return trimmed

  const stripped = trimmed
    .replace(new RegExp(`\\b(?:${stopwordPattern})\\b.*$`, "i"), "")
    .replace(/[\s,;:/-]+$/u, "")
    .trim()

  return stripped || trimmed
}

export const COUNTRY_CANONICAL_VALUES: CanonicalCountryValue[] = ["KOREA", "AMERICA", "ASIA", "EUROPE"]

export const COUNTRY_ALIAS_MAP: Record<string, CanonicalCountryValue> = {
  "국내": "KOREA",
  "국내용": "KOREA",
  "국내산": "KOREA",
  "국산": "KOREA",
  "내수": "KOREA",
  "한국": "KOREA",
  "대한민국": "KOREA",
  "korea": "KOREA",
  "southkorea": "KOREA",
  "kr": "KOREA",
  "kor": "KOREA",
  "미국": "AMERICA",
  "북미": "AMERICA",
  "미주": "AMERICA",
  "america": "AMERICA",
  "northamerica": "AMERICA",
  "unitedstates": "AMERICA",
  "usa": "AMERICA",
  "us": "AMERICA",
  "japan": "ASIA",
  "jp": "ASIA",
  "jpn": "ASIA",
  "일본": "ASIA",
  "china": "ASIA",
  "cn": "ASIA",
  "chn": "ASIA",
  "중국": "ASIA",
  "thailand": "ASIA",
  "tha": "ASIA",
  "태국": "ASIA",
  "vietnam": "ASIA",
  "vnm": "ASIA",
  "베트남": "ASIA",
  "india": "ASIA",
  "ind": "ASIA",
  "인도": "ASIA",
  "asia": "ASIA",
  "아시아": "ASIA",
  "germany": "EUROPE",
  "de": "EUROPE",
  "deu": "EUROPE",
  "독일": "EUROPE",
  "england": "EUROPE",
  "uk": "EUROPE",
  "unitedkingdom": "EUROPE",
  "britain": "EUROPE",
  "eng": "EUROPE",
  "영국": "EUROPE",
  "france": "EUROPE",
  "fra": "EUROPE",
  "프랑스": "EUROPE",
  "italy": "EUROPE",
  "ita": "EUROPE",
  "이탈리아": "EUROPE",
  "spain": "EUROPE",
  "esp": "EUROPE",
  "스페인": "EUROPE",
  "russia": "EUROPE",
  "rus": "EUROPE",
  "러시아": "EUROPE",
  "poland": "EUROPE",
  "pol": "EUROPE",
  "폴란드": "EUROPE",
  "hungary": "EUROPE",
  "hun": "EUROPE",
  "헝가리": "EUROPE",
  "turkey": "EUROPE",
  "turkiye": "EUROPE",
  "tur": "EUROPE",
  "튀르키예": "EUROPE",
  "터키": "EUROPE",
  "czech": "EUROPE",
  "czechia": "EUROPE",
  "czechrepublic": "EUROPE",
  "cze": "EUROPE",
  "체코": "EUROPE",
  "portugal": "EUROPE",
  "prt": "EUROPE",
  "포르투갈": "EUROPE",
  "europe": "EUROPE",
  "유럽": "EUROPE",
}

export function canonicalizeCountryValue(rawValue: string | null | undefined): CanonicalCountryValue | string | null {
  const trimmed = String(rawValue ?? "").trim()
  if (!trimmed) return null

  const normalized = normalizeCompactText(stripKoreanParticles(trimmed))
  if (normalized in COUNTRY_ALIAS_MAP) {
    return COUNTRY_ALIAS_MAP[normalized]
  }

  const upper = trimmed.toUpperCase()
  if (COUNTRY_CANONICAL_VALUES.includes(upper as CanonicalCountryValue)) {
    return upper as CanonicalCountryValue
  }

  return upper || null
}

export function countryToPreferredLanguage(country?: string | null): "ko" | "en" {
  if (!country) return "ko"
  const canonical = canonicalizeCountryValue(country)
  return canonical === "KOREA" ? "ko" : "en"
}

export const TOOL_SUBTYPE_ALIAS_MAP: Record<string, string> = {
  square: "Square",
  "스퀘어": "Square",
  "플랫": "Square",
  "평면": "Square",
  flat: "Square",
  ball: "Ball",
  "볼": "Ball",
  "볼노즈": "Ball",
  radius: "Radius",
  "라디우스": "Radius",
  "코너r": "Radius",
  "코너r값": "Radius",
  "코너반경": "Radius",
  "코너 라디우스": "Radius",
  "cornerradius": "Corner Radius",
  roughing: "Roughing",
  rough: "Roughing",
  "황삭": "Roughing",
  taper: "Taper",
  "테이퍼": "Taper",
  chamfer: "Chamfer",
  "챔퍼": "Chamfer",
  highfeed: "High-Feed",
  "high-feed": "High-Feed",
  "high feed": "High-Feed",
  "하이피드": "High-Feed",
}

export function canonicalizeToolSubtypeValue(rawValue: string | null | undefined): string | null {
  const stripped = stripKoreanParticles(String(rawValue ?? "").trim())
  const normalized = normalizeCompactText(stripped)
  if (!normalized) return null

  for (const [alias, canonical] of Object.entries(TOOL_SUBTYPE_ALIAS_MAP)) {
    if (normalized.includes(normalizeCompactText(alias))) {
      return canonical
    }
  }

  return stripped || null
}

export const COATING_ALIAS_MAP: Record<string, string> = {
  "블루": "Blue-Coating",
  "블루코팅": "Blue-Coating",
  "bluecoating": "Blue-Coating",
  "gold": "TiN",
  "골드": "TiN",
  "골드코팅": "TiN",
  "black": "TiAlN",
  "블랙": "TiAlN",
  "블랙코팅": "TiAlN",
  "브라이트": "Bright Finish",
  "브라이트피니시": "Bright Finish",
  "bright": "Bright Finish",
  "brightfinish": "Bright Finish",
  "무코팅": "Uncoated",
  "무코닝": "Uncoated",
  "비코팅": "Uncoated",
  "비코닝": "Uncoated",
  "노코팅": "Uncoated",
  "코팅없": "Uncoated",
  "코팅없음": "Uncoated",
  "uncoated": "Uncoated",
  "다이아몬드": "Diamond",
  "다이아몬드코팅": "Diamond",
  "diamond": "Diamond",
  "티알엔": "TiAlN",
  "타이알엔": "TiAlN",
  "tialn": "TiAlN",
  "알크른": "AlCrN",
  "알씨알엔": "AlCrN",
  "alcrn": "AlCrN",
  "알틴": "AlTiN",
  "altin": "AlTiN",
  "티씨엔": "TiCN",
  "ticn": "TiCN",
  "티엔": "TiN",
  "티아이엔": "TiN",
  "tin": "TiN",
  "디엘씨": "DLC",
  "dlc": "DLC",
  "x코팅": "X-Coating",
  "엑스코팅": "X-Coating",
  "xcoating": "X-Coating",
  "y코팅": "Y-Coating",
  "와이코팅": "Y-Coating",
  "ycoating": "Y-Coating",
  "z코팅": "Z-Coating",
  "zcoating": "Z-Coating",
  "c코팅": "C-Coating",
  "ccoating": "C-Coating",
  "h코팅": "H-Coating",
  "hcoating": "H-Coating",
  "t코팅": "T-Coating",
  "티코팅": "T-Coating",
}

export const COATING_DB_ALIAS_MAP: Record<string, string[]> = {
  alcrn: ["Y-Coating", "Y Coating"],
  tialn: ["X-Coating", "X Coating"],
  ticn: ["C-Coating", "C Coating"],
  altin: ["Z-Coating", "XC-Coating"],
}

export function canonicalizeCoatingValue(rawValue: string | null | undefined): string | null {
  const stripped = stripKoreanParticles(String(rawValue ?? "").trim())
  const normalized = normalizeCompactText(stripped)
  const normalizedLoose = normalized.replace(/([a-z])\1+/g, "$1")
  if (!normalized) return null

  for (const [alias, canonical] of Object.entries(COATING_ALIAS_MAP)) {
    const aliasKey = normalizeCompactText(alias)
    const aliasLoose = aliasKey.replace(/([a-z])\1+/g, "$1")
    if (normalized === aliasKey || normalizedLoose === aliasLoose) {
      return canonical
    }
  }

  const internalMatch = normalizedLoose.match(/^(x|y|z|c|h|t)coating$/i)
  if (internalMatch) {
    return `${internalMatch[1].toUpperCase()}-Coating`
  }

  if (/[A-Za-z]+-[A-Za-z]/.test(stripped) && !/-coating\b/i.test(stripped)) {
    return stripped.replace(/-/g, "")
  }

  return stripped || null
}

export const MATERIAL_ALIAS_MAP: Record<string, string> = {
  "탄소강": "Carbon Steel",
  "carbonsteel": "Carbon Steel",
  "s45c": "Carbon Steel",
  "sm45c": "Carbon Steel",
  "스테인리스": "Stainless Steel",
  "스텐": "Stainless Steel",
  "stainless": "Stainless Steel",
  "sus": "Stainless Steel",
  "알루미늄": "Aluminum",
  "aluminum": "Aluminum",
  "aluminium": "Aluminum",
  "alu": "Aluminum",
  "구리": "Copper",
  "copper": "Copper",
  "cu": "Copper",
  "주철": "Cast Iron",
  "castiron": "Cast Iron",
  "티타늄": "Titanium",
  "titanium": "Titanium",
  "인코넬": "Inconel",
  "superalloy": "Inconel",
  "inconel": "Inconel",
  "고경도강": "Hardened Steel",
  "hardenedsteel": "Hardened Steel",
  "graphite": "Graphite",
  "흑연": "Graphite",
  "cfrp": "CFRP",
  "비철": "Non-ferrous",
  "nonferrous": "Non-ferrous",
}

export function canonicalizeMaterialValue(rawValue: string | null | undefined): string | null {
  const stripped = stripKoreanParticles(String(rawValue ?? "").trim())
  const normalized = normalizeCompactText(stripped)
  if (!normalized) return null

  for (const [alias, canonical] of Object.entries(MATERIAL_ALIAS_MAP)) {
    if (normalized.includes(alias)) {
      return canonical
    }
  }

  return stripped || null
}

export function buildCanonicalDomainKnowledgeSnippet(): string {
  const coatings = Array.from(new Set(Object.values(COATING_ALIAS_MAP)))
  const toolSubtypes = Array.from(new Set(Object.values(TOOL_SUBTYPE_ALIAS_MAP)))
  const materials = Array.from(new Set(Object.values(MATERIAL_ALIAS_MAP)))

  return `[Canonical registry]
- country: ${COUNTRY_CANONICAL_VALUES.join(", ")}
- coating: ${coatings.join(", ")}
- material: ${materials.join(", ")}
- toolSubtype: ${toolSubtypes.join(", ")}
- interpretation rule: natural-language aliases must normalize onto these canonical values before filtering or prompting.`
}

export type YG1CompanyFacts = {
  foundedAt: string
  headquarters: string
  mainPhone: string
  kosdaq: string
  revenue2024Krw: string
  rankSummary: string
  majorShareholder: string
  domesticFactories: string[]
  domesticSalesOffices: string[]
  onlineOrderHost: string
  recruitmentHost: string
}

export const YG1_COMPANY_FACTS: YG1CompanyFacts = {
  foundedAt: "1981.12.20",
  headquarters: "인천",
  mainPhone: "032-526-0909",
  kosdaq: "019210",
  revenue2024Krw: "5,750억원",
  rankSummary: "엔드밀 세계 1위, 탭 세계 3위, 드릴 세계 6위",
  majorShareholder: "IMC Benelux 14.98%",
  domesticFactories: [
    "인천본부 032-500-4400",
    "부평 032-509-2700",
    "송도 032-500-5400",
    "광주 062-951-9212",
    "충주 043-722-5900",
  ],
  domesticSalesOffices: [
    "서울 02-2681-3456",
    "대구 053-600-8909",
    "천안 041-417-0985",
    "부산 051-314-0985",
    "창원 055-275-0985",
  ],
  onlineOrderHost: "oos.yg1.solutions",
  recruitmentHost: "yg1.recruiter.co.kr",
}

export function buildYG1CompanyPromptSnippet(): string {
  return `
### YG-1 company facts
- 설립/본사/대표 문의: ${YG1_COMPANY_FACTS.foundedAt} / ${YG1_COMPANY_FACTS.headquarters} / ${YG1_COMPANY_FACTS.mainPhone}
- KOSDAQ: ${YG1_COMPANY_FACTS.kosdaq} / 매출(2024): ${YG1_COMPANY_FACTS.revenue2024Krw}
- 순위: ${YG1_COMPANY_FACTS.rankSummary}
- 2대주주: ${YG1_COMPANY_FACTS.majorShareholder}
- 국내 공장: ${YG1_COMPANY_FACTS.domesticFactories.join(", ")}
- 국내 영업소: ${YG1_COMPANY_FACTS.domesticSalesOffices.join(", ")}
- 온라인주문: ${YG1_COMPANY_FACTS.onlineOrderHost}
- 채용: ${YG1_COMPANY_FACTS.recruitmentHost}
- 위 목록에 없는 전화번호/URL/공장/영업소/주소는 만들지 말 것.
`.trim()
}

// ═══ Brand / Series Categories (SSOT) ═══
// 대표 시리즈: 사용자가 인지하는 메인 라인업 (boost 대상)
// 마이크로 시리즈: 초소형 특수 공구 라인 (pure-neq 쿼리에서 demote 대상)
// 변경 시 여기만 수정 — consumer는 isFlagshipSeries/isMicroSeries 사용.
export const FLAGSHIP_SERIES = [
  "4G MILL",
  "V7 PLUS",
  "i-SMART",
  "TitaNox-Power",
  "X-POWER",
  "SEME",
  "GMH",
  "GMG",
] as const

export const MICRO_SERIES = [
  "3S MILL",
  "CRX MICRO",
  "MICRO",
] as const

export function isFlagshipSeries(brandOrSeries: string | null | undefined): boolean {
  const value = String(brandOrSeries ?? "")
  if (!value) return false
  return FLAGSHIP_SERIES.some(flagship => value.includes(flagship))
}

export function isMicroSeries(brandOrSeries: string | null | undefined): boolean {
  const value = String(brandOrSeries ?? "")
  if (!value) return false
  return MICRO_SERIES.some(micro => value.includes(micro))
}

export function buildDirectAssistFactualPromptSection(): string {
  return `
### system facts
- 36,000개 YG-1 제품 데이터를 기준으로 답변한다.
- 추천 스코어링: 직경 40, 피삭재 20, 날수 15, 가공형상 15, 절삭조건 10, 코팅 5, 접근성 5.
- exact 75% 이상, approximate 45~75%, 미매칭 45% 미만.
- ISO group: P=탄소강/합금강, M=스테인리스, K=주철, N=비철/알루미늄, S=내열합금/티타늄, H=고경도강.

### coating facts
- TiAlN: 내열 약 800도, 범용/고경도강 중심.
- AlCrN: 내열 약 1100도, 스테인리스/건식 고속 가공 중심.
- DLC: 알루미늄/구리/흑연 중심, 철계와 스테인리스에는 부적합.
- TiN: 범용 입문형.
- TiCN: 내마모성 중심, 중속 가공.
- Diamond/PCD: 비철/복합재 중심, 철계 금지.
`.trim()
}
