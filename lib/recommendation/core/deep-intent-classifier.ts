/**
 * Deep Intent Classifier — LLM 기반 복잡성 판단.
 *
 * 기존: complexity-router.ts 의 DEEP_*_RE 10개 regex 로 deep 승격 여부 판정.
 * 지금: 이 함수가 LLM 에게 candidateCount + appliedFilterCount 만 컨텍스트로
 *       주고 isDeep 여부를 받아온다. regex 누락·오탐 둘 다 제거.
 *
 * 호출 시점: prod entry(stream route / serve-engine-runtime/response/assist)
 * 에서 assessComplexity 호출 전에 한 번. 결과는 llmHint 로 전달.
 *
 * 실패/미설정 환경에서는 {isDeep:false, reason:"llm_unavailable"} 반환 —
 * assessComplexity 는 llmHint 없이도 light/normal 판정은 sync 로 가능.
 */

import { executeLlm } from "@/lib/llm/llm-executor"

export interface DeepIntentHint {
  isDeep: boolean
  reason: string
}

export interface ClassifyDeepIntentInput {
  message: string
  candidateCount: number
  appliedFilterCount: number
}

const SYSTEM_PROMPT = `절삭공구 상담에서 유저 메시지가 deep reasoning 이 필요한지 판단하라.
deep=true 케이스: 부정/제외, 비교·대체, 맥락 참조(그거/아까), 트러블슈팅(채터/수명), 경쟁사 제품, 불확실성+도메인, 산업 도메인+공구 맥락, 모호한 일반 개념 질문.
deep=false 케이스: 단순 필터 값, 단답, 구체 스펙 요청, 잡담.
JSON 으로만: {"deep": true|false, "reason": "<negation|comparison|context|troubleshoot|competitor|uncertainty|domain|generic|none>"}`

export async function classifyDeepIntentLLM(
  input: ClassifyDeepIntentInput,
): Promise<DeepIntentHint> {
  const text = input.message.trim()
  if (!text) return { isDeep: false, reason: "empty" }

  const userPrompt = `메시지: "${text}"
컨텍스트: 후보 ${input.candidateCount}개, 적용 필터 ${input.appliedFilterCount}개`

  try {
    const result = await executeLlm({
      agentName: "intent-classifier",
      reasoningTier: "light",
      modelTier: "mini",
      systemPrompt: SYSTEM_PROMPT,
      userInput: userPrompt,
      maxTokens: 80,
    })
    const parsed = parseClassifierOutput(result.text)
    if (!parsed) return { isDeep: false, reason: "llm_parse_failed" }
    return parsed
  } catch {
    return { isDeep: false, reason: "llm_unavailable" }
  }
}

function parseClassifierOutput(raw: string): DeepIntentHint | null {
  if (!raw) return null
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const obj = JSON.parse(jsonMatch[0]) as { deep?: unknown; reason?: unknown }
    if (typeof obj.deep !== "boolean") return null
    const reason = typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim() : "none"
    return { isDeep: obj.deep, reason }
  } catch {
    return null
  }
}
