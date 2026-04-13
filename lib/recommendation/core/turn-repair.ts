/**
 * Turn repair rewrites ambiguous follow-up / correction messages into a more
 * explicit instruction before the main recommendation pipeline runs again.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter, NarrowingTurn } from "@/lib/types/exploration"

export interface RepairResult {
  clarifiedMessage: string
  wasRepaired: boolean
  repairExplanation: string | null
}

const NEEDS_REPAIR: RegExp[] = [
  /그거|그걸|이거|아까\s*(?:그\s*거|방금\s*(?:그\s*거)?)/u,
  /더\s*(?:큰|작은|긴|짧은|많은|적은)/u,
  /좀\s*더|조금\s*더/u,
  /아니[라]?|그게\s*아니/u,
  /말한\s*거|했던\s*거/u,
  /진짜\s*너\s*말\s*안\s*듣(?:는|네|는다)/u,
  /내\s*(?:말|뜻)은?\s*(?:그게\s*)?아니(?:라|고)?/u,
  /아니\s*내\s*(?:말|뜻)은?/u,
]

const REPAIR_ONLY_SIGNALS: RegExp[] = [
  /진짜\s*너\s*말\s*안\s*듣(?:는|네|는다)/u,
  /^(?:아니[,\s!]*)?내\s*(?:말|뜻)은?(?:\s*그게)?\s*아니(?:라|고)?[.!?~\sㅠㅜ]*$/u,
  /^그게\s*아니(?:라|고)?[.!?~\sㅠㅜ]*$/u,
  /^아니[,\s!]*다시[.!?~\sㅠㅜ]*$/u,
]

export function needsRepair(msg: string): boolean {
  return NEEDS_REPAIR.some(pattern => pattern.test(msg))
}

export function isRepairOnlySignal(msg: string): boolean {
  const trimmed = msg.trim()
  return REPAIR_ONLY_SIGNALS.some(pattern => pattern.test(trimmed))
}

export async function repairMessage(
  msg: string,
  filters: AppliedFilter[],
  history: NarrowingTurn[],
  provider: LLMProvider,
): Promise<RepairResult> {
  if (!needsRepair(msg)) return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
  if ((!history || history.length === 0) && filters.length === 0) {
    return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
  }

  const recent = history.slice(-3).map((turn, index) => ({
    turn: index + 1,
    userSaid: turn.answer,
    filtersChanged: turn.extractedFilters.map(filter => `${filter.field}: ${filter.value}`),
  }))
  const state = filters.map(filter => `${filter.field}: ${filter.value} (${filter.op})`).join(", ")

  try {
    const raw = await provider.complete(
      `모호한 후속 수정 발화를 직전 추천 문맥으로 다시 해석하세요.

메시지: "${msg}"
직전 대화: ${JSON.stringify(recent, null, 2)}
현재 필터: ${state || "(없음)"}

해석 규칙:
- "그거 말고"는 직전 해석/적용값을 제외하거나 교체하려는 뜻입니다.
- "더 큰 거" 같은 표현은 가장 최근 숫자 필터를 다시 조정하려는 뜻입니다.
- "아니 X를 말한 거야"는 X가 실제 target field/value 라는 correction signal입니다.
- "진짜 너 말 안듣는다", "내 말은 그게 아니고", "그게 아니라"는 직전 semantic parse를 다시 보라는 repair signal입니다.
- 문맥이 충분하면 더 구체적인 수정 문장으로 바꾸고, 충분하지 않으면 원문을 그대로 돌려도 됩니다.

출력은 JSON 한 개만:
{"clarified":"구체화된 문장","explanation":"해석 근거 1문장"}`,
      [{ role: "user", content: "해석하세요." }],
      200,
      "haiku",
      "turn-repair",
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
    const parsed = JSON.parse(match[0])
    if (typeof parsed.clarified !== "string" || !parsed.clarified.trim()) {
      return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
    }
    console.log(`[turn-repair] "${msg}" -> "${parsed.clarified}"`)
    return {
      clarifiedMessage: parsed.clarified,
      wasRepaired: true,
      repairExplanation: typeof parsed.explanation === "string" ? parsed.explanation : null,
    }
  } catch (error) {
    console.warn("[turn-repair] failed:", (error as Error).message)
    return { clarifiedMessage: msg, wasRepaired: false, repairExplanation: null }
  }
}
