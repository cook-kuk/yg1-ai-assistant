/**
 * Unified Judgment — 1번의 LLM 호출로 12가지 의도 속성을 동시에 판단.
 * 톤·맥락 기반 의미 판정. 실패 시 DEFAULT_JUDGMENT 로 안전 fallback.
 */

import { JUDGMENT_CONFIG } from "@/lib/recommendation/infrastructure/config/runtime-config"
import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"

const UNIFIED_JUDGMENT_MODEL = resolveModel("sonnet", "unified-judgment")

export interface UnifiedJudgment {
  // 기존 5가지
  userState: "clear" | "confused" | "uncertain" | "wants_explanation" | "wants_delegation" | "wants_skip" | "wants_revision"
  confusedAbout: string | null
  messageKind: "direct_command" | "meta_feedback" | "quoted_text" | "clarification_request" | "general_chat"
  frameRelation: "direct_answer" | "confusion" | "challenge" | "revise" | "compare_request" | "detail_request" | "followup_on_result" | "meta_feedback" | "restart" | "general_chat"
  intentShift: "none" | "refine_existing" | "replace_constraint" | "branch_exploration" | "compare_request" | "explain_request" | "reset"
  domainRelevance: "product_query" | "company_query" | "cutting_condition" | "competitor" | "greeting" | "off_topic" | "narrowing_response"

  // 새로 추가 5가지
  /** intent-classifier 대체: 추천 흐름 내 구체적 액션 */
  intentAction: "select_option" | "ask_recommendation" | "compare" | "explain" | "reset_session" | "refine_condition" | "skip_field" | "undo" | "continue" | "off_topic"
  /** pending-question-detector 대체: 시스템 응답의 질문 형태 */
  questionShape: "binary_yes_no" | "binary_proceed" | "explicit_choice" | "constrained_options" | "open_ended" | "none"
  /** 유저 답변에서 추출한 값 (칩 매칭용) */
  extractedAnswer: string | null
  /** inquiry-analyzer 대체: 절삭공구 신호 강도 */
  signalStrength: "strong" | "moderate" | "weak" | "none"
  /** meta-message-detector 대체: 인용 여부 */
  isQuotedText: boolean
  /** 사용자가 명시적으로 제거 요청한 기존 필터 필드들. 예: "4날 필터 날려줘" → ["fluteCount"] */
  fieldsToRemove: string[]

  confidence: number
  fromLLM: boolean
}

export interface UnifiedJudgmentInput {
  userMessage: string
  assistantText: string | null
  pendingField: string | null
  currentMode: string | null
  displayedChips: string[]
  filterCount: number
  candidateCount: number
  hasRecommendation: boolean
  /** 이전 턴 시스템 action (맥락판단용, candidateCount와 같은 패턴) */
  previousTurnAction?: string | null
}

const JUDGMENT_SYSTEM = "YG-1 절삭공구 추천 챗봇 의도 분석기. JSON만 반환."

export function stripJsonCodeFence(raw: string): string {
  return raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()
}

export function extractFirstJsonObject(raw: string): string | null {
  const source = stripJsonCodeFence(raw)
  const start = source.indexOf("{")
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < source.length; i += 1) {
    const char = source[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }
    if (char === "{") {
      depth += 1
      continue
    }
    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, i + 1)
      }
    }
  }

  return null
}

export function parseJudgmentJson(raw: string): Record<string, unknown> {
  const cleaned = stripJsonCodeFence(raw)

  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const extracted = extractFirstJsonObject(cleaned)
    if (!extracted) {
      throw new Error("No JSON object found in unified-judgment response")
    }
    return JSON.parse(extracted) as Record<string, unknown>
  }
}

export function buildJudgmentPrompt(input: UnifiedJudgmentInput): string {
  const chips = input.displayedChips.length > 0
    ? input.displayedChips.slice(0, JUDGMENT_CONFIG.chipsPreviewMax).join(", ")
    : "없음"

  const assistantSnippet = (input.assistantText ?? "").slice(0, JUDGMENT_CONFIG.assistantSnippetMaxChars)
  const prevAction = input.previousTurnAction ?? "none"

  return `사용자: "${input.userMessage}"
시스템응답: "${assistantSnippet}"
모드: ${input.currentMode ?? "?"} | 필드: ${input.pendingField ?? "없음"} | 후보: ${input.candidateCount} | 필터: ${input.filterCount} | 추천완료: ${input.hasRecommendation ? "Y" : "N"} | 이전턴: ${prevAction}
칩: ${chips}

[판단 원칙 — 톤·맥락으로 판단, 키워드 매칭 아님]
- 도메인 값(날수·직경·코팅·소재 등)이 질문/탐색 톤이면 explain 이 최우선. 첫 턴이라도 톤이 우선이다.
  · 한국어 의문 조사(은/는/이/가 + 물음표) 또는 의문 어미(~야?/~이야?/~인가?/~니?/~어?)가 붙은 도메인 값 단독 발화는 **설명 요청**이다 (예: "4날은?", "알루미늄은?", "AlTiN이야?"). 절대 필터/ask_recommendation 로 판정하지 말 것.
- 지시 톤으로 값이 주어지면 ask_recommendation / refine_condition.
- 이전 턴이 설명이었고 짧은 후속질문이 오면 보통 설명 추가 요청이다.
- 옵션/종류/목록을 묻는 탐색형 질문은 브랜드·시리즈가 섞여 있어도 explain(product_query).
- 2개 이상 시리즈/브랜드 병치 또는 비교 표현이면 compare.
- 기존 조건을 다른 값으로 교체하는 표현이면 refine_condition + replace_constraint.
- 공구 트러블 증상 서술은 원인·해결 설명 요청(explain).
- 소재/품질/적합 표현이 섞이면 product_query 이다(off_topic/company_query 아님).

[출력 필드]
1. userState: clear|confused|uncertain|wants_explanation|wants_delegation|wants_skip|wants_revision
2. confusedAbout: 혼란 대상(없으면 null)
3. messageKind: direct_command|meta_feedback|quoted_text|clarification_request|general_chat
4. frameRelation: direct_answer|confusion|challenge|revise|compare_request|detail_request|followup_on_result|meta_feedback|restart|general_chat
5. intentShift: none|refine_existing|replace_constraint|branch_exploration|compare_request|explain_request|reset
6. domainRelevance: product_query|company_query|cutting_condition|competitor|greeting|off_topic|narrowing_response
7. intentAction: select_option|ask_recommendation|compare|explain|reset_session|refine_condition|skip_field|undo|continue|off_topic
8. questionShape: binary_yes_no|binary_proceed|explicit_choice|constrained_options|open_ended|none (시스템응답 기준)
9. extractedAnswer: 사용자가 선택/지정한 값(없으면 null)
10. signalStrength: strong|moderate|weak|none (절삭공구 관련 신호)
11. isQuotedText: 이전 시스템 응답 인용 여부(boolean)
12. fieldsToRemove: 명시적으로 제거/해제 요청된 기존 필터의 표준 필드명 배열. 전부 제거면 ["all"]. 값 변경은 refine_condition 으로 처리하고 빈 배열로 둔다.
    (표준 필드명: fluteCount, diameterMm, workPieceName, toolSubtype, coating, brand, machiningCategory, stockStatus, totalStock, lengthOfCutMm 등)

JSON만: {"userState":"","confusedAbout":null,"messageKind":"","frameRelation":"","intentShift":"","domainRelevance":"","intentAction":"","questionShape":"","extractedAnswer":null,"signalStrength":"","isQuotedText":false,"fieldsToRemove":[]}`
}

export const DEFAULT_JUDGMENT: UnifiedJudgment = {
  userState: "clear",
  confusedAbout: null,
  messageKind: "direct_command",
  frameRelation: "direct_answer",
  intentShift: "none",
  domainRelevance: "narrowing_response",
  intentAction: "continue",
  questionShape: "none",
  extractedAnswer: null,
  signalStrength: "none",
  isQuotedText: false,
  fieldsToRemove: [],
  confidence: 0,
  fromLLM: false,
}

/**
 * 짧은 단독 발화 + 한국어 의문 조사/어미 = 설명 요청.
 *   "4날은?" / "알루미늄은?" / "AlTiN이야?" / "4날 뭐야?" / "4날이 뭐?"
 * 매칭 조건:
 *   - 길이 ≤ 20자 (명령/지시 톤 거의 다 이보다 김)
 *   - 끝에 ? 있거나, 의문 어미 포함 (~야/이야/인가/니/어)
 *   - 조사(은/는/이/가/도/만) + ? 또는 의문 어미 앞 / 끝
 * 반환 true → judgment 를 강제로 explain 으로 override.
 */
export function isShortQuestionTone(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed || trimmed.length > 20) return false
  // 끝 물음표 + 조사 또는 끝 물음표 + 값
  if (/[은는이가도만]\s*\?$/.test(trimmed)) return true
  if (/[?？]$/.test(trimmed) && /[가-힣A-Za-z0-9]+\s*[은는이가도만]?\s*[?？]$/.test(trimmed)) {
    // 명령/지시 키워드 있으면 제외
    if (/(추천|보여|찾아|검색|필터|적용|줘|해줘|알려|말해)/u.test(trimmed)) return false
    return true
  }
  // 의문 어미: ~야?/이야?/인가?/~니?/~어?/뭐야?/뭐지?
  if (/(뭐(야|지|에요|예요)?|야|이야|인가|니|어|까)\s*[?？]?$/u.test(trimmed)
      && /[가-힣A-Za-z0-9]/.test(trimmed.charAt(0))) {
    if (/(추천|보여|찾아|검색|필터|적용|줘|해줘|알려|말해)/u.test(trimmed)) return false
    // 짧고 의문어미 붙은 케이스만
    if (trimmed.length <= 15) return true
  }
  return false
}

/** 캐시: 같은 턴에서 중복 호출 방지 */
let lastInput: string | null = null
let lastResult: UnifiedJudgment = DEFAULT_JUDGMENT

export async function performUnifiedJudgment(
  input: UnifiedJudgmentInput,
  provider: LLMProvider
): Promise<UnifiedJudgment> {
  traceRecommendation("context.performUnifiedJudgment:input", input)
  // 같은 유저 메시지 + 같은 이전턴action이면 캐시 반환 (같은 턴 내 중복 호출 방지)
  const cacheKey = `${input.userMessage}||${input.previousTurnAction ?? ""}`
  if (cacheKey === lastInput && lastResult.fromLLM) return lastResult

  if (!provider.available()) {
    return DEFAULT_JUDGMENT
  }

  let rawResponse: string | null = null

  try {
    const prompt = buildJudgmentPrompt(input)
    rawResponse = await provider.complete(
      JUDGMENT_SYSTEM,
      [{ role: "user", content: prompt }],
      JUDGMENT_CONFIG.maxTokens,
      UNIFIED_JUDGMENT_MODEL,
      "unified-judgment"
    )

    const p = parseJudgmentJson(rawResponse) as Partial<UnifiedJudgment>

    const result: UnifiedJudgment = {
      userState: p.userState ?? "clear",
      confusedAbout: p.confusedAbout ?? null,
      messageKind: p.messageKind ?? "direct_command",
      frameRelation: p.frameRelation ?? "direct_answer",
      intentShift: p.intentShift ?? "none",
      domainRelevance: p.domainRelevance ?? "narrowing_response",
      intentAction: p.intentAction ?? "continue",
      questionShape: p.questionShape ?? "none",
      extractedAnswer: p.extractedAnswer ?? null,
      signalStrength: p.signalStrength ?? "none",
      isQuotedText: p.isQuotedText ?? false,
      fieldsToRemove: Array.isArray(p.fieldsToRemove)
        ? (p.fieldsToRemove as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      confidence: 1,
      fromLLM: true,
    }

    // ── 의문조사 safety net ─────────────────────────────────────
    // LLM 판정이 프롬프트 규칙(line 136)을 무시하고 "4날은?", "알루미늄은?"
    // 같은 단독 도메인 값 + 의문조사 발화를 refine_condition/ask_recommendation
    // 으로 분류하는 회귀를 deterministic 으로 교정. 짧은 발화 + 의문 종결에
    // 한정 → 정상 명령 톤은 건드리지 않는다.
    if (isShortQuestionTone(input.userMessage) && result.intentAction !== "explain") {
      console.log(`[unified-judgment] override: "${input.userMessage}" LLM=${result.intentAction} → explain (의문조사 safety net)`)
      result.intentAction = "explain"
      result.userState = "wants_explanation"
      result.intentShift = "explain_request"
      result.domainRelevance = result.domainRelevance === "off_topic" ? result.domainRelevance : "product_query"
    }

    console.log(`[unified-judgment] "${input.userMessage.slice(0, JUDGMENT_CONFIG.logSnippetMaxChars)}" → action=${result.intentAction} domain=${result.domainRelevance} state=${result.userState} signal=${result.signalStrength}`)
    traceRecommendation("context.performUnifiedJudgment:output", {
      input,
      result,
      rawResponse,
    })

    lastInput = cacheKey
    lastResult = result
    return result
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && /JSON/i.test(error.message))) {
      console.warn("[unified-judgment] Raw LLM response:", {
        userMessage: input.userMessage,
        assistantText: input.assistantText,
        pendingField: input.pendingField,
        currentMode: input.currentMode,
        rawResponse,
      })
    }
    console.warn("[unified-judgment] Haiku failed:", error)
    traceRecommendationError("context.performUnifiedJudgment:error", error, {
      input,
      rawResponse,
      fallback: DEFAULT_JUDGMENT,
    })
    return DEFAULT_JUDGMENT
  }
}

/** 캐시 초기화 (새 턴 시작 시) */
export function resetJudgmentCache(): void {
  lastInput = null
  lastResult = DEFAULT_JUDGMENT
}
