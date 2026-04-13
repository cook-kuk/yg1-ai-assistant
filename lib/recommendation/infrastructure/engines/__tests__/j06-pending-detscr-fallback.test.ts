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
    displayedChips: ["Y-Coating", "AlTiN", "상관없음"],
    displayedOptions: [
      { index: 1, label: "Y-Coating", field: "coating", value: "Y-Coating", count: 8 },
      { index: 2, label: "AlTiN", field: "coating", value: "AlTiN", count: 4 },
    ],
    lastAskedField: pendingField,
    currentMode: "recommendation",
  } as unknown as ExplorationSessionState
}

describe("J06: pending-question det-SCR fallback", () => {
  it("'Y 코팅으로 추천해줘' defers det-SCR candidate instead of committing coating=Y-Coating", () => {
    const session = makeSession("coating")
    const r = resolvePendingQuestionReply(session, "Y 코팅으로 추천해줘")
    expect(r.kind).toBe("unresolved")
    if (r.kind === "unresolved") {
      expect(r.pendingField).toBe("coating")
      expect(r.raw).toBe("Y 코팅으로 추천해줘")
    }
  })
})
