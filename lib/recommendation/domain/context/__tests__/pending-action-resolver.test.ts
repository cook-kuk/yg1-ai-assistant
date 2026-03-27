/**
 * Pending Action Resolver — Tests
 *
 * Tests:
 * 1. isAffirmativeReply: true for "응", "네", "좋아", etc.
 * 2. isAffirmativeReply: false for "3날", "재고 먼저"
 * 3. isExplicitOverride: true for "아니 3날로"
 * 4. shouldExecutePendingAction: execute=true for affirmative + valid pendingAction
 * 5. shouldExecutePendingAction: execute=false when expired
 * 6. shouldExecutePendingAction: execute=false for explicit override
 * 7. pendingActionToFilter: converts correctly
 */

import { describe, it, expect } from "vitest"
import {
  isAffirmativeReply,
  isExplicitOverride,
  shouldExecutePendingAction,
  pendingActionToFilter,
} from "../pending-action-resolver"
import type { PendingAction } from "@/lib/types/exploration"

function makePendingAction(overrides?: Partial<PendingAction>): PendingAction {
  return {
    type: "apply_filter",
    label: "4날 (32개)",
    payload: { field: "fluteCount", value: "4날" },
    sourceTurnId: "turn-1",
    createdAt: 3,
    expiresAfterTurns: 2,
    ...overrides,
  }
}

// ════════════════════════════════════════════════════════════════
// 1. isAffirmativeReply — positive cases
// ════════════════════════════════════════════════════════════════

describe("isAffirmativeReply", () => {
  it.each([
    "응", "네", "예", "좋아", "좋아요", "그래", "그걸로", "그렇게",
    "진행", "해줘", "ㄱㄱ", "ㅇㅇ", "ㅇ", "고고", "ok", "yes", "sure", "go",
    "응!", "네.", "OK", "Yes",
  ])('returns true for "%s"', (msg) => {
    expect(isAffirmativeReply(msg)).toBe(true)
  })

  // ── negative cases ──
  it.each([
    "3날", "재고 먼저", "비교해줘", "4날로 해줘", "아니", "다른거",
    "TiAlN 코팅", "뭔지 설명해줘",
  ])('returns false for "%s"', (msg) => {
    expect(isAffirmativeReply(msg)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// 2. isExplicitOverride
// ════════════════════════════════════════════════════════════════

describe("isExplicitOverride", () => {
  it("returns true for long messages (>10 chars)", () => {
    expect(isExplicitOverride("아니 3날로 변경해줘", [])).toBe(true)
  })

  it("returns true for negation verbs", () => {
    expect(isExplicitOverride("아니", [])).toBe(true)
    expect(isExplicitOverride("말고", [])).toBe(true)
    expect(isExplicitOverride("대신", [])).toBe(true)
    expect(isExplicitOverride("비교", [])).toBe(true)
  })

  it("returns true when message matches a displayed chip", () => {
    expect(isExplicitOverride("3날", ["3날", "4날"])).toBe(true)
  })

  it("returns false for short non-override messages", () => {
    expect(isExplicitOverride("응", [])).toBe(false)
    expect(isExplicitOverride("네", [])).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// 3. shouldExecutePendingAction
// ════════════════════════════════════════════════════════════════

describe("shouldExecutePendingAction", () => {
  it("returns execute:true for affirmative reply with valid pending action", () => {
    const result = shouldExecutePendingAction(
      makePendingAction({ createdAt: 3 }),
      "응",
      4, // currentTurn = 4, createdAt = 3, within 2-turn expiry
      []
    )
    expect(result.execute).toBe(true)
    expect(result.reason).toBe("affirmative_bind")
  })

  it("returns execute:false when no pending action", () => {
    const result = shouldExecutePendingAction(null, "응", 4, [])
    expect(result.execute).toBe(false)
    expect(result.reason).toBe("no_pending_action")
  })

  it("returns execute:false when expired", () => {
    const result = shouldExecutePendingAction(
      makePendingAction({ createdAt: 1, expiresAfterTurns: 2 }),
      "응",
      10, // currentTurn=10, createdAt=1 → diff=9 > 2
      []
    )
    expect(result.execute).toBe(false)
    expect(result.reason).toBe("expired")
  })

  it("returns execute:false for explicit override", () => {
    const result = shouldExecutePendingAction(
      makePendingAction({ createdAt: 3 }),
      "아니 3날로 변경해줘",
      4,
      []
    )
    expect(result.execute).toBe(false)
    expect(result.reason).toBe("explicit_override")
  })

  it("returns execute:false for chip selection (explicit override)", () => {
    const result = shouldExecutePendingAction(
      makePendingAction({ createdAt: 3 }),
      "3날",
      4,
      ["3날", "4날"]
    )
    expect(result.execute).toBe(false)
    expect(result.reason).toBe("explicit_override")
  })

  it("returns execute:false for non-affirmative short message", () => {
    const result = shouldExecutePendingAction(
      makePendingAction({ createdAt: 3 }),
      "뭐야",
      4,
      []
    )
    expect(result.execute).toBe(false)
    expect(result.reason).toBe("not_affirmative")
  })
})

// ════════════════════════════════════════════════════════════════
// 4. pendingActionToFilter
// ════════════════════════════════════════════════════════════════

describe("pendingActionToFilter", () => {
  it("converts apply_filter action to AppliedFilter", () => {
    const action = makePendingAction()
    const filter = pendingActionToFilter(action)
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("fluteCount")
    expect(filter!.value).toBe("4날")
    expect(filter!.op).toBe("eq")
    expect(filter!.rawValue).toBe("4날")
  })

  it("returns null for non-apply_filter type", () => {
    const action = makePendingAction({ type: "open_comparison" })
    expect(pendingActionToFilter(action)).toBeNull()
  })

  it("returns null when payload.field is missing", () => {
    const action = makePendingAction({ payload: { value: "4날" } })
    expect(pendingActionToFilter(action)).toBeNull()
  })

  it("returns null when payload.value is missing", () => {
    const action = makePendingAction({ payload: { field: "fluteCount" } })
    expect(pendingActionToFilter(action)).toBeNull()
  })
})
