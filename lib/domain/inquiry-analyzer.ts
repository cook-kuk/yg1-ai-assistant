/**
 * Inquiry Analyzer — First gate in the pipeline.
 *
 * Analyzes raw user input BEFORE any retrieval or recommendation.
 * Determines signal strength, domain relevance, and whether the system
 * should proceed with product search at all.
 */

// ── Types ────────────────────────────────────────────────────

export type SignalStrength = "strong" | "moderate" | "weak" | "noise"
export type DomainRelevance = "on_domain" | "adjacent" | "off_domain"
export type InputForm = "question" | "command" | "keyword_list" | "smalltalk" | "nonsense" | "single_word"
export type Recoverability = "immediate" | "one_question" | "two_questions" | "not_recoverable"

export interface InquiryAnalysis {
  // Core classification
  signalStrength: SignalStrength
  domainRelevance: DomainRelevance
  inputForm: InputForm
  ambiguityLevel: "low" | "medium" | "high"
  seriousness: "genuine" | "testing" | "nonsense"

  // Extracted signal
  hasToolKeyword: boolean
  hasMaterialKeyword: boolean
  hasDimensionKeyword: boolean
  hasOperationKeyword: boolean
  hasProductCode: boolean
  extractedKeywordCount: number

  // Recovery
  recoverability: Recoverability
  suggestedAction: "proceed_retrieval" | "ask_clarification" | "soft_redirect" | "hard_redirect"

  // Debug
  reason: string
}

// ── Keyword Sets ─────────────────────────────────────────────

const TOOL_KEYWORDS = new Set([
  "엔드밀", "드릴", "볼", "플랫", "스퀘어", "챔퍼", "테이퍼", "인서트",
  "endmill", "end mill", "drill", "ball", "flat", "square", "taper",
  "밀링", "선삭", "보링", "리머", "탭",
])

const MATERIAL_KEYWORDS = new Set([
  "알루미늄", "알루", "alu", "스테인리스", "스텐", "sus", "탄소강", "합금강",
  "주철", "티타늄", "인코넬", "고경도", "구리", "비철", "공구강", "내열합금",
  "scm", "s45c", "sncm", "skd", "hrc",
])

const DIMENSION_PATTERNS = [
  /\d+(\.\d+)?\s*mm/i,
  /\d+(\.\d+)?\s*파이/,
  /\d+(\.\d+)?\s*밀리/,
  /직경\s*\d/,
  /지름\s*\d/,
  /φ?\d+(\.\d+)?/,
]

const OPERATION_KEYWORDS = new Set([
  "황삭", "정삭", "중삭", "슬롯", "측면", "프로파일", "페이싱", "고이송",
  "roughing", "finishing", "slotting", "side", "profiling",
  "측면가공", "슬롯가공", "프로파일가공", "3d", "포켓",
])

const PRODUCT_CODE_PATTERNS = [
  /\b(CE[57]\w{2,})/i,
  /\b(GNX\d{2,})/i,
  /\b(SEM[A-Z]*\d{3,})/i,
  /\b(E[0-9]{4})/i,
  /\b(GAA?\d{2,})/i,
  /\b(GMG?\d{2,})/i,
  /\b(EHD\d{2,})/i,
  /\b(ALU[\s-]*PLUS)/i,
]

const COATING_KEYWORDS = new Set([
  "코팅", "tialn", "alcrn", "ticn", "tin", "dlc", "무코팅", "y-코팅", "블루",
])

const RECOMMENDATION_SIGNALS = new Set([
  "추천", "추천해", "골라", "찾아", "뭐", "어떤", "좋은", "적합",
  "무난", "인기", "베스트", "대체", "대안", "비교",
])

const GREETING_PATTERNS = [
  /^안녕/, /^하이$/, /^hello/i, /^hi$/i, /^hey/i, /^반갑/,
  /^고마/, /^감사/, /^잘가/, /^바이/,
]

const NONSENSE_PATTERNS = [
  /^[ㅋㅎㅠㅜㄷ]+$/,          // ㅋㅋㅋ, ㅎㅎ, ㅠㅠ
  /^[!?.,;:]+$/,              // ???, !!!
  /^[a-z]{1,3}$/i,            // "hi", "ok" (too short)
  /^(ㅇㅇ|ㄴㄴ|ㄱㄱ|ㅇㅋ)$/,
  /^(뭐|왜|음|어|헐|흠|아)$/,
]

const OFF_DOMAIN_KEYWORDS = new Set([
  "날씨", "주식", "음식", "치킨", "피자", "노래", "영화", "게임",
  "코드", "프로그래밍", "배고", "졸려", "심심",
])

const SMALLTALK_PATTERNS = [
  /나랑\s*놀/, /심심/, /뭐\s*해/, /배고/, /졸려/, /놀자/,
  /뭐\s*할\s*수\s*있/, /누구/, /이름이\s*뭐/,
]

// App/UI-related question patterns — questions about the system itself
const APP_QUESTION_PATTERNS = [
  /매칭.*뭐|매칭.*무엇|매칭.*뜻|매칭.*의미/,
  /점수.*뭐|점수.*무엇|점수.*뜻|점수.*의미|점수.*어떻게/,
  /후보.*뭐|후보.*무엇|후보.*뜻/,
  /팩트.*체크|fact.*check|검증.*뭐/,
  /근거.*뭐|근거.*무엇|근거.*뜻/,
  /절삭.*조건.*뭐|절삭.*조건.*무엇/,
  /스코어|score|배점|가중치|weight/i,
  /어떻게.*작동|어떻게.*동작|원리|메커니즘/,
  /이\s*시스템|이\s*앱|이\s*사이트|이\s*프로그램/,
  /뭐야\??$|뭔가요\??$|뭔데\??$|뭐에요\??$/,  // ends with "뭐야?"
  /무슨.*뜻|무슨.*의미/,
  /왜.*이렇게|왜.*이런|왜.*나와|왜.*나오/,
  /어떻게.*봐|어떻게.*읽|어떻게.*해석/,
  /정확.*매칭|근사.*매칭|근사.*후보/,
  /없음.*뭐|없음.*뜻|없음.*의미/,
]

// ── Main Analysis Function ───────────────────────────────────

export function analyzeInquiry(message: string): InquiryAnalysis {
  const clean = message.trim()
  const lower = clean.toLowerCase()

  // Empty input
  if (!clean) {
    return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
      "빈 입력", { ambiguityLevel: "high", seriousness: "nonsense" })
  }

  // Very short (1-2 chars, not a number)
  if (clean.length <= 2 && !/^\d+$/.test(clean)) {
    if (NONSENSE_PATTERNS.some(p => p.test(clean))) {
      return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
        "초단문 무의미 입력", { ambiguityLevel: "high", seriousness: "nonsense" })
    }
  }

  // Check for nonsense patterns
  if (NONSENSE_PATTERNS.some(p => p.test(clean))) {
    return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
      "무의미 패턴 매칭", { ambiguityLevel: "high", seriousness: "nonsense" })
  }

  // Check for greeting
  if (GREETING_PATTERNS.some(p => p.test(lower))) {
    return buildResult("weak", "off_domain", "smalltalk", "not_recoverable", "soft_redirect",
      "인사/잡담 패턴", { ambiguityLevel: "low", seriousness: "genuine" })
  }

  // Check for app/UI questions (before smalltalk/off-domain so they don't get blocked)
  if (APP_QUESTION_PATTERNS.some(p => p.test(lower))) {
    return buildResult("moderate", "adjacent", "question", "immediate", "proceed_retrieval",
      "앱/UI 관련 질문", { ambiguityLevel: "low", seriousness: "genuine", extractedKeywordCount: 0 })
  }

  // Check for smalltalk
  if (SMALLTALK_PATTERNS.some(p => p.test(lower))) {
    return buildResult("noise", "off_domain", "smalltalk", "not_recoverable", "soft_redirect",
      "잡담 패턴", { ambiguityLevel: "low", seriousness: "nonsense" })
  }

  // Check for off-domain
  const hasOffDomain = [...OFF_DOMAIN_KEYWORDS].some(k => lower.includes(k))
  if (hasOffDomain && !hasDomainKeywords(lower)) {
    return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
      "범위 밖 키워드", { ambiguityLevel: "low", seriousness: "genuine" })
  }

  // ── Domain keyword extraction ──
  const hasToolKw = [...TOOL_KEYWORDS].some(k => lower.includes(k))
  const hasMaterialKw = [...MATERIAL_KEYWORDS].some(k => lower.includes(k))
  const hasDimKw = DIMENSION_PATTERNS.some(p => p.test(lower))
  const hasOpKw = [...OPERATION_KEYWORDS].some(k => lower.includes(k))
  const hasProductCode = PRODUCT_CODE_PATTERNS.some(p => p.test(clean))
  const hasCoatingKw = [...COATING_KEYWORDS].some(k => lower.includes(k))
  const hasRecommendSignal = [...RECOMMENDATION_SIGNALS].some(k => lower.includes(k))

  const kwCount = [hasToolKw, hasMaterialKw, hasDimKw, hasOpKw, hasProductCode, hasCoatingKw].filter(Boolean).length

  // Determine input form
  const inputForm = detectInputForm(clean, lower)

  // ── Classification based on keyword density ──

  // Strong signal: 3+ domain keywords or product code
  if (kwCount >= 3 || (hasProductCode && kwCount >= 1)) {
    return buildResult("strong", "on_domain", inputForm, "immediate", "proceed_retrieval",
      `강신호: ${kwCount}개 도메인 키워드`, {
        hasToolKeyword: hasToolKw, hasMaterialKeyword: hasMaterialKw,
        hasDimensionKeyword: hasDimKw, hasOperationKeyword: hasOpKw,
        hasProductCode, extractedKeywordCount: kwCount,
        ambiguityLevel: "low", seriousness: "genuine",
      })
  }

  // Moderate signal: 1-2 domain keywords
  if (kwCount >= 1) {
    const recoverability = kwCount === 2 ? "one_question" as const : "two_questions" as const
    return buildResult("moderate", "on_domain", inputForm, recoverability, "proceed_retrieval",
      `중신호: ${kwCount}개 도메인 키워드`, {
        hasToolKeyword: hasToolKw, hasMaterialKeyword: hasMaterialKw,
        hasDimensionKeyword: hasDimKw, hasOperationKeyword: hasOpKw,
        hasProductCode, extractedKeywordCount: kwCount,
        ambiguityLevel: kwCount === 1 ? "high" : "medium",
        seriousness: "genuine",
      })
  }

  // Has recommendation signal but no domain keywords
  if (hasRecommendSignal) {
    return buildResult("weak", "adjacent", inputForm, "two_questions", "ask_clarification",
      "추천 의도는 있으나 도메인 키워드 부재", {
        extractedKeywordCount: 0, ambiguityLevel: "high", seriousness: "genuine",
      })
  }

  // Bare number (could be diameter)
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return buildResult("moderate", "on_domain", "single_word", "one_question", "proceed_retrieval",
      "숫자만 입력 — 직경으로 추정", {
        hasDimensionKeyword: true, extractedKeywordCount: 1,
        ambiguityLevel: "medium", seriousness: "genuine",
      })
  }

  // Nothing domain-related detected
  return buildResult("weak", "off_domain", inputForm, "not_recoverable", "soft_redirect",
    "도메인 관련 키워드 미감지", { ambiguityLevel: "high", seriousness: "testing" })
}

// ── Helpers ──────────────────────────────────────────────────

function hasDomainKeywords(lower: string): boolean {
  return [...TOOL_KEYWORDS].some(k => lower.includes(k))
    || [...MATERIAL_KEYWORDS].some(k => lower.includes(k))
    || [...OPERATION_KEYWORDS].some(k => lower.includes(k))
    || [...COATING_KEYWORDS].some(k => lower.includes(k))
}

function detectInputForm(clean: string, lower: string): InputForm {
  if (/[?？]/.test(clean) || /뭐|어떤|왜|어디|언제|몇/.test(lower)) return "question"
  if (/해줘|해주세요|줘|주세요|알려|찾아/.test(lower)) return "command"
  if (/^[\w가-힣]+(\s+[\w가-힣]+){2,}$/.test(clean) && clean.length < 30) return "keyword_list"
  if (clean.length < 6) return "single_word"
  return "command"
}

function buildResult(
  signalStrength: SignalStrength,
  domainRelevance: DomainRelevance,
  inputForm: InputForm,
  recoverability: Recoverability,
  suggestedAction: InquiryAnalysis["suggestedAction"],
  reason: string,
  overrides: Partial<InquiryAnalysis> = {}
): InquiryAnalysis {
  return {
    signalStrength,
    domainRelevance,
    inputForm,
    ambiguityLevel: "medium",
    seriousness: "genuine",
    hasToolKeyword: false,
    hasMaterialKeyword: false,
    hasDimensionKeyword: false,
    hasOperationKeyword: false,
    hasProductCode: false,
    extractedKeywordCount: 0,
    recoverability,
    suggestedAction,
    reason,
    ...overrides,
  }
}

// ── Response Templates for Non-Retrieval Cases ──────────────

export function getRedirectResponse(analysis: InquiryAnalysis): {
  text: string
  chips: string[]
  showCandidates: boolean
} {
  switch (analysis.suggestedAction) {
    case "hard_redirect":
      return {
        text: "절삭공구 추천을 도와드릴 수 있어요. 가공 재질, 직경, 공구 종류 중 하나라도 알려주시면 바로 찾아드리겠습니다.",
        chips: ["스테인리스 가공", "알루미늄 10mm", "엔드밀 추천", "절삭조건 문의"],
        showCandidates: false,
      }
    case "soft_redirect":
      if (analysis.inputForm === "smalltalk" && analysis.domainRelevance === "off_domain") {
        return {
          text: "안녕하세요! YG-1 절삭공구 추천 어시스턴트입니다. 어떤 가공을 계획 중이신가요?",
          chips: ["제품 추천", "절삭조건 문의", "코팅 비교", "시리즈 검색"],
          showCandidates: false,
        }
      }
      return {
        text: "절삭공구 관련 질문을 도와드립니다. 예를 들어 'SCM440용 10mm 엔드밀 추천'처럼 말씀해주세요.",
        chips: ["탄소강 황삭", "알루미늄 정삭", "SUS304 가공", "코팅 비교"],
        showCandidates: false,
      }
    case "ask_clarification":
      return {
        text: "추천해드리려면 조건이 좀 더 필요합니다. 가공할 재질이 무엇인가요?",
        chips: ["탄소강", "스테인리스", "알루미늄", "티타늄", "주철"],
        showCandidates: false,
      }
    default:
      return {
        text: "조건을 입력해주세요.",
        chips: [],
        showCandidates: true,
      }
  }
}
