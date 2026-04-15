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
    ? input.displayedChips.slice(0, 6).join(", ")
    : "없음"

  const prevAction = input.previousTurnAction ?? "none"

  return `사용자: "${input.userMessage}"
시스템응답: "${(input.assistantText ?? "").slice(0, 120)}"
모드: ${input.currentMode ?? "?"}, 필드: ${input.pendingField ?? "없음"}, 후보: ${input.candidateCount}, 필터: ${input.filterCount}, 추천완료: ${input.hasRecommendation ? "Y" : "N"}
이전턴action: ${prevAction}  ← 이전 턴이 설명(answer_general/explain_product)이면 짧은 후속질문("4날은?")도 보통 설명 추가요청, 필터가 아님
칩: ${chips}

10가지 판단:
1. userState: clear|confused|uncertain|wants_explanation|wants_delegation|wants_skip|wants_revision
2. confusedAbout: 혼란 대상(없으면 null)
3. messageKind: direct_command|meta_feedback|quoted_text|clarification_request|general_chat
4. frameRelation: direct_answer|confusion|challenge|revise|compare_request|detail_request|followup_on_result|meta_feedback|restart|general_chat
5. intentShift: none|refine_existing|replace_constraint|branch_exploration|compare_request|explain_request|reset
6. domainRelevance: product_query|company_query|cutting_condition|competitor|greeting|off_topic|narrowing_response
   - 소재 키워드(SUS, SCM, S45C, 알루미늄, 스테인리스, 티타늄 등) + 품질/적합 표현("괜찮은", "적합한", "좋은 거", "추천", "어떤 거") → product_query (off_topic 아님!)
7. intentAction: select_option(칩/값 선택)|ask_recommendation(추천 요청)|compare(비교+설명 둘 다)|explain(설명요청)|reset_session(처음부터)|refine_condition(조건변경)|skip_field(건너뛰기)|undo(되돌리기)|continue(진행)|off_topic(무관)
   - [도메인 값 해석 원칙] 사용자가 도메인 값(날수, 직경, 코팅, 소재 등)을 언급했을 때 의도 판단 기준:
     · 질문/탐색/궁금 톤이면 → explain. 이 판정은 다른 어떤 힌트보다 우선한다.
     · 그 값으로 제품을 찾거나 조건을 걸려는 명시적 지시 톤이면 → ask_recommendation.
     · 톤이 정말로 중립이고 값만 단독으로 던져졌을 때만 맥락(직전 턴)을 참고. 세션 첫 턴이라도 자동으로 ask_recommendation 으로 넘기지 말 것 — 톤이 우선.
     값 자체가 구체적이라고 해서 자동으로 필터로 판단하지 마라. 톤이 근거다.
   - "차이점", "비교", "A와 B", "A랑 B", "vs" → intentAction: "compare" (narrowing 중이어도). compare는 비교표+설명 둘 다 제공
   - 시리즈/브랜드 이름이 2개 이상 언급되면 → intentAction: "compare"
   - "변경", "바꾸고", "바꿔", "틀렸", "실수", "다시", "고치" + 필드명(날수/직경/코팅/형상/소재) → intentAction: "refine_condition" (select_option 아님!)
   - "N날로 해줘", "코팅 바꿔줘" 같은 직접 값 지정도 refine_condition
   - "재고 있는 것만", "재고 확인", "즉시 구매", "재고 된 거만" → domainRelevance: "product_query", intentAction: "select_option" (재고 필터링)
   - "쉽게 설명해줘", "쉽게 알려줘", "설명해줘", "뭐가 다른거야", "어떤 차이" → intentAction: "explain" (현재 표시된 선택지/시리즈 설명)
   - [탐색형 질문 = 필터 아님, 무조건 explain] 아래 패턴은 "옵션 목록/종류를 알려달라"는 정보 요청이므로 절대 ask_recommendation 으로 분류하지 말 것:
     · "뭐가 있어?", "뭐가 있나?", "뭐뭐 있어?"
     · "종류가 뭐야?", "종류(가/는) 어떻게 돼?"
     · "어떤 게 있어?", "어떤 것이 있나?", "어떤 (형상/코팅/브랜드/시리즈/타입) 있어?"
     · "있나요?", "있어요?", "몇 가지야?", "몇 개 있어?"
     · 소재/카테고리 + "브랜드/시리즈/종류/타입" + "?" (예: "구리 브랜드 뭐가 있어?", "알루미늄용 시리즈 어떤 거 있어?")
     → 전부 intentAction: "explain", domainRelevance: "product_query" (brand/series 언급돼도 필터로 잡지 말 것)
   - "A 말고 B로", "A 대신 B", "B로 바꿔", "B로 교체" → intentAction: "refine_condition", intentShift: "replace_constraint" (기존 A 제거 → B 적용)
   - 공구 트러블 증상 ("수명 짧", "파손", "치핑", "마모", "진동", "채터", "버", "깨짐") → intentAction: "explain" (원인/해결 설명 요청, 필터링 아님)
   - 소재 키워드 + 품질/적합 표현("괜찮은 거", "적합한 거", "좋은 거", "어떤 게 좋") → intentAction: "ask_recommendation", domainRelevance: "product_query" (off_topic/company_query 아님!)
8. questionShape: 시스템응답에 질문이 있으면 형태 — binary_yes_no|binary_proceed|explicit_choice|constrained_options|open_ended|none
9. extractedAnswer: 사용자가 선택한 값(칩 텍스트/값) 추출, 없으면 null
   - 가공방식 키워드 매핑: "램핑"→Radius, "슬롯"→Square, "프로파일"→Ball, "정삭"→Finishing, "황삭"→Roughing
   - "엔드밀" 언급 시 extractedAnswer에 "엔드밀" 포함 (탭/드릴 제외 의도)
10. signalStrength: 절삭공구 관련 신호 — strong(소재+직경 등 2+)|moderate(키워드 1개)|weak(간접)|none(무관)
11. isQuotedText: 사용자가 이전 시스템 응답을 인용/언급하는지 (true/false)

JSON: {"userState":"","confusedAbout":null,"messageKind":"","frameRelation":"","intentShift":"","domainRelevance":"","intentAction":"","questionShape":"","extractedAnswer":null,"signalStrength":"","isQuotedText":false}`
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
      2500,
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
      confidence: 1,
      fromLLM: true,
    }

    console.log(`[unified-judgment] "${input.userMessage.slice(0, 25)}" → action=${result.intentAction} domain=${result.domainRelevance} state=${result.userState} signal=${result.signalStrength}`)
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
