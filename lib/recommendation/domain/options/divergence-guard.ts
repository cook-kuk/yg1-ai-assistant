/**
 * Answer / Chip Divergence Guard
 *
 * If the answer text presents something as an actionable next step,
 * that action must also be representable in displayedOptions/chips.
 *
 * This guard detects when the answer suggests one thing but the chips
 * show something else, and returns corrective signals.
 *
 * Deterministic. No LLM calls.
 */

import type { DisplayedOption } from "@/lib/recommendation/domain/types"

// ── Action phrases the answer might suggest ──
const ACTIONABLE_PATTERNS: Array<{ pattern: RegExp; actionLabel: string; chipTemplate: string }> = [
  { pattern: /둘\s*다\s*보기/, actionLabel: "둘 다 보기", chipTemplate: "둘 다 보기" },
  { pattern: /함께\s*보기/, actionLabel: "함께 보기", chipTemplate: "함께 보기" },
  { pattern: /비교해?\s*보기?/, actionLabel: "비교 보기", chipTemplate: "비교해줘" },
  { pattern: /코팅\s*(다시\s*)?선택/, actionLabel: "코팅 선택", chipTemplate: "코팅 변경" },
  { pattern: /다른\s*조건\s*보기/, actionLabel: "다른 조건", chipTemplate: "다른 조건으로" },
  { pattern: /절삭조건\s*확인/, actionLabel: "절삭조건", chipTemplate: "절삭조건 알려줘" },
  { pattern: /대체\s*후보/, actionLabel: "대체 후보", chipTemplate: "대체 후보 보기" },
  { pattern: /대안.*보기/, actionLabel: "대안 보기", chipTemplate: "대체 후보 보기" },
  { pattern: /다시\s*선택/, actionLabel: "다시 선택", chipTemplate: "다시 선택" },
]

export interface DivergenceCheckResult {
  /** Whether a divergence was detected */
  hasDivergence: boolean
  /** Actions mentioned in the answer that have no matching chip */
  missingChips: string[]
  /** Suggested chips to add to fix divergence */
  suggestedChips: string[]
  /** Actions in the answer that should be removed if no chip can be added */
  answerActionsToRemove: string[]
}

/**
 * Check if the answer text and chips are aligned.
 *
 * Returns a DivergenceCheckResult indicating any mismatches.
 */
export function checkAnswerChipDivergence(
  answerText: string,
  chips: string[],
  displayedOptions: DisplayedOption[]
): DivergenceCheckResult {
  const missingChips: string[] = []
  const suggestedChips: string[] = []
  const answerActionsToRemove: string[] = []

  const chipSet = new Set(chips.map(c => c.toLowerCase()))
  const optionValues = new Set(displayedOptions.map(o => o.value.toLowerCase()))

  for (const { pattern, actionLabel, chipTemplate } of ACTIONABLE_PATTERNS) {
    if (!pattern.test(answerText)) continue

    // Check if there's a matching chip or option
    const hasMatchingChip = chips.some(c =>
      c.toLowerCase().includes(chipTemplate.slice(0, 4).toLowerCase()) ||
      chipTemplate.toLowerCase().includes(c.slice(0, 4).toLowerCase())
    )

    const hasMatchingOption = displayedOptions.some(o =>
      o.label.toLowerCase().includes(chipTemplate.slice(0, 4).toLowerCase()) ||
      o.value.toLowerCase().includes(chipTemplate.slice(0, 4).toLowerCase())
    )

    if (!hasMatchingChip && !hasMatchingOption) {
      missingChips.push(actionLabel)
      suggestedChips.push(chipTemplate)
      answerActionsToRemove.push(actionLabel)
    }
  }

  return {
    hasDivergence: missingChips.length > 0,
    missingChips,
    suggestedChips,
    answerActionsToRemove,
  }
}

/**
 * Fix divergence by adding missing chips (up to a limit).
 * Returns the corrected chip list.
 */
export function fixChipDivergence(
  currentChips: string[],
  divergence: DivergenceCheckResult,
  maxChips: number = 8
): string[] {
  if (!divergence.hasDivergence) return currentChips

  const result = [...currentChips]
  const remaining = maxChips - result.length

  for (const chip of divergence.suggestedChips) {
    if (remaining <= 0) break
    if (!result.includes(chip)) {
      result.push(chip)
    }
  }

  return result.slice(0, maxChips)
}
