/**
 * Unified Haiku Judgment — 1번의 Haiku 호출로 10가지를 동시에 판단.
 *
 * 기존 하드코딩(regex 300+개) 판단을 Haiku 시맨틱 이해로 대체:
 * 1. userState: 유저 인지 상태
 * 2. messageKind: 메시지 유형 (인용/메타피드백/직접명령)
 * 3. frameRelation: 이전 질문과의 관계
 * 4. intentShift: 의도 변화
 * 5. domainRelevance: 도메인 관련성
 * 6. intentAction: 추천 흐름 내 액션 (선택/비교/설명/리셋 등)
 * 7. questionShape: 시스템 질문 형태 감지
 * 8. extractedAnswer: 유저 답변에서 추출한 값
 * 9. signalStrength: 절삭공구 관련 신호 강도
 * 10. isQuotedText: 이전 응답 인용 여부
 *
 * 성능: Haiku 1회 호출 (~200ms), 다른 연산과 병렬 실행
 * 안전: Haiku 실패 → 기존 하드코딩 fallback
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

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
}

const JUDGMENT_SYSTEM = "YG-1 절삭공구 추천 챗봇 의도 분석기. JSON만 반환."

function buildJudgmentPrompt(input: UnifiedJudgmentInput): string {
  const chips = input.displayedChips.length > 0
    ? input.displayedChips.slice(0, 6).join(", ")
    : "없음"

  return `사용자: "${input.userMessage}"
시스템응답: "${(input.assistantText ?? "").slice(0, 120)}"
모드: ${input.currentMode ?? "?"}, 필드: ${input.pendingField ?? "없음"}, 후보: ${input.candidateCount}, 필터: ${input.filterCount}, 추천완료: ${input.hasRecommendation ? "Y" : "N"}
칩: ${chips}

10가지 판단:
1. userState: clear|confused|uncertain|wants_explanation|wants_delegation|wants_skip|wants_revision
2. confusedAbout: 혼란 대상(없으면 null)
3. messageKind: direct_command|meta_feedback|quoted_text|clarification_request|general_chat
4. frameRelation: direct_answer|confusion|challenge|revise|compare_request|detail_request|followup_on_result|meta_feedback|restart|general_chat
5. intentShift: none|refine_existing|replace_constraint|branch_exploration|compare_request|explain_request|reset
6. domainRelevance: product_query|company_query|cutting_condition|competitor|greeting|off_topic|narrowing_response
7. intentAction: select_option(칩/값 선택)|ask_recommendation(추천 요청)|compare(비교)|explain(설명요청)|reset_session(처음부터)|refine_condition(조건변경)|skip_field(건너뛰기)|undo(되돌리기)|continue(진행)|off_topic(무관)
8. questionShape: 시스템응답에 질문이 있으면 형태 — binary_yes_no|binary_proceed|explicit_choice|constrained_options|open_ended|none
9. extractedAnswer: 사용자가 선택한 값(칩 텍스트/값) 추출, 없으면 null
10. signalStrength: 절삭공구 관련 신호 — strong(소재+직경 등 2+)|moderate(키워드 1개)|weak(간접)|none(무관)
11. isQuotedText: 사용자가 이전 시스템 응답을 인용/언급하는지 (true/false)

JSON: {"userState":"","confusedAbout":null,"messageKind":"","frameRelation":"","intentShift":"","domainRelevance":"","intentAction":"","questionShape":"","extractedAnswer":null,"signalStrength":"","isQuotedText":false}`
}

const DEFAULT_JUDGMENT: UnifiedJudgment = {
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
  confidence: 0,
  fromLLM: false,
}

/** 캐시: 같은 턴에서 중복 호출 방지 */
let lastInput: string | null = null
let lastResult: UnifiedJudgment = DEFAULT_JUDGMENT

export async function performUnifiedJudgment(
  input: UnifiedJudgmentInput,
  provider: LLMProvider
): Promise<UnifiedJudgment> {
  // 같은 유저 메시지면 캐시 반환 (같은 턴 내 중복 호출 방지)
  const cacheKey = input.userMessage
  if (cacheKey === lastInput && lastResult.fromLLM) return lastResult

  if (!provider.available()) {
    return DEFAULT_JUDGMENT
  }

  try {
    const prompt = buildJudgmentPrompt(input)
    const raw = await provider.complete(
      JUDGMENT_SYSTEM,
      [{ role: "user", content: prompt }],
      120,
      "haiku"
    )

    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    const p = JSON.parse(cleaned)

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
      confidence: 1,
      fromLLM: true,
    }

    console.log(`[unified-judgment] "${input.userMessage.slice(0, 25)}" → action=${result.intentAction} domain=${result.domainRelevance} state=${result.userState} signal=${result.signalStrength}`)

    lastInput = cacheKey
    lastResult = result
    return result
  } catch (error) {
    console.warn("[unified-judgment] Haiku failed:", error)
    return DEFAULT_JUDGMENT
  }
}

/** 캐시 초기화 (새 턴 시작 시) */
export function resetJudgmentCache(): void {
  lastInput = null
  lastResult = DEFAULT_JUDGMENT
}
