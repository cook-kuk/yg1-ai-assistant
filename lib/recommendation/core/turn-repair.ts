/**
 * Turn Repair — "그거 말고 더 큰 거", "아니야 소재를 말한 거야" 같은
 * 모호한 참조를 직전 대화 맥락으로 풀어서 구체적인 메시지로 교정.
 *
 * 트리거는 한국어 문법 패턴(regex 5종, 도메인 무관). 실제 해석은 haiku LLM.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter, NarrowingTurn } from "@/lib/types/exploration"

export interface RepairResult {
  clarifiedMessage: string
  wasRepaired: boolean
  repairExplanation: string | null
}

const NEEDS_REPAIR: RegExp[] = [
  /그거|그것|이거|아까\s*(?:그|거)|방금\s*(?:그|거)/u,
  /더\s*(?:큰|작은|긴|짧은|높은|낮은|많은|적은)/u,
  /좀\s*더|좀더|조금\s*더/u,
  /아니[야라요]|그게\s*아니/u,
  /말한\s*거|뜻한\s*거/u,
]

export function needsRepair(msg: string): boolean {
  return NEEDS_REPAIR.some(p => p.test(msg))
}

export async function repairMessage(
  msg: string,
  filters: AppliedFilter[],
  history: NarrowingTurn[],
  provider: LLMProvider,
): Promise<RepairResult> {
  if (!needsRepair(msg)) return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
  // 둘 다 비어있으면 해석할 맥락이 없음
  if ((!history || history.length === 0) && filters.length === 0) {
    return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
  }

  const recent = history.slice(-3).map((t, i) => ({
    turn: i + 1,
    userSaid: t.answer,
    filtersChanged: t.extractedFilters.map(f => `${f.field}: ${f.value}`),
  }))
  const state = filters.map(f => `${f.field}: ${f.value} (${f.op})`).join(", ")

  try {
    const raw = await provider.complete(
      `모호한 참조를 직전 대화 맥락으로 해석하세요.\n\n메시지: "${msg}"\n직전 대화: ${JSON.stringify(recent, null, 2)}\n현재 필터: ${state || "(없음)"}\n\n해석 원칙:\n- "그거 말고" → 직전에 적용한 필터를 제외/변경\n- "더 큰 거" → 가장 최근 숫자 필터를 증가(직경/길이/날수 등)\n- "아니야 X를 말한 거야" → X를 기준으로 재해석\n\n출력은 JSON 한 줄만:\n{"clarified":"구체화된 메시지","explanation":"이유 1문장"}`,
      [{ role: "user", content: "해석하세요." }],
      200,
      "haiku",
      "turn-repair",
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
    const p = JSON.parse(match[0])
    if (typeof p.clarified !== "string" || !p.clarified.trim()) {
      return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
    }
    console.log(`[turn-repair] "${msg}" → "${p.clarified}"`)
    return { clarifiedMessage: p.clarified, wasRepaired: true, repairExplanation: typeof p.explanation === "string" ? p.explanation : null }
  } catch (e) {
    console.warn("[turn-repair] failed:", (e as Error).message)
    return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
  }
}
