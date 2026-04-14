import { describe, expect, test } from "vitest"

import { assessComplexity, canUseResolverStage } from "../complexity-router"

// complexity-router는 더 이상 regex 기반 의도 분류기가 아니다.
// 빈 입력만 light로 단축, 나머지는 전부 LLM(+semantic cache)에 위임한다.
describe("assessComplexity", () => {
  test("empty string → light/empty_input", () => {
    const decision = assessComplexity("")
    expect(decision.level).toBe("light")
    expect(decision.reason).toBe("empty_input")
    expect(decision.uiThinkingMode).toBe("hidden")
    expect(decision.generateCoT).toBe(false)
  })

  test("whitespace-only → light/empty_input", () => {
    const decision = assessComplexity("   ")
    expect(decision.level).toBe("light")
    expect(decision.reason).toBe("empty_input")
  })

  test("compound recommendation → normal/llm_decides", () => {
    const decision = assessComplexity("스테인리스 10mm 4날")
    expect(decision.level).toBe("normal")
    expect(decision.reason).toBe("llm_decides")
    expect(decision.resolverStageBudget).toBe("stage2")
  })

  test("greeting/chatter → normal (LLM decides)", () => {
    const decision = assessComplexity("안녕하세요")
    expect(decision.level).toBe("normal")
    expect(decision.reason).toBe("llm_decides")
  })

  test("low-info uncertainty → normal (no more 28s deep cascade)", () => {
    const decision = assessComplexity("난 아무것도 모르는 신입사원이야")
    expect(decision.level).toBe("normal")
    expect(decision.reason).toBe("llm_decides")
  })

  test("generic-best request → normal (LLM decides, not regex-promoted)", () => {
    const decision = assessComplexity("여기서 제일 좋은 거 골라줘")
    expect(decision.level).toBe("normal")
    expect(decision.reason).toBe("llm_decides")
  })
})

describe("canUseResolverStage", () => {
  test("light(empty) → stage1만 허용", () => {
    const empty = assessComplexity("")
    expect(canUseResolverStage(empty, "stage1")).toBe(true)
    expect(canUseResolverStage(empty, "stage2")).toBe(false)
    expect(canUseResolverStage(empty, "stage3")).toBe(false)
  })

  test("normal → stage1·stage2 허용, stage3 차단", () => {
    const normal = assessComplexity("스테인리스 10mm 4날")
    expect(canUseResolverStage(normal, "stage1")).toBe(true)
    expect(canUseResolverStage(normal, "stage2")).toBe(true)
    expect(canUseResolverStage(normal, "stage3")).toBe(false)
  })

  test("decision 미지정 → 기본 stage3 풀버짓", () => {
    expect(canUseResolverStage(null, "stage1")).toBe(true)
    expect(canUseResolverStage(null, "stage2")).toBe(true)
    expect(canUseResolverStage(null, "stage3")).toBe(true)
  })
})
