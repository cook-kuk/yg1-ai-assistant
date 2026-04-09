/**
 * Deterministic chip ranker.
 *
 * Replaces the old LLM-based reranker. Chips are just "pick top 4–6 from
 * deterministic candidates and order them" — no LLM needed. Scoring uses
 * signals already present in ChipContext.
 */

import type { SmartOption } from "./types"
import type { ChipContext } from "../context/chip-context-builder"

export interface RankedResult {
  options: SmartOption[]
  rerankedByLLM: false
}

const MAX_CHIPS = 6

export function rankChipsDeterministic(
  candidates: SmartOption[],
  chipContext: ChipContext,
): RankedResult {
  if (candidates.length <= 4) {
    return { options: candidates, rerankedByLLM: false }
  }

  const pendingField = chipContext.pendingQuestion?.field ?? null
  const answered = new Set(chipContext.answeredFields)
  const confused =
    chipContext.userState === "confused" ||
    chipContext.userState === "uncertain" ||
    chipContext.userState === "wants_explanation" ||
    chipContext.userState === "wants_delegation"

  const scored = candidates.map((opt, index) => {
    let score = opt.priorityScore ?? 0

    // 1. Pending question alignment — strongest signal
    if (pendingField && opt.field === pendingField) score += 1000

    // 2. Confusion helpers (explain / delegate / any / dontknow)
    if (confused) {
      const id = opt.id.toLowerCase()
      if (
        id.includes("explain") ||
        id.includes("delegate") ||
        id.includes("dontknow") ||
        id.includes("any") ||
        id.includes("help")
      ) {
        score += 500
      }
    }

    // 3. Already-answered field → demote (don't re-ask)
    if (opt.field && answered.has(opt.field)) score -= 200

    // 4. Reset goes to the bottom unless user explicitly asked
    if (opt.family === "reset") score -= 800

    // 5. Soft preferences
    if (opt.preservesContext) score += 10
    if (opt.destructive) score -= 20
    if (opt.recommended) score += 30

    return { opt, score, index }
  })

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))

  return {
    options: scored.slice(0, MAX_CHIPS).map(s => s.opt),
    rerankedByLLM: false,
  }
}
