import { describe, expect, it } from "vitest"

import { classifyQueryTarget } from "../query-target-classifier"

describe("query-target registry integration", () => {
  it("classifies registry-backed multiword series names", () => {
    const result = classifyQueryTarget("V7 PLUS 특징 알려줘", "coating")

    expect(result.type).toBe("series_info")
    expect(result.entities).toContain("V7 PLUS")
  })

  it("keeps registry-backed multiword comparison entities", () => {
    const result = classifyQueryTarget("X-POWER PRO와 V7 PLUS 차이 알려줘", "coating")

    expect(result.type).toBe("series_comparison")
    expect(result.entities).toContain("X-POWER PRO")
    expect(result.entities).toContain("V7 PLUS")
  })
})
