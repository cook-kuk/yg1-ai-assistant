import { describe, expect, it } from "vitest"

import { classifyQueryTarget } from "../query-target-classifier"

describe("query-target company info routing", () => {
  it("treats office questions as company info that override the pending narrowing field", () => {
    const result = classifyQueryTarget(
      "부산영업소에 대해서 알려줘",
      "workPieceName",
      "workPieceName"
    )

    expect(result.type).toBe("company_info")
    expect(result.overridesActiveFilter).toBe(true)
    expect(result.searchScope).toBe("none")
  })
})
