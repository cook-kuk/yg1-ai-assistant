import { describe, it, expect } from "vitest"
import { parseDeterministic } from "../lib/recommendation/core/deterministic-scr"

describe("debug deterministic", () => {
  it("prints actions", () => {
    console.log('brand-no', JSON.stringify(parseDeterministic("브랜드 노상관"), null, 2))
    console.log('global-relax', JSON.stringify(parseDeterministic("다 괜찮아 직경만 10mm"), null, 2))
    expect(true).toBe(true)
  })
})
