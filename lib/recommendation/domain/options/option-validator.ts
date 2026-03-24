/**
 * Option Validator — Enforces Option-First Architecture
 *
 * INVARIANT: displayedOptions is the ONLY source of truth for actionable choices.
 * Chips are presentation derived from displayedOptions.
 * Answer text must NEVER be the source of chip generation.
 *
 * This validator ensures:
 * 1. Chips are a subset of displayedOptions (no orphan chips)
 * 2. Answer text does not contain actionable phrases absent from displayedOptions
 * 3. The pipeline order is enforced: options → chips → answer (never reverse)
 *
 * Deterministic. No LLM calls.
 */

import type { DisplayedOption } from "@/lib/recommendation/domain/types"
import type { UnifiedTurnContext } from "@/lib/recommendation/domain/context/turn-context-builder"

// ── Actionable phrase patterns that indicate a selectable action ──
const ACTIONABLE_PHRASE_PATTERNS: Array<{ pattern: RegExp; actionType: string }> = [
  // Direct action suggestions
  { pattern: /둘\s*다\s*보기/, actionType: "compare_both" },
  { pattern: /함께\s*보기/, actionType: "view_together" },
  { pattern: /비교해?\s*보기?/, actionType: "compare" },
  { pattern: /비교해?\s*볼까요/, actionType: "compare" },
  { pattern: /비교해?\s*드릴까요/, actionType: "compare" },
  { pattern: /코팅\s*(다시\s*)?선택/, actionType: "select_coating" },
  { pattern: /다른\s*조건\s*보기/, actionType: "other_conditions" },
  { pattern: /다른\s*조건으로/, actionType: "other_conditions" },
  { pattern: /절삭조건\s*확인/, actionType: "cutting_conditions" },
  { pattern: /대체\s*후보/, actionType: "alternatives" },
  { pattern: /대안.*보기/, actionType: "alternatives" },
  { pattern: /다시\s*선택/, actionType: "reselect" },
  { pattern: /다시\s*찾아/, actionType: "research" },
  // Binary action suggestions in text
  { pattern: /예\s*[/·]\s*아니요/, actionType: "binary_yes_no" },
  { pattern: /진행\s*[/·]\s*취소/, actionType: "binary_proceed" },
  // Suggestion patterns ("~해보세요", "~하시겠어요?")
  { pattern: /선택해\s*보세요/, actionType: "suggest_select" },
  { pattern: /클릭해\s*보세요/, actionType: "suggest_click" },
  { pattern: /눌러\s*보세요/, actionType: "suggest_click" },
  { pattern: /골라\s*보세요/, actionType: "suggest_pick" },
  // Korean action verb endings that suggest immediate action
  { pattern: /해\s*보시겠어요\s*\?/, actionType: "suggest_action" },
  { pattern: /하시겠어요\s*\?/, actionType: "suggest_action" },
  { pattern: /할까요\s*\?/, actionType: "suggest_action" },
  { pattern: /볼까요\s*\?/, actionType: "suggest_action" },
  { pattern: /드릴까요\s*\?/, actionType: "suggest_action" },
]

// ── Soft replacement templates ──
const SOFT_REPLACEMENTS: Record<string, string> = {
  compare_both: "필요하시면 말씀해주세요",
  view_together: "필요하시면 말씀해주세요",
  compare: "비교가 필요하시면 말씀해주세요",
  select_coating: "코팅 관련해서 말씀해주세요",
  other_conditions: "다른 조건이 필요하시면 말씀해주세요",
  cutting_conditions: "절삭조건이 궁금하시면 말씀해주세요",
  alternatives: "대체 후보가 필요하시면 말씀해주세요",
  reselect: "변경이 필요하시면 말씀해주세요",
  research: "다시 검색이 필요하시면 말씀해주세요",
  binary_yes_no: "",
  binary_proceed: "",
  suggest_select: "아래 선택지를 참고해주세요",
  suggest_click: "아래 선택지를 참고해주세요",
  suggest_pick: "아래 선택지를 참고해주세요",
  suggest_action: "",
}

export interface OptionValidationResult {
  /** Whether the pipeline is valid (no unauthorized actions) */
  isValid: boolean
  /** Actions found in answer text without matching displayedOption */
  unauthorizedActions: Array<{ phrase: string; actionType: string }>
  /** Corrected answer text (null if no correction needed) */
  correctedAnswer: string | null
  /** Orphan chips (chips with no matching displayedOption) */
  orphanChips: string[]
  /** Validated chips (only chips that map to displayedOptions) */
  validatedChips: string[]
}

/**
 * Validate that chips are derived from displayedOptions and answer text
 * does not introduce unauthorized actionable choices.
 *
 * This is the post-answer validator required by the option-first architecture.
 */
export function validateOptionFirstPipeline(
  answerText: string,
  chips: string[],
  displayedOptions: DisplayedOption[],
  turnContext?: UnifiedTurnContext | null
): OptionValidationResult {
  const effectiveDisplayedOptions = displayedOptions.length > 0
    ? displayedOptions
    : (turnContext?.sessionState?.displayedOptions ?? [])
  const effectiveChips = chips.length > 0
    ? chips
    : (turnContext?.sessionState?.displayedChips ?? [])
  const unauthorizedActions: Array<{ phrase: string; actionType: string }> = []
  let correctedAnswer = answerText

  // ── 1. Check answer text for unauthorized actionable phrases ──
  for (const { pattern, actionType } of ACTIONABLE_PHRASE_PATTERNS) {
    const match = answerText.match(pattern)
    if (!match) continue

    const phrase = match[0]

    // Check if this action has a corresponding displayedOption
    // Use semantic root matching: extract the core action word from the phrase
    const phraseRoot = extractActionRoot(phrase)
    const hasMatchingOption = effectiveDisplayedOptions.some(o => {
      const optLabel = o.label.toLowerCase().replace(/\s+/g, "")
      const optValue = o.value.toLowerCase().replace(/\s+/g, "")

      // Match if the option contains the action root or vice versa
      return (
        optLabel.includes(phraseRoot) ||
        optValue.includes(phraseRoot) ||
        phraseRoot.includes(optValue.slice(0, Math.min(optValue.length, 4)))
      )
    })

    // Also check chips for a match
    const hasMatchingChip = effectiveChips.some(c => {
      const chipNorm = c.toLowerCase().replace(/\s+/g, "")
      return (
        chipNorm.includes(phraseRoot) ||
        phraseRoot.includes(chipNorm.slice(0, Math.min(chipNorm.length, 4)))
      )
    })

    if (!hasMatchingOption && !hasMatchingChip) {
      unauthorizedActions.push({ phrase, actionType })
      const replacement = SOFT_REPLACEMENTS[actionType] ?? ""
      if (replacement) {
        correctedAnswer = correctedAnswer.replace(pattern, replacement)
      }
    }
  }

  // ── 2. Validate chips against displayedOptions ──
  const orphanChips: string[] = []
  const validatedChips: string[] = []
  // Meta chips that are always allowed (navigation, skip, etc.)
  const META_CHIPS = new Set(["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요", "⟵ 이전 단계로 돌아가기"])

  for (const chip of effectiveChips) {
    if (META_CHIPS.has(chip)) {
      validatedChips.push(chip)
      continue
    }

    // Check if chip maps to a displayedOption
    const hasOption = effectiveDisplayedOptions.some(o =>
      o.label === chip || o.value === chip ||
      chip.startsWith(o.value) || o.label.startsWith(chip.replace(/\s*\(\d+개\)\s*$/, ""))
    )

    if (hasOption || effectiveDisplayedOptions.length === 0) {
      // If no displayedOptions exist, allow chips (legacy paths)
      validatedChips.push(chip)
    } else {
      orphanChips.push(chip)
    }
  }

  const hasDivergence = unauthorizedActions.length > 0

  return {
    isValid: !hasDivergence && orphanChips.length === 0,
    unauthorizedActions,
    correctedAnswer: hasDivergence ? correctedAnswer : null,
    orphanChips,
    validatedChips,
  }
}

/**
 * Extract the core action root from a Korean phrase for semantic matching.
 * E.g. "비교해 보기" → "비교", "다시 선택" → "다시선택", "절삭조건 확인" → "절삭조건"
 */
function extractActionRoot(phrase: string): string {
  const norm = phrase.toLowerCase().replace(/\s+/g, "")
  // Remove verb endings and particles
  const cleaned = norm
    .replace(/해?\s*보기?$/, "")
    .replace(/해?\s*볼까요$/, "")
    .replace(/해?\s*드릴까요$/, "")
    .replace(/하시겠어요\?*$/, "")
    .replace(/할까요\?*$/, "")
    .replace(/볼까요\?*$/, "")
    .replace(/드릴까요\?*$/, "")
    .replace(/해\s*보세요$/, "")
    .replace(/을$|를$|도$|이$|가$/, "")
    .trim()
  return cleaned || norm.slice(0, 2)
}

/**
 * Derive chips from displayedOptions.
 * This is the canonical way to produce chips in the option-first pipeline.
 *
 * Order: displayedOptions → chips (never reverse)
 */
export function deriveChipsFromOptions(
  displayedOptions: DisplayedOption[],
  includeMetaChips: boolean = true
): string[] {
  const chips: string[] = []

  for (const option of displayedOptions) {
    chips.push(option.label)
  }

  if (includeMetaChips && chips.length > 0) {
    if (!chips.includes("상관없음")) {
      chips.push("상관없음")
    }
  }

  return chips
}

/**
 * Build displayedOptions from smart options and derive chips from them.
 * Single entry point for option-first chip generation.
 *
 * Returns { displayedOptions, chips } guaranteed to be consistent.
 */
export function buildConsistentOptionsAndChips(
  displayedOptions: DisplayedOption[],
  includeMetaChips: boolean = true
): { displayedOptions: DisplayedOption[]; chips: string[] } {
  return {
    displayedOptions,
    chips: deriveChipsFromOptions(displayedOptions, includeMetaChips),
  }
}
