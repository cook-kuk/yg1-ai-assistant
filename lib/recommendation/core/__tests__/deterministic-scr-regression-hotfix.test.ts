import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

describe("deterministic-scr regression hotfix", () => {
  it("parses Korean between range phrasing", () => {
    const action = parseDeterministic("직경 8에서 12 사이").find(candidate => candidate.field === "diameterMm")
    expect(action?.op).toBe("between")
    expect(action?.value).toBe(8)
    expect((action as { value2?: number } | undefined)?.value2).toBe(12)
  })

  it("detects instock phrasing", () => {
    const action = parseDeterministic("재고 있는 거 보여줘").find(candidate => candidate.field === "stockStatus")
    expect(action?.op).toBe("eq")
    expect(action?.value).toBe("instock")
  })

  it("detects coolant-hole negation", () => {
    const action = parseDeterministic("쿨런트 홀 없는 거").find(candidate => candidate.field === "coolantHole")
    expect(action?.op).toBe("eq")
    expect(action?.value).toBe("false")
  })
})
