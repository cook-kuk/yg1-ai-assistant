/**
 * Pending Action Resolver
 *
 * Determines whether an incoming user message should trigger
 * execution of a previously proposed (pending) action.
 *
 * Lifecycle: assistant proposes -> set pendingAction -> user replies ->
 *   affirmative? execute & clear : override/expire? clear : keep
 */

import type { PendingAction, AppliedFilter } from "@/lib/recommendation/domain/types"

// ── Affirmative detection ──────────────────────────────────────
const AFFIRMATIVE_PATTERNS = /^(응|네|예|좋아|좋아요|그래|그걸로|그렇게|진행|해줘|ㄱㄱ|ㅇㅇ|ㅇ|고고|ok|yes|sure|go)[\s!.]*$/i

export function isAffirmativeReply(message: string): boolean {
  return AFFIRMATIVE_PATTERNS.test(message.trim())
}

// ── Explicit override detection ────────────────────────────────
export function isExplicitOverride(message: string, displayedChips: string[]): boolean {
  const trimmed = message.trim()
  // Longer messages are likely explicit instructions
  if (trimmed.length > 10) return true
  // Contains action/negation verbs
  if (/아니|말고|대신|비교|재고|먼저|다른|변경|바꿔/.test(trimmed)) return true
  // Matches a displayed chip (explicit selection, not affirmative)
  if (displayedChips.some(chip => chip === trimmed)) return true
  return false
}

// ── Main decision function ─────────────────────────────────────
export function shouldExecutePendingAction(
  pendingAction: PendingAction | null | undefined,
  userMessage: string,
  currentTurn: number,
  displayedChips: string[]
): { execute: boolean; reason: string } {
  if (!pendingAction) return { execute: false, reason: "no_pending_action" }

  // Check expiration
  if (currentTurn - pendingAction.createdAt > pendingAction.expiresAfterTurns) {
    return { execute: false, reason: "expired" }
  }

  // Check explicit override first (higher priority)
  if (isExplicitOverride(userMessage, displayedChips)) {
    return { execute: false, reason: "explicit_override" }
  }

  // Check affirmative
  if (isAffirmativeReply(userMessage)) {
    return { execute: true, reason: "affirmative_bind" }
  }

  return { execute: false, reason: "not_affirmative" }
}

// ── Convert pending action to AppliedFilter ────────────────────
export function pendingActionToFilter(action: PendingAction): AppliedFilter | null {
  if (action.type !== "apply_filter" || !action.payload.field || !action.payload.value) return null
  return {
    field: action.payload.field,
    op: "eq",
    value: action.payload.value,
    rawValue: action.payload.value,
    appliedAt: 0, // caller should overwrite
  }
}
