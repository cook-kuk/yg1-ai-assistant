/**
 * Inquiry Analyzer — First gate in the pipeline.
 *
 * Analyzes raw user input BEFORE any retrieval or recommendation.
 * Determines signal strength, domain relevance, and whether the system
 * should proceed with product search at all.
 */

export type SignalStrength = "strong" | "moderate" | "weak" | "noise"
export type DomainRelevance = "on_domain" | "adjacent" | "off_domain"
export type InputForm = "question" | "command" | "keyword_list" | "smalltalk" | "nonsense" | "single_word"
export type Recoverability = "immediate" | "one_question" | "two_questions" | "not_recoverable"

export interface InquiryAnalysis {
  signalStrength: SignalStrength
  domainRelevance: DomainRelevance
  inputForm: InputForm
  ambiguityLevel: "low" | "medium" | "high"
  seriousness: "genuine" | "testing" | "nonsense"
  hasToolKeyword: boolean
  hasMaterialKeyword: boolean
  hasDimensionKeyword: boolean
  hasOperationKeyword: boolean
  hasProductCode: boolean
  extractedKeywordCount: number
  recoverability: Recoverability
  suggestedAction: "proceed_retrieval" | "ask_clarification" | "soft_redirect" | "hard_redirect" | "answer_general"
  reason: string
}

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

const GENERAL_KNOWLEDGE_KEYWORDS = new Set([
  "가공", "주의", "주의사항", "차이", "비교", "장단점", "특징", "원리", "팁", "방법",
  "선택", "기준", "어떻게", "언제", "왜", "장점", "단점", "수명", "마모",
  "속도", "이송", "회전", "절입", "절삭", "냉각", "쿨란트", "칩",
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
  /^[ㅋㅎㅠㅜㄷ]+$/,
  /^[!?.,;:]+$/,
  /^(ㅇㅇ|ㄴㄴ|ㄱㄱ|ㅇㅋ)$/,
  /^(음|헐|흠)$/,
]

const OFF_DOMAIN_KEYWORDS = new Set([
  "날씨", "주식", "음식", "치킨", "피자", "노래", "영화", "게임",
  "코드", "프로그래밍", "배고", "졸려", "심심",
])

const SMALLTALK_PATTERNS = [
  /나랑\s*놀/, /심심/, /뭐\s*해/, /배고/, /졸려/, /놀자/,
  /뭐\s*할\s*수\s*있/, /누구/, /이름이\s*뭐/,
]

const NARROWING_RESPONSE_PATTERNS = [
  /^상관\s*없/, /^아무\s*거나/, /^아무거나/, /^뭐든/, /^다\s*괜찮/, /^괜찮/,
  /^모름/, /^몰라/, /^모르겠/, /^모른다/, /^잘\s*모르/, /^글쎄/,
  /모른다고/, /모르겠다고/, /몰라요/, /모릅니다/,
  /^패스/, /^넘어/, /^넘겨/, /^다음/, /^스킵/, /^skip/i, /^pass/i, /^next/i,
  /^추천해/, /^보여/, /^결과/, /^바로/,
  /^\d+\s*(mm|밀리|파이)/, /^\d+날/, /^\d+\s*날/,
  /^그게\s*뭐/, /^그건\s*뭐/, /^이게\s*뭐/, /^뭐야\s*그/, /^그거\s*뭐/,
  /^차이.*뭐/, /^뭐가\s*다/, /^뭐가\s*좋/, /^어떤\s*게\s*좋/,
  /이미.*했/, /이미.*말했/, /이미.*입력/, /아까.*했/, /아까.*말했/,
  /했잖아/, /했잔아/, /말했잖아/, /말했잔아/, /입력했/,
]

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
  /뭐야\??$|뭔가요\??$|뭔데\??$|뭐에요\??$/,
  /무슨.*뜻|무슨.*의미/,
  /왜.*이렇게|왜.*이런|왜.*나와|왜.*나오/,
  /어떻게.*봐|어떻게.*읽|어떻게.*해석/,
  /정확.*매칭|근사.*매칭|근사.*후보/,
  /없음.*뭐|없음.*뜻|없음.*의미/,
]

export function analyzeInquiry(message: string): InquiryAnalysis {
  const clean = message.trim()
  const lower = clean.toLowerCase()

  if (!clean) {
    return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
      "빈 입력", { ambiguityLevel: "high", seriousness: "nonsense" })
  }

  if (clean.length <= 2 && !/^\d+$/.test(clean)) {
    if (NONSENSE_PATTERNS.some(pattern => pattern.test(clean))) {
      return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
        "초단문 무의미 입력", { ambiguityLevel: "high", seriousness: "nonsense" })
    }
  }

  if (NONSENSE_PATTERNS.some(pattern => pattern.test(clean))) {
    return buildResult("noise", "off_domain", "nonsense", "not_recoverable", "hard_redirect",
      "무의미 패턴 매칭", { ambiguityLevel: "high", seriousness: "nonsense" })
  }

  if (GREETING_PATTERNS.some(pattern => pattern.test(lower))) {
    return buildResult("weak", "adjacent", "smalltalk", "not_recoverable", "answer_general",
      "인사/잡담 패턴", { ambiguityLevel: "low", seriousness: "genuine" })
  }

  if (NARROWING_RESPONSE_PATTERNS.some(pattern => pattern.test(lower))) {
    return buildResult("moderate", "on_domain", "command", "immediate", "proceed_retrieval",
      "축소 대화 응답 (skip/값 입력)", { ambiguityLevel: "low", seriousness: "genuine", extractedKeywordCount: 0 })
  }

  if (APP_QUESTION_PATTERNS.some(pattern => pattern.test(lower))) {
    return buildResult("moderate", "adjacent", "question", "immediate", "answer_general",
      "앱/UI 관련 질문", { ambiguityLevel: "low", seriousness: "genuine", extractedKeywordCount: 0 })
  }

  const knowledgeQuestionPatterns = [
    /차이.*뭐|차이점|비교.*해|비교.*줘|뭐가.*다른/,
    /주의.*사항|주의.*점|주의.*해야/,
    /장단점|장점.*단점|좋은.*점|나쁜.*점/,
    /뭐야\??$|뭔가요\??$|뭔데\??$|뭐에요\??$|뭐임\??$/,
    /알려.*줘|설명.*해|가르쳐/,
    /어떤.*좋|뭐가.*좋|뭘.*써야|언제.*쓰|왜.*쓰/,
    /특징|원리|방법|팁|노하우/,
  ]
  const isKnowledgeQuestion = knowledgeQuestionPatterns.some(pattern => pattern.test(lower))
  const hasCoatingOrMaterialKw =
    [...COATING_KEYWORDS].some(keyword => lower.includes(keyword)) ||
    [...MATERIAL_KEYWORDS].some(keyword => lower.includes(keyword))
  if (isKnowledgeQuestion && hasCoatingOrMaterialKw) {
    return buildResult("moderate", "on_domain", "question", "immediate", "answer_general",
      "도메인 지식 질문 (코팅/소재)", { ambiguityLevel: "low", seriousness: "genuine", extractedKeywordCount: 0 })
  }

  if (SMALLTALK_PATTERNS.some(pattern => pattern.test(lower))) {
    return buildResult("weak", "off_domain", "smalltalk", "not_recoverable", "answer_general",
      "잡담 패턴", { ambiguityLevel: "low", seriousness: "genuine" })
  }

  const hasOffDomain = [...OFF_DOMAIN_KEYWORDS].some(keyword => lower.includes(keyword))
  if (hasOffDomain && !hasDomainKeywords(lower)) {
    return buildResult("weak", "off_domain", "question", "not_recoverable", "answer_general",
      "범위 밖 질문 — LLM이 유연하게 대응", { ambiguityLevel: "low", seriousness: "genuine" })
  }

  const hasGeneralKw = [...GENERAL_KNOWLEDGE_KEYWORDS].some(keyword => lower.includes(keyword))
  const hasAnyDomainKw = hasDomainKeywords(lower)
  if (hasGeneralKw && (hasAnyDomainKw || lower.length >= 8)) {
    return buildResult("moderate", "on_domain", "question", "immediate", "answer_general",
      "일반 기술 지식 질문", { ambiguityLevel: "low", seriousness: "genuine", extractedKeywordCount: 0 })
  }

  const hasToolKw = [...TOOL_KEYWORDS].some(keyword => lower.includes(keyword))
  const hasMaterialKw = [...MATERIAL_KEYWORDS].some(keyword => lower.includes(keyword))
  const hasDimKw = DIMENSION_PATTERNS.some(pattern => pattern.test(lower))
  const hasOpKw = [...OPERATION_KEYWORDS].some(keyword => lower.includes(keyword))
  const hasProductCode = PRODUCT_CODE_PATTERNS.some(pattern => pattern.test(clean))
  const hasCoatingKw = [...COATING_KEYWORDS].some(keyword => lower.includes(keyword))
  const hasRecommendSignal = [...RECOMMENDATION_SIGNALS].some(keyword => lower.includes(keyword))

  const kwCount = [hasToolKw, hasMaterialKw, hasDimKw, hasOpKw, hasProductCode, hasCoatingKw].filter(Boolean).length
  const inputForm = detectInputForm(clean, lower)

  if (kwCount >= 3 || (hasProductCode && kwCount >= 1)) {
    return buildResult("strong", "on_domain", inputForm, "immediate", "proceed_retrieval",
      `강신호: ${kwCount}개 도메인 키워드`, {
        hasToolKeyword: hasToolKw,
        hasMaterialKeyword: hasMaterialKw,
        hasDimensionKeyword: hasDimKw,
        hasOperationKeyword: hasOpKw,
        hasProductCode,
        extractedKeywordCount: kwCount,
        ambiguityLevel: "low",
        seriousness: "genuine",
      })
  }

  if (kwCount >= 1) {
    const recoverability = kwCount === 2 ? "one_question" as const : "two_questions" as const
    return buildResult("moderate", "on_domain", inputForm, recoverability, "proceed_retrieval",
      `중신호: ${kwCount}개 도메인 키워드`, {
        hasToolKeyword: hasToolKw,
        hasMaterialKeyword: hasMaterialKw,
        hasDimensionKeyword: hasDimKw,
        hasOperationKeyword: hasOpKw,
        hasProductCode,
        extractedKeywordCount: kwCount,
        ambiguityLevel: kwCount === 1 ? "high" : "medium",
        seriousness: "genuine",
      })
  }

  if (hasRecommendSignal) {
    return buildResult("weak", "adjacent", inputForm, "two_questions", "ask_clarification",
      "추천 의도는 있으나 도메인 키워드 부재", {
        extractedKeywordCount: 0,
        ambiguityLevel: "high",
        seriousness: "genuine",
      })
  }

  if (/^\d+(\.\d+)?$/.test(clean)) {
    return buildResult("moderate", "on_domain", "single_word", "one_question", "proceed_retrieval",
      "숫자만 입력 — 직경으로 추정", {
        hasDimensionKeyword: true,
        extractedKeywordCount: 1,
        ambiguityLevel: "medium",
        seriousness: "genuine",
      })
  }

  return buildResult("weak", "off_domain", inputForm, "not_recoverable", "answer_general",
    "도메인 관련 키워드 미감지 — LLM 대응", { ambiguityLevel: "high", seriousness: "genuine" })
}

function hasDomainKeywords(lower: string): boolean {
  return [...TOOL_KEYWORDS].some(keyword => lower.includes(keyword))
    || [...MATERIAL_KEYWORDS].some(keyword => lower.includes(keyword))
    || [...OPERATION_KEYWORDS].some(keyword => lower.includes(keyword))
    || [...COATING_KEYWORDS].some(keyword => lower.includes(keyword))
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
    case "answer_general":
      return {
        text: "",
        chips: [],
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
