import { describe, it, expect } from "vitest"
import { resolvePendingQuestionReply } from "../serve-engine-runtime"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeSession(pendingField: string): ExplorationSessionState {
  return {
    turnCount: 1,
    candidateCount: 50,
    appliedFilters: [],
    narrowingHistory: [],
    resolvedInput: {},
    displayedCandidates: [],
    displayedChips: ["Y-Coating", "AlTiN", "\uC0C1\uAD00\uC5C6\uC74C"],
    displayedOptions: [
      { index: 1, label: "Y-Coating", field: "coating", value: "Y-Coating", count: 8 },
      { index: 2, label: "AlTiN", field: "coating", value: "AlTiN", count: 4 },
    ],
    lastAskedField: pendingField,
    currentMode: "recommendation",
  } as unknown as ExplorationSessionState
}

describe("J06: pending-question det-SCR fallback", () => {
  it("defers a coating recommendation request instead of early-committing the deterministic candidate", () => {
    const session = makeSession("coating")
    const message = "Y \uCF54\uD305\uC73C\uB85C \uCD94\uCC9C\uD574\uC918"
    const reply = resolvePendingQuestionReply(session, message)

    expect(["unresolved", "defer_holistic"]).toContain(reply.kind)
    if (reply.kind === "unresolved" || reply.kind === "defer_holistic") {
      expect(reply.pendingField).toBe("coating")
      expect(reply.raw).toBe(message)
    }
  })
})
