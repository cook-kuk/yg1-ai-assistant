import { describe, test, expect } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

describe("parseDeterministic bare-mm", () => {
  test("10mm → diameterMm=10", () => {
    const r = parseDeterministic("10mm")
    expect(r.find(a => a.field === "diameterMm")?.value).toBe(10)
  })
  test("8.5 mm", () => {
    const r = parseDeterministic("8.5 mm")
    expect(r.find(a => a.field === "diameterMm")?.value).toBe(8.5)
  })
})
