import { describe, expect, it } from "vitest"

import {
  canonicalizeMaterialSelection,
  getIntakeDisplayValue,
  getMaterialDisplayValue,
} from "./intake-localization"

describe("intake localization material handling", () => {
  it("keeps ISO material selections as canonical keys", () => {
    expect(canonicalizeMaterialSelection("S")).toBe("S")
    expect(canonicalizeMaterialSelection("p, n")).toBe("P,N")
  })

  it("maps ISO material keys back to localized labels for display", () => {
    expect(getMaterialDisplayValue("S", "ko")).toBe("초내열합금")
    expect(getMaterialDisplayValue("P,N", "en")).toBe("Carbon Steel, Non-ferrous")
  })

  it("formats intake material answers using localized ISO labels", () => {
    expect(getIntakeDisplayValue("material", { status: "known", value: "M" }, "ko")).toBe("스테인리스강")
    expect(getIntakeDisplayValue("material", { status: "known", value: "K,H" }, "en")).toBe("Cast Iron, Hardened Steel")
  })
})
