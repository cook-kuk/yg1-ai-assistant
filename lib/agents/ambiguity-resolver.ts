/**
 * Ambiguity Resolver Agent — Opus
 *
 * Handles vague utterances that require deep reasoning:
 *   "그 전 걸로", "아까 그거", "이 중 더 좋은 거", "처음 기준으로 다시"
 *
 * Uses full session history, stage snapshots, and displayed products
 * to resolve ambiguous references.
 *
 * Only invoked when the Orchestrator detects high ambiguity.
 */

import type { LLMProvider } from "@/lib/llm/provider"
import type { ExplorationSessionState, CandidateSnapshot } from "@/lib/types/exploration"
import type { NarrowingIntent, AmbiguityResolution } from "./types"

/**
 * Escalation threshold — when to invoke Opus instead of handling deterministically.
 */
export function needsOpusResolution(
  message: string,
  intentConfidence: number,
  sessionState: ExplorationSessionState | null
): boolean {
  // Low confidence from Haiku → escalate
  if (intentConfidence < 0.5) return true

  // Vague reference patterns that need full context reasoning
  const vaguePatterns = [
    /아까\s*(그|저)/, /그\s*전\s*걸/, /이\s*중/, /위에.*거/,
    /처음\s*기준/, /원래\s*거/, /방금\s*그/, /저번에/,
    /더\s*좋은/, /더\s*나은/, /어떤\s*게\s*나/, /뭐가\s*더/,
  ]
  if (vaguePatterns.some(p => p.test(message))) return true

  // Pronoun-heavy messages with active session
  if (sessionState && /^(그거|이거|저거|그것|이것|그게)\s*/.test(message.trim())) return true

  return false
}

/**
 * Resolve ambiguous user message using Opus.
 */
export async function resolveAmbiguity(
  message: string,
  sessionState: ExplorationSessionState,
  displayedProducts: CandidateSnapshot[] | null,
  provider: LLMProvider
): Promise<AmbiguityResolution> {
  const startMs = Date.now()

  // Build rich context for Opus
  const stageHistorySummary = (sessionState.stageHistory ?? []).map((s, i) =>
    `  Stage ${i}: ${s.stageName} (후보 ${s.candidateCount}개)${s.filterApplied ? ` ← ${s.filterApplied.field}=${s.filterApplied.value}` : " (초기)"}`
  ).join("\n")

  const filtersSummary = sessionState.appliedFilters.map(f =>
    `  - ${f.field}=${f.value} (step ${f.appliedAt})`
  ).join("\n")

  const displayedSummary = displayedProducts?.slice(0, 10).map(p =>
    `  #${p.rank} ${p.displayCode}${p.displayLabel ? ` [${p.displayLabel}]` : ""} | ${p.seriesName ?? "?"} | φ${p.diameterMm ?? "?"}mm | ${p.fluteCount ?? "?"}F | ${p.coating ?? "?"} | ${p.matchStatus} ${p.score}점`
  ).join("\n") ?? "(표시된 제품 없음)"

  const narrowingHistorySummary = sessionState.narrowingHistory.map((h, i) =>
    `  Turn ${i + 1}: Q="${h.question}" → A="${h.answer}" (${h.candidateCountBefore}→${h.candidateCountAfter}개)`
  ).join("\n") || "(없음)"

  const systemPrompt = `You are an ambiguity resolver for a Korean industrial cutting tool recommendation system.

The user said something ambiguous during an active recommendation session. Your job is to figure out
what they actually mean by analyzing the full session state, stage history, displayed products, and
conversation history.

RESPOND WITH JSON ONLY:
{
  "resolvedIntent": "<one of: SET_PARAMETER, SELECT_OPTION, ASK_RECOMMENDATION, ASK_COMPARISON, GO_BACK_ONE_STEP, GO_BACK_TO_SPECIFIC_STAGE, RESET_SESSION, ASK_EXPLANATION, ASK_REASON>",
  "resolvedValue": "<extracted value if applicable, e.g. 'Square' for go-back, or '1,2' for comparison targets>",
  "resolvedTargets": ["1번", "2번"] or null,
  "explanation": "<Korean: 1-2 sentences explaining your interpretation>",
  "confidence": 0.0-1.0
}`

  const userPrompt = `=== 현재 세션 상태 ===
후보 수: ${sessionState.candidateCount}개
해결 상태: ${sessionState.resolutionStatus}
턴: ${sessionState.turnCount}

[적용된 필터]
${filtersSummary || "(없음)"}

[단계 이력]
${stageHistorySummary || "(없음)"}

[대화 이력]
${narrowingHistorySummary}

[현재 표시된 제품]
${displayedSummary}

=== 사용자 메시지 ===
"${message}"`

  try {
    const raw = await provider.complete(systemPrompt, [{ role: "user", content: userPrompt }], 1500, "opus", "ambiguity-resolver")
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))

    const durationMs = Date.now() - startMs
    console.log(`[ambiguity-resolver:opus] Resolved "${message}" → ${parsed.resolvedIntent} (${parsed.confidence}) in ${durationMs}ms`)
    console.log(`[ambiguity-resolver:opus] Explanation: ${parsed.explanation}`)

    return {
      resolvedIntent: parsed.resolvedIntent as NarrowingIntent,
      resolvedValue: parsed.resolvedValue ?? undefined,
      resolvedTargets: parsed.resolvedTargets ?? undefined,
      explanation: parsed.explanation ?? "해석 불가",
      confidence: parsed.confidence ?? 0.5,
      modelUsed: "opus",
    }
  } catch (e) {
    console.warn("[ambiguity-resolver:opus] Failed:", e)
    return {
      resolvedIntent: "ASK_EXPLANATION",
      resolvedValue: undefined,
      explanation: "해석에 실패했습니다. 좀 더 구체적으로 말씀해주세요.",
      confidence: 0.2,
      modelUsed: "opus",
    }
  }
}
