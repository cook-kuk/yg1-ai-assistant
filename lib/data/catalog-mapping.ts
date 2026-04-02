/**
 * YG-1 Product Catalog Mapping
 * Maps product brand/keyword patterns to YG-1 online catalog viewer URLs.
 * 115 catalogs (59 Korean + 56 English) scraped from product.yg1.solutions
 */

const CATALOG_BASE = "https://product.yg1.solutions/resource/catalog/file"

export interface CatalogEntry {
  title: string
  catalogId: string
  url: string
  language: "ko" | "en"
  category: "Milling" | "Holemaking" | "Threading" | "Turning" | "Tooling" | "Industry" | "Other"
  /** Keywords to match against series name, description, or brand (lowercase) */
  matchKeywords: string[]
}

function kor(id: string, region = "국내용"): string {
  return `${CATALOG_BASE}/${id}/${encodeURI(encodeURI(region))}`
}
function eng(id: string, region = "EUROPE"): string {
  return `${CATALOG_BASE}/${id}/${encodeURI(encodeURI(region))}`
}

export const CATALOG_LIST: CatalogEntry[] = [
  // ═══════════════════════════════════
  // 밀링 (Milling) — Korean
  // ═══════════════════════════════════
  { title: "X-1 EH", catalogId: "1189", url: kor("1189"), language: "ko", category: "Milling", matchKeywords: ["x1-eh", "x1eh", "eh021", "eh022", "eh023", "eh024", "eh025", "eh026", "eh056", "eh057", "eh058", "eh059", "eh060", "eh062", "eh065", "eh066", "eh067", "eh068", "eh073", "eh077", "eh078", "eh094", "eh095", "eh105", "eh108", "eh216", "eh243", "eh244", "eh245", "eh246", "eh249", "eh250", "eh251", "eh252"] },
  { title: "EV MILLS", catalogId: "1178", url: kor("1178"), language: "ko", category: "Milling", matchKeywords: ["ev mill", "evmill"] },
  { title: "Ramping Tools", catalogId: "1177", url: kor("1177"), language: "ko", category: "Milling", matchKeywords: ["ramping"] },
  { title: "EㆍFORCE", catalogId: "1132", url: kor("1132"), language: "ko", category: "Milling", matchKeywords: ["e-force", "eforce", "e5e", "e5h", "e5i"] },
  { title: "4G MILLS", catalogId: "922", url: kor("922"), language: "ko", category: "Milling", matchKeywords: ["4g mill", "gmf"] },
  { title: "X5070 S", catalogId: "1161", url: kor("1161"), language: "ko", category: "Milling", matchKeywords: ["x5070", "g8a", "g8b", "g8d", "g826", "g850", "g851", "g854", "g859"] },
  { title: "G-CUT", catalogId: "917", url: kor("917"), language: "ko", category: "Milling", matchKeywords: ["g-cut", "gcut", "g9"] },
  { title: "X-POWER S", catalogId: "1160", url: kor("1160"), language: "ko", category: "Milling", matchKeywords: ["x-power", "xpower", "ep4", "ep7", "ep9"] },
  { title: "SUS-CUT", catalogId: "918", url: kor("918"), language: "ko", category: "Milling", matchKeywords: ["sus-cut", "suscut", "emi", "ehe", "gmi"] },
  { title: "ALU-CUT", catalogId: "919", url: kor("919"), language: "ko", category: "Milling", matchKeywords: ["alu-cut", "alucut", "e5d7", "e5d8", "e5e83", "e5e84", "ged"] },
  { title: "V7 PLUS", catalogId: "921", url: kor("921"), language: "ko", category: "Milling", matchKeywords: ["v7 plus", "v7plus", "emb"] },
  { title: "TANK-POWER", catalogId: "1159", url: kor("1159"), language: "ko", category: "Milling", matchKeywords: ["tank-power", "tankpower", "emd"] },
  { title: "Super Alloy", catalogId: "880", url: kor("880"), language: "ko", category: "Milling", matchKeywords: ["super alloy", "superalloy", "titanox", "gng", "gnx"] },
  { title: "WIDE-CUT", catalogId: "916", url: kor("916"), language: "ko", category: "Milling", matchKeywords: ["wide-cut", "widecut"] },
  { title: "하이스 엔드밀", catalogId: "883", url: kor("883"), language: "ko", category: "Milling", matchKeywords: ["하이스", "hss", "high speed steel"] },
  { title: "i-Xmill S", catalogId: "1158", url: kor("1158"), language: "ko", category: "Milling", matchKeywords: ["i-xmill", "ixmill", "xb1", "xb2", "xmb", "xmr", "xmf", "xmm"] },
  { title: "CBN", catalogId: "884", url: kor("884"), language: "ko", category: "Milling", matchKeywords: ["cbn"] },
  { title: "인서트 종합", catalogId: "1130", url: kor("1130"), language: "ko", category: "Milling", matchKeywords: ["인서트 종합", "insert"] },
  { title: "챔퍼컷", catalogId: "881", url: kor("881"), language: "ko", category: "Milling", matchKeywords: ["chamfer cut", "챔퍼컷"] },
  { title: "챔퍼밀", catalogId: "1156", url: kor("1156"), language: "ko", category: "Milling", matchKeywords: ["chamfer mill", "챔퍼밀"] },

  // ═══════════════════════════════════
  // 드릴링 (Holemaking) — Korean
  // ═══════════════════════════════════
  { title: "넘버원드릴", catalogId: "1163", url: kor("1163"), language: "ko", category: "Holemaking", matchKeywords: ["넘버원", "number one", "d1gp", "d2gp"] },
  { title: "X-DRILL (SYMX) vol.2", catalogId: "1164", url: kor("1164"), language: "ko", category: "Holemaking", matchKeywords: ["x-drill", "xdrill", "symx", "spmx"] },
  { title: "X-DRILL (SYMX)", catalogId: "1134", url: kor("1134"), language: "ko", category: "Holemaking", matchKeywords: ["x-drill", "xdrill", "symx"] },
  { title: "드림드릴 S", catalogId: "903", url: kor("903"), language: "ko", category: "Holemaking", matchKeywords: ["dream drill", "dreamdrill", "드림드릴", "dge", "dgn", "dgr", "d110", "d120", "d130", "d210", "d220", "d5302", "d5303", "d5432", "d5433", "d5434"] },
  { title: "드릴 종합", catalogId: "1137", url: kor("1137"), language: "ko", category: "Holemaking", matchKeywords: ["드릴 종합"] },
  { title: "플랫바텀드릴", catalogId: "904", url: kor("904"), language: "ko", category: "Holemaking", matchKeywords: ["flat bottom", "플랫바텀", "dh3", "dh4", "dh5", "dh7"] },
  { title: "드릴링 인서트", catalogId: "905", url: kor("905"), language: "ko", category: "Holemaking", matchKeywords: ["drilling insert", "드릴링 인서트"] },
  { title: "스페이드 드릴", catalogId: "906", url: kor("906"), language: "ko", category: "Holemaking", matchKeywords: ["spade", "스페이드"] },
  { title: "I - ONE 드릴", catalogId: "907", url: kor("907"), language: "ko", category: "Holemaking", matchKeywords: ["i-one", "ione", "아이원"] },
  { title: "센터 & NC드릴", catalogId: "908", url: kor("908"), language: "ko", category: "Holemaking", matchKeywords: ["center drill", "nc drill", "센터", "nc드릴"] },
  { title: "하이스 드릴", catalogId: "909", url: kor("909"), language: "ko", category: "Holemaking", matchKeywords: ["하이스 드릴", "hss drill"] },
  { title: "골드피 드릴", catalogId: "910", url: kor("910"), language: "ko", category: "Holemaking", matchKeywords: ["gold-p", "goldp", "골드피"] },
  { title: "코발트 드릴", catalogId: "912", url: kor("912"), language: "ko", category: "Holemaking", matchKeywords: ["cobalt", "코발트"] },
  { title: "논스톱 드릴", catalogId: "913", url: kor("913"), language: "ko", category: "Holemaking", matchKeywords: ["non-stop", "nonstop", "논스톱"] },
  { title: "프리미엄 CPM 드릴", catalogId: "914", url: kor("914"), language: "ko", category: "Holemaking", matchKeywords: ["cpm", "프리미엄"] },
  { title: "초경드릴", catalogId: "915", url: kor("915"), language: "ko", category: "Holemaking", matchKeywords: ["초경드릴", "carbide drill"] },

  // ═══════════════════════════════════
  // 쓰레딩 (Threading) — Korean
  // ═══════════════════════════════════
  { title: "탭 종합 (2025)", catalogId: "1165", url: kor("1165"), language: "ko", category: "Threading", matchKeywords: ["탭 종합"] },
  { title: "콤보 SUS용 탭", catalogId: "1176", url: kor("1176"), language: "ko", category: "Threading", matchKeywords: ["combo", "콤보", "sus용 탭", "t24", "t28"] },
  { title: "탭홀더", catalogId: "1166", url: kor("1166"), language: "ko", category: "Threading", matchKeywords: ["탭홀더", "tap holder"] },
  { title: "쓰레드 밀링커터", catalogId: "944", url: kor("944"), language: "ko", category: "Threading", matchKeywords: ["thread mill", "쓰레드밀", "l111", "l121", "l19", "l321"] },
  { title: "초경탭", catalogId: "945", url: kor("945"), language: "ko", category: "Threading", matchKeywords: ["초경탭", "carbide tap"] },
  { title: "스파이럴탭", catalogId: "955", url: kor("955"), language: "ko", category: "Threading", matchKeywords: ["spiral", "스파이럴"] },
  { title: "포인트탭", catalogId: "954", url: kor("954"), language: "ko", category: "Threading", matchKeywords: ["point tap", "포인트탭"] },
  { title: "스트레이트탭", catalogId: "952", url: kor("952"), language: "ko", category: "Threading", matchKeywords: ["straight", "스트레이트"] },
  { title: "전조탭(롤탭)", catalogId: "953", url: kor("953"), language: "ko", category: "Threading", matchKeywords: ["roll tap", "전조탭", "롤탭", "forming"] },
  { title: "핸드탭", catalogId: "951", url: kor("951"), language: "ko", category: "Threading", matchKeywords: ["hand tap", "핸드탭"] },
  { title: "인써트코일탭", catalogId: "950", url: kor("950"), language: "ko", category: "Threading", matchKeywords: ["insert coil", "인써트코일"] },
  { title: "관용탭(파이프탭)", catalogId: "949", url: kor("949"), language: "ko", category: "Threading", matchKeywords: ["pipe tap", "관용탭", "파이프탭"] },
  { title: "너트탭", catalogId: "948", url: kor("948"), language: "ko", category: "Threading", matchKeywords: ["nut tap", "너트탭"] },

  // ═══════════════════════════════════
  // 터닝 (Turning) — Korean
  // ═══════════════════════════════════
  { title: "PCBN 인서트", catalogId: "1188", url: kor("1188"), language: "ko", category: "Turning", matchKeywords: ["pcbn"] },
  { title: "터닝 CVD 강용 재종", catalogId: "1179", url: kor("1179"), language: "ko", category: "Turning", matchKeywords: ["cvd", "강용"] },
  { title: "파팅앤그루빙 인서트", catalogId: "1141", url: kor("1141"), language: "ko", category: "Turning", matchKeywords: ["parting", "grooving", "파팅", "그루빙"] },
  { title: "터닝 인서트", catalogId: "1143", url: kor("1143"), language: "ko", category: "Turning", matchKeywords: ["turning insert", "터닝 인서트", "cnmg", "wnmg", "dnmg", "vnmg", "tnmg"] },
  { title: "써멧 재종 YT100", catalogId: "1139", url: kor("1139"), language: "ko", category: "Turning", matchKeywords: ["cermet", "써멧", "yt100"] },
  { title: "SUS용 터닝 인서트", catalogId: "901", url: kor("901"), language: "ko", category: "Turning", matchKeywords: ["sus용 터닝", "stainless turning"] },

  // ═══════════════════════════════════
  // 툴링 & 기타 — Korean
  // ═══════════════════════════════════
  { title: "툴홀더", catalogId: "958", url: kor("958", "국내전용"), language: "ko", category: "Tooling", matchKeywords: ["tool holder", "툴홀더", "bt ", "hsk", "cat "] },
  { title: "로타리버", catalogId: "959", url: kor("959"), language: "ko", category: "Other", matchKeywords: ["rotary burr", "로타리버"] },
  { title: "리머", catalogId: "960", url: kor("960"), language: "ko", category: "Other", matchKeywords: ["reamer", "리머"] },
  { title: "챔퍼툴", catalogId: "961", url: kor("961"), language: "ko", category: "Other", matchKeywords: ["chamfer tool", "챔퍼툴"] },

  // ═══════════════════════════════════
  // Milling — English
  // ═══════════════════════════════════
  { title: "ALU-POWER HPC", catalogId: "1087", url: eng("1087"), language: "en", category: "Milling", matchKeywords: ["alu-power", "alupower"] },
  { title: "ALU-POWER", catalogId: "1086", url: eng("1086"), language: "en", category: "Milling", matchKeywords: ["alu-power", "alupower", "a119", "a122", "e525"] },
  { title: "EV MILL", catalogId: "1174", url: eng("1174"), language: "en", category: "Milling", matchKeywords: ["ev mill", "evmill"] },
  { title: "4G MILLS", catalogId: "1085", url: eng("1085"), language: "en", category: "Milling", matchKeywords: ["4g mill", "gmf"] },
  { title: "i-XMILL", catalogId: "1093", url: eng("1093"), language: "en", category: "Milling", matchKeywords: ["i-xmill", "ixmill", "xb1", "xb2", "xmb", "xmr"] },
  { title: "i-SMART", catalogId: "1047", url: eng("1047"), language: "en", category: "Milling", matchKeywords: ["i-smart", "ismart", "xgmf", "xsem"] },
  { title: "X5070", catalogId: "1102", url: eng("1102"), language: "en", category: "Milling", matchKeywords: ["x5070", "g8a", "g8b"] },
  { title: "V7 PLUS", catalogId: "1100", url: eng("1100"), language: "en", category: "Milling", matchKeywords: ["v7 plus", "v7plus", "emb"] },
  { title: "V7 PLUS A", catalogId: "1101", url: eng("1101", "AMERICA"), language: "en", category: "Milling", matchKeywords: ["v7 plus", "v7plus"] },
  { title: "X-POWER PRO", catalogId: "1103", url: eng("1103"), language: "en", category: "Milling", matchKeywords: ["x-power", "xpower", "ep4", "ep9"] },
  { title: "TITANOX POWER", catalogId: "1099", url: eng("1099"), language: "en", category: "Milling", matchKeywords: ["titanox", "ehe", "emi", "gmg24", "gmg25", "gmg26"] },
  { title: "X1-EH", catalogId: "1108", url: eng("1108"), language: "en", category: "Milling", matchKeywords: ["x1-eh", "x1eh", "eh021", "eh022", "eh023"] },
  { title: "K-2", catalogId: "1094", url: eng("1094"), language: "en", category: "Milling", matchKeywords: ["k-2", "k2 "] },
  { title: "K-2 MULTIPLE HELIX", catalogId: "1095", url: eng("1095"), language: "en", category: "Milling", matchKeywords: ["k-2 multiple", "multiple helix"] },
  { title: "YG MINIATURE", catalogId: "1186", url: eng("1186", "AMERICA"), language: "en", category: "Milling", matchKeywords: ["miniature", "micro"] },
  { title: "YG HF4 ENMX", catalogId: "1104", url: eng("1104", "AMERICA"), language: "en", category: "Milling", matchKeywords: ["hf4", "enmx"] },
  { title: "INDEXABLE MILLING", catalogId: "1090", url: eng("1090"), language: "en", category: "Milling", matchKeywords: ["indexable milling"] },
  { title: "MILLING (종합)", catalogId: "1096", url: eng("1096"), language: "en", category: "Milling", matchKeywords: [] },
  { title: "CHAMFERING TOOLS", catalogId: "1172", url: eng("1172"), language: "en", category: "Milling", matchKeywords: ["chamfer"] },
  { title: "COMPOSITE END MILLS", catalogId: "1088", url: eng("1088", "VIEW"), language: "en", category: "Milling", matchKeywords: ["composite", "cfrp"] },

  // ═══════════════════════════════════
  // Holemaking — English
  // ═══════════════════════════════════
  { title: "DREAM DRILLS", catalogId: "1071", url: eng("1071"), language: "en", category: "Holemaking", matchKeywords: ["dream drill", "dreamdrill", "dge", "dgn", "dgr", "d110", "d120", "d530"] },
  { title: "HOLEMAKING (종합)", catalogId: "1073", url: eng("1073"), language: "en", category: "Holemaking", matchKeywords: [] },
  { title: "INDEXABLE DRILLING", catalogId: "1074", url: eng("1074"), language: "en", category: "Holemaking", matchKeywords: ["indexable drill"] },
  { title: "i-ONE DRILLS", catalogId: "1075", url: eng("1075"), language: "en", category: "Holemaking", matchKeywords: ["i-one", "ione"] },
  { title: "MULTI-1 DRILLS", catalogId: "1076", url: eng("1076"), language: "en", category: "Holemaking", matchKeywords: ["multi-1", "multi1"] },
  { title: "GOLD-P DRILLS", catalogId: "1072", url: eng("1072", "VIEW"), language: "en", category: "Holemaking", matchKeywords: ["gold-p", "goldp"] },
  { title: "SPADE DRILLS", catalogId: "1077", url: eng("1077", "AMERICA"), language: "en", category: "Holemaking", matchKeywords: ["spade"] },
  { title: "COMPOSITE DRILL", catalogId: "1070", url: eng("1070", "VIEW"), language: "en", category: "Holemaking", matchKeywords: ["composite drill", "cfrp drill"] },

  // ═══════════════════════════════════
  // Threading — English
  // ═══════════════════════════════════
  { title: "PRIME TAP", catalogId: "1111", url: eng("1111"), language: "en", category: "Threading", matchKeywords: ["prime tap", "tre", "trj", "trh"] },
  { title: "COMBO TAP", catalogId: "1110", url: eng("1110"), language: "en", category: "Threading", matchKeywords: ["combo tap", "t24", "t28"] },
  { title: "SYNCHRO TAP", catalogId: "1112", url: eng("1112"), language: "en", category: "Threading", matchKeywords: ["synchro", "tks", "tts"] },
  { title: "THREAD MILLS", catalogId: "1113", url: eng("1113"), language: "en", category: "Threading", matchKeywords: ["thread mill", "l111", "l121"] },
  { title: "YG TAP CHIP BREAKER", catalogId: "1115", url: eng("1115"), language: "en", category: "Threading", matchKeywords: ["tap chip breaker"] },
  { title: "THREADING (종합)", catalogId: "1114", url: eng("1114"), language: "en", category: "Threading", matchKeywords: [] },
  { title: "PIPE TAP", catalogId: "1173", url: eng("1173"), language: "en", category: "Threading", matchKeywords: ["pipe tap"] },
  { title: "TAP for Cast Iron & Aluminum", catalogId: "1187", url: eng("1187"), language: "en", category: "Threading", matchKeywords: ["cast iron", "cast aluminum"] },

  // ═══════════════════════════════════
  // Turning — English
  // ═══════════════════════════════════
  { title: "ISO TURNING", catalogId: "1118", url: eng("1118"), language: "en", category: "Turning", matchKeywords: ["turning", "cnmg", "wnmg", "dnmg"] },
  { title: "MINIATURE BORING", catalogId: "1119", url: eng("1119"), language: "en", category: "Turning", matchKeywords: ["miniature boring", "boring"] },
  { title: "PARTING & GROOVING", catalogId: "1121", url: eng("1121"), language: "en", category: "Turning", matchKeywords: ["parting", "grooving"] },
  { title: "PCBN TURNING", catalogId: "1175", url: eng("1175"), language: "en", category: "Turning", matchKeywords: ["pcbn"] },
  { title: "NANO CUT", catalogId: "1120", url: eng("1120", "AMERICA"), language: "en", category: "Turning", matchKeywords: ["nano cut", "nanocut"] },

  // ═══════════════════════════════════
  // Tooling — English
  // ═══════════════════════════════════
  { title: "TOOLING SYSTEM", catalogId: "1116", url: eng("1116"), language: "en", category: "Tooling", matchKeywords: ["tooling system", "tool holder", "bt ", "hsk", "cat "] },

  // ═══════════════════════════════════
  // Industry Solutions — English
  // ═══════════════════════════════════
  { title: "AEROSPACE", catalogId: "1080", url: eng("1080", "VIEW"), language: "en", category: "Industry", matchKeywords: ["aerospace", "항공"] },
  { title: "AUTOMOTIVE", catalogId: "1081", url: eng("1081", "VIEW"), language: "en", category: "Industry", matchKeywords: ["automotive", "자동차"] },
  { title: "DIE & MOLD", catalogId: "1083", url: eng("1083", "VIEW"), language: "en", category: "Industry", matchKeywords: ["die", "mold", "금형"] },
  { title: "MEDICAL", catalogId: "1048", url: eng("1048", "VIEW"), language: "en", category: "Industry", matchKeywords: ["medical", "의료"] },
  { title: "ENERGY", catalogId: "1162", url: eng("1162", "VIEW"), language: "en", category: "Industry", matchKeywords: ["energy", "에너지"] },
  { title: "COMPOSITE MATERIALS", catalogId: "1082", url: eng("1082", "VIEW"), language: "en", category: "Industry", matchKeywords: ["composite", "cfrp", "복합소재"] },

  // ═══════════════════════════════════
  // Other — English
  // ═══════════════════════════════════
  { title: "REAMERS", catalogId: "1123", url: eng("1123"), language: "en", category: "Other", matchKeywords: ["reamer", "리머"] },
  { title: "COMPOSITE REAMERS", catalogId: "738", url: eng("738", "VIEW"), language: "en", category: "Other", matchKeywords: ["composite reamer"] },
]

/**
 * Find matching catalogs for a given series.
 * Returns catalogs sorted by language preference.
 */
export function findCatalogsForProduct(
  seriesName: string | null,
  description: string | null,
  brand: string | null,
  toolType: string | null,
  preferredLanguage: "ko" | "en" = "ko"
): CatalogEntry[] {
  if (!seriesName && !brand) return []

  // 매칭은 seriesName과 brand만 사용 (description/toolType은 오매칭 유발)
  const seriesNorm = (seriesName ?? "").toLowerCase().replace(/[-_\s]/g, "")
  const brandNorm = (brand ?? "").toLowerCase().replace(/[-_\s]/g, "")

  const matched = CATALOG_LIST.filter(catalog => {
    // 언어 필터: preferredLanguage만 허용
    if (catalog.language !== preferredLanguage) return false

    return catalog.matchKeywords.length > 0 &&
      catalog.matchKeywords.some(kw => {
        const kwNorm = kw.replace(/[-_\s]/g, "")
        if (kwNorm.length < 3) return false // 짧은 키워드 오매칭 방지
        return seriesNorm.includes(kwNorm) || brandNorm.includes(kwNorm) || kwNorm.includes(seriesNorm) && seriesNorm.length >= 3
      })
  })

  // Deduplicate by catalogId
  const seen = new Set<string>()
  const unique = matched.filter(c => {
    if (seen.has(c.catalogId)) return false
    seen.add(c.catalogId)
    return true
  })

  // Sort: preferred language first (already filtered, but keep for consistency)
  return unique.sort((a, b) => {
    const aScore = a.language === preferredLanguage ? 0 : 1
    const bScore = b.language === preferredLanguage ? 0 : 1
    return aScore - bScore
  })
}
