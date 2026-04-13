import { describe, expect, it } from "vitest"

import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"

describe("natural-language alternatives", () => {
  it("splits Korean natural-language alternatives into multi-value filters", () => {
    const filter = parseAnswerToFilter("fluteCount", "2 또는 4")
    expect(filter).not.toBeNull()
    const raw = filter!.rawValue
    expect(Array.isArray(raw)).toBe(true)
    expect(raw).toContain(2)
    expect(raw).toContain(4)
  })
})
