/**
 * Answer / Chip Divergence Guard — Option-First Architecture
 *
 * RULE: displayedOptions is the ONLY source of truth for actionable choices.
 * Chips are presentation derived from displayedOptions.
 * Answer text must NEVER create new chips.
 *
 * This guard:
 * 1. Detects actionable phrases in answer text
 * 2. Checks whether each maps to an existing displayedOption
 * 3. If NOT, the answer is REWRITTEN to remove the unauthorized action
 *    (never the other way around — we do NOT add chips from text)
 *
 * Deterministic. No LLM calls.
 */

import type { DisplayedOption } from "@/lib/recommendation/domain/types"

// ── Action phrases the answer might suggest ──
const ACTIONABLE_PATTERNS: Array<{ pattern: RegExp; actionLabel: string; replacement: string }> = [
  { pattern: /둘\s*다\s*보기/, actionLabel: "둘 다 보기", replacement: "원하시면 말씀해주세요" },
  { pattern: /함께\s*보기/, actionLabel: "함께 보기", replacement: "원하시면 말씀해주세요" },
  { pattern: /비교해?\s*보기?/, actionLabel: "비교 보기", replacement: "비교가 필요하시면 말씀해주세요" },
  { pattern: /코팅\s*(다시\s*)?선택/, actionLabel: "코팅 선택", replacement: "코팅 관련해서 말씀해주세요" },
  { pattern: /다른\s*조건\s*보기/, actionLabel: "다른 조건", replacement: "다른 조건이 필요하시면 말씀해주세요" },
  { pattern: /절삭조건\s*확인/, actionLabel: "절삭조건", replacement: "절삭조건이 궁금하시면 말씀해주세요" },
  { pattern: /대체\s*후보/, actionLabel: "대체 후보", replacement: "대체 후보가 필요하시면 말씀해주세요" },
  { pattern: /대안.*보기/, actionLabel: "대안 보기", replacement: "대안이 필요하시면 말씀해주세요" },
  { pattern: /다시\s*선택/, actionLabel: "다시 선택", replacement: "변경이 필요하시면 말씀해주세요" },
]

export interface DivergenceCheckResult {
  /** Whether a divergence was detected */
  hasDivergence: boolean
  /** Actions mentioned in the answer that have no matching option */
  unauthorizedActions: string[]
  /** The corrected answer text with unauthorized actions softened */
  correctedAnswer: string | null
}

/**
 * Check if the answer text contains actionable phrases not backed by displayedOptions.
 *
 * Returns corrective signals — the direction is always:
 * displayedOptions → constrain answer (NEVER answer → add chips)
 */
export function checkAnswerChipDivergence(
  answerText: string,
  chips: string[],
  displayedOptions: DisplayedOption[]
): DivergenceCheckResult {
  const unauthorizedActions: string[] = []
  let correctedAnswer = answerText

  for (const { pattern, actionLabel, replacement } of ACTIONABLE_PATTERNS) {
    if (!pattern.test(answerText)) continue

    // Check if there's a matching chip or option
    const hasMatchingChip = chips.some(c =>
      c.toLowerCase().includes(actionLabel.slice(0, 3).toLowerCase())
    )
    const hasMatchingOption = displayedOptions.some(o =>
      o.label.toLowerCase().includes(actionLabel.slice(0, 3).toLowerCase()) ||
      o.value.toLowerCase().includes(actionLabel.slice(0, 3).toLowerCase())
    )

    if (!hasMatchingChip && !hasMatchingOption) {
      unauthorizedActions.push(actionLabel)
      // Soften the actionable phrase in the answer (don't remove entirely — soften)
      correctedAnswer = correctedAnswer.replace(pattern, replacement)
    }
  }

  return {
    hasDivergence: unauthorizedActions.length > 0,
    unauthorizedActions,
    correctedAnswer: unauthorizedActions.length > 0 ? correctedAnswer : null,
  }
}

/**
 * @deprecated Use correctedAnswer from checkAnswerChipDivergence instead.
 * This function is kept for backward compatibility but now returns chips unchanged.
 * The option-first architecture does NOT add chips from answer text.
 */
export function fixChipDivergence(
  currentChips: string[],
  _divergence: DivergenceCheckResult,
  _maxChips: number = 8
): string[] {
  // Option-first: NEVER add chips from answer text.
  // Return chips unchanged.
  return currentChips
}
