import { describe, expect, it } from "vitest"

import {
  canonicalizeKnownEntityValue,
  findKnownEntityMentions,
  getKnownEntityValues,
} from "../entity-registry"

describe("entity-registry", () => {
  it("canonicalizes known series names from the shared registry", () => {
    expect(canonicalizeKnownEntityValue("series", "v7 plus")).toBe("V7 PLUS")
    expect(canonicalizeKnownEntityValue("series", "x-power pro")).toBe("X-POWER PRO")
  })

  it("finds multiword entity mentions without regex whitelists", () => {
    expect(findKnownEntityMentions("series", "V7 PLUS와 X-POWER PRO 비교")).toEqual([
      "X-POWER PRO",
      "V7 PLUS",
    ])
  })

  it("exposes canonical values for downstream prompt/query layers", () => {
    const seriesValues = getKnownEntityValues("series")

    expect(seriesValues).toContain("V7 PLUS")
    expect(seriesValues).toContain("X-POWER PRO")
  })
})
