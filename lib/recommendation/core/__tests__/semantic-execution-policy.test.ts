import { describe, expect, it } from "vitest"

import {
  hasSemanticComparisonCue,
  hasSemanticMutationCue,
  shouldDeferHardcodedSemanticExecution,
} from "../semantic-execution-policy"

describe("semantic execution policy", () => {
  it("detects semantic mutation cues that should skip hardcoded execution", () => {
    expect(hasSemanticMutationCue("2날 말고 4날로")).toBe(true)
    expect(hasSemanticMutationCue("TiAlN 빼고 다른거")).toBe(true)
    expect(hasSemanticMutationCue("브랜드 대신 다른 걸로")).toBe(true)
    expect(hasSemanticMutationCue("anything except TiAlN")).toBe(true)
  })

  it("detects broad comparison cues that should stay LLM-first", () => {
    expect(hasSemanticComparisonCue("CRX S와 V7 비교해줘")).toBe(true)
    expect(hasSemanticComparisonCue("둘 차이점 뭐야")).toBe(true)
    expect(hasSemanticComparisonCue("A vs B")).toBe(true)
  })

  it("keeps closed-form numeric prompts out of the semantic defer bucket", () => {
    expect(shouldDeferHardcodedSemanticExecution("RPM 8000 이상")).toBe(false)
    expect(shouldDeferHardcodedSemanticExecution("재고 100개 이상")).toBe(false)
    expect(shouldDeferHardcodedSemanticExecution("직경 10mm")).toBe(false)
  })
})
