import { describe, expect, it } from "vitest"

import { resolveYG1Query } from "../knowledge-router"

describe("knowledge router", () => {
  it("returns 부산영업소 from the internal knowledge source", () => {
    const result = resolveYG1Query("부산영업소에 대해서 알려줘")

    expect(result.source).toBe("internal_kb")
    expect(result.answer).toContain("부산영업소")
    expect(result.answer).toContain("051-314-0985")
    expect(result.answer).toContain("YG1_Knowledge_Base_FINAL.md")
    expect(result.needsWebSearch).toBe(false)
  })
})
