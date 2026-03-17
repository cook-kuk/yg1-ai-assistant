/**
 * Orchestrator — Routing Logic Tests
 *
 * Tests the deterministic routeToAction function.
 */

import { describe, it, expect } from "vitest"
import { routeToAction } from "../orchestrator"
import type { TurnContext } from "../types"
import type { ExplorationSessionState } from "@/lib/types/exploration"

function makeCtx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    userMessage: "test",
    intakeForm: {} as any,
    sessionState: {
      sessionId: "ses-test",
      candidateCount: 50,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: { locale: "en", manufacturerScope: "yg1-only" as const },
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
    },
    resolvedInput: { locale: "en", manufacturerScope: "yg1-only" as const },
    candidateCount: 50,
    displayedProducts: null,
    currentCandidates: [],
    ...overrides,
  }
}

describe("routeToAction — Slot Replacement", () => {
  it("routes CHANGE_SINGLE_VALUED_SLOT with existing filter to replace_slot", () => {
    const ctx = makeCtx({
      sessionState: {
        ...makeCtx().sessionState!,
        appliedFilters: [{ field: "diameterMm", op: "eq", value: "2mm", rawValue: 2, appliedAt: 0 }],
      },
    })
    const params = { diameterMm: 4, modelUsed: "haiku" as const }
    const action = routeToAction("CHANGE_SINGLE_VALUED_SLOT", "4mm", params, ctx)

    expect(action.type).toBe("replace_slot")
    if (action.type === "replace_slot") {
      expect(action.oldFilter.value).toBe("2mm")
      expect(action.newFilter.field).toBe("diameterMm")
    }
  })

  it("routes SET_PARAMETER with existing filter to replace_slot (auto-detect)", () => {
    const ctx = makeCtx({
      sessionState: {
        ...makeCtx().sessionState!,
        appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 }],
      },
    })
    const params = { fluteCount: 2, modelUsed: "haiku" as const }
    const action = routeToAction("SET_PARAMETER", "2날", params, ctx)

    expect(action.type).toBe("replace_slot")
  })

  it("routes SET_PARAMETER without existing filter to continue_narrowing", () => {
    const ctx = makeCtx()
    const params = { fluteCount: 4, modelUsed: "haiku" as const }
    const action = routeToAction("SET_PARAMETER", "4날", params, ctx)

    expect(action.type).toBe("continue_narrowing")
  })
})

describe("routeToAction — Side Conversation & Overlay", () => {
  it("routes SIDE_CONVERSATION to side_conversation action", () => {
    const ctx = makeCtx({ userMessage: "힘들어" })
    const action = routeToAction("SIDE_CONVERSATION", undefined, null, ctx)
    expect(action.type).toBe("side_conversation")
  })

  it("routes SIMPLE_MATH to side_conversation action", () => {
    const ctx = makeCtx({ userMessage: "1+1" })
    const action = routeToAction("SIMPLE_MATH", undefined, null, ctx)
    expect(action.type).toBe("side_conversation")
  })

  it("routes META_CONVERSATION to side_conversation action", () => {
    const ctx = makeCtx({ userMessage: "넌 뭐야?" })
    const action = routeToAction("META_CONVERSATION", undefined, null, ctx)
    expect(action.type).toBe("side_conversation")
  })
})

describe("routeToAction — Scope Confirmation", () => {
  it("routes ASK_SCOPE_CONFIRMATION to confirm_scope", () => {
    const ctx = makeCtx()
    const action = routeToAction("ASK_SCOPE_CONFIRMATION", undefined, null, ctx)
    expect(action.type).toBe("confirm_scope")
  })
})

describe("routeToAction — Return to Recommendation", () => {
  it("routes RETURN_TO_ACTIVE_RECOMMENDATION to show_recommendation when resolved", () => {
    const ctx = makeCtx({
      sessionState: {
        ...makeCtx().sessionState!,
        resolutionStatus: "resolved_exact",
      },
    })
    const action = routeToAction("RETURN_TO_ACTIVE_RECOMMENDATION", undefined, null, ctx)
    expect(action.type).toBe("show_recommendation")
  })

  it("routes RETURN_TO_ACTIVE_RECOMMENDATION to skip_field when not resolved", () => {
    const ctx = makeCtx()
    const action = routeToAction("RETURN_TO_ACTIVE_RECOMMENDATION", undefined, null, ctx)
    expect(action.type).toBe("skip_field")
  })
})

describe("routeToAction — Existing Routes Preserved", () => {
  it("routes RESET_SESSION to reset_session", () => {
    const action = routeToAction("RESET_SESSION", undefined, null, makeCtx())
    expect(action.type).toBe("reset_session")
  })

  it("routes ASK_COMPARISON to compare_products", () => {
    const action = routeToAction("ASK_COMPARISON", "1번,2번", null, makeCtx())
    expect(action.type).toBe("compare_products")
  })

  it("routes GO_BACK_ONE_STEP to go_back_one_step", () => {
    const action = routeToAction("GO_BACK_ONE_STEP", undefined, null, makeCtx())
    expect(action.type).toBe("go_back_one_step")
  })
})
