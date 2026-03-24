/**
 * Unified Haiku Judgment — 1번의 Haiku 호출로 5가지를 동시에 판단.
 *
 * 기존 하드코딩(regex/keyword) 판단을 Haiku 시맨틱 이해로 대체:
 * 1. userState: 유저 인지 상태 (confused, clear, wants_delegation 등)
 * 2. messageKind: 메시지 유형 (direct_command, meta_feedback, quoted 등)
 * 3. frameRelation: 응답 관계 (direct_answer, confusion, challenge 등)
 * 4. intentShift: 의도 변화 (none, refine, replace, branch, reset 등)
 * 5. domainRelevance: 도메인 관련성 (product_query, company_query, off_topic 등)
 *
 * Haiku 실패 시 → 기존 하드코딩 fallback (graceful degradation)
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

export interface UnifiedJudgment {
  userState: "clear" | "confused" | "uncertain" | "wants_explanation" | "wants_delegation" | "wants_skip" | "wants_revision"
  confusedAbout: string | null
  messageKind: "direct_command" | "meta_feedback" | "quoted_text" | "clarification_request" | "general_chat"
  frameRelation: "direct_answer" | "confusion" | "challenge" | "revise" | "compare_request" | "detail_request" | "followup_on_result" | "meta_feedback" | "restart" | "general_chat"
  intentShift: "none" | "refine_existing" | "replace_constraint" | "branch_exploration" | "compare_request" | "explain_request" | "reset"
  domainRelevance: "product_query" | "company_query" | "cutting_condition" | "competitor" | "greeting" | "off_topic" | "narrowing_response"
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

const JUDGMENT_SYSTEM = `당신은 YG-1 절삭공구 추천 챗봇의 의도 분석기입니다.
사용자 메시지를 분석하여 JSON으로 판단 결과를 반환하세요.`

function buildJudgmentPrompt(input: UnifiedJudgmentInput): string {
  const ctx = [
    `모드: ${input.currentMode ?? "unknown"}`,
    input.pendingField ? `질문 중인 필드: ${input.pendingField}` : null,
    `후보: ${input.candidateCount}개, 필터: ${input.filterCount}개`,
    input.hasRecommendation ? "추천 결과 있음" : null,
    input.displayedChips.length > 0 ? `표시 칩: ${input.displayedChips.slice(0, 5).join(", ")}` : null,
    input.assistantText ? `시스템 마지막 응답: "${input.assistantText.slice(0, 100)}"` : null,
  ].filter(Boolean).join("\n")

  return `사용자 메시지: "${input.userMessage}"

현재 상황:
${ctx}

아래 5가지를 판단하세요:

1. userState: 유저 인지 상태
   clear(명확) | confused(혼란) | uncertain(불확실) | wants_explanation(설명 원함) | wants_delegation(알아서 해줘) | wants_skip(건너뛰기) | wants_revision(수정 원함)

2. messageKind: 메시지 유형
   direct_command(직접 명령/답변) | meta_feedback(시스템에 대한 피드백) | quoted_text(이전 답변 인용) | clarification_request(명확화 요청) | general_chat(일반 대화)

3. frameRelation: 이전 질문과의 관계
   direct_answer(직접 답변) | confusion(혼란 표현) | challenge(반박) | revise(수정 요청) | compare_request(비교 요청) | detail_request(상세 요청) | followup_on_result(결과 후속) | meta_feedback(메타 피드백) | restart(처음부터) | general_chat(관련 없는 대화)

4. intentShift: 의도 변화
   none(변화 없음) | refine_existing(기존 조건 세분화) | replace_constraint(조건 교체) | branch_exploration(새 방향 탐색) | compare_request(비교) | explain_request(설명 요청) | reset(초기화)

5. domainRelevance: 도메인 관련성
   product_query(제품 관련) | company_query(회사 정보) | cutting_condition(절삭조건) | competitor(경쟁사) | greeting(인사) | off_topic(무관) | narrowing_response(좁히기 응답)

JSON만: {"userState":"...","confusedAbout":null,"messageKind":"...","frameRelation":"...","intentShift":"...","domainRelevance":"..."}`
}

const DEFAULT_JUDGMENT: UnifiedJudgment = {
  userState: "clear",
  confusedAbout: null,
  messageKind: "direct_command",
  frameRelation: "direct_answer",
  intentShift: "none",
  domainRelevance: "narrowing_response",
  confidence: 0,
  fromLLM: false,
}

export async function performUnifiedJudgment(
  input: UnifiedJudgmentInput,
  provider: LLMProvider
): Promise<UnifiedJudgment> {
  if (!provider.available()) {
    return DEFAULT_JUDGMENT
  }

  try {
    const prompt = buildJudgmentPrompt(input)
    const raw = await provider.complete(
      JUDGMENT_SYSTEM,
      [{ role: "user", content: prompt }],
      150,
      "haiku"
    )

    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    const parsed = JSON.parse(cleaned)

    const result: UnifiedJudgment = {
      userState: parsed.userState ?? "clear",
      confusedAbout: parsed.confusedAbout ?? null,
      messageKind: parsed.messageKind ?? "direct_command",
      frameRelation: parsed.frameRelation ?? "direct_answer",
      intentShift: parsed.intentShift ?? "none",
      domainRelevance: parsed.domainRelevance ?? "narrowing_response",
      confidence: 1,
      fromLLM: true,
    }

    console.log(`[unified-judgment] ${input.userMessage.slice(0, 30)} → state=${result.userState}, kind=${result.messageKind}, relation=${result.frameRelation}, intent=${result.intentShift}, domain=${result.domainRelevance}`)
    return result
  } catch (error) {
    console.warn("[unified-judgment] Haiku failed, using default:", error)
    return DEFAULT_JUDGMENT
  }
}
