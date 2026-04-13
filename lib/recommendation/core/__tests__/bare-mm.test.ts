import { describe, test, expect } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

describe("parseDeterministic bare-mm", () => {
  test("10mm alone no longer defaults to diameter", () => {
    const r = parseDeterministic("10mm")
    expect(r.find(a => a.field === "diameterMm")).toBeUndefined()
  })
  test("8.5 mm alone no longer defaults to diameter", () => {
    const r = parseDeterministic("8.5 mm")
    expect(r.find(a => a.field === "diameterMm")).toBeUndefined()
  })
  test("10mm은 chipBreaker=MM false-positive 없음", () => {
    const r = parseDeterministic("10mm")
    expect(r.find(a => a.field === "chipBreaker")).toBeUndefined()
  })
})
