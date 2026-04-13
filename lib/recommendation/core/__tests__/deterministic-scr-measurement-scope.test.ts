import { describe, expect, it } from "vitest"

import { parseDeterministic } from "../deterministic-scr"

describe("deterministic-scr measurement scope", () => {
  it("parses a bare diameter mm phrase without throwing", () => {
    expect(() => parseDeterministic("10mm")).not.toThrow()
  })
})
