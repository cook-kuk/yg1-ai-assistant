/**
 * YG-1 Product Video Mapping
 * Maps product brand/keyword patterns to YouTube video URLs.
 * When a recommended series matches a pattern, the video link is shown in the product detail.
 */

export interface VideoEntry {
  title: string
  url: string
  language: "ko" | "en" | "both"
  category: "Milling" | "Holemaking" | "Threading" | "Turning" | "Tooling"
  /** Keywords to match against series name, description, or brand (lowercase) */
  matchKeywords: string[]
}

export const VIDEO_LIST: VideoEntry[] = [
  // ═══ Milling ═══
  { title: "Alu-Power HPC Chip Breaker", url: "https://youtu.be/AgylaZUuJhU", language: "en", category: "Milling", matchKeywords: ["alu-power", "alupower"] },
  { title: "ALU-POWER HPC", url: "https://youtu.be/Nx_OJARIq8Y", language: "both", category: "Milling", matchKeywords: ["alu-power", "alupower"] },
  { title: "ALU-CUT HPC", url: "https://youtu.be/732nAHbbM18", language: "ko", category: "Milling", matchKeywords: ["alu-cut", "alucut"] },
  { title: "X1-EH", url: "https://youtu.be/EoRxjaP7N1I", language: "en", category: "Milling", matchKeywords: ["x1-eh", "x1eh", "eh021", "eh022", "eh023", "eh024", "eh025", "eh026"] },
  { title: "TitaNox-Power HPC", url: "https://youtu.be/3Pwpo1qNm4k", language: "en", category: "Milling", matchKeywords: ["titanox"] },
  { title: "TitaNox-Power", url: "https://youtu.be/3LwmYNkDID0", language: "en", category: "Milling", matchKeywords: ["titanox"] },
  { title: "티타녹스파워", url: "https://youtu.be/WqyE2PaStys", language: "ko", category: "Milling", matchKeywords: ["titanox"] },
  { title: "V7 PLUS", url: "https://youtu.be/BQfXbpeZbb0", language: "en", category: "Milling", matchKeywords: ["v7 plus", "v7plus", "emb"] },
  { title: "V7 PLUS", url: "https://youtu.be/QViDrz2DDK0", language: "ko", category: "Milling", matchKeywords: ["v7 plus", "v7plus", "emb"] },
  { title: "V7 Plus Chipsplitter", url: "https://youtu.be/fycliCo3uTA", language: "en", category: "Milling", matchKeywords: ["v7 plus", "v7plus", "chipsplitter"] },
  { title: "V7 PLUS 칩스플리터", url: "https://youtu.be/cXEWzrnB5_A", language: "ko", category: "Milling", matchKeywords: ["v7 plus", "v7plus", "chipsplitter"] },
  { title: "4G MILLS", url: "https://youtu.be/XO8x6fwIzCU", language: "en", category: "Milling", matchKeywords: ["4g mill", "gmf"] },
  { title: "i-Xmill", url: "https://youtu.be/G6Ue7Kt85Ho", language: "en", category: "Milling", matchKeywords: ["i-xmill", "ixmill", "xb1", "xb2", "xmb", "xmr", "xmf", "xmm"] },
  { title: "i-Xmill S", url: "https://youtu.be/VTi_XJ_jJS8", language: "ko", category: "Milling", matchKeywords: ["i-xmill", "ixmill"] },
  { title: "X5070", url: "https://youtu.be/bTJB0cxpILE", language: "en", category: "Milling", matchKeywords: ["x5070", "g8a", "g8b", "g8d", "g826", "g850", "g851", "g854", "g859"] },
  { title: "ONLY ONE", url: "https://youtu.be/0qrFvGGddoM", language: "en", category: "Milling", matchKeywords: ["only one", "gyf", "gyg"] },
  { title: "i-SMART", url: "https://youtu.be/sTZ6MCX2c18", language: "both", category: "Milling", matchKeywords: ["i-smart", "ismart", "xgmf", "xsem"] },
  { title: "YG MILL - APKT", url: "https://youtu.be/_tuOoE3k3d4", language: "en", category: "Milling", matchKeywords: ["apkt"] },
  { title: "YG MILL - APKT", url: "https://youtu.be/kSea9KPxm6I", language: "ko", category: "Milling", matchKeywords: ["apkt"] },
  { title: "YG HF4 MILL ENMX", url: "https://youtu.be/MLoCNlUuFsE", language: "both", category: "Milling", matchKeywords: ["enmx", "hf4"] },
  { title: "YG HF4 MILL - ENMX", url: "https://youtu.be/-s3OI-p5UiM", language: "ko", category: "Milling", matchKeywords: ["enmx", "hf4"] },
  { title: "YG FM10 MILL PNMU", url: "https://youtu.be/h3yFmcGc344", language: "en", category: "Milling", matchKeywords: ["pnmu", "fm10"] },
  { title: "YG FM10 MILL - PNMU", url: "https://youtu.be/juwzl28bBE4", language: "ko", category: "Milling", matchKeywords: ["pnmu", "fm10"] },
  { title: "YG TM4 MILL LNKU & LNHU", url: "https://youtu.be/kYAF9Gd2sIg", language: "en", category: "Milling", matchKeywords: ["lnku", "lnhu", "tm4"] },
  { title: "YG SM3 MILL TPKT", url: "https://youtu.be/XePP_vsmCXE", language: "en", category: "Milling", matchKeywords: ["tpkt", "sm3"] },
  { title: "E-FORCE BLUE", url: "https://youtu.be/mgTel2Uvmnc", language: "ko", category: "Milling", matchKeywords: ["e-force", "eforce", "e5e", "e5h", "e5i"] },
  { title: "포지밀", url: "https://youtu.be/IO1z-VmtbsQ", language: "ko", category: "Milling", matchKeywords: ["apmt", "apxt"] },
  { title: "CFRP Compression Router", url: "https://youtu.be/P7Fzw45xmfs", language: "en", category: "Milling", matchKeywords: ["cfrp", "compression router", "urt5"] },
  { title: "Compression Router with Chip Breakers", url: "https://youtu.be/VH9VVl3ifcw", language: "en", category: "Milling", matchKeywords: ["compression router", "urt5"] },
  { title: "COMPOSITE MATERIALS", url: "https://youtu.be/eaCAGP5kVaw", language: "en", category: "Milling", matchKeywords: ["composite", "cfrp", "fbnp", "femp", "udc5", "udm5", "udr5", "upd5"] },

  // ═══ Holemaking ═══
  { title: "Dream Drill X", url: "https://youtu.be/QwPlDRx7dmM", language: "en", category: "Holemaking", matchKeywords: ["dream drill", "dreamdrill", "dge", "dgn", "dgr", "d1gp", "d2gp"] },
  { title: "DREAM DRILLS-GENERAL", url: "https://youtu.be/Hv9Ll2ldFm8", language: "en", category: "Holemaking", matchKeywords: ["dream drill", "dreamdrill", "d110", "d120", "d130"] },
  { title: "드림드릴 - 범용 초경 드릴", url: "https://youtu.be/Y6tyd73jqbI", language: "ko", category: "Holemaking", matchKeywords: ["dream drill", "dreamdrill", "d110", "d120"] },
  { title: "DREAM DRILLS-PRO", url: "https://youtu.be/YfJrFY_qZsk", language: "en", category: "Holemaking", matchKeywords: ["dream drill", "d5302", "d5303", "d5432", "d5433", "d5434"] },
  { title: "DREAM DRILLS-HIGH FEED", url: "https://youtu.be/hOZ5GM-XGA8", language: "en", category: "Holemaking", matchKeywords: ["high feed", "d8182"] },
  { title: "드림드릴 - 고이송", url: "https://youtu.be/AYnyJ4fULNM", language: "ko", category: "Holemaking", matchKeywords: ["high feed", "고이송", "d8182"] },
  { title: "DREAM DRILLS-FLAT BOTTOM", url: "https://youtu.be/-KUEL_R-A3o", language: "en", category: "Holemaking", matchKeywords: ["flat bottom", "dh3", "dh4", "dh5", "dh7"] },
  { title: "드림드릴 - 플랫바텀", url: "https://youtu.be/YumVavdt-mw", language: "ko", category: "Holemaking", matchKeywords: ["flat bottom", "플랫바텀", "dh3", "dh4", "dh5"] },
  { title: "DREAM DRILLS-INOX", url: "https://youtu.be/mJ_0f1dbDqo", language: "en", category: "Holemaking", matchKeywords: ["inox", "dl1", "dl6", "dlgp"] },
  { title: "드림드릴 - 이녹스", url: "https://youtu.be/J7Fe80OhkI8", language: "ko", category: "Holemaking", matchKeywords: ["inox", "이녹스", "dl1", "dl6"] },
  { title: "DREAM DRILLS-MQL TYPE", url: "https://youtu.be/HLVVB9fFy6A", language: "en", category: "Holemaking", matchKeywords: ["mql", "dhm"] },
  { title: "i-ONE DRILLS", url: "https://youtu.be/LPLz2pN6LWY", language: "en", category: "Holemaking", matchKeywords: ["i-one", "ione", "i-one drill"] },
  { title: "아이원드릴", url: "https://youtu.be/dxuLN6r1YWc", language: "ko", category: "Holemaking", matchKeywords: ["i-one", "ione", "아이원"] },
  { title: "X-Drill SYMX", url: "https://youtu.be/mK-B5MPCYfM", language: "en", category: "Holemaking", matchKeywords: ["spmx", "symx", "x-drill"] },
  { title: "SPADE DRILLS", url: "https://youtu.be/IzK-gYks_iA", language: "en", category: "Holemaking", matchKeywords: ["spade"] },
  { title: "스페이드 드릴 인서트", url: "https://youtu.be/Pxj1_4u_qeQ", language: "ko", category: "Holemaking", matchKeywords: ["spade", "스페이드"] },
  { title: "Drilling Insert", url: "https://youtu.be/9u-n3kXx19M", language: "en", category: "Holemaking", matchKeywords: ["drilling insert"] },
  { title: "드릴링 인서트", url: "https://youtu.be/C0C3_8fh2So", language: "ko", category: "Holemaking", matchKeywords: ["drilling insert", "드릴링 인서트"] },
  { title: "CFRP Drill", url: "https://youtu.be/GDA4UUqi97E", language: "en", category: "Holemaking", matchKeywords: ["cfrp drill", "rti", "guf", "gug"] },

  // ═══ Threading ═══
  { title: "PRIME TAP X-coating", url: "https://youtu.be/p6AU1jIXxmw", language: "en", category: "Threading", matchKeywords: ["prime tap", "primetap", "tre", "trj", "trh"] },
  { title: "PRIME TAP Forming Internal Coolant", url: "https://youtu.be/4UExZUcKSuE", language: "en", category: "Threading", matchKeywords: ["prime tap", "forming"] },
  { title: "프라임탭", url: "https://youtu.be/NOoqRVHK77g", language: "ko", category: "Threading", matchKeywords: ["prime tap", "프라임탭", "tre", "trj"] },
  { title: "COMBO TAP", url: "https://youtu.be/AxTuKPBsNHU", language: "en", category: "Threading", matchKeywords: ["combo tap", "combotap", "t24", "t28"] },
  { title: "콤보탭", url: "https://youtu.be/59xmq-DbzbU", language: "ko", category: "Threading", matchKeywords: ["combo tap", "콤보탭", "t24", "t28"] },
  { title: "SYNCHRO TAPS", url: "https://youtu.be/jk3ECJEVtdY", language: "en", category: "Threading", matchKeywords: ["synchro", "tks", "tts"] },
  { title: "THREAD MILLS", url: "https://youtu.be/45u9tk8fAWA", language: "both", category: "Threading", matchKeywords: ["thread mill", "threadmill", "l111", "l121", "l19", "l321"] },
  { title: "쓰레드밀", url: "https://youtu.be/eUkeehLQgBY", language: "ko", category: "Threading", matchKeywords: ["thread mill", "쓰레드밀"] },
  { title: "YG TAP Chip Breaker", url: "https://youtu.be/HQOfsa07oR4", language: "en", category: "Threading", matchKeywords: ["tap chip breaker"] },

  // ═══ Turning ═══
  { title: "YG-1 Turning Insert Grades Lineup 2025", url: "https://youtu.be/ksJF0Nuf_8A", language: "en", category: "Turning", matchKeywords: ["turning", "yg turn"] },
  { title: "YG TURN", url: "https://youtu.be/NL0gbhaBq8g", language: "en", category: "Turning", matchKeywords: ["turning", "yg turn"] },
  { title: "YG TURN - 터닝 재종 라인업", url: "https://youtu.be/NL0gbhaBq8g", language: "ko", category: "Turning", matchKeywords: ["turning", "터닝"] },
  { title: "NanoCut", url: "https://youtu.be/-ujx_4spMH8", language: "en", category: "Turning", matchKeywords: ["nanocut", "nano cut"] },

  // ═══ Tooling ═══
  { title: "YG-1 Power E-Hydro Chuck", url: "https://youtu.be/gBjH7h22TrI", language: "en", category: "Tooling", matchKeywords: ["hydro chuck", "e-hydro"] },
]

/**
 * Find matching videos for a given series name, description, and brand.
 * Returns videos sorted by language preference (matching language first).
 */
export function findVideosForProduct(
  seriesName: string | null,
  description: string | null,
  brand: string | null,
  preferredLanguage: "ko" | "en" = "ko"
): VideoEntry[] {
  if (!seriesName && !description && !brand) return []

  const searchText = [
    seriesName ?? "",
    description ?? "",
    brand ?? "",
  ].join(" ").toLowerCase().replace(/[-_]/g, "")

  const seriesLower = (seriesName ?? "").toLowerCase()

  const matched = VIDEO_LIST.filter(video =>
    video.matchKeywords.some(kw => {
      const kwNorm = kw.replace(/[-_]/g, "")
      return searchText.includes(kwNorm) || seriesLower.startsWith(kwNorm)
    })
  )

  // Deduplicate by URL
  const seen = new Set<string>()
  const unique = matched.filter(v => {
    if (seen.has(v.url)) return false
    seen.add(v.url)
    return true
  })

  // Sort: preferred language first, then "both"
  return unique.sort((a, b) => {
    const aScore = a.language === preferredLanguage ? 0 : a.language === "both" ? 1 : 2
    const bScore = b.language === preferredLanguage ? 0 : b.language === "both" ? 1 : 2
    return aScore - bScore
  })
}
