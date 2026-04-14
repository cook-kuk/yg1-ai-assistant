import { describe, expect, test } from "vitest"

import { assessComplexity, canUseResolverStage } from "../complexity-router"

describe("assessComplexity", () => {
  test("routes simple numeric filters to the fast path", () => {
    const decision = assessComplexity("10mm 이상")

    expect(decision.level).toBe("light")
    expect(decision.reason).toBe("deterministic_numeric")
    expect(decision.resolverStageBudget).toBe("stage1")
    expect(decision.allowLegacyLlmFallback).toBe(false)
    expect(decision.allowToolForge).toBe(false)
    expect(decision.runSelfCorrection).toBe(false)
    expect(decision.generateCoT).toBe(false)
    expect(decision.uiThinkingMode).toBe("hidden")
  })

  test("keeps chip-click style values on the fast path", () => {
    const decision = assessComplexity("4날 (1558개)")

    expect(decision.level).toBe("light")
    expect(decision.resolverStageBudget).toBe("stage1")
    expect(decision.uiThinkingMode).toBe("hidden")
    expect(decision.generateCoT).toBe(false)
  })

  test("routes clear compound recommendation requests to the normal path", () => {
    const decision = assessComplexity("4날 Square 추천")

    expect(decision.level).toBe("normal")
    expect(decision.reason).toBe("compound_recommendation")
    expect(decision.resolverStageBudget).toBe("stage2")
    expect(decision.allowLegacyLlmFallback).toBe(false)
    expect(decision.allowToolForge).toBe(false)
    expect(decision.runSelfCorrection).toBe(false)
    expect(decision.generateCoT).toBe(false)
    expect(decision.uiThinkingMode).toBe("simple")
  })

  test("routes negation and generic follow-ups to the deep path", () => {
    const decision = assessComplexity("티타늄 말고 뭐가 좋아?")

    expect(decision.level).toBe("deep")
    expect(decision.reason).toBe("negation")
    expect(decision.resolverStageBudget).toBe("stage3")
    expect(decision.allowLegacyLlmFallback).toBe(true)
    expect(decision.allowToolForge).toBe(true)
    expect(decision.runSelfCorrection).toBe(true)
    expect(decision.generateCoT).toBe(true)
    expect(decision.uiThinkingMode).toBe("full")
  })

  test("routes low-info uncertainty messages to deep with CoT", () => {
    const decision = assessComplexity("나는 아무것도 몰라요")

    expect(decision.level).toBe("deep")
    expect(decision.reason).toBe("low_info_clarification")
    expect(decision.generateCoT).toBe(true)
    expect(decision.uiThinkingMode).toBe("full")
  })

  test("routes domain-only messages (industry keyword w/o specifics) to deep", () => {
    const decision = assessComplexity("에어로스페이스에서 씁니다")

    expect(decision.level).toBe("deep")
    expect(decision.reason).toBe("domain_only")
    expect(decision.generateCoT).toBe(true)
  })
})

describe("canUseResolverStage", () => {
  test("enforces the configured resolver budget", () => {
    const fast = assessComplexity("4날")
    const normal = assessComplexity("4날 Square 추천")
    const deep = assessComplexity("티타늄 말고 뭐가 좋아?")

    expect(canUseResolverStage(fast, "stage1")).toBe(true)
    expect(canUseResolverStage(fast, "stage2")).toBe(false)
    expect(canUseResolverStage(fast, "stage3")).toBe(false)

    expect(canUseResolverStage(normal, "stage1")).toBe(true)
    expect(canUseResolverStage(normal, "stage2")).toBe(true)
    expect(canUseResolverStage(normal, "stage3")).toBe(false)

    expect(canUseResolverStage(deep, "stage1")).toBe(true)
    expect(canUseResolverStage(deep, "stage2")).toBe(true)
    expect(canUseResolverStage(deep, "stage3")).toBe(true)
  })
})
